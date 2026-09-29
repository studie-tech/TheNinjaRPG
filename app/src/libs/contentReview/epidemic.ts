import { fetchWithTimeout } from "@/utils/http";
import {
  epidemicDownloadResponse,
  epidemicSfxSearchResponse,
} from "@/validators/epidemic";

/**
 * Epidemic Sound Partner Content API, authenticated with a server-side API key
 * (`Authorization: Bearer epidemic_live_…`). The key never leaves the server: the audit job
 * and the browser only ever see search results and our own UploadThing copies.
 */
const EPIDEMIC_API = "https://partner-content-api.epidemicsound.com";
const TIMEOUT_MS = 10_000;
/**
 * API-key calls act on behalf of a partner user. The game is a single user: every sound it
 * uses is licensed to the studio's account, not to individual players.
 */
const PARTNER_USER_ID = "theninja-rpg";

export type EpidemicSfx = { id: string; title: string; lengthMs: number };

export const isEpidemicConfigured = () => !!process.env.EPIDEMIC_API_KEY;

const request = async (path: string, init: RequestInit = {}) => {
  const key = process.env.EPIDEMIC_API_KEY;
  if (!key) throw new Error("EPIDEMIC_API_KEY is not configured");
  const response = await fetchWithTimeout(
    `${EPIDEMIC_API}${path}`,
    {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${key}`,
        "X-Partner-User-Id": PARTNER_USER_ID,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    },
    TIMEOUT_MS,
  );
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`Epidemic Sound ${path} responded ${response.status}: ${detail}`);
  }
  return (await response.json()) as unknown;
};

/** Best matches for a plain-language description, e.g. "short fiery whoosh". */
export const searchEpidemicSfx = async (term: string, limit: number) => {
  const query = new URLSearchParams({
    term,
    limit: String(limit),
    sort: "best-match",
  });
  const body = epidemicSfxSearchResponse.parse(
    await request(`/v0/sound-effects/search?${query.toString()}`),
  );
  return body.soundEffects.map(
    (sfx): EpidemicSfx => ({
      id: sfx.id,
      title: sfx.title,
      lengthMs: sfx.length * 1000,
    }),
  );
};

/** Signed 128 kbps MP3 link, valid for 24 hours; also usable for streaming a preview. */
export const epidemicSfxDownloadUrl = async (id: string) => {
  const body = epidemicDownloadResponse.parse(
    await request(
      `/v0/sound-effects/${encodeURIComponent(id)}/download?format=mp3&quality=normal`,
    ),
  );
  return body.url;
};
