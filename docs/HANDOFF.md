# Handoff — VoiceCouncil (for Sanjay)

Updated 2026-06-19. All code is written and committed on branch `Sanjay`; what
remains is deploy/ops, blocked on Insforge org access (see below).

## TL;DR
AI interview panel. Three phases: **Prep** (3 Nebius models negotiate who asks what) →
**Live** interview over Vapi voice (one fast model) → **Verdict** (3 models grade → scorecard).
Backend = **Insforge** (NOT Butterbase). Full design in `docs/DESIGN.md`.

## ✅ Done (code committed on `Sanjay`)
- **Insforge linked** — project `VoiceCouncil`, host `https://w3gj444d.us-east.insforge.app`.
- **Schema applied + verified** — `sessions`, `interview_plans`, `scorecards` (`migrations/20260619182530_voicecouncil-core-schema.sql`).
- **Streaming spike PASSED** — Insforge edge function streams OpenAI-compatible SSE incrementally (no gateway buffering). Approach C confirmed.
- **`vapi-llm`** — real Nebius streaming proxy (canned loop removed). Strips Vapi-only fields, pipes upstream SSE straight through. `backend/functions/vapi-llm.ts`.
- **`vapi-webhook`** — end-of-call-report handler: normalizes the transcript (parses `[HM]/[EXPERT]/[BAR]` tags), PATCHes the session row, best-effort triggers Verdict. `backend/functions/vapi-webhook.ts`.
- **`prep-plan`** — Phase 1 fan-out: 3 Nebius models propose lanes in parallel → synthesis divides non-overlapping coverage → upserts `interview_plans`. `backend/functions/prep-plan.ts`.
- **`verdict`** — Phase 3 fan-out: 3 models grade in parallel (tolerant) → synthesis → upserts `scorecards`. `backend/functions/verdict.ts`.
- **Frontend wired to real backend** — `generatePlan()` invokes `prep-plan`; `subscribeScorecard()` polls the `scorecards` row (see realtime note below); live interview uses the Vapi Web SDK (`frontend/src/lib/vapi.ts`), passing `metadata.sessionId` so the webhook can correlate the call. Builds clean (`npm run build`).
- **Vapi assistant config** — `vapi/assistant.json` (custom-LLM → `vapi-llm`, server.url → `vapi-webhook`), system prompt in `vapi/system-prompt.md`.
- **Deploy script** — `backend/deploy.sh` deploys all four functions in one command.

## ⏳ Next up — deploy/ops only (code is done)
0. **Unblock Insforge access** (the gate for everything below) — the CLI account
   must be a member of the project's org. Either Saad adds you, or direct-link
   with the project API key. Confirm with `npx @insforge/cli current`.
1. **Set secrets** (once): `NEBIUS_API_KEY`, `INSFORGE_PROJECT_URL`, `INSFORGE_API_KEY`
   via `npx @insforge/cli secrets add <NAME> <value>`. Optional vars in `.env.example`.
   Set `VERDICT_FUNCTION_URL=https://w3gj444d.function2.insforge.app/verdict` so the
   webhook auto-starts grading.
2. **Deploy all functions**: `bash backend/deploy.sh` (or a single slug as an arg).
   Re-run the stream test below — chunks must still arrive incrementally.
3. **Vapi wiring** — point the assistant's custom-LLM at `https://w3gj444d.function2.insforge.app/vapi-llm`
   and server.url at `…/vapi-webhook`. ⚠️ Vapi appends `/chat/completions` to the
   model URL — make sure the final POST lands on the function. Re-PATCH the assistant
   if the stale "Wellness Partners" first/voicemail messages are still live.
4. **Frontend flip to real** — set `VITE_INSFORGE_ANON_KEY` in `frontend/.env.local`
   (Vapi public key + assistant id are already there). With it set, MOCK mode turns off.
5. **Rotate the Nebius key** that was pasted in chat earlier, before going live.

### Realtime note (why `subscribeScorecard` polls)
Insforge realtime is **socket.io channel pub/sub**, not a Postgres table-change feed
— it only delivers if a publisher emits to a channel, and there's no HTTP publish
route (verified against the SDK). A single-file Deno function can't publish without
embedding a socket.io client, and a late subscriber would miss the event anyway
(no replay). So the poll against the `verdict`-written `scorecards` row is the
canonical delivery path. If a server-side publisher is added later, layer a
realtime listener on top and keep the poll as the backstop.

## Pick-up commands
```bash
git checkout Sanjay && git pull origin Sanjay

# Insforge (Sanjay links his own CLI context if needed)
npx @insforge/cli current          # confirm linked to VoiceCouncil
npx @insforge/cli metadata         # tables/functions/secrets state
npx @insforge/cli functions list

# Deploy all four functions (after secrets are set)
bash backend/deploy.sh

# Frontend
cd frontend && npm install && npm run dev   # http://localhost:5173 (mock mode)
cd frontend && npm run build                # production build sanity check
```

## Verify the streaming spike (after Nebius swap)
```bash
curl -N -s -X POST https://w3gj444d.function2.insforge.app/vapi-llm \
  -H "Content-Type: application/json" \
  -d '{"model":"<nebius-model>","stream":true,"messages":[{"role":"user","content":"hi"}]}' \
  | while IFS= read -r l; do [ -n "$l" ] && printf '%s  %s\n' "$(date +%H:%M:%S)" "$l"; done
# PASS = chunks arrive across several seconds, not all at once at the end.
```

## Conventions
- Commits credit **Saad** and **Sanjay** (no Claude co-author trailer).
- Never commit keys: `.insforge/project.json`, `.env`, `.env.local` are gitignored.
- Backend = Insforge only. A Butterbase MCP is also connected in some sessions — do NOT use it for backend.
