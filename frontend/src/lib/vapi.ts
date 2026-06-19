// Vapi Web SDK wrapper for the live interview phase.
//
// Mirrors the insforge.ts pattern: when VITE_VAPI_PUBLIC_KEY / _ASSISTANT_ID are
// absent we run in MOCK mode and replay the canned transcript, so the interview
// screen is demoable with no keys. With keys set, we start a real Vapi web call
// and surface its events through one small callback interface.
//
// Persona protocol: the custom-LLM (backend/functions/vapi-llm.ts) tags each
// panel turn with a leading [HM] / [EXPERT] / [BAR] marker so the dashboard can
// highlight the active speaker. We parse and strip that tag here.

import Vapi from "@vapi-ai/web";
import type { PersonaKey, TranscriptLine } from "./types";
import { MOCK_TRANSCRIPT } from "./mock";

const publicKey = import.meta.env.VITE_VAPI_PUBLIC_KEY as string | undefined;
const assistantId = import.meta.env.VITE_VAPI_ASSISTANT_ID as string | undefined;

export const VAPI_MOCK_MODE = !publicKey || !assistantId;

export type CallStatus = "connecting" | "live" | "ended" | "error";

export interface InterviewCallbacks {
  /** A finalized transcript line (panelist or candidate). */
  onLine: (line: TranscriptLine) => void;
  /** Whoever is currently speaking, for avatar highlighting. */
  onActiveSpeaker?: (who: PersonaKey | "CANDIDATE" | null) => void;
  /** Call lifecycle, for the live badge + error surfacing. */
  onStatus?: (status: CallStatus, detail?: string) => void;
}

export interface StartOptions {
  /** Correlates the call to its session row; flows to the end-of-call webhook. */
  sessionId?: string;
  /** Plan context injected into the assistant prompt via {{variables}}. */
  variableValues?: Record<string, unknown>;
}

export interface InterviewCall {
  stop: () => void;
}

const TAG_RE = /^\s*\[(HM|EXPERT|BAR)\]\s*/i;

// Pull the leading [HM]/[EXPERT]/[BAR] tag off an assistant turn. Defaults to the
// Hiring Manager if the model forgot to tag (keeps the UI from breaking).
function parseAssistantLine(text: string): TranscriptLine {
  const m = text.match(TAG_RE);
  if (m) {
    return {
      speaker: m[1].toUpperCase() as PersonaKey,
      text: text.replace(TAG_RE, "").trim(),
    };
  }
  return { speaker: "HM", text: text.trim() };
}

// ---- Real Vapi call -------------------------------------------------------

function startRealInterview(
  cb: InterviewCallbacks,
  opts: StartOptions,
): InterviewCall {
  const vapi = new Vapi(publicKey!);
  cb.onStatus?.("connecting");

  vapi.on("call-start", () => cb.onStatus?.("live"));
  vapi.on("call-end", () => {
    cb.onActiveSpeaker?.(null);
    cb.onStatus?.("ended");
  });
  vapi.on("error", (e: unknown) => {
    const detail =
      (e as { message?: string } | null)?.message ?? String(e ?? "unknown");
    cb.onStatus?.("error", detail);
  });

  // Vapi streams partial + final transcripts; we only commit finals as lines.
  vapi.on("message", (msg: unknown) => {
    const m = msg as {
      type?: string;
      role?: string;
      transcript?: string;
      transcriptType?: string;
    };
    if (m?.type !== "transcript" || m.transcriptType !== "final") return;
    const text = (m.transcript ?? "").trim();
    if (!text) return;

    if (m.role === "user") {
      cb.onActiveSpeaker?.("CANDIDATE");
      cb.onLine({ speaker: "CANDIDATE", text });
    } else {
      const line = parseAssistantLine(text);
      cb.onActiveSpeaker?.(line.speaker);
      cb.onLine(line);
    }
  });

  // assistantId + overrides (metadata reaches the end-of-call webhook).
  vapi
    .start(assistantId!, {
      metadata: { sessionId: opts.sessionId },
      variableValues: opts.variableValues,
    } as Parameters<typeof vapi.start>[1])
    .catch((e: unknown) =>
      cb.onStatus?.("error", (e as Error)?.message ?? String(e)),
    );

  return {
    stop: () => {
      try {
        vapi.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}

// ---- Mock call (no keys) --------------------------------------------------

function startMockInterview(cb: InterviewCallbacks): InterviewCall {
  cb.onStatus?.("connecting");
  let i = 0;
  const startId = setTimeout(() => cb.onStatus?.("live"), 400);
  const id = setInterval(() => {
    if (i >= MOCK_TRANSCRIPT.length) {
      clearInterval(id);
      cb.onActiveSpeaker?.(null);
      return;
    }
    const line = MOCK_TRANSCRIPT[i++];
    cb.onActiveSpeaker?.(line.speaker);
    cb.onLine(line);
  }, 1400);

  return {
    stop: () => {
      clearTimeout(startId);
      clearInterval(id);
    },
  };
}

/** Start the interview call. Returns a handle whose stop() ends it. */
export function startInterview(
  cb: InterviewCallbacks,
  opts: StartOptions = {},
): InterviewCall {
  return VAPI_MOCK_MODE
    ? startMockInterview(cb)
    : startRealInterview(cb, opts);
}
