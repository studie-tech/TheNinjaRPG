import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HistoryEntry, Settings } from "./types";

// The device token is sent as a bearer to whatever apiBase says, so an
// attacker-chosen value would exfiltrate it. Only these origins are accepted.
const ALLOWED_API_HOSTS = [
  "www.theninja-rpg.com",
  "theninja-rpg.com",
  "localhost",
  "127.0.0.1",
];

export const isAllowedApiBase = (value: string): boolean => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    // Plain http is only ever acceptable for local development.
    const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol === "http:" && !isLocal) return false;
    return ALLOWED_API_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
};

// All client state lives in one user-owned directory. Override with
// TNR_DEV_CLIENT_HOME for tests / non-standard installs.
export const dataDir = (): string =>
  process.env.TNR_DEV_CLIENT_HOME ?? join(homedir(), ".tnr-dev-client");

export const tokenPath = () => join(dataDir(), "token.json");
export const settingsPath = () => join(dataDir(), "settings.json");
export const historyPath = () => join(dataDir(), "history.json");
export const usagePath = () => join(dataDir(), "usage.json");
export const jobsDir = () => join(dataDir(), "jobs");

export function ensureDataDir(): void {
  mkdirSync(jobsDir(), { recursive: true });
}

export interface StoredToken {
  deviceToken: string;
  // ms epoch
  expiresAt: number;
  githubLogin?: string | null;
}

export function loadToken(): StoredToken | null {
  try {
    if (!existsSync(tokenPath())) return null;
    return JSON.parse(readFileSync(tokenPath(), "utf8")) as StoredToken;
  } catch {
    return null;
  }
}

export function saveToken(token: StoredToken): void {
  ensureDataDir();
  // mode on write, not chmod after: creating at the umask default first leaves a
  // window where the device token is world-readable. chmod still runs so an
  // existing file from an older build is tightened too.
  writeFileSync(tokenPath(), JSON.stringify(token, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(tokenPath(), 0o600);
}

export function clearToken(): void {
  rmSync(tokenPath(), { force: true });
}

export const defaultSettings: Settings = {
  apiBase: "https://www.theninja-rpg.com",
  repoPath: "",
  claudeDailyTokenCap: 0,
  codexDailyTokenCap: 0,
  autoRun: false,
};

export function loadSettings(): Settings {
  try {
    if (!existsSync(settingsPath())) return { ...defaultSettings };
    const raw = JSON.parse(readFileSync(settingsPath(), "utf8")) as Partial<Settings>;
    const merged = { ...defaultSettings, ...raw };
    // settings.json is a plain file, so validating only on the write path leaves
    // the guard open to anything running as the user — including a job agent,
    // whose worktree sits under this same directory. Re-check where it is read.
    if (typeof merged.apiBase !== "string" || !isAllowedApiBase(merged.apiBase)) {
      merged.apiBase = defaultSettings.apiBase;
    }
    return merged;
  } catch {
    return { ...defaultSettings };
  }
}

/**
 * Merge a settings patch, ignoring keys the caller may not set and rejecting an
 * apiBase that is not a known game host.
 */
export function saveSettings(patch: Partial<Settings>): Settings {
  ensureDataDir();
  const current = loadSettings();
  const next: Settings = { ...current };

  if (typeof patch.apiBase === "string" && isAllowedApiBase(patch.apiBase)) {
    next.apiBase = patch.apiBase;
  }
  if (typeof patch.repoPath === "string") next.repoPath = patch.repoPath;
  if (typeof patch.autoRun === "boolean") next.autoRun = patch.autoRun;
  for (const key of ["claudeDailyTokenCap", "codexDailyTokenCap"] as const) {
    const value = patch[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      next[key] = Math.floor(value);
    }
  }

  writeFileSync(settingsPath(), JSON.stringify(next, null, 2), "utf8");
  // Settings carry the local repo path and the game host; keep them owner-only.
  chmodSync(settingsPath(), 0o600);
  return next;
}

const HISTORY_LIMIT = 200;

export function loadHistory(): HistoryEntry[] {
  try {
    if (!existsSync(historyPath())) return [];
    return JSON.parse(readFileSync(historyPath(), "utf8")) as HistoryEntry[];
  } catch {
    return [];
  }
}

export function appendHistory(entry: HistoryEntry): void {
  ensureDataDir();
  const next = [entry, ...loadHistory()].slice(0, HISTORY_LIMIT);
  writeFileSync(historyPath(), JSON.stringify(next, null, 2), "utf8");
}
