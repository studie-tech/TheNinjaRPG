import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import type { Connection } from "mysql2/promise";
import { readTestDatabaseUrl } from "../tests/setup/testDatabaseConfig";

/** Run sequential Bun shards in separate processes and invocation-owned SQL schemas. */
async function runTestShards() {
  const requested = process.env.TEST_SHARDS ?? "4";
  if (!/^[1-4]$/.test(requested))
    throw new Error("TEST_SHARDS must be an integer between 1 and 4.");
  const shards = Math.min(Number(requested), availableParallelism());
  const args = process.argv.slice(2);
  const concurrencyFlags = new Set([
    "--shard", "--parallel", "--concurrent", "--watch", "--hot", "--isolate", "--no-isolate", "-w",
  ]);
  if (args.some((arg) => concurrencyFlags.has(arg.split("=")[0]!)))
    throw new Error("Use TEST_SHARDS to select workers, or test:serial for native runner modes.");
  const databaseUrl = readTestDatabaseUrl(process.env);
  const logs = process.env.TEST_LOG_DIR ?? await mkdtemp(join(tmpdir(), "tnr-tests-"));
  await mkdir(logs, { recursive: true, mode: 0o700 });
  console.log(`Running ${shards} test shards on ${availableParallelism()} available CPUs`);
  console.log(`Test logs: ${logs}`);

  const active = new Set<ChildProcess>();
  const ownedSchemas: string[] = [];
  let connection: Connection | undefined;
  let interrupted: number | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let exitCode = 1;
  const kill = (signal: NodeJS.Signals) => {
    for (const child of active) {
      if (!child.pid) continue;
      try {
        // Each shard owns its process group; Bun also reaps detached fixture descendants.
        process.kill(process.platform === "win32" ? child.pid : -child.pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") console.error(error);
      }
    }
  };
  const stop = (signal: NodeJS.Signals) => {
    interrupted ??= signal === "SIGINT" ? 130 : 143;
    kill("SIGTERM");
    killTimer ??= setTimeout(() => kill("SIGKILL"), 2000);
    killTimer.unref();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  try {
    let urls: (string | undefined)[] = Array.from({ length: shards }, () => undefined);
    if (databaseUrl) {
      const server = new URL(databaseUrl);
      if (server.protocol !== "mysql:") throw new Error("TEST_MYSQL_URL must use mysql://.");
      server.pathname = "/";
      connection = await mysql.createConnection(server.toString());
      const admin = connection;
      const prefix = `tnr_test_${randomUUID().replaceAll("-", "")}`;
      // Wait for every CREATE before cleanup, including when one allocation fails.
      const allocated = await Promise.allSettled(Array.from({ length: shards }, async (_, index) => {
        const name = `${prefix}_${index + 1}`;
        await admin.query("CREATE DATABASE ??", [name]);
        ownedSchemas.push(name);
        const url = new URL(databaseUrl);
        url.pathname = `/${name}`;
        return url.toString();
      }));
      const failed = allocated.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      urls = allocated.map((result) => (result as PromiseFulfilledResult<string>).value);
    }
    if (interrupted) return interrupted;

    const results = await Promise.allSettled(urls.map(async (url, index) => {
      const path = join(logs, `${index + 1}.log`);
      const fd = openSync(path, "w", 0o600);
      let child: ChildProcess;
      try {
        child = spawn(process.execPath, ["test", "--no-orphans", `--shard=${index + 1}/${shards}`, ...args], {
          cwd: dirname(dirname(fileURLToPath(import.meta.url))),
          env: { ...process.env, NODE_ENV: "test", TEST_MYSQL_URL: url },
          detached: process.platform !== "win32",
          stdio: ["ignore", fd, fd],
        });
        active.add(child);
      } finally {
        closeSync(fd);
      }
      let spawnError: Error | undefined;
      const code = await new Promise<number>((resolve) => {
        child.once("error", (error) => { spawnError = error; });
        child.once("close", (code) => { active.delete(child); resolve(code ?? 1); });
      });
      const output = await readFile(path, "utf8");
      const title = `Test shard ${index + 1}/${shards}`;
      const text = code === 0 ? output.trimEnd().split("\n").slice(-8).join("\n") : output;
      console.log([
        process.env.GITHUB_ACTIONS === "true" ? `::group::${title}` : `${title}:`,
        text,
        spawnError?.message,
        process.env.GITHUB_ACTIONS === "true" ? "::endgroup::" : undefined,
      ].filter((line) => line !== undefined).join("\n"));
      return code;
    }));
    for (const result of results) {
      if (result.status === "rejected") console.error(result.reason);
    }
    exitCode = results.every((result) => result.status === "fulfilled" && result.value === 0) ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  } finally {
    // Only schemas successfully created by this invocation can be dropped.
    const dropped = await Promise.allSettled(ownedSchemas.map((name) => connection!.query("DROP DATABASE ??", [name])));
    for (const result of dropped) {
      if (result.status === "rejected") { console.error(result.reason); exitCode = 1; }
    }
    try {
      await connection?.end();
    } finally {
      clearTimeout(killTimer);
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
  }
  return interrupted ?? exitCode;
}

if (import.meta.main) {
  runTestShards().then(
    (code) => { process.exitCode = code; },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
