import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { jutsu, userData, userJutsu } from "@/drizzle/schema";
import { listJutsuForGetAll } from "@/queries/jutsu";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import { DamageTag } from "@/validators/combat";
import { insertUsers } from "../../../../setup/factories";
import { stubRateLimitTransport } from "../../../../setup/rateLimit";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const USER = "owned-first-player";
// Equal catalogue timestamps exercise the ID tie-breaker across pages.
const ids = ["j1", "j2", "j3", "j4", "j5"];

describeWithDatabase("jutsu catalogue with the player's jutsu first", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    stubRateLimitTransport({ unexpectedRequestMessage: "Unexpected HTTP request" });
    await resetTables(userJutsu, jutsu, userData);
    await insertUsers([
      { userId: USER, username: USER },
      { userId: "other-player", username: "other-player" },
    ]);
    const db = await getTestDatabase();
    await db.insert(jutsu).values(
      ids.map((id) => ({
        id,
        name: id,
        image: "",
        description: id,
        battleDescription: id,
        target: "SELF" as const,
        range: 0,
        requiredRank: "GENIN" as const,
        jutsuType: "NORMAL" as const,
        effects: [DamageTag.parse({ statTypes: ["Ninjutsu"] })],
        updatedAt: new Date(Date.UTC(2026, 0, 10)),
      })),
    );
    await db.insert(userJutsu).values([
      { id: "owned-j4", userId: USER, jutsuId: "j4", level: 3 },
      { id: "owned-j5", userId: USER, jutsuId: "j5", level: 8 },
      { id: "foreign-j1", userId: "other-player", jutsuId: "j1", level: 9 },
    ]);
  });

  const pages = async (input: {
    ownedFirst?: boolean;
    favoriteIds?: string[];
    trainingIds?: string[];
  }) => {
    const caller = await callerFor(jutsuRouter, USER);
    const seen: string[][] = [];
    let cursor: number | null | undefined;
    do {
      const page = await caller.getAll({ limit: 2, cursor, ...input });
      seen.push(page.data.map((row) => row.id));
      cursor = page.nextCursor;
    } while (cursor !== null && cursor !== undefined);
    return seen;
  };

  it("pages the player's jutsu first, highest level first, then the rest without repeats", async () => {
    expect(await pages({ ownedFirst: true })).toEqual([
      ["j5", "j4"],
      ["j1", "j2"],
      ["j3"],
    ]);
  });

  it("pages favorites first, then the player's jutsu by level, then the rest", async () => {
    expect(await pages({ ownedFirst: true, favoriteIds: ["j3", "j4"] })).toEqual([
      ["j4", "j3"],
      ["j5", "j1"],
      ["j2"],
    ]);
  });

  it("keeps active and queued techniques ahead of other learned jutsu across pages", async () => {
    expect(await pages({ ownedFirst: true, trainingIds: ["j2", "j4"] })).toEqual([
      ["j4", "j2"],
      ["j5", "j1"],
      ["j3"],
    ]);
  });

  it("keeps favorites ahead of active/queued priority and ignores missing priority IDs", async () => {
    expect(
      await pages({
        ownedFirst: true,
        favoriteIds: ["j3", "j4"],
        trainingIds: ["j2", "j5", "missing"],
      }),
    ).toEqual([["j4", "j3"], ["j5", "j2"], ["j1"]]);
  });

  it("breaks catalogue timestamp ties by id when priority is off", async () => {
    const db = await getTestDatabase();
    expect(listJutsuForGetAll(db, [], { limit: 2 }, 0).toSQL().sql).toContain(
      "order by `jutsu`.`updatedAt` desc, `jutsu`.`id` asc",
    );
    expect(await pages({})).toEqual([["j1", "j2"], ["j3", "j4"], ["j5"]]);
  });
});
