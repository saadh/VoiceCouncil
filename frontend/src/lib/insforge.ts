// Insforge client. Runs in MOCK mode when keys are absent so the dashboard
// works standalone; flips to the real backend once VITE_INSFORGE_ANON_KEY is set.
import { createClient } from "@insforge/sdk";

const baseUrl = import.meta.env.VITE_INSFORGE_BASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_INSFORGE_ANON_KEY as string | undefined;

export const MOCK_MODE = !baseUrl || !anonKey;

// Only construct a real client when configured. In mock mode this stays null
// and the api layer serves mock data.
export const insforge = MOCK_MODE
  ? null
  : createClient({ baseUrl: baseUrl!, anonKey: anonKey! });

if (MOCK_MODE && typeof window !== "undefined") {
  // eslint-disable-next-line no-console
  console.info(
    "[VoiceCouncil] Running in MOCK mode — set VITE_INSFORGE_ANON_KEY in .env.local to use the real backend.",
  );
}

// Edge-function host. The SDK's functions.invoke() targets the wrong host
// ({appkey}.functions.insforge.app -> 404, CORS-blocked); the real deployed host
// is {appkey}.function2.insforge.app. We call functions directly there instead.
// Prefer the explicit env var; otherwise derive function2 host from the base URL.
export const FUNCTIONS_BASE: string | null = (() => {
  const explicit = import.meta.env.VITE_INSFORGE_FUNCTIONS_URL as
    | string
    | undefined;
  if (explicit) return explicit.replace(/\/$/, "");
  if (!baseUrl) return null;
  // https://{appkey}.{region}.insforge.app -> https://{appkey}.function2.insforge.app
  return baseUrl
    .replace(
      /^(https?:\/\/[^.]+)\.[^.]+\.insforge\.app.*$/,
      "$1.function2.insforge.app",
    )
    .replace(/\/$/, "");
})();

// Invoke an edge function by POSTing directly to the correct host (bypasses the
// SDK's broken host derivation, which CORS-blocks in the browser).
export async function invokeFunction<T = unknown>(
  slug: string,
  body: unknown,
): Promise<T> {
  if (!FUNCTIONS_BASE) throw new Error("Functions host not configured");
  const res = await fetch(`${FUNCTIONS_BASE}/${slug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${slug} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}
