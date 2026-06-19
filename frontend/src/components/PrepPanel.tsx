import PanelAvatars from "./PanelAvatars";
import { personaByKey } from "../lib/mock";
import type { InterviewPlan } from "../lib/types";

// Phase 1 PREP: the council "war room". Shows the live negotiation (round 1 ->
// round 2) and the final divided plan. The negotiation is the multi-agent
// demo asset — three models visibly dividing coverage.
export default function PrepPanel({
  plan,
  loading,
  onStart,
}: {
  plan: InterviewPlan | null;
  loading: boolean;
  onStart: () => void;
}) {
  return (
    <div className="prep">
      <PanelAvatars />

      {loading || !plan ? (
        <div className="card conferring">
          <div className="spinner" />
          <div>
            <strong>The council is conferring…</strong>
            <p className="muted">
              Three models are dividing focus areas so they don't ask the same
              things.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="card">
            <h3>How they divided the work</h3>
            <div className="negotiation">
              {plan.negotiation.map((t, i) => {
                const p = personaByKey(t.persona);
                return (
                  <div key={i} className="nego-line">
                    <span
                      className="nego-chip"
                      style={{ background: p?.color }}
                    >
                      {p?.name} · R{t.round}
                    </span>
                    <span>{t.text}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="lanes">
            {plan.lanes.map((lane) => {
              const p = personaByKey(lane.persona);
              return (
                <div
                  key={lane.persona}
                  className="card lane"
                  style={{ ["--accent" as string]: p?.color }}
                >
                  <div className="lane-head">
                    <span className="lane-name">{p?.name}</span>
                    <span className="lane-title">{p?.title}</span>
                  </div>
                  <div className="lane-focus">{lane.focus}</div>
                  <ul>
                    {lane.questions.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          <button className="btn btn--primary btn--lg" onClick={onStart}>
            Start the interview →
          </button>
        </>
      )}
    </div>
  );
}
