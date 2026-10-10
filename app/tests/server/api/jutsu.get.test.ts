
import { describe, expect, it, vi } from "bun:test";
import { jutsuRouter } from "@/server/api/routers/jutsu";

// Exercise the query resolver directly; middleware and transport are not under test.
const get = (row: object | undefined) => {
  const findFirst = vi.fn(async () => row);
  const { resolver } = jutsuRouter._def.procedures.get._def as unknown as {
    resolver: (options: {
      ctx: { drizzle: object; userId: string | null };
      input: { id: string };
    }) => Promise<unknown>;
  };
  return resolver({
    ctx: { drizzle: { query: { jutsu: { findFirst } } }, userId: null },
    input: { id: "stale-link" },
  });
};

describe("jutsu.get", () => {
  it("answers a missing jutsu with null instead of throwing", async () => {
    await expect(get(undefined)).resolves.toBeNull();
  });

  it("returns an existing jutsu", async () => {
    await expect(get({ id: "stale-link", name: "Found" })).resolves.toEqual({
      id: "stale-link",
      name: "Found",
    });
  });
});
