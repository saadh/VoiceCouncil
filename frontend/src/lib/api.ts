// Data layer. Each function has a real Insforge path and a mock fallback so the
// UI is identical whether or not the backend is wired. TODOs mark where the
// backend phases (Prep fan-out, Vapi call, Verdict fan-out) plug in.

import { insforge, MOCK_MODE } from "./insforge";
import { MOCK_PLAN, MOCK_SCORECARD } from "./mock";
import type { InterviewPlan, Scorecard, Session } from "./types";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mockId = () => "mock-" + Math.random().toString(36).slice(2, 10);

export interface IntakeInput {
  role: string;
  jobDescription?: string;
  resume?: string;
}

// Create a session row (Phase 0 intake).
export async function createSession(input: IntakeInput): Promise<Session> {
  if (MOCK_MODE || !insforge) {
    await wait(300);
    return {
      id: mockId(),
      role: input.role,
      job_description: input.jobDescription ?? null,
      resume: input.resume ?? null,
      status: "created",
    };
  }
  const { data, error } = await insforge.database
    .from("sessions")
    .insert([
      {
        role: input.role,
        job_description: input.jobDescription ?? null,
        resume: input.resume ?? null,
        status: "created",
      },
    ])
    .select();
  if (error) throw error;
  return (data as Session[])[0];
}

// Phase 1 PREP: run the council "war room" and return the negotiated plan.
// Real path invokes the Insforge `prep-plan` edge function (3 Nebius models
// negotiate lanes -> synthesize); mock path returns MOCK_PLAN after a beat.
export async function generatePlan(sessionId: string): Promise<InterviewPlan> {
  if (MOCK_MODE || !insforge) {
    await wait(1500);
    return MOCK_PLAN;
  }
  const { data, error } = await insforge.functions.invoke("prep-plan", {
    body: { session_id: sessionId },
  });
  if (error) throw error;
  return data as InterviewPlan;
}

// Phase 3 VERDICT: wait for the synthesized scorecard. Mock path resolves after
// a delay to simulate the fan-out "conferring" beat. Returns an unsubscribe fn.
//
// Delivery note: Insforge realtime is socket.io pub/sub (channels), not a
// Postgres table-change feed — it only fires if a publisher emits to a channel.
// The `verdict` function is a single-file Deno function (fetch only, no socket.io
// client), so it can't publish without breaking standalone deploy. We therefore
// poll the `scorecards` row that `verdict` upserts — the canonical source of
// truth. (If a server-side publisher is added later, layer a realtime listener
// on top of this poll, keeping the poll as the backstop against missed events.)
export function subscribeScorecard(
  sessionId: string,
  onScore: (s: Scorecard) => void,
): () => void {
  if (MOCK_MODE || !insforge) {
    const t = setTimeout(() => onScore(MOCK_SCORECARD), 3500);
    return () => clearTimeout(t);
  }
  let cancelled = false;
  (async () => {
    // Poll until the verdict fan-out writes the scorecard row.
    for (let i = 0; i < 60 && !cancelled; i++) {
      const { data } = await insforge.database
        .from("scorecards")
        .select("scorecard")
        .eq("session_id", sessionId)
        .limit(1);
      const row = (data as Array<{ scorecard: Scorecard }> | null)?.[0];
      if (row?.scorecard) {
        onScore(row.scorecard);
        return;
      }
      await wait(1000);
    }
  })();
  return () => {
    cancelled = true;
  };
}
