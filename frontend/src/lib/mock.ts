// Mock data so the dashboard is clickable end-to-end before Nebius/Vapi land.
// Everything here gets replaced by real Insforge reads once the backend phases
// (Prep fan-out, live call, Verdict fan-out) are wired.

import type {
  InterviewPlan,
  Persona,
  Scorecard,
  TranscriptLine,
} from "./types";

export const PERSONAS: Persona[] = [
  {
    key: "HM",
    name: "Dana",
    title: "Hiring Manager",
    color: "#5b9cff",
    blurb: "Behavioral — ownership, conflict, impact.",
  },
  {
    key: "EXPERT",
    name: "Raj",
    title: "Domain Expert",
    color: "#41d4a8",
    blurb: "Deep technical follow-ups in your stack.",
  },
  {
    key: "BAR",
    name: "Mara",
    title: "Bar-raiser",
    color: "#f5a623",
    blurb: "Pressure-tests weak or hand-wavy answers.",
  },
];

export const personaByKey = (key: string) =>
  PERSONAS.find((p) => p.key === key);

export const MOCK_PLAN: InterviewPlan = {
  negotiation: [
    { persona: "HM", round: 1, text: "I'll take leadership and a conflict-resolution story." },
    { persona: "EXPERT", round: 1, text: "I'll go deep on system design and their API work from the resume." },
    { persona: "BAR", round: 1, text: "I'll probe scaling tradeoffs and pressure-test vague claims." },
    { persona: "EXPERT", round: 2, text: "Mara, you take scaling — I'll narrow to data modeling so we don't overlap." },
    { persona: "BAR", round: 2, text: "Deal. I'll own scaling + failure modes and skip data modeling." },
    { persona: "HM", round: 2, text: "I'll add a 'why this company' close so we cover motivation." },
  ],
  lanes: [
    {
      persona: "HM",
      focus: "Leadership, conflict, motivation",
      questions: [
        "Tell me about a time you owned a project end to end.",
        "Describe a disagreement with a teammate and how it resolved.",
        "Why this role, and why now?",
      ],
    },
    {
      persona: "EXPERT",
      focus: "System design & data modeling",
      questions: [
        "Walk me through the API you built on your resume — what would you change?",
        "How would you model the data for a multi-tenant version?",
        "Where are the consistency boundaries in that design?",
      ],
    },
    {
      persona: "BAR",
      focus: "Scaling & failure modes",
      questions: [
        "That design — where does it fall over at 100x traffic?",
        "What's the failure mode you're least prepared for?",
        "You said 'it just scales' — defend that.",
      ],
    },
  ],
};

export const MOCK_TRANSCRIPT: TranscriptLine[] = [
  { speaker: "HM", text: "Thanks for joining. Tell me about a project you owned end to end." },
  { speaker: "CANDIDATE", text: "I led the billing rewrite last year..." },
  { speaker: "EXPERT", text: "On that rewrite — how did you handle idempotency for retries?" },
  { speaker: "CANDIDATE", text: "We used an idempotency key per request stored in Redis." },
  { speaker: "BAR", text: "And when Redis is partitioned mid-write? Walk me through it." },
];

export const MOCK_SCORECARD: Scorecard = {
  overall: 7.3,
  dimensions: [
    { name: "Communication", score: 8, note: "Clear structure, good signposting." },
    { name: "Technical depth", score: 7, note: "Solid, but thin on failure modes." },
    { name: "Structure (STAR)", score: 8, note: "Strong situation/result framing." },
    { name: "Composure under pressure", score: 6, note: "Wobbled on the partition follow-up." },
  ],
  redFlags: ["Claimed 'it just scales' without backing it up."],
  topFixes: [
    "Prepare one concrete failure-mode story with metrics.",
    "When pressed, pause and reason out loud instead of asserting.",
    "Quantify impact — say 'cut latency 40%', not 'a lot'.",
  ],
  graders: [
    { model: "llama-3.1-8b", overall: 7, comment: "Good clarity, light on depth." },
    { model: "qwen-2.5-32b", overall: 7.5, comment: "Strong structure, composure dipped." },
    { model: "deepseek-v3", overall: 7.4, comment: "Solid; failure-mode prep needed." },
  ],
};
