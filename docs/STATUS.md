# VoiceCouncil — Project Status

_Last updated: 2026-06-20. This is the canonical "where are we" record. Also see `docs/DESIGN.md` (full design) and `docs/HANDOFF.md` (earlier handoff)._

## What this is
AI interview panel built for a Voice AI Hackathon (sponsors: Nebius, Vapi, Insforge).
A candidate enters a role (+ optional job description / resume); a 3-persona AI panel
interviews them by voice, then grades them. Three phases:

1. **PREP** ("council war room") — 3 Nebius models negotiate non-overlapping interview
   lanes (one round) → an **Interview Plan** (per-persona focus + questions).
2. **LIVE** — a Vapi voice interview; one fast model runs the 3 personas (Hiring
   Manager / Domain Expert / Bar-raiser), reading from the plan.
3. **VERDICT** — 3 Nebius models grade the transcript in parallel → synthesized
   **scorecard** (dimensions, red flags, top-3 fixes, per-model grades).

## Current working state ✅
The full real flow works end to end against Insforge project **th7dp9ab** (confirmed
by the user 2026-06-19): intake → real council prep plan → live Vapi voice interview →
real scorecard.

### Run it locally
```bash
cd frontend && npm install && npm run dev   # http://localhost:5173
```
- **Real mode** needs `frontend/.env.local` (gitignored; already present on Saad's
  machine) with: `VITE_INSFORGE_BASE_URL`, `VITE_INSFORGE_ANON_KEY`,
  `VITE_INSFORGE_FUNCTIONS_URL=https://th7dp9ab.function2.insforge.app`,
  `VITE_VAPI_PUBLIC_KEY`, `VITE_VAPI_ASSISTANT_ID`.
- **Without those** → MOCK mode (fully clickable with sample data, `MOCK MODE` badge).

## Stack / where things live
| Layer | Location |
|---|---|
| Frontend (Vite + React + TS) | `frontend/` — phases in `src/components/`, data layer `src/lib/api.ts`, client `src/lib/insforge.ts`, Vapi `src/lib/vapi.ts`, mock data `src/lib/mock.ts` |
| Backend edge functions | `backend/functions/` — `prep-plan.ts`, `verdict.ts`, `vapi-llm.ts`, `vapi-webhook.ts`; deploy via `backend/deploy.sh` |
| Voice config | `vapi/assistant.json`, `vapi/system-prompt.md` |
| DB schema | `migrations/` — tables `sessions`, `interview_plans`, `scorecards` |

## Insforge projects (IMPORTANT — there are two)
- **`th7dp9ab` = canonical (Sanjay's project).** Full backend deployed + working.
  Hosts: `https://th7dp9ab.us-east.insforge.app` (data API),
  `https://th7dp9ab.function2.insforge.app` (edge functions). Region assumed
  us-east — confirm.
- **`w3gj444d` = Saad's original.** Only the early spike + schema. **Saad's CLI account
  ONLY sees `w3gj444d`** → Saad cannot deploy / set secrets / read schema on
  `th7dp9ab`. All live backend ops there are **Sanjay's** job (or Sanjay adds Saad to
  the th7dp9ab org).

## Key fixes made (now on `master`, commit `ef06130`)
1. **CORS / function host** (`frontend/src/lib/insforge.ts` + `api.ts`): the
   `@insforge/sdk` `functions.invoke()` targets `{appkey}.functions.insforge.app` →
   **404, CORS-blocked in the browser**, so prep/verdict never ran (council prep hung
   on "conferring"). Fix: `invokeFunction()` fetches the correct
   `{appkey}.function2.insforge.app` host (from `VITE_INSFORGE_FUNCTIONS_URL`).
2. **Transcript persistence** (`persistTranscript()` in `api.ts` +
   `InterviewPanel.tsx`): the Vapi webhook isn't firing for web calls, so the
   transcript was never saved → verdict had nothing to grade → stuck at the verdict
   step. Fix: the interview panel writes its in-browser transcript to the session on
   "End interview," then verdict grades it. (Anon-key PATCH works → HTTP 204.)
3. **Retry backstop**: prep/verdict re-fire the invoke every ~35s while polling, since
   the ~30s edge timeout can kill a slow run before it persists.

## Git history note — the force-push (IMPORTANT)
On 2026-06-20, `master` was **force-pushed** to our working version (`ef06130`),
**replacing Sanjay's 9 pushed commits** (tip was `e63e404`). The user chose a hard
replace with no remote backup.
- **Dropped:** Sanjay's latency fix (commit `feda74f`: faster Nebius models + bounded
  `max_tokens`) and other backend updates. Recoverable from **Sanjay's local clone** or
  GitHub's reflog (dangling `e63e404` / `feda74f`) for a while — not backed up on a
  remote branch.
- **Sanjay must** `git fetch origin && git reset --hard origin/master` (NOT `git pull`)
  to align, or his orphaned commits get re-merged.
- **Net:** `master` = the working frontend but the **older / slower** backend functions.

## Known issues / pending work
1. **Latency (open):** prep & verdict each take ~25–40s. Causes: two sequential LLM hops
   (3 parallel proposals + 1 synthesis), large models (Llama-3.3-70B), **Qwen3-32B
   likely in thinking mode**, and **no `max_tokens` cap**. Sanjay's dropped `feda74f`
   addressed part of this — recover it if wanted. Other levers discussed: disable
   thinking mode, cap `max_tokens` + terser prompts, smaller models, drop the synthesis
   hop (assign lanes in the persona prompts), stream the panel incrementally. All
   backend → **Sanjay deploys**.
2. **Vapi webhook not firing for web calls** — frontend transcript-persist is the
   workaround. Proper fix: set the Vapi assistant's `server.url` (= `…/vapi-webhook`)
   and enable `end-of-call-report`. Vapi-side, Sanjay/Saad.
3. **Rotate the Nebius API key** that was pasted in chat earlier, before going public
   (it's a th7dp9ab secret → Sanjay).
4. **Confirm th7dp9ab region** (assumed us-east).

## Conventions
- Commit co-authors: `Saad <saadh@users.noreply.github.com>` and
  `Sanjay <SanjayDevarajan03@users.noreply.github.com>`. **No Claude co-author trailer.**
- Never commit secrets — `.env`, `.env.local`, `.insforge/` are gitignored.
- **Backend = Insforge only.** A Butterbase MCP may also be connected in some sessions;
  do NOT use it for backend work.
