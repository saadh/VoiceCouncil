// VoiceCouncil — Vapi server webhook (Phase 2 -> Phase 3 handoff)
//
// Vapi POSTs server messages here. We care about `end-of-call-report`, which
// carries the full call transcript — the SOURCE OF TRUTH for grading (do NOT
// rebuild it elsewhere). On report we:
//   1. attach the transcript + vapi_call_id to the session row
//   2. flip the session to `grading`
//   3. best-effort kick off the Verdict fan-out (if VERDICT_FUNCTION_URL is set)
//
// We ALWAYS ack 200 quickly so Vapi doesn't retry-storm; failures are logged.
//
// Secrets (set as Insforge secrets, read via Deno.env):
//   INSFORGE_PROJECT_URL  e.g. https://w3gj444d.us-east.insforge.app
//   INSFORGE_API_KEY      Insforge API key (writes sessions)
//   VAPI_SERVER_SECRET    optional; if set, must match the x-vapi-secret header
//   VERDICT_FUNCTION_URL  optional; POSTed { session_id } to start grading

declare const Deno: { env: { get(key: string): string | undefined } };

type PersonaKey = "HM" | "EXPERT" | "BAR";
interface TranscriptLine {
  speaker: PersonaKey | "CANDIDATE";
  text: string;
}

const TAG_RE = /^\s*\[(HM|EXPERT|BAR)\]\s*/i;

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors() });
  }
  if (req.method !== "POST") {
    return json({ ok: true, note: "vapi-webhook alive" }, 200);
  }

  // Optional shared-secret check (Vapi sends server.secret as x-vapi-secret).
  const expected = Deno.env.get("VAPI_SERVER_SECRET");
  if (expected && req.headers.get("x-vapi-secret") !== expected) {
    return json({ ok: false, error: "bad secret" }, 401);
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch (_) {
    return json({ ok: false, error: "invalid json" }, 400);
  }

  // Vapi wraps the event as { message: {...} }; tolerate a bare body too.
  const msg = (payload.message ?? payload) as Record<string, unknown>;
  const type = msg.type as string | undefined;

  // Ack anything that isn't an end-of-call report (status-update, etc.).
  if (type !== "end-of-call-report") {
    return json({ ok: true, ignored: type ?? "unknown" }, 200);
  }

  try {
    const call = (msg.call ?? {}) as Record<string, unknown>;
    const artifact = (msg.artifact ?? {}) as Record<string, unknown>;
    const metadata = (call.metadata ?? msg.metadata ?? {}) as Record<
      string,
      unknown
    >;

    const sessionId = metadata.sessionId as string | undefined;
    const callId = call.id as string | undefined;
    const rawTranscript =
      (artifact.transcript as string | undefined) ??
      (msg.transcript as string | undefined) ??
      "";
    const lines = normalizeLines(
      (artifact.messages as unknown[]) ?? [],
      rawTranscript,
    );

    const transcript = {
      lines,
      raw: rawTranscript,
      endedReason: (msg.endedReason as string) ?? null,
      summary: (msg.summary as string) ?? null,
      vapi_call_id: callId ?? null,
    };

    if (!sessionId) {
      // No session to attach to — still ack so Vapi doesn't retry.
      console.warn("[vapi-webhook] end-of-call-report missing sessionId", callId);
      return json({ ok: true, warning: "no sessionId in metadata" }, 200);
    }

    await persistSession(sessionId, {
      transcript,
      vapi_call_id: callId ?? null,
      status: "grading",
    });

    // Best-effort: start the Verdict fan-out. Never block the ack on it.
    triggerVerdict(sessionId).catch((e) =>
      console.error("[vapi-webhook] verdict trigger failed", e),
    );

    return json({ ok: true, sessionId, lines: lines.length }, 200);
  } catch (e) {
    // Log but still 200 — Vapi retries are not useful for our processing errors.
    console.error("[vapi-webhook] processing error", e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 200);
  }
}

// Build dashboard-shaped transcript lines from Vapi's structured messages,
// parsing the [HM]/[EXPERT]/[BAR] tag off each panel turn.
function normalizeLines(
  messages: unknown[],
  rawFallback: string,
): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  for (const raw of messages) {
    const m = raw as { role?: string; message?: string; content?: string };
    const role = (m.role ?? "").toLowerCase();
    const text = (m.message ?? m.content ?? "").trim();
    if (!text) continue;
    if (role === "user") {
      out.push({ speaker: "CANDIDATE", text });
    } else if (role === "bot" || role === "assistant") {
      out.push(parseAssistantLine(text));
    }
    // skip system / tool roles
  }

  // Fall back to the flat transcript string if no structured messages.
  if (out.length === 0 && rawFallback) {
    for (const ln of rawFallback.split("\n")) {
      const line = ln.trim();
      if (!line) continue;
      if (/^user:/i.test(line)) {
        out.push({ speaker: "CANDIDATE", text: line.replace(/^user:/i, "").trim() });
      } else if (/^(ai|assistant|bot):/i.test(line)) {
        out.push(parseAssistantLine(line.replace(/^(ai|assistant|bot):/i, "").trim()));
      }
    }
  }
  return out;
}

function parseAssistantLine(text: string): TranscriptLine {
  const tag = text.match(TAG_RE);
  if (tag) {
    return {
      speaker: tag[1].toUpperCase() as PersonaKey,
      text: text.replace(TAG_RE, "").trim(),
    };
  }
  return { speaker: "HM", text };
}

// PATCH the session row via the Insforge database REST API (PostgREST shape).
async function persistSession(
  sessionId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const base = Deno.env.get("INSFORGE_PROJECT_URL");
  const key = Deno.env.get("INSFORGE_API_KEY");
  if (!base || !key) {
    throw new Error("INSFORGE_PROJECT_URL / INSFORGE_API_KEY not configured");
  }
  const url =
    `${base.replace(/\/$/, "")}/api/database/records/sessions` +
    `?id=eq.${encodeURIComponent(sessionId)}`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(fields),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`session update failed ${res.status}: ${detail}`);
  }
}

// Optional: notify the Verdict function that a transcript is ready.
async function triggerVerdict(sessionId: string): Promise<void> {
  const verdictUrl = Deno.env.get("VERDICT_FUNCTION_URL");
  if (!verdictUrl) return; // verdict fan-out not wired yet — skip cleanly
  await fetch(verdictUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
}

function cors(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-vapi-secret",
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(), "Content-Type": "application/json" },
  });
}
