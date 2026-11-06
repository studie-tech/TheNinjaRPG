import { afterEach, expect, it, vi } from "bun:test";
import type { RouterOutputs } from "@/app/_trpc/client";
import * as queries from "@/queries/combat";
import { combatRouter } from "@/server/api/routers/combat";
import * as completion from "@/server/utils/combatCompletion";

afterEach(() => vi.restoreAllMocks());

it("recovers a deleted arena battle only for the authenticated viewer without settling it again", async () => {
  const read = vi.spyOn(queries, "fetchBattle").mockResolvedValue(null);
  const saved = { battle: { id: "finished-arena" }, result: { outcome: "Won" } } as RouterOutputs["combat"]["getBattle"];
  const recover = vi.fn(async () => saved);
  vi.spyOn(completion, "combatCompletionStore").mockReturnValue({ recover, save: vi.fn() } as never);
  const resolver = (combatRouter.getBattle._def as unknown as {
    resolver: (args: unknown) => Promise<RouterOutputs["combat"]["getBattle"]>;
  }).resolver;
  // No writable database surface is supplied: receipt recovery must be display-only.
  const database = {};
  expect(await resolver({ ctx: { userId: "viewer", drizzle: database }, input: { battleId: "finished-arena" } })).toBe(saved);
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith(database, "finished-arena");
  expect(recover).toHaveBeenCalledTimes(1);
  expect(recover).toHaveBeenCalledWith("viewer", "finished-arena");
});
