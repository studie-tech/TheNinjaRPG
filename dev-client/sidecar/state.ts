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
  writeFileSync(tokenPath(), JSON.stringify(token, null, 2), "utf8");
  // The device token grants game-account access: keep it owner-only.
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
  githubLogin: null,
};

export function loadSettings(): Settings {
  try {
    if (!existsSync(settingsPath())) return { ...defaultSettings };
    const raw = JSON.parse(readFileSync(settingsPath(), "utf8")) as Partial<Settings>;
    return { ...defaultSettings, ...raw };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  ensureDataDir();
  const next = { ...loadSettings(), ...patch };
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2), "utf8");
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
