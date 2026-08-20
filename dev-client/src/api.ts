import { invoke } from "@tauri-apps/api/core";
import type { Agent, HistoryEntry, Settings, StatusResponse } from "../sidecar/types";

export type {
  Agent,
  HistoryEntry,
  Settings,
  StatusResponse,
} from "../sidecar/types";

// The sidecar listens on a fixed loopback port. The Tauri shell can confirm
// it is running via the start_sidecar command; polling /status covers plain
// browser development where no shell is present.
export const SIDECAR_PORT = 49200;

export class SidecarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SidecarError";
  }
}

function url(path: string): string {
  return `http://127.0.0.1:${SIDECAR_PORT}${path}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url(path), init);
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

export const startSidecar = () => tauriInvoke<SidecarInfo>("start_sidecar");
export const stopSidecar = () => tauriInvoke<SidecarInfo>("stop_sidecar");
