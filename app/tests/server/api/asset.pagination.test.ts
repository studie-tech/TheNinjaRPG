import { describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { unpackLpcDesigns } from "@/libs/lpc/transport";
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
      const client = drizzle(async (sql, params) => {
        if (sql.includes("order by")) {
          expect(params).toEqual([3, 2]);
          expect(sql).not.toContain("lpcConfig");
          return {
            rows: Array.from({ length: count }, (_, index) => [`asset-${index}`]),
          };
        }
        expect(params).toEqual(
          Array.from({ length: Math.min(count, 2) }, (_, index) => `asset-${index}`),
        );
        expect(sql).not.toContain("order by");
        // Fetch order may differ from the sorted ID page.
        return {
          rows: Array.from({ length: Math.min(count, 2) }, (_, index) =>
            row(`asset-${index}`),
          ).reverse(),
        };
      }) as unknown as DrizzleClient;
      const result = await resolver({
        ctx: { drizzle: client },
        input: { limit: 2, cursor: 1, includeAnimations: true },
      });
      expect(unpackLpcDesigns(result.data)).toHaveLength(Math.min(count, 2));
      expect(unpackLpcDesigns(result.data).map((asset) => asset.id)).toEqual(
        Array.from({ length: Math.min(count, 2) }, (_, index) => `asset-${index}`),
      );
      expect(result.nextCursor).toBe(count > 2 ? 2 : null);
    },
  );
});
