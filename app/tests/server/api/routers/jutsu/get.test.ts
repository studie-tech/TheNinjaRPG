import { describe, expect, it, vi } from "bun:test";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import { resolverOf } from "../../../../setup/testDatabase";

// Exercise the query resolver directly; middleware and transport are not under test.
const get = (row: object | undefined): Promise<unknown> => {
  const findFirst = vi.fn(async () => row);
  return resolverOf(jutsuRouter.get)({
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
