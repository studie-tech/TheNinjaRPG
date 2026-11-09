import { afterEach, expect, it, vi } from "bun:test";
import type { RouterOutputs } from "@/app/_trpc/client";
import * as queries from "@/queries/combat";
import { combatRouter } from "@/server/api/routers/combat";
import * as completion from "@/server/utils/combatCompletion";
import { resolverOf } from "../../../../setup/testDatabase";

afterEach(() => vi.restoreAllMocks());

it.each(["getBattle", "performAction"] as const)(
  "%s recovers a deleted arena battle through the same request without settling it again",
  async (procedure) => {
    const read = vi.spyOn(queries, "fetchBattle").mockResolvedValue(null);
    const saved = {
      battle: { id: "finished-arena" },
      result: { outcome: "Won" },
    } as RouterOutputs["combat"]["getBattle"];
    const recover = vi.fn(async () => saved);
    vi.spyOn(completion, "combatCompletionStore").mockReturnValue({
      recover,
      save: vi.fn(),
    } as never);
    const resolver = resolverOf(combatRouter[procedure]);
    // No writable database surface is supplied: receipt recovery must be display-only.
    const database = {};
    const response: unknown = await resolver({
      ctx: { userId: "viewer", drizzle: database, waitForRateLimit: async () => {} },
      input: { battleId: "finished-arena" } as never,
    });
    expect(response).toEqual(
      procedure === "getBattle"
        ? saved
        : {
            updateClient: true,
            battleUpdate: saved.battle,
            result: saved.result,
            logEntries: [],
            updatedQuestIds: [],
          },
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(database, "finished-arena");
    expect(recover).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledWith("viewer", "finished-arena");
  },
);
