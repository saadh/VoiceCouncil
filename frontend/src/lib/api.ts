// Data layer. Each function has a real Insforge path and a mock fallback so the
// UI is identical whether or not the backend is wired. TODOs mark where the
// backend phases (Prep fan-out, Vapi call, Verdict fan-out) plug in.

import { insforge, invokeFunction, MOCK_MODE } from "./insforge";
import { MOCK_PLAN, MOCK_SCORECARD } from "./mock";
import type {
  InterviewPlan,
  Scorecard,
  Session,
  TranscriptLine,
} from "./types";

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
//
// Latency note: the fan-out (3 parallel proposals + a synthesis pass) routinely
// runs ~30s, which brushes CloudFront's hard ~30s edge timeout — so the invoke's
// HTTP response is NOT a reliable signal (it can 504 a beat before the function
// finishes writing the row). We therefore treat the invoke purely as a trigger
// and poll the `interview_plans` row it upserts — the same poll-the-canonical-row
// approach `subscribeScorecard` uses for the verdict. The row is the source of
// truth regardless of whether the edge connection survived.
export async function generatePlan(sessionId: string): Promise<InterviewPlan> {
  if (MOCK_MODE || !insforge) {
    await wait(1500);
    return MOCK_PLAN;
  }

  // If a plan already exists (re-entry / double-invoke), return it immediately.
  const existing = await readPlan(sessionId);
  if (existing) return existing;

  // Fire the fan-out. Don't await its result for success — a 504/timeout here is
  // expected when the function outlives the edge timeout; the poll below decides.
  const fire = () =>
    invokeFunction("prep-plan", { session_id: sessionId }).catch(() => {
      /* edge timeout / transient — the interview_plans poll is canonical */
    });
  fire();

  // The fan-out runs ~25-40s, right at the ~30s edge timeout, so a cold/slow run
  // can be KILLED before it persists the row. Re-fire periodically until the row
  // appears (a warm re-invoke usually completes in ~25s). Idempotent: prep-plan
  // upserts one row per session.
  for (let i = 1; i <= 150; i++) {
    await wait(1000);
    const plan = await readPlan(sessionId);
    if (plan) return plan;
    if (i % 35 === 0) fire(); // retry a dropped / timed-out invoke
  }
  throw new Error("Prep timed out — the panel did not return a plan.");
}

async function readPlan(sessionId: string): Promise<InterviewPlan | null> {
  if (!insforge) return null;
  const { data } = await insforge.database
    .from("interview_plans")
    .select("plan")
    .eq("session_id", sessionId)
    .limit(1);
  const row = (data as Array<{ plan: InterviewPlan }> | null)?.[0];
  return row?.plan ?? null;
}

// Persist the transcript the interview panel collected in-browser so the verdict
// can grade it. The Vapi end-of-call webhook is meant to write this, but it isn't
// firing for web calls — and the frontend already has every line. We write it
// directly in the shape verdict expects ({ lines, raw }), then trigger grading.
export async function persistTranscript(
  sessionId: string,
  lines: TranscriptLine[],
): Promise<void> {
  if (MOCK_MODE || !insforge || lines.length === 0) return;
  const raw = lines.map((l) => `${l.speaker}: ${l.text}`).join("\n");
  await insforge.database
    .from("sessions")
    .update({ transcript: { lines, raw }, status: "grading" })
    .eq("id", sessionId);
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
  // The webhook triggers `verdict`, but its fan-out runs right at the ~30s edge
  // timeout and can be killed before writing the scorecard (same race as prep).
  // Re-fire verdict ourselves as a backstop until the row appears. Idempotent:
  // verdict upserts one scorecard per session.
  const fire = () =>
    invokeFunction("verdict", { session_id: sessionId }).catch(() => {});
  fire();
  (async () => {
    // Poll until the verdict fan-out writes the scorecard row.
    for (let i = 1; i <= 150 && !cancelled; i++) {
      const { data } = await insforge!.database
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
      if (i % 35 === 0) fire(); // retry a dropped / timed-out invoke
    }
  })();
  return () => {
    cancelled = true;
  };
}
