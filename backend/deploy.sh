#!/usr/bin/env bash
# VoiceCouncil — deploy all Insforge edge functions in one shot.
#
# Prereq: your Insforge CLI must be linked to the VoiceCouncil project AND your
# account must be a member of the project's org (the current blocker — ask Saad
# to add you, or link directly with the project API key). Verify with:
#   npx @insforge/cli current
#
# Secrets the functions read at runtime (set ONCE, not per deploy):
#   Required (all functions):
#     npx @insforge/cli secrets add NEBIUS_API_KEY       <nebius-key>
#     npx @insforge/cli secrets add INSFORGE_PROJECT_URL <https://th7dp9ab.us-east.insforge.app>
#     npx @insforge/cli secrets add INSFORGE_API_KEY     <insforge-api-key>
#   Optional:
#     NEBIUS_BASE_URL      default https://api.studio.nebius.ai/v1
#     NEBIUS_MODEL         vapi-llm fallback model when the request omits one
#     NEBIUS_PANEL_MODELS  csv override for the 3 prep/verdict panel models
#     NEBIUS_SYNTH_MODEL   synthesis model (defaults to the first panel model)
#     VAPI_SERVER_SECRET   must match vapi/assistant.json server.secret
#     VERDICT_FUNCTION_URL https://th7dp9ab.function2.insforge.app/verdict
#                          (lets vapi-webhook auto-start grading)
#
# Usage:  bash backend/deploy.sh            # deploy everything
#         bash backend/deploy.sh vapi-llm   # deploy a single function

set -euo pipefail

cd "$(dirname "$0")/.."   # repo root, regardless of where it's invoked from

CLI="npx @insforge/cli -y"
FUNCS=(vapi-llm vapi-webhook prep-plan verdict)

# Allow deploying a subset by passing slugs as args.
if [ "$#" -gt 0 ]; then
  FUNCS=("$@")
fi

echo "Deploying ${#FUNCS[@]} function(s) to Insforge…"
for slug in "${FUNCS[@]}"; do
  file="backend/functions/${slug}.ts"
  if [ ! -f "$file" ]; then
    echo "  ✗ $slug — missing $file" >&2
    exit 1
  fi
  echo "  → $slug ($file)"
  $CLI functions deploy "$slug" --file "$file"
done

echo "Done. Verify with: $CLI functions list"
