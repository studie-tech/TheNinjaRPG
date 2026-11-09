import { describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { gameAssetRouter } from "@/routers/asset";
import type { DrizzleClient } from "@/server/db";
import { resolverOf } from "../../setup/testDatabase";

/** Proxy-row shape for the asset columns selected by the application query. */
const row = (id: string) => [
  id,
  id,
  "STATIC",
  "https://example.com/art.png",
  "https://example.com/art.png",
  1,
  1,
  false,
  "",
  "2026-01-01 00:00:00",
  "2026-01-01 00:00:00",
  "TNR",
  null,
  false,
];

const resolver = resolverOf(gameAssetRouter.getAll);

describe("asset library pagination", () => {
  it.each([0, 1, 2, 3])(
    "only offers another page when there is an unseen asset (%i rows)",
    async (count) => {
      const client = drizzle(async (_sql, params) => {
        expect(params).toEqual([3, 2]);
        return {
          rows: Array.from({ length: count }, (_, index) => row(`asset-${index}`)),
        };
      }) as unknown as DrizzleClient;
      const result = await resolver({
        ctx: { drizzle: client },
        input: { limit: 2, cursor: 1, includeAnimations: true },
      });
      expect(result.data).toHaveLength(Math.min(count, 2));
      expect(result.nextCursor).toBe(count > 2 ? 2 : null);
    },
  );
});
