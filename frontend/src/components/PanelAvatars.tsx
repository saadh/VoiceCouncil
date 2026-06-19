import { PERSONAS } from "../lib/mock";
import type { PersonaKey } from "../lib/types";

// The three-persona panel. Highlights the active speaker (drives off the
// [HM]/[EXPERT]/[BAR] tag the live model emits per turn).
export default function PanelAvatars({
  active,
  speaking,
}: {
  active?: PersonaKey | null;
  speaking?: boolean;
}) {
  return (
    <div className="panel-row">
      {PERSONAS.map((p) => {
        const isActive = active === p.key;
        return (
          <div
            key={p.key}
            className={"panelist" + (isActive ? " panelist--active" : "")}
            style={{ ["--accent" as string]: p.color }}
          >
            <div className="panelist-avatar">
              {p.name[0]}
              {isActive && speaking && <span className="speaking-dot" />}
            </div>
            <div className="panelist-name">{p.name}</div>
            <div className="panelist-title">{p.title}</div>
            <div className="panelist-blurb">{p.blurb}</div>
          </div>
        );
      })}
    </div>
  );
}
