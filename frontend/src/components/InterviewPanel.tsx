import { useEffect, useRef, useState } from "react";
import PanelAvatars from "./PanelAvatars";
import { personaByKey } from "../lib/mock";
import { persistTranscript } from "../lib/api";
import {
  startInterview,
  VAPI_MOCK_MODE,
  type CallStatus,
  type InterviewCall,
} from "../lib/vapi";
import type {
  InterviewPlan,
  PersonaKey,
  Session,
  TranscriptLine,
} from "../lib/types";

// Phase 2 LIVE: the voice interview.
// With Vapi keys set this mounts a real web call and renders the live transcript
// from Vapi events; without keys it falls back to replaying the mock transcript
// (VAPI_MOCK_MODE). Either way the panel + caption UI is identical.
export default function InterviewPanel({
  onEnd,
  session,
  plan,
}: {
  onEnd: () => void;
  session?: Session | null;
  plan?: InterviewPlan | null;
}) {
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [active, setActive] = useState<PersonaKey | "CANDIDATE" | null>(null);
  const [status, setStatus] = useState<CallStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const callRef = useRef<InterviewCall | null>(null);

  // Start the call on mount, tear it down on unmount.
  useEffect(() => {
    const call = startInterview(
      {
        onLine: (line) => setLines((prev) => [...prev, line]),
        onActiveSpeaker: (who) => setActive(who),
        onStatus: (s, detail) => {
          setStatus(s);
          if (s === "error") setError(detail ?? "Call error");
        },
      },
      {
        sessionId: session?.id,
        variableValues: plan ? planVariables(plan) : undefined,
      },
    );
    callRef.current = call;
    return () => call.stop();
    // session/plan are captured once when the live phase begins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  async function handleEnd() {
    callRef.current?.stop();
    // Write the transcript we collected in-browser before advancing, so the
    // verdict has something to grade (the Vapi webhook isn't firing for web calls).
    if (session?.id) {
      try {
        await persistTranscript(session.id, lines);
      } catch {
        /* best-effort; verdict will report "no transcript" if this failed */
      }
    }
    onEnd();
  }

  const speaking = status === "live";

  return (
    <div className="interview">
      <PanelAvatars
        active={active === "CANDIDATE" ? null : active}
        speaking={speaking}
      />

      <div className="card live-call">
        <div className="live-badge">
          <span className="live-dot" />{" "}
          {status === "live"
            ? "LIVE · voice"
            : status === "connecting"
              ? "Connecting…"
              : status === "ended"
                ? "Call ended"
                : "Connection error"}
        </div>
        <p className="muted call-note">
          {VAPI_MOCK_MODE
            ? "Mock mode — replaying a sample interview. Set VITE_VAPI_PUBLIC_KEY and VITE_VAPI_ASSISTANT_ID in .env.local for a live voice call."
            : "Talk to the panel; they take turns from the plan and improvise follow-ups."}
        </p>
        {error && <p className="call-error">⚠️ {error}</p>}
      </div>

      <div className="card transcript" ref={logRef}>
        {lines.length === 0 && <p className="muted">Connecting…</p>}
        {lines.map((l, i) => {
          const isCand = l.speaker === "CANDIDATE";
          const p = isCand ? null : personaByKey(l.speaker);
          return (
            <div key={i} className={"t-line" + (isCand ? " t-line--me" : "")}>
              <span
                className="t-who"
                style={{ color: isCand ? "#cbd5e1" : p?.color }}
              >
                {isCand ? "You" : p?.name}
              </span>
              <span className="t-text">{l.text}</span>
            </div>
          );
        })}
      </div>

      <button className="btn btn--danger btn--lg" onClick={handleEnd}>
        End interview &amp; get scorecard
      </button>
    </div>
  );
}

// Flatten the interview plan into Vapi {{variable}} values the assistant prompt
// can interpolate (kept as strings — Vapi substitutes them verbatim).
function planVariables(plan: InterviewPlan): Record<string, string> {
  const lanes = plan.lanes
    .map((lane) => {
      const persona = personaByKey(lane.persona)?.title ?? lane.persona;
      const qs = lane.questions.map((q) => `    - ${q}`).join("\n");
      return `${persona} (${lane.persona}) — focus: ${lane.focus}\n${qs}`;
    })
    .join("\n");
  return { interviewPlan: lanes };
}
