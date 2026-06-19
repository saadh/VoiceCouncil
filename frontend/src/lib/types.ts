// Shared types for the VoiceCouncil dashboard.
// These mirror the Insforge schema (sessions / interview_plans / scorecards).

export type Phase = "intake" | "prep" | "interview" | "verdict";

export type PersonaKey = "HM" | "EXPERT" | "BAR";

export interface Persona {
  key: PersonaKey;
  name: string; // panelist display name
  title: string; // their role on the panel
  color: string; // accent color for cards/highlights
  blurb: string; // one-line description of what they probe
}

export type SessionStatus =
  | "created"
  | "prepping"
  | "ready"
  | "interviewing"
  | "grading"
  | "done";

export interface Session {
  id: string;
  role: string;
  job_description?: string | null;
  resume?: string | null;
  status: SessionStatus;
  vapi_call_id?: string | null;
  created_at?: string;
}

// Phase 1 PREP output (interview_plans.plan + .negotiation)
export interface PlanLane {
  persona: PersonaKey;
  focus: string; // the focus area this persona claimed
  questions: string[]; // seeded question bank
}

export interface NegotiationTurn {
  persona: PersonaKey;
  round: 1 | 2;
  text: string; // what this model said while dividing lanes
}

export interface InterviewPlan {
  lanes: PlanLane[];
  negotiation: NegotiationTurn[];
}

// Live transcript line
export interface TranscriptLine {
  speaker: PersonaKey | "CANDIDATE";
  text: string;
}

// Phase 3 VERDICT output (scorecards.scorecard + .grader_results)
export interface ScoreDimension {
  name: string;
  score: number; // 0-10
  note: string;
}

export interface GraderResult {
  model: string; // which Nebius model graded
  overall: number;
  comment: string;
}

export interface Scorecard {
  overall: number; // 0-10
  dimensions: ScoreDimension[];
  redFlags: string[];
  topFixes: string[];
  graders: GraderResult[]; // the fan-out: each model's independent grade
}
