import { useEffect, useState } from "react";
import PhaseNav from "./components/PhaseNav";
import IntakeForm from "./components/IntakeForm";
import PrepPanel from "./components/PrepPanel";
import InterviewPanel from "./components/InterviewPanel";
import ScorecardView from "./components/ScorecardView";
import {
  createSession,
  generatePlan,
  subscribeScorecard,
  type IntakeInput,
} from "./lib/api";
import { MOCK_MODE } from "./lib/insforge";
import type { InterviewPlan, Phase, Scorecard, Session } from "./lib/types";

export default function App() {
  const [phase, setPhase] = useState<Phase>("intake");
  const [session, setSession] = useState<Session | null>(null);
  const [plan, setPlan] = useState<InterviewPlan | null>(null);
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [busy, setBusy] = useState(false);

  // Phase 0 -> 1: create session, then run the council prep.
  async function handleIntake(input: IntakeInput) {
    setBusy(true);
    const s = await createSession(input);
    setSession(s);
    setBusy(false);
    setPhase("prep");
    setPlan(null);
    const p = await generatePlan(s.id);
    setPlan(p);
  }

  // Phase 3: subscribe to the scorecard fan-out when we enter the verdict phase.
  useEffect(() => {
    if (phase !== "verdict" || !session) return;
    setScorecard(null);
    const unsub = subscribeScorecard(session.id, setScorecard);
    return unsub;
  }, [phase, session]);

  function restart() {
    setSession(null);
    setPlan(null);
    setScorecard(null);
    setPhase("intake");
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">⚖️</span> VoiceCouncil
          <span className="brand-sub">AI Interview Panel</span>
        </div>
        {MOCK_MODE && <span className="mock-pill">MOCK MODE</span>}
      </header>

      <PhaseNav phase={phase} />

      <main className="stage">
        {phase === "intake" && (
          <IntakeForm onSubmit={handleIntake} busy={busy} />
        )}
        {phase === "prep" && (
          <PrepPanel
            plan={plan}
            loading={!plan}
            onStart={() => setPhase("interview")}
          />
        )}
        {phase === "interview" && (
          <InterviewPanel onEnd={() => setPhase("verdict")} />
        )}
        {phase === "verdict" && (
          <ScorecardView
            scorecard={scorecard}
            loading={!scorecard}
            onRestart={restart}
          />
        )}
      </main>

      <footer className="foot muted">
        Vapi voice · Nebius multi-model panel · Insforge backend
      </footer>
    </div>
  );
}
