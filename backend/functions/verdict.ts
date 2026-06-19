// VoiceCouncil — Phase 3 VERDICT: the council confers.
//
// Reads the session transcript (the source of truth written by vapi-webhook),
// then three Nebius models grade the candidate IN PARALLEL. One synthesis pass
// merges them into a single scorecard. Persists scorecards + flips the session
// to `done`. Returns the Scorecard the dashboard renders.
//
// Triggered by vapi-webhook (VERDICT_FUNCTION_URL) with { session_id }; can also
// be invoked directly. Tolerant: if a grader fails we synthesize from whoever
// returned — never block on one model.
//
// Secrets (Insforge): NEBIUS_API_KEY, INSFORGE_PROJECT_URL, INSFORGE_API_KEY,
//   optional NEBIUS_BASE_URL, NEBIUS_PANEL_MODELS (csv), NEBIUS_SYNTH_MODEL.
//
// NOTE: Nebius + Insforge helpers are inlined (standalone deploy). Mirror of
// the helpers in prep-plan.ts — keep in sync.

declare const Deno: { env: { get(key: string): string | undefined } };

interface ScoreDimension {
  name: string;
  score: number;
  note: string;
}
interface GraderResult {
  model: string;
  overall: number;
  comment: string;
}
interface GraderOutput {
  overall: number;
  comment: string;
  dimensions: ScoreDimension[];
  redFlags: string[];
  topFixes: string[];
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
  if (req.method !== "POST") return json({ ok: true, note: "verdict alive" }, 200);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch (_) {
    /* tolerate */
  }
  const sessionId = body.session_id as string | undefined;
  if (!sessionId) return json({ error: { message: "session_id required" } }, 400);

  try {
    const rows = await dbGet(
      "sessions",
      `id=eq.${encodeURIComponent(sessionId)}&select=role,transcript`,
    );
    const session = rows[0] as
      | { role?: string; transcript?: unknown }
      | undefined;
    if (!session) return json({ error: { message: "session not found" } }, 404);

    const transcriptText = transcriptToText(session.transcript);
    if (!transcriptText.trim()) {
      return json({ error: { message: "no transcript to grade" } }, 422);
    }

    await dbUpdate("sessions", `id=eq.${encodeURIComponent(sessionId)}`, {
      status: "grading",
    });

    const role = session.role ?? "the role";
    const models = panelModels();

    // Fan-out: each model grades independently. Settle so one failure is fine.
    const settled = await Promise.allSettled(
      models.map((m) => gradeOnce(m, role, transcriptText)),
    );
    const graderResults: Array<{ model: string; output: GraderOutput }> = [];
    settled.forEach((s, i) => {
      if (s.status === "fulfilled") graderResults.push({ model: models[i], output: s.value });
      else console.warn(`[verdict] grader ${models[i]} failed`, s.reason);
    });
    if (graderResults.length === 0) {
      throw new Error("all graders failed");
    }

    // graders summary is built from real per-model output (not trusted to synth).
    const graders: GraderResult[] = graderResults.map((g) => ({
      model: g.model,
      overall: clamp10(g.output.overall),
      comment: g.output.comment ?? "",
    }));

    // Synthesis: merge into one scorecard.
    const synth = await synthesizeScorecard(
      graderResults.map((g) => g.output),
    );

    const scorecard = {
      overall: clamp10(synth.overall),
      dimensions: synth.dimensions,
      redFlags: synth.redFlags,
      topFixes: synth.topFixes.slice(0, 3),
      graders,
    };

    await dbUpsert(
      "scorecards",
      {
        session_id: sessionId,
        scorecard,
        grader_results: graderResults,
      },
      "session_id",
    );
    await dbUpdate("sessions", `id=eq.${encodeURIComponent(sessionId)}`, {
      status: "done",
    });

    return json(scorecard, 200);
  } catch (e) {
    console.error("[verdict] error", e);
    return json({ error: { message: String((e as Error)?.message ?? e) } }, 500);
  }
}

async function gradeOnce(
  model: string,
  role: string,
  transcript: string,
): Promise<GraderOutput> {
  const out = await nebiusJSON(
    model,
    `You are an expert interview assessor grading a candidate's mock interview ` +
      `for the role of ${role}. Grade rigorously and fairly. Respond ONLY with ` +
      'JSON: {"overall":number 0-10,"comment":string,"dimensions":' +
      '[{"name":string,"score":number 0-10,"note":string}],"redFlags":[string],' +
      '"topFixes":[string]}. Use exactly these dimensions: Communication, ' +
      "Technical depth, Structure, Composure under pressure.",
    `Interview transcript:\n\n${transcript}`,
  );
  return {
    overall: Number(out?.overall ?? 0),
    comment: String(out?.comment ?? ""),
    dimensions: Array.isArray(out?.dimensions)
      ? (out.dimensions as ScoreDimension[]).map((d) => ({
          name: String(d?.name ?? ""),
          score: clamp10(Number(d?.score ?? 0)),
          note: String(d?.note ?? ""),
        }))
      : [],
    redFlags: Array.isArray(out?.redFlags) ? (out.redFlags as unknown[]).map(String) : [],
    topFixes: Array.isArray(out?.topFixes) ? (out.topFixes as unknown[]).map(String) : [],
  };
}

async function synthesizeScorecard(
  outputs: GraderOutput[],
): Promise<Omit<GraderOutput, "comment">> {
  try {
    const synth = await nebiusJSON(
      synthModel(),
      "You are the head of the hiring panel synthesizing multiple assessors' " +
        "grades into ONE final scorecard. Respond ONLY with JSON: " +
        '{"overall":number 0-10,"dimensions":[{"name":string,"score":number,"note":string}],' +
        '"redFlags":[string],"topFixes":[string]}. Average scores where ' +
        "reasonable, merge overlapping notes, and keep the 3 most important fixes. " +
        "Use exactly these dimensions: Communication, Technical depth, Structure, " +
        "Composure under pressure.",
      JSON.stringify(outputs),
    );
    return {
      overall: Number(synth?.overall ?? avg(outputs.map((o) => o.overall))),
      dimensions: Array.isArray(synth?.dimensions)
        ? (synth.dimensions as ScoreDimension[]).map((d) => ({
            name: String(d?.name ?? ""),
            score: clamp10(Number(d?.score ?? 0)),
            note: String(d?.note ?? ""),
          }))
        : outputs[0].dimensions,
      redFlags: Array.isArray(synth?.redFlags)
        ? (synth.redFlags as unknown[]).map(String)
        : dedupe(outputs.flatMap((o) => o.redFlags)),
      topFixes: Array.isArray(synth?.topFixes)
        ? (synth.topFixes as unknown[]).map(String)
        : dedupe(outputs.flatMap((o) => o.topFixes)),
    };
  } catch (e) {
    // Synthesis failed — assemble a deterministic fallback from the graders.
    console.warn("[verdict] synthesis failed, merging locally", e);
    return {
      overall: avg(outputs.map((o) => o.overall)),
      dimensions: outputs[0].dimensions,
      redFlags: dedupe(outputs.flatMap((o) => o.redFlags)),
      topFixes: dedupe(outputs.flatMap((o) => o.topFixes)).slice(0, 3),
    };
  }
}

// Build a flat transcript string from the jsonb the webhook stored.
function transcriptToText(t: unknown): string {
  if (!t) return "";
  if (typeof t === "string") return t;
  const obj = t as { lines?: Array<{ speaker?: string; text?: string }>; raw?: string };
  if (Array.isArray(obj.lines) && obj.lines.length) {
    return obj.lines
      .map((l) => `${l.speaker ?? "?"}: ${l.text ?? ""}`)
      .join("\n");
  }
  return obj.raw ?? "";
}

function clamp10(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n * 10) / 10));
}
function avg(ns: number[]): number {
  if (!ns.length) return 0;
  return clamp10(ns.reduce((a, b) => a + b, 0) / ns.length);
}
function dedupe(xs: string[]): string[] {
  return [...new Set(xs.filter(Boolean))];
}

// ---- Nebius helpers (inlined; mirror prep-plan.ts) ------------------------

function nebiusBase(): string {
  return (Deno.env.get("NEBIUS_BASE_URL") ?? "https://api.studio.nebius.ai/v1").replace(/\/$/, "");
}

function panelModels(): string[] {
  const csv = Deno.env.get("NEBIUS_PANEL_MODELS");
  if (csv) return csv.split(",").map((s) => s.trim()).filter(Boolean);
  return [
    "meta-llama/Llama-3.3-70B-Instruct",
    "Qwen/Qwen3-32B",
    "google/gemma-3-27b-it",
  ];
}

function synthModel(): string {
  return Deno.env.get("NEBIUS_SYNTH_MODEL") ?? panelModels()[0];
}

async function nebiusJSON(
  model: string,
  system: string,
  user: string,
): Promise<Record<string, unknown>> {
  const key = Deno.env.get("NEBIUS_API_KEY");
  if (!key) throw new Error("NEBIUS_API_KEY not configured");
  const res = await fetch(`${nebiusBase()}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.4,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    throw new Error(`Nebius ${model} ${res.status}: ${await res.text().catch(() => "")}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  return parseJSON(String(content));
}

function parseJSON(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch (_) {
    const m = s.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch (_e) {
        /* fall through */
      }
    }
    throw new Error("could not parse JSON from model output");
  }
}

// ---- Insforge DB helpers (inlined; mirror prep-plan.ts) -------------------

function db(): { base: string; key: string } {
  const base = Deno.env.get("INSFORGE_PROJECT_URL");
  const key = Deno.env.get("INSFORGE_API_KEY");
  if (!base || !key) throw new Error("INSFORGE_PROJECT_URL / INSFORGE_API_KEY not configured");
  return { base: base.replace(/\/$/, ""), key };
}

async function dbGet(table: string, query: string): Promise<unknown[]> {
  const { base, key } = db();
  const res = await fetch(`${base}/api/database/records/${table}?${query}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`DB get ${table} ${res.status}: ${await res.text().catch(() => "")}`);
  return (await res.json()) as unknown[];
}

async function dbUpdate(
  table: string,
  query: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const { base, key } = db();
  const res = await fetch(`${base}/api/database/records/${table}?${query}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(`DB update ${table} ${res.status}: ${await res.text().catch(() => "")}`);
}

async function dbUpsert(
  table: string,
  row: Record<string, unknown>,
  onConflict: string,
): Promise<void> {
  const { base, key } = db();
  const res = await fetch(
    `${base}/api/database/records/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify([row]),
    },
  );
  if (!res.ok) throw new Error(`DB upsert ${table} ${res.status}: ${await res.text().catch(() => "")}`);
}

function cors(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(), "Content-Type": "application/json" },
  });
}
