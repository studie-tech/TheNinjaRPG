import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Agent, CliInfo } from "./types";

const COMMAND_NAMES: Record<Agent, string> = {
  CLAUDE: "claude",
  CODEX: "codex",
};

function knownPathsFor(agent: Agent): string[] {
  const name = COMMAND_NAMES[agent];
  return [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    join(homedir(), ".local", "bin"),
    join(homedir(), ".claude", "local"),
    join(homedir(), ".codex", "bin"),
  ].map((dir) => join(dir, name));
}

// Injectable so tests can fake the environment.
export interface CliProbe {
  which: (command: string) => Promise<string | null>;
  exists: (path: string) => boolean;
  runVersion: (path: string) => Promise<string>;
}

const execFileAsync = (
  file: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string }> =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: 10_000 }, (error, stdout) => {
      resolve({ ok: !error, stdout: String(stdout ?? "").trim() });
    });
  });

export const defaultCliProbe: CliProbe = {
  which: async (command) => {
    const { ok, stdout } = await execFileAsync("which", [command]);
    return ok && stdout ? stdout : null;
  },
  exists: (path) => existsSync(path),
  runVersion: async (path) => {
    const { ok, stdout } = await execFileAsync(path, ["--version"]);
    return ok ? stdout : "";
  },
};

// Pull the first x.y.z out of a version line ("1.0.12 (Claude Code)",
// "codex-cli 0.19.0", ...).
export function parseVersionLine(raw: string): string {
  const match = raw.match(/\d+\.\d+\.\d+/);
  return match ? match[0] : "unknown";
}

export async function detectCli(
  agent: Agent,
  probe: CliProbe = defaultCliProbe,
): Promise<CliInfo | null> {
  const name = COMMAND_NAMES[agent];

  let path: string | null = await probe.which(name);
  if (!path) {
    path = knownPathsFor(agent).find((candidate) => probe.exists(candidate)) ?? null;
  }
  if (!path) return null;

  const version = parseVersionLine(await probe.runVersion(path));
  return { name: agent, command: name, path, version };
}

export async function detectAllClis(
  probe: CliProbe = defaultCliProbe,
): Promise<{ claude: CliInfo | null; codex: CliInfo | null }> {
  const [claude, codex] = await Promise.all([
    detectCli("CLAUDE", probe),
    detectCli("CODEX", probe),
  ]);
  return { claude, codex };
}
