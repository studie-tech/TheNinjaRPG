import { afterEach, expect, it, vi } from "bun:test";
import type { DrizzleClient } from "@/server/db";
import { prepareDevBuildings } from "../../scripts/dev-buildings";

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

it.each([
  undefined,
  "not a URL",
  "https://production.psdb.cloud",
  "https://localhost.evil.example",
])("never accesses a database outside local preparation: %s", async (databaseUrl) => {
  const read = vi.fn(() => {
    throw new Error("Unexpected database access");
  });
  const result = await prepareDevBuildings({
    databaseUrl,
    client: { select: read } as unknown as DrizzleClient,
  });
  expect(result.status).toBe("skipped");
  expect(read).not.toHaveBeenCalled();
});

it.each(["NODE_ENV", "VERCEL", "VERCEL_ENV"])(
  "skips deployment preparation guarded by %s",
  async (key) => {
    Object.assign(process.env, { [key]: "production" });
    const result = await prepareDevBuildings({
      databaseUrl: "http://localhost:3002",
      client: {} as DrizzleClient,
    });
    expect(result.status).toBe("skipped");
  },
);
