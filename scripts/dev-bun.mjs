#!/usr/bin/env node
/** Keep every application Make command on a Bun that understands the committed lockfile. */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function selectBun(candidates, minimum) {
  const required = minimum.split(".").map(Number);
  for (const candidate of new Set(candidates)) {
    let version;
    try {
      version = execFileSync(candidate, ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      continue;
    }
    if (!/^\d+\.\d+\.\d+$/.test(version)) continue;
    const parts = version.split(".").map(Number);
    const difference =
      parts.map((part, i) => part - required[i]).find((part) => part !== 0) ?? 0;
    if (difference >= 0) return candidate;
  }
  throw new Error(
    `Bun >= ${minimum} is required by app/package.json. Install a compatible Bun in PATH or ~/.bun/bin; refusing to rewrite bun.lock with an older runtime.`,
  );
}

/** Package scripts also invoke `bun`; keep those descendants on the selected runtime. */
export function bunEnvironment(binary, environment = process.env) {
  return {
    ...environment,
    PATH:
      binary === "bun"
        ? environment.PATH
        : `${dirname(binary)}${delimiter}${environment.PATH ?? ""}`,
  };
}

const script = fileURLToPath(import.meta.url);
if (process.argv[1] && realpathSync(process.argv[1]) === script) {
  try {
    const { packageManager } = JSON.parse(
      readFileSync(new URL("../app/package.json", import.meta.url), "utf8"),
    );
    const binary = selectBun(
      ["bun", join(homedir(), ".bun/bin/bun")],
      packageManager.replace(/^bun@/, ""),
    );
    if (binary !== "bun")
      console.error(`dev-bun: using ${binary} (PATH Bun is missing or too old)`);
    const result = spawnSync(binary, process.argv.slice(2), {
      stdio: "inherit",
      env: bunEnvironment(binary),
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(`dev-bun: ${error.message}`);
    process.exitCode = 1;
  }
}
