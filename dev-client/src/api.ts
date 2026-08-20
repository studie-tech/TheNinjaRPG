import { invoke } from "@tauri-apps/api/core";
import type { Agent, HistoryEntry, Settings, StatusResponse } from "../sidecar/types";

export type {
  Agent,
  HistoryEntry,
  Settings,
  StatusResponse,
} from "../sidecar/types";

// Where the sidecar actually is, and the per-launch secret it requires. Both
// come from the Tauri shell (start_sidecar / sidecar_info); the defaults only
// serve plain browser development, where TNR_DEV_CLIENT_PORT /
// VITE_TNR_DEV_CLIENT_AUTH_TOKEN can supply them instead.
export const DEFAULT_SIDECAR_PORT = 49200;

let sidecarPort =
  Number(import.meta.env.VITE_TNR_DEV_CLIENT_PORT) || DEFAULT_SIDECAR_PORT;
let authToken: string = import.meta.env.VITE_TNR_DEV_CLIENT_AUTH_TOKEN ?? "";

/** Adopt the port + token the shell reports, so overrides actually take effect. */
export function useSidecarInfo(info: SidecarInfo | null): void {
  if (!info) return;
  if (info.port) sidecarPort = info.port;
  if (info.authToken) authToken = info.authToken;
}

export class SidecarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SidecarError";
  }
}

function url(path: string): string {
  return `http://127.0.0.1:${sidecarPort}${path}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (authToken) headers.set("authorization", `Bearer ${authToken}`);
  const res = await fetch(url(path), { ...init, headers });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new SidecarError(message);
  }
  return data as T;
}

const postJson = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const sidecar = {
  status: () => request<StatusResponse>("/status"),
  history: () => request<{ history: HistoryEntry[] }>("/jobs/history"),
  signin: () =>
    request<{ connectUrl: string; port: number }>("/auth/signin", postJson({})),
  signout: () => request<{ revoked: boolean }>("/auth/signout", postJson({})),
  saveSettings: (body: Partial<Settings>) =>
    request<Settings>("/setup/save", postJson(body)),
  claim: (agent: Agent) =>
    request<{ claimed: boolean; message?: string }>("/jobs/claim", postJson({ agent })),
  abort: () => request<{ aborted: boolean }>("/jobs/abort", postJson({})),
};

// Tauri commands; resolve to null when running outside the shell.
export interface SidecarInfo {
  running: boolean;
  port: number;
  authToken: string;
}

export async function tauriInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  try {
    return await invoke(command, args);
  } catch {
    return null;
  }
}

/**
 * Open a URL in the user's real browser.
 *
 * A plain <a target="_blank"> does nothing useful inside a Tauri webview, so
 * external links are routed through the shell's opener instead.
 */
export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  const opened = await tauriInvoke<null>("open_external", { url });
  // Outside the Tauri shell (plain vite dev) fall back to a normal window open.
  if (opened === null && typeof window !== "undefined") window.open(url, "_blank");
}

export const startSidecar = async () => {
  const info = await tauriInvoke<SidecarInfo>("start_sidecar");
  useSidecarInfo(info);
  return info;
};
export const stopSidecar = () => tauriInvoke<SidecarInfo>("stop_sidecar");
export const sidecarInfo = async () => {
  const info = await tauriInvoke<SidecarInfo>("sidecar_info");
  useSidecarInfo(info);
  return info;
};
