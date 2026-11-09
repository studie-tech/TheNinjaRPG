import { afterEach, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import { describeWithDatabase } from "../setup/testDatabase";
import { pollUntil } from "../setup/statements";

const application = resolve(import.meta.dirname, "../..");
const directories: string[] = [];
const running = new Set<ReturnType<typeof start>>();

afterEach(async () => {
  for (const run of running) run.child.kill("SIGTERM");
  await Promise.all([...running].map((run) => run.finished));
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});

async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), "tnr-shards-test-"));
  directories.push(parent);
  const root = join(parent, "app with spaces");
  await Promise.all([
    mkdir(join(root, "scripts"), { recursive: true }),
    mkdir(join(root, "tests/setup"), { recursive: true }),
    mkdir(join(root, "markers"), { recursive: true }),
  ]);
  await Promise.all([
    copyFile(
      join(application, "scripts/test-shards.ts"),
      join(root, "scripts/test-shards.ts"),
    ),
    copyFile(
      join(application, "tests/setup/testDatabaseConfig.ts"),
      join(root, "tests/setup/testDatabaseConfig.ts"),
    ),
    symlink(join(application, "node_modules"), join(root, "node_modules"), "dir"),
    writeFile(join(root, "package.json"), '{"type":"module"}'),
    ...Array.from({ length: 8 }, (_, id) =>
      writeFile(
        join(root, `tests/fixture-${id}.test.ts`),
        `
      import { it, expect } from "bun:test";
      import { appendFileSync } from "node:fs";
      import { join } from "node:path";
      import mysql from "mysql2/promise";
      it("fixture ${id}", async () => {
        const uri = process.env.TEST_MYSQL_URL;
        let connection;
        let database;
        try {
          if (uri) {
            connection = await mysql.createConnection(uri);
            const [rows] = await connection.query("SELECT DATABASE() AS name");
            database = rows[0].name;
            expect(database).not.toBe(process.env.ROOT_TEST_DATABASE);
            await connection.query("CREATE TABLE IF NOT EXISTS Probe (id INT PRIMARY KEY, runKey VARCHAR(40))");
            await connection.query("INSERT INTO Probe VALUES (?, ?)", [${id}, process.env.SHARD_RUN_KEY]);
            const [values] = await connection.query("SELECT DISTINCT runKey FROM Probe");
            expect(values.map(row => row.runKey)).toEqual([process.env.SHARD_RUN_KEY]);
          }
          appendFileSync(join(process.env.SHARD_MARKER_DIR, process.env.SHARD_RUN_KEY + "-${id}.jsonl"),
            JSON.stringify({ id: ${id}, pid: process.pid, database }) + "\\n");
          if (process.env.SHARD_WAIT === "1") await new Promise(resolve => setTimeout(resolve, 30_000));
          expect(String(${id})).not.toBe(process.env.SHARD_FAIL_FILE);
        } finally { await connection?.end(); }
      }, 40_000);
    `,
      ),
    ),
  ]);
  return root;
}

function start(
  root: string,
  environment: Record<string, string | undefined> = {},
  args: string[] = [],
) {
  const child = spawn(
    process.execPath,
    [join(root, "scripts/test-shards.ts"), ...args],
    {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: "test",
        TEST_MYSQL_URL: undefined,
        TEST_MYSQL_ALLOW_DESTRUCTIVE: undefined,
        TEST_SHARDS: "4",
        TEST_LOG_DIR: join(root, `logs-${randomUUID()}`),
        SHARD_MARKER_DIR: join(root, "markers"),
        SHARD_RUN_KEY: "default",
        GITHUB_ACTIONS: "",
        ...environment,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const finished = new Promise<{ code: number | null; output: string }>((done) => {
    child.once("close", (code) => {
      running.delete(run);
      done({ code, output });
    });
  });
  const run = { child, finished };
  running.add(run);
  return run;
}

async function markers(root: string, runKey = "default") {
  const paths = (await readdir(join(root, "markers"))).filter((path) =>
    path.startsWith(`${runKey}-`),
  );
  return (
    await Promise.all(
      paths.map((path) => readFile(join(root, "markers", path), "utf8")),
    )
  ).flatMap((text) =>
    text
      .trim()
      .split("\n")
      .map(
        (line) => JSON.parse(line) as { id: number; pid: number; database?: string },
      ),
  );
}

it.each([undefined, "1"])(
  "runs every file once in long-lived workers with TEST_SHARDS=%s",
  async (requested) => {
    const root = await fixture();
    const result = await start(root, requested ? { TEST_SHARDS: requested } : {})
      .finished;
    expect(result.code, result.output).toBe(0);
    const entries = await markers(root);
    expect(entries.map(({ id }) => id).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(entries.map(({ pid }) => pid)).size).toBe(
      Math.min(Number(requested ?? 4), availableParallelism()),
    );
  },
  20_000,
);

it("waits for every shard and propagates a test failure", async () => {
  const root = await fixture();
  const result = await start(root, { SHARD_FAIL_FILE: "3" }).finished;
  expect(result.code).toBe(1);
  expect(result.output).toContain("fixture 3");
  expect((await markers(root)).map(({ id }) => id).sort()).toEqual([
    0, 1, 2, 3, 4, 5, 6, 7,
  ]);
}, 20_000);

it.each(["0", "5", "2.5", "invalid"])(
  "rejects invalid TEST_SHARDS=%s before starting workers",
  async (requested) => {
    const root = await fixture();
    const result = await start(root, { TEST_SHARDS: requested }).finished;
    expect(result.code).toBe(1);
    expect(result.output).toContain("TEST_SHARDS must be an integer between 1 and 4");
    expect(await markers(root)).toEqual([]);
  },
);

it("rejects an unacknowledged SQL configuration before connecting or starting workers", async () => {
  const root = await fixture();
  const result = await start(root, {
    TEST_MYSQL_URL: "mysql://root@127.0.0.1:1/unused",
  }).finished;
  expect(result.code).toBe(1);
  expect(result.output).toContain("TEST_MYSQL_ALLOW_DESTRUCTIVE is not '1'");
  expect(await markers(root)).toEqual([]);
});

it("rejects nested native concurrency that could share a shard's database", async () => {
  const root = await fixture();
  const result = await start(root, {}, ["--parallel=2"]).finished;
  expect(result.code).toBe(1);
  expect(result.output).toContain("Use TEST_SHARDS to select workers");
  expect(await markers(root)).toEqual([]);
});

describeWithDatabase("shard schema ownership", () => {
  const sqlEnvironment = (runKey: string) => ({
    TEST_MYSQL_URL: process.env.TEST_MYSQL_URL,
    TEST_MYSQL_ALLOW_DESTRUCTIVE: "1",
    TEST_SHARDS: "2",
    SHARD_RUN_KEY: runKey,
    ROOT_TEST_DATABASE: new URL(process.env.TEST_MYSQL_URL!).pathname.slice(1),
  });

  async function assertRemoved(names: string[]) {
    const connection = await mysql.createConnection(process.env.TEST_MYSQL_URL!);
    try {
      const [rows] = await connection.query<RowDataPacket[]>(
        "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN (?)",
        [names],
      );
      expect(rows).toEqual([]);
    } finally {
      await connection.end();
    }
  }

  it("isolates overlapping invocations and preserves the configured database", async () => {
    const root = await fixture();
    const connection = await mysql.createConnection(process.env.TEST_MYSQL_URL!);
    const sentinel = `ShardSentinel_${randomUUID().replaceAll("-", "")}`;
    try {
      await connection.query("CREATE TABLE ?? (marker INT)", [sentinel]);
      await connection.query("INSERT INTO ?? VALUES (42)", [sentinel]);
      const results = await Promise.all([
        start(root, sqlEnvironment("first")).finished,
        start(root, sqlEnvironment("second")).finished,
      ]);
      for (const result of results) expect(result.code, result.output).toBe(0);
      const first = await markers(root, "first");
      const second = await markers(root, "second");
      expect(first).toHaveLength(8);
      expect(second).toHaveLength(8);
      const names = [
        ...new Set([...first, ...second].map(({ database }) => database!)),
      ];
      expect(names).toHaveLength(2 * Math.min(2, availableParallelism()));
      await assertRemoved(names);
      const [rows] = await connection.query<RowDataPacket[]>("SELECT marker FROM ??", [
        sentinel,
      ]);
      expect(rows.map(({ marker }) => marker)).toEqual([42]);
    } finally {
      await connection.query("DROP TABLE IF EXISTS ??", [sentinel]);
      await connection.end();
    }
  }, 30_000);

  it("drops its schemas after a failed test", async () => {
    const root = await fixture();
    const result = await start(root, {
      ...sqlEnvironment("failed"),
      SHARD_FAIL_FILE: "3",
    }).finished;
    expect(result.code).toBe(1);
    const entries = await markers(root, "failed");
    expect(entries).toHaveLength(8);
    await assertRemoved([...new Set(entries.map(({ database }) => database!))]);
  }, 20_000);

  it.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)(
    "stops its workers and drops schemas on %s",
    async (signal, exitCode) => {
      const root = await fixture();
      const run = start(root, { ...sqlEnvironment("interrupted"), SHARD_WAIT: "1" });
      try {
        expect(
          await pollUntil(async () => (await markers(root, "interrupted")).length > 0, {
            attempts: 500,
            intervalMs: 10,
          }),
        ).toBe(true);
      } finally {
        run.child.kill(signal);
      }
      const result = await run.finished;
      expect(result.code, result.output).toBe(exitCode);
      const entries = await markers(root, "interrupted");
      expect(entries.length).toBeGreaterThan(0);
      const prefix = entries[0]!.database!.replace(/_\d+$/, "");
      await assertRemoved(
        Array.from(
          { length: Math.min(2, availableParallelism()) },
          (_, index) => `${prefix}_${index + 1}`,
        ),
      );
    },
    20_000,
  );
});
