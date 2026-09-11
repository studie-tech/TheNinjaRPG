// @vitest-environment node

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { item, jutsu, rankedLoadout, userData } from "@/drizzle/schema";
import { pvpRankRouter } from "@/routers/pvprank";
import type { RankedLoadoutSchema } from "@/validators/pvpRank";
import { insertItems, insertUsers } from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const USER_ID = "gap93-user";
const LOADOUT_ID = "gap93-loadout";

const emptyLoadout = (): Required<RankedLoadoutSchema> => ({
  jutsuIds: [],
  weaponIds: [],
  consumableIds: [],
  favoriteJutsuIds: [],
  favoriteWeaponIds: [],
  favoriteConsumableIds: [],
});

const callerForUser = async (userId = USER_ID) =>
  pvpRankRouter.createCaller({ drizzle: await getTestDatabase(), userId } as never);

describeWithDatabase("pvpRank.updateRankedLoadout", () => {
  beforeEach(async () => {
    const database = await getTestDatabase();
    await resetTables(rankedLoadout, jutsu, item, userData);
    await insertUsers([
      { userId: USER_ID, username: "Gap93 Ranked User" },
      {
        userId: "gap93-banned",
        username: "Gap93 Banned User",
        isBanned: true,
      },
    ]);
    await insertItems([
      {
        id: "gap93-weapon",
        name: "Gap93 Ranked Blade",
        itemType: "WEAPON",
        slot: "HAND",
      },
      {
        id: "gap93-consumable",
        name: "Gap93 Ranked Tonic",
        itemType: "CONSUMABLE",
      },
      {
        id: "gap93-paid-weapon",
        name: "Gap93 Paid Blade",
        itemType: "WEAPON",
        slot: "HAND",
        repsCost: 1,
      },
    ]);
    await database.insert(jutsu).values([
      {
        id: "gap93-jutsu",
        name: "Gap93 Ranked Wind",
        description: "Selectable ranked jutsu",
        effects: [],
        target: "OPPONENT",
        range: 1,
        requiredRank: "STUDENT",
        jutsuType: "NORMAL",
        image: "/gap93-jutsu.png",
        battleDescription: "uses ranked wind",
      },
      {
        id: "gap93-ai-jutsu",
        name: "Gap93 AI Wind",
        description: "Not selectable in ranked editor",
        effects: [],
        target: "OPPONENT",
        range: 1,
        requiredRank: "STUDENT",
        jutsuType: "AI",
        image: "/gap93-ai.png",
        battleDescription: "uses AI wind",
      },
    ]);
    const createdAt = new Date("2026-09-11T10:00:00.000Z");
    await database.insert(rankedLoadout).values([
      {
        id: LOADOUT_ID,
        userId: USER_ID,
        loadout: emptyLoadout(),
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "gap93-banned-loadout",
        userId: "gap93-banned",
        loadout: emptyLoadout(),
        createdAt,
        updatedAt: createdAt,
      },
    ]);
  });

  it("commits all seven editor paths in sequence and preserves unrelated fields", async () => {
    const database = await getTestDatabase();
    const caller = await callerForUser();
    let revision = new Date("2026-09-11T10:00:00.000Z");
    let loadout = emptyLoadout();
    const updates: Required<RankedLoadoutSchema>[] = [
      { ...loadout, favoriteJutsuIds: ["gap93-jutsu"] },
      {
        ...loadout,
        favoriteJutsuIds: ["gap93-jutsu"],
        favoriteWeaponIds: ["gap93-weapon"],
      },
      {
        ...loadout,
        favoriteJutsuIds: ["gap93-jutsu"],
        favoriteWeaponIds: ["gap93-weapon"],
        favoriteConsumableIds: ["gap93-consumable"],
      },
      {
        ...loadout,
        jutsuIds: ["gap93-jutsu"],
        favoriteJutsuIds: ["gap93-jutsu"],
        favoriteWeaponIds: ["gap93-weapon"],
        favoriteConsumableIds: ["gap93-consumable"],
      },
      {
        ...loadout,
        jutsuIds: ["gap93-jutsu"],
        weaponIds: ["gap93-weapon"],
        favoriteJutsuIds: ["gap93-jutsu"],
        favoriteWeaponIds: ["gap93-weapon"],
        favoriteConsumableIds: ["gap93-consumable"],
      },
      {
        jutsuIds: ["gap93-jutsu"],
        weaponIds: ["gap93-weapon"],
        consumableIds: ["gap93-consumable"],
        favoriteJutsuIds: ["gap93-jutsu"],
        favoriteWeaponIds: ["gap93-weapon"],
        favoriteConsumableIds: ["gap93-consumable"],
      },
      {
        jutsuIds: [],
        weaponIds: [],
        consumableIds: [],
        favoriteJutsuIds: ["gap93-jutsu"],
        favoriteWeaponIds: ["gap93-weapon"],
        favoriteConsumableIds: ["gap93-consumable"],
      },
    ];

    for (const next of updates) {
      const result = await caller.updateRankedLoadout({
        ...next,
        expectedLoadoutId: LOADOUT_ID,
        expectedUpdatedAt: revision,
      });
      expect(result.success).toBe(true);
      expect(result.committed?.loadout).toEqual(next);
      revision = result.committed?.updatedAt ?? revision;
      loadout = next;
    }

    const stored = await database.query.rankedLoadout.findFirst({
      where: eq(rankedLoadout.id, LOADOUT_ID),
    });
    expect(stored?.loadout).toEqual(loadout);
    expect(stored?.updatedAt).toEqual(revision);
  });

  it("serializes stale competing full snapshots without losing the winner", async () => {
    const database = await getTestDatabase();
    const caller = await callerForUser();
    const expectedUpdatedAt = new Date("2026-09-11T10:00:00.000Z");
    const favoriteWeapon = {
      ...emptyLoadout(),
      favoriteWeaponIds: ["gap93-weapon"],
      expectedLoadoutId: LOADOUT_ID,
      expectedUpdatedAt,
    };
    const favoriteJutsu = {
      ...emptyLoadout(),
      favoriteJutsuIds: ["gap93-jutsu"],
      expectedLoadoutId: LOADOUT_ID,
      expectedUpdatedAt,
    };

    const results = await Promise.all([
      caller.updateRankedLoadout(favoriteWeapon),
      caller.updateRankedLoadout(favoriteJutsu),
    ]);
    const stored = await database.query.rankedLoadout.findFirst({
      where: eq(rankedLoadout.id, LOADOUT_ID),
    });

    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.filter((result) => !result.success)).toHaveLength(1);
    expect([favoriteWeapon.favoriteWeaponIds, favoriteJutsu.favoriteWeaponIds]).toContainEqual(
      stored?.loadout.favoriteWeaponIds,
    );
    expect(stored?.loadout).toEqual(
      results.find((result) => result.success)?.committed?.loadout,
    );
  });

  it("replays an identical lost-response save without a second write", async () => {
    const caller = await callerForUser();
    const request = {
      ...emptyLoadout(),
      weaponIds: ["gap93-weapon"],
      expectedLoadoutId: LOADOUT_ID,
      expectedUpdatedAt: new Date("2026-09-11T10:00:00.000Z"),
    };

    const first = await caller.updateRankedLoadout(request);
    const replay = await caller.updateRankedLoadout(request);

    expect(first).toMatchObject({ success: true });
    expect(replay).toMatchObject({
      success: true,
      message: "Ranked loadout already saved",
    });
    expect(replay.committed?.updatedAt).toEqual(first.committed?.updatedAt);
  });

  it("rejects banned, stale, wrong-row, paid, wrong-category and AI selections", async () => {
    const database = await getTestDatabase();
    const caller = await callerForUser();
    const expectedUpdatedAt = new Date("2026-09-11T10:00:00.000Z");
    const base = {
      ...emptyLoadout(),
      expectedLoadoutId: LOADOUT_ID,
      expectedUpdatedAt,
    };
    const bannedCaller = await callerForUser("gap93-banned");

    const banned = await bannedCaller.updateRankedLoadout({
      ...emptyLoadout(),
      expectedLoadoutId: "gap93-banned-loadout",
      expectedUpdatedAt,
    });
    const stale = await caller.updateRankedLoadout({
      ...base,
      favoriteWeaponIds: ["gap93-weapon"],
      expectedUpdatedAt: new Date("2026-09-11T09:59:59.000Z"),
    });
    const wrongRow = await caller.updateRankedLoadout({
      ...base,
      expectedLoadoutId: "gap93-banned-loadout",
    });
    const paid = await caller.updateRankedLoadout({
      ...base,
      weaponIds: ["gap93-paid-weapon"],
    });
    const wrongCategory = await caller.updateRankedLoadout({
      ...base,
      weaponIds: ["gap93-consumable"],
    });
    const ai = await caller.updateRankedLoadout({
      ...base,
      jutsuIds: ["gap93-ai-jutsu"],
    });
    const stored = await database.query.rankedLoadout.findFirst({
      where: eq(rankedLoadout.id, LOADOUT_ID),
    });

    expect(banned.success).toBe(false);
    expect(stale.message).toContain("changed elsewhere");
    expect(wrongRow.message).toContain("no longer available");
    expect(paid.message).toContain("not selectable");
    expect(wrongCategory.message).toContain("not selectable");
    expect(ai.message).toContain("not selectable");
    expect(stored?.loadout).toEqual(emptyLoadout());
  });
});
