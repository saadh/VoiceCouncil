# Handoff — VoiceCouncil (for Sanjay)

Updated 2026-06-19. Saad stepped out; pick up from here.

## TL;DR
AI interview panel. Three phases: **Prep** (3 Nebius models negotiate who asks what) →
**Live** interview over Vapi voice (one fast model) → **Verdict** (3 models grade → scorecard).
Backend = **Insforge** (NOT Butterbase). Full design in `docs/DESIGN.md`.

## ✅ Done (all pushed to `master`)
- **Insforge linked** — project `VoiceCouncil`, host `https://w3gj444d.us-east.insforge.app`.
- **Schema applied + verified** — `sessions`, `interview_plans`, `scorecards` (`migrations/20260619182530_voicecouncil-core-schema.sql`).
- **Streaming spike PASSED** — Insforge edge function streams OpenAI-compatible SSE incrementally (no gateway buffering). Approach C confirmed; no fallback needed. Function: `backend/functions/vapi-llm.ts`, deployed as slug `vapi-llm` → `https://w3gj444d.function2.insforge.app/vapi-llm`. Currently returns a CANNED reply.
- **Dashboard shell** — `frontend/` (Vite + React + TS). Runs in MOCK mode end-to-end with no keys. Builds clean.

## ⏳ Next up (in priority order)
1. **Nebius proxy** (Sanjay was on this) — in `backend/functions/vapi-llm.ts`, replace the canned token loop with a real Nebius streaming call.
   - Set the key as an Insforge secret: `npx @insforge/cli secrets set NEBIUS_API_KEY <key>` (read it in the function via `Deno.env.get("NEBIUS_API_KEY")`).
   - Nebius is OpenAI-compatible: base `https://api.studio.nebius.ai/v1`, POST `/chat/completions` with `stream: true`, pipe its SSE straight through.
   - Redeploy: `npx @insforge/cli -y functions deploy vapi-llm --file backend/functions/vapi-llm.ts`.
   - Re-run the stream test (see Verify below) — chunks must still arrive incrementally.
2. **Fan-out helper** — one function "N Nebius models → synthesize", reused for Prep (`prep-plan`) and Verdict. The frontend `generatePlan()` already calls a `prep-plan` function.
3. **Vapi wiring** (Saad) — point Vapi custom-LLM at the function URL. ⚠️ Verify whether Vapi appends `/chat/completions`; make sure the final POST lands on the function.
4. **Frontend flip to real** — set `VITE_INSFORGE_ANON_KEY` in `frontend/.env.local`, fill the two TODOs in `frontend/src/lib/api.ts` (`generatePlan` invoke, `subscribeScorecard` realtime).

## Pick-up commands
```bash
git pull origin master

# Insforge (Sanjay links his own CLI context if needed)
npx @insforge/cli current          # confirm linked to VoiceCouncil
npx @insforge/cli metadata         # tables/functions/secrets state
npx @insforge/cli functions list

# Frontend
cd frontend && npm install && npm run dev   # http://localhost:5173 (mock mode)
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
