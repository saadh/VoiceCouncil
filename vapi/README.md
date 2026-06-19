# Vapi assistant config

The live interview phase (Phase 2) runs on a single Vapi assistant that plays all
three panelists. Vapi handles voice, turn-taking, and barge-in; it calls our
Insforge custom-LLM endpoint for each turn and posts the transcript back when the
call ends.

```
Browser (frontend/src/lib/vapi.ts)
  └─ vapi.start(ASSISTANT_ID, { metadata: { sessionId }, variableValues: { interviewPlan } })
        └─ Vapi  ──POST {custom-llm url}/chat/completions──▶  vapi-llm  (Nebius proxy)
        └─ Vapi  ──POST server.url (end-of-call-report)───▶  vapi-webhook  (stores transcript)
```

## Files

- **`system-prompt.md`** — the full panel system prompt (source of truth; the
  condensed copy in `assistant.json` is generated from it).
- **`assistant.json`** — the Vapi assistant definition (model, voice, transcriber,
  server webhook, message subscriptions).

## Create / update the assistant

You need your Vapi **private** key (dashboard → API Keys). Run this yourself —
never commit the key.

```bash
# Create
curl -s https://api.vapi.ai/assistant \
  -H "Authorization: Bearer $VAPI_PRIVATE_KEY" \
  -H "Content-Type: application/json" \
  -d @vapi/assistant.json

# Update an existing assistant
curl -s -X PATCH https://api.vapi.ai/assistant/$VAPI_ASSISTANT_ID \
  -H "Authorization: Bearer $VAPI_PRIVATE_KEY" \
  -H "Content-Type: application/json" \
  -d @vapi/assistant.json
```

The response's `id` is your `VITE_VAPI_ASSISTANT_ID`. Put it (and the **public**
key) in `frontend/.env.local`:

```
VITE_VAPI_PUBLIC_KEY=...     # dashboard → public key (safe for the browser)
VITE_VAPI_ASSISTANT_ID=...   # id returned above
```

Without these two, the interview screen stays in mock mode (replays a sample
transcript) — no Vapi account needed to demo the UI.

## ⚠️ Custom-LLM path (verify before the demo)

Vapi POSTs to **`{model.url}/chat/completions`**, appending the path. With
`model.url` = `https://th7dp9ab.function2.insforge.app/vapi-llm`, the request
lands at `.../vapi-llm/chat/completions`. Confirm Insforge routes that to the
`vapi-llm` function (it ignores the path and reads the body). Quick check:

```bash
curl -N -s -X POST https://th7dp9ab.function2.insforge.app/vapi-llm/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"x","stream":true,"messages":[{"role":"user","content":"hi"}]}'
```

If that 404s, either (a) set `model.url` to the bare function host and let the
function match any path, or (b) deploy the function under a `/chat/completions`
route. Don't move on until a streamed reply comes back.

## How the plan reaches the prompt

`InterviewPanel` flattens the Phase-1 plan into `variableValues.interviewPlan`,
which Vapi substitutes into the system prompt's `{{interviewPlan}}` placeholder at
call start. The candidate's session id rides along in `metadata.sessionId` so the
end-of-call webhook can attach the transcript to the right row.

## Webhook security (optional but recommended)

Set a shared secret so the webhook can reject forged posts. Add to
`assistant.json` → `server`:

```json
"server": {
  "url": "https://th7dp9ab.function2.insforge.app/vapi-webhook",
  "secret": "<random-string>"
}
```

Vapi sends it as the `x-vapi-secret` header. Store the same value as an Insforge
secret named `VAPI_SERVER_SECRET`; `vapi-webhook` checks it when present.

## Notes

- One shared voice in v1. Distinct per-persona voices are a nice-to-have (would
  require a Vapi `squad` or voice switching) — out of scope for the first demo.
- `model.model` is the Nebius model id the `vapi-llm` proxy forwards to; keep it
  in sync with whatever `vapi-llm` is configured to call.
