// VoiceCouncil — Phase 1 PREP: the council "war room".
//
// Three Nebius models (one per panelist persona) each propose their interview
// lane IN PARALLEL, then one synthesis pass divides coverage so lanes don't
// overlap. Returns the InterviewPlan the dashboard expects and upserts it into
// interview_plans. Tolerant: if a model fails we fall back to a static lane;
// if synthesis fails we use the raw proposals.
//
// Called by the frontend: insforge.functions.invoke("prep-plan", { body:
// { session_id } }).
//
// Secrets (Insforge): NEBIUS_API_KEY, INSFORGE_PROJECT_URL, INSFORGE_API_KEY,
//   optional NEBIUS_BASE_URL, NEBIUS_PANEL_MODELS (csv), NEBIUS_SYNTH_MODEL.
//
// NOTE: the Nebius + Insforge helpers are inlined (not imported) so the file
// deploys standalone via `functions deploy --file`. The same helpers live in
// verdict.ts — keep them in sync.

declare const Deno: { env: { get(key: string): string | undefined } };

type PersonaKey = "HM" | "EXPERT" | "BAR";

interface PersonaDef {
  key: PersonaKey;
  title: string;
  brief: string;
}

const PERSONAS: PersonaDef[] = [
  { key: "HM", title: "Hiring Manager", brief: "behavioral signal: ownership, conflict, impact, motivation" },
  { key: "EXPERT", title: "Domain Expert", brief: "deep technical follow-ups in the candidate's own stack" },
  { key: "BAR", title: "Bar-raiser", brief: "pressure-testing weak or hand-wavy claims, scaling, failure modes" },
];

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
  if (req.method !== "POST") return json({ ok: true, note: "prep-plan alive" }, 200);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch (_) {
    /* tolerate */
  }
  const sessionId = body.session_id as string | undefined;
  if (!sessionId) return json({ error: { message: "session_id required" } }, 400);

  try {
    // Load the candidate context.
    const rows = await dbGet(
      "sessions",
      `id=eq.${encodeURIComponent(sessionId)}&select=role,job_description,resume`,
    );
    const session = rows[0] as
      | { role?: string; job_description?: string; resume?: string }
      | undefined;
    if (!session) return json({ error: { message: "session not found" } }, 404);

    await dbUpdate("sessions", `id=eq.${encodeURIComponent(sessionId)}`, {
      status: "prepping",
    });

    const role = session.role ?? "the role";
    const context =
      `Role: ${role}\n\n` +
      `Job description:\n${session.job_description ?? "(none provided)"}\n\n` +
      `Candidate resume:\n${session.resume ?? "(none provided)"}`;

    const models = panelModels();

    // Fan-out: each persona proposes its lane in parallel.
    const proposals = await Promise.all(
      PERSONAS.map((p, i) => proposeLane(p, models[i % models.length], context)),
    );

    // Round-1 negotiation comes straight from each proposal.
    const round1 = proposals.map((pr) => ({
      persona: pr.persona,
      round: 1 as const,
      text: pr.negotiation,
    }));

    // Synthesis: divide lanes so they don't overlap; capture round-2 tweaks.
    let lanes = proposals.map((pr) => ({
      persona: pr.persona,
      focus: pr.focus,
      questions: pr.questions,
    }));
    let round2: Array<{ persona: PersonaKey; round: 2; text: string }> = [];
    try {
      const synth = await nebiusJSON(
        synthModel(),
        "You are the panel lead organizing a non-overlapping interview plan. " +
          "Given each panelist's proposal, finalize each lane so coverage does " +
          "not overlap, and note any round-2 adjustments where a panelist " +
          "narrows scope to avoid stepping on another. Respond ONLY with JSON: " +
          '{"lanes":[{"persona":"HM|EXPERT|BAR","focus":string,"questions":[string,string,string]}],' +
          '"round2":[{"persona":"HM|EXPERT|BAR","text":string}]}',
        JSON.stringify(proposals),
      );
      if (Array.isArray(synth?.lanes) && synth.lanes.length) {
        lanes = synth.lanes
          .filter((l: { persona?: string }) => isPersona(l.persona))
          .map((l: { persona: PersonaKey; focus?: string; questions?: string[] }) => ({
            persona: l.persona,
            focus: l.focus ?? "",
            questions: Array.isArray(l.questions) ? l.questions : [],
          }));
      }
      if (Array.isArray(synth?.round2)) {
        round2 = synth.round2
          .filter((r: { persona?: string; text?: string }) => isPersona(r.persona) && r.text)
          .map((r: { persona: PersonaKey; text: string }) => ({
            persona: r.persona,
            round: 2 as const,
            text: r.text,
          }));
      }
    } catch (e) {
      console.warn("[prep-plan] synthesis failed, using raw proposals", e);
    }

    const plan = { lanes, negotiation: [...round1, ...round2] };

    // Persist + mark ready. Upsert keeps re-runs idempotent (session_id unique).
    await dbUpsert(
      "interview_plans",
      { session_id: sessionId, plan, negotiation: plan.negotiation },
      "session_id",
    );
    await dbUpdate("sessions", `id=eq.${encodeURIComponent(sessionId)}`, {
      status: "ready",
    });

    return json(plan, 200);
  } catch (e) {
    console.error("[prep-plan] error", e);
    return json({ error: { message: String((e as Error)?.message ?? e) } }, 500);
  }
}

interface Proposal {
  persona: PersonaKey;
  focus: string;
  questions: string[];
  negotiation: string;
}

async function proposeLane(
  p: PersonaDef,
  model: string,
  context: string,
): Promise<Proposal> {
  try {
    const out = await nebiusJSON(
      model,
      `You are the ${p.title} on a job interview panel. You probe ${p.brief}. ` +
        "Propose your interview lane for THIS candidate. Respond ONLY with JSON: " +
        '{"focus":string,"questions":[string,string,string],"negotiation":string}. ' +
        "`negotiation` is one sentence claiming your lane to the other panelists.",
      context,
    );
    return {
      persona: p.key,
      focus: String(out?.focus ?? p.brief),
      questions: Array.isArray(out?.questions) ? out.questions.slice(0, 3).map(String) : [],
      negotiation: String(out?.negotiation ?? `I'll cover ${p.brief}.`),
    };
  } catch (e) {
    console.warn(`[prep-plan] ${p.key} proposal failed`, e);
    return {
      persona: p.key,
      focus: p.brief,
      questions: [],
      negotiation: `I'll cover ${p.brief}.`,
    };
  }
}

function isPersona(v: unknown): v is PersonaKey {
  return v === "HM" || v === "EXPERT" || v === "BAR";
}

// ---- Nebius helpers (inlined; mirror verdict.ts) --------------------------

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
      temperature: 0.6,
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

// ---- Insforge DB helpers (inlined; mirror verdict.ts) ---------------------

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
