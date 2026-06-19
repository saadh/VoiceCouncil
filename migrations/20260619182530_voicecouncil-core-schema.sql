-- VoiceCouncil core schema — three-phase data model
--   Phase 1 PREP    -> interview_plans (council "war room" output)
--   Phase 2 LIVE    -> sessions (+ transcript)
--   Phase 3 VERDICT -> scorecards (multi-model grade + synthesis)
-- Demo sessions are anonymous (no end-user auth), so no RLS user isolation here.

create extension if not exists pgcrypto;

-- One row per interview attempt. Drives the lifecycle status.
create table if not exists sessions (
  id              uuid primary key default gen_random_uuid(),
  role            text not null,                       -- e.g. "Senior Backend Engineer"
  job_description text,                                -- pasted JD (optional)
  resume          text,                                -- pasted resume (optional)
  status          text not null default 'created',     -- created|prepping|ready|interviewing|grading|done
  vapi_call_id    text,                                -- Vapi call id, set when the call starts
  transcript      jsonb,                               -- full end-of-call transcript (source of truth for verdict)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Phase 1 output: the negotiated interview plan. One per session.
create table if not exists interview_plans (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null unique references sessions(id) on delete cascade,
  plan        jsonb not null,    -- final per-persona focus areas + question bank
  negotiation jsonb,             -- round 1 -> round 2 exchange, surfaced on the Plan screen
  created_at  timestamptz not null default now()
);

-- Phase 3 output: the synthesized scorecard. One per session.
create table if not exists scorecards (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null unique references sessions(id) on delete cascade,
  scorecard      jsonb not null, -- synthesis: communication, depth, structure, red flags, top-3 fixes
  grader_results jsonb,          -- each grader model's independent grade (the fan-out)
  created_at     timestamptz not null default now()
);

-- sessions are queried by status while a demo is mid-flight
create index if not exists idx_sessions_status on sessions(status);
-- (interview_plans.session_id and scorecards.session_id are UNIQUE, so already indexed)

-- keep sessions.updated_at fresh on status transitions
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sessions_updated_at on sessions;
create trigger trg_sessions_updated_at
  before update on sessions
  for each row execute function set_updated_at();
