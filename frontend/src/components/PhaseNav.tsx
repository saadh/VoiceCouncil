import type { Phase } from "../lib/types";

const STEPS: { key: Phase; label: string }[] = [
  { key: "intake", label: "Setup" },
  { key: "prep", label: "Council prep" },
  { key: "interview", label: "Interview" },
  { key: "verdict", label: "Scorecard" },
];

export default function PhaseNav({ phase }: { phase: Phase }) {
  const idx = STEPS.findIndex((s) => s.key === phase);
  return (
    <nav className="phasenav">
      {STEPS.map((s, i) => (
        <div
          key={s.key}
          className={
            "phase-step" +
            (i === idx ? " is-current" : "") +
            (i < idx ? " is-done" : "")
          }
        >
          <span className="phase-dot">{i < idx ? "✓" : i + 1}</span>
          <span className="phase-label">{s.label}</span>
        </div>
      ))}
    </nav>
  );
}
