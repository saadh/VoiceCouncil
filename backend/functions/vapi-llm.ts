// VoiceCouncil — Vapi custom-LLM endpoint (SPIKE)
//
// Goal of this spike: prove an Insforge edge function streams OpenAI-compatible
// Server-Sent Events INCREMENTALLY through the Insforge gateway (no buffering),
// which is what Vapi's custom-LLM requires for low-latency voice.
//
// For the spike this emits a canned reply token-by-token with deliberate delays
// so a `curl --no-buffer` shows whether chunks arrive live. Once it passes and
// the Nebius API key is set as a secret, swap the canned loop for a Nebius
// chat-completions proxy (same SSE shape).

export default async function (req: Request): Promise<Response> {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Vapi POSTs an OpenAI-style body: { messages, model, stream, ... }
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch (_) {
    // tolerate empty/non-JSON bodies during manual testing
  }

  const wantsStream = body?.stream !== false; // default to streaming
  const model = (body?.model as string) ?? "voicecouncil-spike";
  const id = "chatcmpl-spike";
  const created = Math.floor(Date.now() / 1000);

  const reply =
    "Hi, this is the VoiceCouncil panel. The Insforge streaming spike is working.";

  // Non-streaming path (OpenAI chat.completion shape)
  if (!wantsStream) {
    return new Response(
      JSON.stringify({
        id,
        object: "chat.completion",
        created,
        model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: reply },
            finish_reason: "stop",
          },
        ],
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // Streaming path (OpenAI chat.completion.chunk SSE shape)
  const encoder = new TextEncoder();
  const words = reply.split(" ");

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      // initial role delta
      send({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
      });

      for (const w of words) {
        // deliberate delay so incremental delivery is observable in curl
        await new Promise((r) => setTimeout(r, 120));
        send({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            { index: 0, delta: { content: w + " " }, finish_reason: null },
          ],
        });
      }

      // final stop delta + DONE sentinel
      send({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      });
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
