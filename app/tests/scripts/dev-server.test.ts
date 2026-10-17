import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  browserLease,
  devPaths,
  devStatus,
  portAvailable,
} from "../../../scripts/dev-server.mjs";

const manager = fileURLToPath(
  new URL("../../../scripts/dev-server.mjs", import.meta.url),
);
const fixtures: string[] = [];
const roots: string[] = [];
const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });

async function command(root: string, action: string, port = "") {
  const child = spawn("node", [join(root, "scripts/dev-server.mjs"), action], {
    cwd: root,
    env: { ...process.env, PORT: port },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => {
    output += data;
  });
  child.stderr.on("data", (data) => {
    output += data;
  });
  const code = await new Promise<number | null>((done) => child.once("exit", done));
  return { code, output };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "tnr-dev-test-"));
  fixtures.push(directory);
  const root = join(directory, "repo with spaces");
  await mkdir(join(root, "scripts"), { recursive: true });
  await writeFile(join(root, "scripts/dev-server.mjs"), await readFile(manager));
  await writeFile(join(root, "Makefile"), "dev-prepare:\n\t@true\n");
  await mkdir(join(root, "app/node_modules/next/dist/bin"), { recursive: true });
  await writeFile(
    join(root, "app/node_modules/next/dist/bin/next"),
    `
    const http = require('node:http');
    const port = Number(process.argv[process.argv.indexOf('-p') + 1]);
    console.log('fixture: starting');
    http.createServer((req, res) => res.end('ready')).listen(port);
  `,
  );
  git(root, "init", "-q");
  git(root, "add", ".");
  git(
    root,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "fixture",
  );
  roots.push(root);
  return { directory, root };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await command(root, "down");
  for (const directory of fixtures.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("parallel worktree dev servers", () => {
  test("concurrent starts reuse one server without deleting its cache", async () => {
    const { root } = await fixture();
    await mkdir(join(root, "app/.next"));
    await writeFile(join(root, "app/.next/keep"), "cache");
    const results = await Promise.all([command(root, "up"), command(root, "up")]);
    for (const result of results) expect(result.code, result.output).toBe(0);
    const first = JSON.parse(results[0]!.output);
    const second = JSON.parse(results[1]!.output);
    expect(first.id).toBe(second.id);
    expect(first.phase).toBe("ready");
    expect(await readFile(join(root, "app/.next/keep"), "utf8")).toBe("cache");
    expect((await command(root, "up")).code).toBe(0);
    expect(JSON.parse((await command(root, "status")).output).pid).toBe(first.pid);
    expect(await readFile(first.logPath, "utf8")).toContain("fixture: starting");
  }, 20_000);

  test("sibling worktrees reserve distinct ports and stop independently", async () => {
    const { root, directory } = await fixture();
    const sibling = join(directory, "sibling");
    git(root, "worktree", "add", "--detach", sibling, "HEAD");
    roots.push(sibling);
    const results = await Promise.all([command(root, "up"), command(sibling, "up")]);
    for (const result of results) expect(result.code, result.output).toBe(0);
    const first = JSON.parse(results[0]!.output);
    const second = JSON.parse(results[1]!.output);
    expect(first.port).not.toBe(second.port);
    expect(devPaths(root).registry).toBe(devPaths(sibling).registry);
    expect((await command(root, "down")).code).toBe(0);
    expect(await portAvailable(first.port)).toBe(true);
    expect((await fetch(second.url)).status).toBe(200);
    expect((await command(root, "up")).code).toBe(0);
    expect(JSON.parse((await command(root, "status")).output).port).toBe(first.port);
  }, 25_000);

  test("an occupied explicit port fails promptly and leaves the listener alone", async () => {
    const { root } = await fixture();
    const listener = createServer();
    await new Promise<void>((done) => listener.listen(0, done));
    const address = listener.address() as { port: number };
    try {
      const result = await command(root, "up", String(address.port));
      expect(result.code).not.toBe(0);
      expect(result.output).toContain("Supervisor exited");
      expect(await portAvailable(address.port)).toBe(false);
      expect((await command(root, "down")).code).toBe(0);
      expect(await portAvailable(address.port)).toBe(false);
    } finally {
      await new Promise<void>((done) => listener.close(() => done()));
    }
  }, 10_000);

  test("a port reserved during preparation cannot be taken by a sibling", async () => {
    const { root, directory } = await fixture();
    const sibling = join(directory, "sibling");
    git(root, "worktree", "add", "--detach", sibling, "HEAD");
    roots.push(sibling);
    await writeFile(join(root, "Makefile"), "dev-prepare:\n\t@sleep 2\n");
    await writeFile(join(sibling, "Makefile"), "dev-prepare:\n\t@sleep 2\n");
    const listener = createServer();
    await new Promise<void>((done) => listener.listen(0, done));
    const port = (listener.address() as { port: number }).port;
    await new Promise<void>((done) => listener.close(() => done()));
    const results = await Promise.all([
      command(root, "up", String(port)),
      command(sibling, "up", String(port)),
    ]);
    expect(results.filter(({ code }) => code === 0)).toHaveLength(1);
    expect(results.filter(({ code }) => code !== 0)).toHaveLength(1);
    const winner = results.find(({ code }) => code === 0);
    expect(JSON.parse(winner?.output ?? "{}").port).toBe(port);
  }, 15_000);

  test("preparation failures propagate with an actionable log", async () => {
    const { root } = await fixture();
    await writeFile(
      join(root, "Makefile"),
      "dev-prepare:\n\t@echo missing-env >&2\n\t@false\n",
    );
    const result = await command(root, "up");
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("Read");
    expect(await readFile(devPaths(root).logPath, "utf8")).toContain("missing-env");
    expect((await devStatus(devPaths(root))).phase).toBe("stopped");
  }, 10_000);

  test("a recycled PID never permits stopping an unrelated process", async () => {
    const { root } = await fixture();
    const paths = devPaths(root);
    await mkdir(paths.registry);
    await writeFile(
      paths.stateFile,
      JSON.stringify({ root, pid: process.pid, id: "not-the-supervisor", port: 1 }),
    );
    expect((await command(root, "down")).code).toBe(0);
    expect((await devStatus(paths)).phase).toBe("stopped");
  });
});

test("Chrome leases reject other owners, renew, release and expire", async () => {
  const { root } = await fixture();
  const paths = devPaths(root);
  const acquired = await browserLease(paths, "acquire", "chat-a", 100);
  expect(acquired.owner).toBe("chat-a");
  await expect(browserLease(paths, "acquire", "chat-b", 101)).rejects.toThrow("chat-a");
  await expect(browserLease(paths, "release", "chat-b", 101)).rejects.toThrow("chat-a");
  const renewed = await browserLease(paths, "acquire", "chat-a", 102);
  expect(renewed.expiresAt).toBeGreaterThan(acquired.expiresAt);
  expect(await browserLease(paths, "release", "chat-a", 103)).toEqual({
    released: true,
  });
  expect((await browserLease(paths, "acquire", "chat-b", 104)).owner).toBe("chat-b");
  expect(
    (await browserLease(paths, "acquire", "chat-a", 104 + 31 * 60_000)).owner,
  ).toBe("chat-a");
});
