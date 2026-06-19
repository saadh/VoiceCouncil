// VoiceCouncil — Vapi custom-LLM endpoint (Nebius proxy)
//
// Vapi's custom-LLM POSTs an OpenAI-style chat body here; we forward it to
// Nebius Token Factory (OpenAI-compatible) and stream the SSE straight back so
// the voice stays low-latency. The Insforge streaming spike already proved the
// gateway forwards SSE incrementally — this swaps the canned token loop for the
// real upstream call.
//
// Secrets (set as Insforge secrets, read via Deno.env):
//   NEBIUS_API_KEY   required
//   NEBIUS_BASE_URL  optional, default https://api.studio.nebius.ai/v1
//   NEBIUS_MODEL     optional fallback when the request omits a model

declare const Deno: { env: { get(key: string): string | undefined } };

// Fields Vapi adds to the OpenAI body that Nebius shouldn't receive.
const VAPI_ONLY_FIELDS = [
  "call",
  "metadata",
  "phoneNumber",
  "customer",
  "timestamp",
  "assistant",
  "artifact",
  "phoneCallProviderId",
];

export default async function (req: Request): Promise<Response> {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const apiKey = Deno.env.get("NEBIUS_API_KEY");
  const baseUrl =
    Deno.env.get("NEBIUS_BASE_URL") ?? "https://api.studio.nebius.ai/v1";
  const fallbackModel = Deno.env.get("NEBIUS_MODEL");

  if (!apiKey) {
    return jsonError(
      corsHeaders,
      500,
      "NEBIUS_API_KEY is not configured (set it as an Insforge secret).",
    );
  }

  // Vapi POSTs an OpenAI-style body: { messages, model, stream, ... }
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch (_) {
    // tolerate empty/non-JSON bodies during manual testing
  }

  const wantsStream = body?.stream !== false; // default to streaming
  const model = (body?.model as string) || fallbackModel;
  if (!model) {
    return jsonError(
      corsHeaders,
      400,
      "No model in request and NEBIUS_MODEL fallback is unset.",
    );
  }

  // Strip Vapi-only fields, then forward a clean OpenAI chat payload to Nebius.
  const payload: Record<string, unknown> = { ...body };
  for (const f of VAPI_ONLY_FIELDS) delete payload[f];
  payload.model = model;
  payload.stream = wantsStream;

  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return jsonError(
      corsHeaders,
      502,
      `Upstream request to Nebius failed: ${(e as Error)?.message ?? e}`,
    );
  }

  // Propagate upstream errors (auth, bad model, rate limit) as-is.
  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return jsonError(
      corsHeaders,
      upstream.status,
      `Nebius error ${upstream.status}: ${detail}`,
    );
  }

  // Streaming: pass the SSE body straight through (preserves incremental tokens).
  if (wantsStream) {
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // Non-streaming: forward the JSON chat.completion as-is.
  const data = await upstream.text();
  return new Response(data, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(
  cors: Record<string, string>,
  status: number,
  message: string,
): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
