import { afterEach, expect, it, vi } from "bun:test";
import type { DrizzleClient } from "@/server/db";
import { lpcSeedAssets } from "../../drizzle/data/lpc/seed";
import { isLocalLpcDatabase, prepareDevLpc } from "../../scripts/dev-lpc";

const bundledAssets = lpcSeedAssets();

const environment = {
  NODE_ENV: process.env.NODE_ENV,
  VERCEL: process.env.VERCEL,
  VERCEL_ENV: process.env.VERCEL_ENV,
};
afterEach(() => {
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
const local = "http://root:private@localhost:3002/";
const clientFor = (rows = bundledAssets) => {
  const read = vi.fn(async () => rows);
  const write = vi.fn(() => {
    throw new Error("Unexpected write");
  });
  return {
    read,
    write,
    client: {
      query: { gameAsset: { findMany: read } },
      insert: write,
    } as unknown as DrizzleClient,
  };
};

it.each([
  [local, true],
  ["http://root:private@127.0.0.1:61491/", true],
  ["http://[::1]:3002", true],
  ["http://planetscale:8080", true],
  ["http://tnr_planetscale:8080", true],
  ["https://aws.connect.psdb.cloud", false],
  ["http://localhost.evil.example:3002", false],
  ["http://127.0.0.1.evil.example", false],
  ["https://localhost@production.example", false],
  ["file://localhost/database", false],
  ["not a URL", false],
  [undefined, false],
] as const)("classifies the development database URL %s", (url, expected) => {
  expect(isLocalLpcDatabase(url)).toBe(expected);
});

it("skips a remote database before reading or writing it", async () => {
  const db = clientFor();
  const report = await prepareDevLpc({
    databaseUrl: "https://production.psdb.cloud",
    client: db.client,
  });
  expect(report.status).toBe("skipped");
  expect(db.read).not.toHaveBeenCalled();
  expect(db.write).not.toHaveBeenCalled();
});

it.each([undefined, "not a URL"])(
  "reports invalid database configuration %s without access",
  async (url) => {
    const db = clientFor();
    const report = await prepareDevLpc({ databaseUrl: url, client: db.client });
    expect(report.status).toBe("unavailable");
    expect(report.message).toContain("app/.env");
    expect(db.read).not.toHaveBeenCalled();
    expect(db.write).not.toHaveBeenCalled();
  },
);

it.each(["NODE_ENV", "VERCEL", "VERCEL_ENV"])(
  "skips deployment setup guarded by %s",
  async (key) => {
    Object.assign(process.env, { [key]: "production" });
    const db = clientFor();
    expect(
      (await prepareDevLpc({ databaseUrl: local, client: db.client })).status,
    ).toBe("skipped");
    expect(db.read).not.toHaveBeenCalled();
    expect(db.write).not.toHaveBeenCalled();
  },
);

it("checks a complete catalog and its travel atlases without writing", async () => {
  const db = clientFor();
  expect(
    await prepareDevLpc({ databaseUrl: local, readOnly: true, client: db.client }),
  ).toMatchObject({
    status: "ready",
    designs: bundledAssets.length,
    expectedDesigns: bundledAssets.length,
    missing: [],
    invalid: [],
  });
  expect(db.read).toHaveBeenCalledTimes(1);
  expect(db.write).not.toHaveBeenCalled();
});

it("reports missing designs and the preparation command without seeding in doctor mode", async () => {
  const db = clientFor(bundledAssets.filter((asset) => asset.id !== "body"));
  const report = await prepareDevLpc({
    databaseUrl: local,
    readOnly: true,
    client: db.client,
  });
  expect(report).toMatchObject({
    status: "incomplete",
    designs: bundledAssets.length - 1,
    missing: ["body"],
  });
  expect(report.message).toContain("make dev-prepare");
  expect(db.write).not.toHaveBeenCalled();
});

it("reports invalid existing artwork rather than replacing it", async () => {
  const rows = structuredClone(bundledAssets);
  rows.find((asset) => asset.id === "body")!.lpcConfig.variants[
    "male/light/blue"
  ]![0]!.layout.columns = 0;
  const db = clientFor(rows);
  const report = await prepareDevLpc({
    databaseUrl: local,
    readOnly: true,
    client: db.client,
  });
  expect(report).toMatchObject({ status: "incomplete", invalid: ["body"] });
  expect(report.message).toContain("asset editor");
  expect(db.write).not.toHaveBeenCalled();
});

it("reports database/schema failures without printing credentials, SQL or artwork", async () => {
  const db = clientFor();
  db.read.mockRejectedValueOnce(
    new Error("Unknown column lpcConfig; SELECT private JSON; password=secret"),
  );
  const report = await prepareDevLpc({
    databaseUrl: local,
    readOnly: true,
    client: db.client,
  });
  expect(report.status).toBe("unavailable");
  expect(report.message).toContain("schema migrations");
  expect(JSON.stringify(report)).not.toMatch(/private|password|secret|SELECT/);
});
