#!/usr/bin/env node
/** Worktree-scoped Next supervisors; the common Git directory coordinates ports and Chrome. */
import { createHash, randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(import.meta.url);
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const git = (root, ...args) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

export function devPaths(cwd = process.cwd()) {
  const root = git(cwd, "rev-parse", "--show-toplevel");
  const registry = join(
    resolve(root, git(root, "rev-parse", "--git-common-dir")),
    "tnr-dev",
  );
  const key = createHash("sha256").update(root).digest("hex").slice(0, 12);
  return {
    root,
    registry,
    key,
    stateFile: join(registry, `${key}.json`),
    logPath: join(registry, `${key}.log`),
  };
}

export async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function saveJson(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, path);
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A PID alone can be recycled; the supervisor's random command-line ID must still match. */
function ownsSupervisor(state) {
  if (!state || !alive(state.pid)) return false;
  try {
    const command = execFileSync("ps", ["-p", String(state.pid), "-o", "command="], {
      encoding: "utf8",
    });
    return (
      command.includes(join(state.root, "scripts/dev-server.mjs")) &&
      command.includes(state.id)
    );
  } catch {
    return false;
  }
}

async function locked(paths, fn) {
  await mkdir(paths.registry, { recursive: true, mode: 0o700 });
  const lock = join(paths.registry, "registry.lock");
  const deadline = Date.now() + 20_000;
  while (true) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline)
        throw new Error(
          `Registry is locked: ${lock}. Check its owner.json; remove the lock only if that process has exited.`,
        );
      await pause(100);
    }
  }
  try {
    await saveJson(join(lock, "owner.json"), { pid: process.pid, root: paths.root });
    return await fn();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

export async function portAvailable(port) {
  return new Promise((done) => {
    const server = createServer();
    server.once("error", () => done(false));
    server.listen(port, () => server.close(() => done(true)));
  });
}

async function reserve(paths, id, requestedPort) {
  return locked(paths, async () => {
    const previous = await readJson(paths.stateFile);
    if (ownsSupervisor(previous)) {
      if (requestedPort && previous.port !== requestedPort)
        throw new Error(
          `Already running on ${previous.url}. Use make dev-down before changing PORT.`,
        );
      return null;
    }
    if (alive(previous?.childPid))
      throw new Error(
        `Orphaned dev process ${previous.childPid}; inspect ${paths.logPath} and that process before restarting. No process was killed.`,
      );
    const reserved = new Set();
    for (const file of await readdir(paths.registry)) {
      if (!file.endsWith(".json") || file === "browser.json") continue;
      const state = await readJson(join(paths.registry, file));
      if (ownsSupervisor(state) || alive(state?.childPid)) reserved.add(state.port);
    }
    const first = 3100 + (Number.parseInt(paths.key.slice(0, 4), 16) % 900);
    const ports = requestedPort
      ? [requestedPort]
      : [
          previous?.port,
          ...Array.from({ length: 900 }, (_, i) => 3100 + ((first - 3100 + i) % 900)),
        ];
    for (const port of ports) {
      if (!port || reserved.has(port) || !(await portAvailable(port))) continue;
      const state = {
        root: paths.root,
        id,
        pid: process.pid,
        childPid: null,
        port,
        url: `http://localhost:${port}`,
        logPath: paths.logPath,
        phase: "starting",
      };
      await saveJson(paths.stateFile, state);
      return state;
    }
    throw new Error(
      requestedPort
        ? `Port ${requestedPort} is occupied; choose another PORT or omit it.`
        : "No free dev port in 3100–3999.",
    );
  });
}

export async function devStatus(paths = devPaths()) {
  const state = await readJson(paths.stateFile);
  const browser = await readJson(join(paths.registry, "browser.json"));
  return {
    ...state,
    root: paths.root,
    phase: ownsSupervisor(state) ? state.phase : "stopped",
    logPath: paths.logPath,
    browserSession: `tnr-${paths.key}`,
    browserLease: browser?.expiresAt > Date.now() ? browser : null,
  };
}

export async function browserLease(
  paths,
  action,
  owner = process.env.CODEX_THREAD_ID || paths.key,
  now = Date.now(),
) {
  return locked(paths, async () => {
    const path = join(paths.registry, "browser.json");
    const lease = await readJson(path);
    if (
      lease?.expiresAt > now &&
      (lease.owner !== owner || lease.root !== paths.root)
    ) {
      throw new Error(
        `Chrome login lease belongs to ${lease.owner} in ${lease.root} until ${new Date(lease.expiresAt).toISOString()}. Continue API/server work; retry after release. Do not sign in or switch accounts in shared Chrome.`,
      );
    }
    if (action === "release") {
      await rm(path, { force: true });
      return { released: true };
    }
    const next = { owner, root: paths.root, expiresAt: now + 30 * 60_000 };
    await saveJson(path, next);
    return next;
  });
}

async function supervise(paths, id, port) {
  const state = await reserve(paths, id, port);
  if (!state) return;
  let child;
  let stopping = false;
  const stop = () => {
    stopping = true;
    // Each child gets its own process group: make/bun/Next descendants all stop together.
    if (child?.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
    }
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  const run = async (command, args, options = {}) => {
    child = spawn(command, args, {
      cwd: paths.root,
      stdio: "inherit",
      detached: true,
      ...options,
    });
    const completion = new Promise((done, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => done({ code, signal }));
    });
    state.childPid = child.pid;
    await saveJson(paths.stateFile, state);
    return completion;
  };
  try {
    const prepared = await run("make", ["dev-prepare"]);
    state.childPid = null;
    if (prepared.code !== 0 || stopping)
      throw new Error("Dev preparation stopped or failed; see the log.");
    const exited = run(
      process.execPath,
      [
        join(paths.root, "app/node_modules/next/dist/bin/next"),
        "dev",
        "-p",
        String(state.port),
      ],
      {
        cwd: join(paths.root, "app"),
        env: { ...process.env, NODE_ENV: "development" },
      },
    );
    let finished = false;
    void exited.then(
      () => {
        finished = true;
      },
      () => {
        finished = true;
      },
    );
    while (!finished && !stopping) {
      try {
        const response = await fetch(`${state.url}/login`, {
          signal: AbortSignal.timeout(5_000),
          redirect: "manual",
        });
        await response.body?.cancel();
        if (response.status === 200 && !finished && !stopping) {
          state.phase = "ready";
          await saveJson(paths.stateFile, state);
          console.log(`dev: ready at ${state.url}`);
          break;
        }
      } catch {
        /* Compilation can outlast a single readiness request. */
      }
      await pause(1_000);
    }
    const result = await exited;
    if (result.code !== 0 && !stopping)
      throw new Error(`Next exited (${result.code ?? result.signal}).`);
  } catch (error) {
    stop();
    state.error = error.message;
    console.error(`dev: ${error.message}`);
    process.exitCode = 1;
  } finally {
    state.phase = "stopped";
    if (!alive(state.childPid)) state.childPid = null;
    await saveJson(paths.stateFile, state);
  }
}

async function launch(paths, foreground, port) {
  const existing = await readJson(paths.stateFile);
  let launchError;
  if (ownsSupervisor(existing) && port && port !== existing.port)
    throw new Error(`Already running on ${existing.url}; use make dev-down first.`);
  if (!ownsSupervisor(existing)) {
    await mkdir(paths.registry, { recursive: true, mode: 0o700 });
    const log = foreground ? null : await open(paths.logPath, "a", 0o600);
    const child = spawn(
      process.execPath,
      [script, "serve", randomUUID(), port ? String(port) : ""],
      {
        cwd: paths.root,
        detached: !foreground,
        stdio: foreground ? "inherit" : ["ignore", log.fd, log.fd],
      },
    );
    child.once("error", (error) => {
      launchError = error.message;
    });
    child.once("exit", (code) => {
      if (code) launchError = `Supervisor exited with code ${code}`;
    });
    if (log) await log.close();
    if (foreground) {
      process.on("SIGINT", () => child.kill("SIGINT"));
      process.on("SIGTERM", () => child.kill("SIGTERM"));
      const code = await new Promise((done, reject) => {
        child.once("error", reject);
        child.once("exit", done);
      });
      process.exitCode = code ?? 1;
      return;
    }
    child.unref();
  }
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const status = await devStatus(paths);
    if (status.phase === "ready") {
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    if (launchError) throw new Error(`${launchError}. Read ${paths.logPath}`);
    // Allow the detached supervisor time to publish its initial state.
    if (status.id !== existing?.id && status.phase === "stopped")
      throw new Error(
        `Startup failed. Read ${paths.logPath}${status.error ? `: ${status.error}` : ""}`,
      );
    await pause(500);
  }
  throw new Error(
    `Readiness timed out; the server may still be starting. Inspect make dev-status and ${paths.logPath}; rerun make dev-up to wait again.`,
  );
}

async function main() {
  const paths = devPaths();
  const [action, id, rawPort] = process.argv.slice(2);
  const requested = action === "serve" ? rawPort : process.env.PORT;
  const port = requested ? Number(requested) : null;
  if (requested && (!Number.isInteger(port) || port < 1024 || port > 65535))
    throw new Error("PORT must be an integer from 1024 to 65535.");
  switch (action) {
    case "serve":
      await supervise(paths, id, port);
      break;
    case "start":
    case "up":
      await launch(paths, action === "start", port);
      break;
    case "status":
      console.log(JSON.stringify(await devStatus(paths), null, 2));
      break;
    case "down": {
      const state = await readJson(paths.stateFile);
      if (ownsSupervisor(state)) {
        process.kill(state.pid, "SIGTERM");
        for (let i = 0; i < 100 && ownsSupervisor(state); i++) await pause(100);
        if (ownsSupervisor(state))
          throw new Error(
            `Supervisor ${state.pid} is still stopping. Inspect ${paths.logPath}; no unrelated listener was killed.`,
          );
      }
      console.log(JSON.stringify(await devStatus(paths), null, 2));
      break;
    }
    case "browser-acquire":
    case "browser-release":
      console.log(
        JSON.stringify(
          await browserLease(
            paths,
            action === "browser-acquire" ? "acquire" : "release",
          ),
          null,
          2,
        ),
      );
      break;
    default:
      throw new Error(
        "Use make start, dev-up, dev-status, dev-down, dev-browser, or dev-browser-release.",
      );
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === script) {
  main().catch((error) => {
    console.error(`dev: ${error.message}`);
    process.exitCode = 1;
  });
}
