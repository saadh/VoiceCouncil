import type { Scorecard } from "../lib/types";

// Phase 3 VERDICT: the scorecard. Shows the synthesis plus each grader model's
// independent score (the multi-model fan-out, made visible for the judges).
export default function ScorecardView({
  scorecard,
  loading,
  onRestart,
}: {
  scorecard: Scorecard | null;
  loading: boolean;
  onRestart: () => void;
}) {
  if (loading || !scorecard) {
    return (
      <div className="card conferring">
        <div className="spinner" />
        <div>
          <strong>The panel is conferring…</strong>
          <p className="muted">
            Three models are grading your interview independently, then
            reconciling.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="verdict">
      <div className="card score-head">
        <div className="overall">
          <div className="overall-num">{scorecard.overall.toFixed(1)}</div>
          <div className="overall-label">/ 10 overall</div>
        </div>
        <div className="graders">
          <div className="graders-label">Panel grades</div>
          <div className="grader-row">
            {scorecard.graders.map((g) => (
              <div key={g.model} className="grader" title={g.comment}>
                <div className="grader-score">{g.overall.toFixed(1)}</div>
                <div className="grader-model">{g.model}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Breakdown</h3>
        {scorecard.dimensions.map((d) => (
          <div key={d.name} className="dim">
            <div className="dim-top">
              <span>{d.name}</span>
              <span className="dim-score">{d.score}/10</span>
            </div>
            <div className="bar">
              <div className="bar-fill" style={{ width: `${d.score * 10}%` }} />
            </div>
            <div className="muted dim-note">{d.note}</div>
          </div>
        ))}
      </div>

      <div className="two-col">
        <div className="card">
          <h3>Red flags</h3>
          <ul className="flags">
            {scorecard.redFlags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h3>Top 3 fixes</h3>
          <ol className="fixes">
            {scorecard.topFixes.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ol>
        </div>
      </div>

      <button className="btn btn--primary btn--lg" onClick={onRestart}>
        Run another interview
      </button>
    </div>
  );
}
