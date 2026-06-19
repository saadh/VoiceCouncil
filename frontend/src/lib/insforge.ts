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
