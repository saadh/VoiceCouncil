import { useEffect, useRef, useState } from "react";
import PanelAvatars from "./PanelAvatars";
import { personaByKey, MOCK_TRANSCRIPT } from "../lib/mock";
import type { PersonaKey, TranscriptLine } from "../lib/types";

// Phase 2 LIVE: the voice interview. The Vapi web call mounts here (TODO).
// For the shell we replay a mock transcript and rotate the active speaker so
// the panel + live-caption UI is demonstrable before Vapi is wired.
export default function InterviewPanel({ onEnd }: { onEnd: () => void }) {
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [active, setActive] = useState<PersonaKey | null>("HM");
  const logRef = useRef<HTMLDivElement>(null);

  // Replay the mock transcript line-by-line.
  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      if (i >= MOCK_TRANSCRIPT.length) {
        clearInterval(id);
        return;
      }
      const line = MOCK_TRANSCRIPT[i];
      setLines((prev) => [...prev, line]);
      if (line.speaker !== "CANDIDATE") setActive(line.speaker);
      i++;
    }, 1400);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  return (
    <div className="interview">
      <PanelAvatars active={active} speaking />

      <div className="card live-call">
        <div className="live-badge">
          <span className="live-dot" /> LIVE · voice
        </div>
        <p className="muted call-note">
          Vapi web call mounts here. Talk to the panel; they take turns from the
          plan and improvise follow-ups.
        </p>
      </div>

      <div className="card transcript" ref={logRef}>
        {lines.length === 0 && <p className="muted">Connecting…</p>}
        {lines.map((l, i) => {
          const isCand = l.speaker === "CANDIDATE";
          const p = isCand ? null : personaByKey(l.speaker);
          return (
            <div
              key={i}
              className={"t-line" + (isCand ? " t-line--me" : "")}
            >
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

      <button className="btn btn--danger btn--lg" onClick={onEnd}>
        End interview &amp; get scorecard
      </button>
    </div>
  );
}
