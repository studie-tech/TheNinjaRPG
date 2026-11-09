import { afterEach, beforeEach, expect, it, setSystemTime, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  item,
  jutsu,
  jutsuEquipLimit,
  rankedLoadout,
  rankedPvpQueue,
  rankedSeason,
  userData,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { pvpRankRouter } from "@/server/api/routers/pvprank";
import { cleanRankedProhibitedSelections } from "@/server/utils/ranked";
import { HealTag, PoisonTag } from "@/validators/combat";
import { insertItems, insertJutsus, insertUsers } from "../../../../setup/factories";
import { equipLimitFixture } from "../../../../setup/jutsuEquipLimits";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../../../setup/testDatabase";

const USER = "ranked-cleanup-user";
const FAVORITE_HEAL_IDS = Array.from(
  { length: 3 },
  (_, index) => `favorite-heal-${index}`,
);
const loadout = (jutsuIds: string[], weaponIds: string[] = []) => ({
  jutsuIds,
  weaponIds,
  consumableIds: [],
  favoriteJutsuIds: jutsuIds,
  favoriteWeaponIds: weaponIds,
  favoriteConsumableIds: [],
});

describeWithDatabase("ranked prohibited loadout cleanup", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(
      jutsuEquipLimit,
      rankedPvpQueue,
      rankedLoadout,
      rankedSeason,
      item,
      jutsu,
      userData,
    );
    await insertUsers([
      { userId: USER, username: USER, rank: "JONIN", status: "AWAKE", rankedLp: 100 },
    ]);
    const db = await getTestDatabase();
    await db.insert(jutsuEquipLimit).values(equipLimitFixture);
    await insertJutsus(
      [
        ...["usable", "usable-two", ...FAVORITE_HEAL_IDS].map((id) => ({
          id,
          battleUsageType: "BOTH" as const,
        })),
        {
          id: "skill-jutsu",
          requiredSkillId: "skill",
          battleUsageType: "BOTH" as const,
        },
        { id: "village-jutsu", villageId: "village", battleUsageType: "BOTH" as const },
        { id: "pve-jutsu", battleUsageType: "PVE" as const },
      ].map((entry) => ({
        ...entry,
        effects:
          entry.id.startsWith("usable") || FAVORITE_HEAL_IDS.includes(entry.id)
            ? [HealTag.parse({})]
            : [],
        requiredRank: "GENIN" as const,
      })),
    );
    await insertItems([
      { id: "weapon", itemType: "WEAPON", effects: [PoisonTag.parse({})] },
      { id: "weapon-two", itemType: "WEAPON", effects: [PoisonTag.parse({})] },
      {
        id: "favorite-consumable",
        itemType: "CONSUMABLE",
        effects: [PoisonTag.parse({})],
      },
      { id: "bloodline-item", itemType: "WEAPON", bloodlineId: "bloodline" },
      { id: "skill-item", itemType: "WEAPON", requiredSkillId: "skill" },
    ]);
    await db.insert(rankedLoadout).values({
      id: "ranked-loadout",
      userId: USER,
      loadout: loadout(
        ["usable", "skill-jutsu", "village-jutsu", "pve-jutsu"],
        ["weapon", "bloodline-item", "skill-item"],
      ),
    });
  });

  const storedLoadout = async () => {
    const row = await (await getTestDatabase()).query.rankedLoadout.findFirst({
      where: eq(rankedLoadout.userId, USER),
    });
    if (!row) throw new Error("Missing ranked loadout");
    return row;
  };

  it("loads rules alongside an empty ranked loadout in one query wave", async () => {
    const db = await getTestDatabase();
    await db
      .update(rankedLoadout)
      .set({ loadout: loadout([]) })
      .where(eq(rankedLoadout.userId, USER));
    const caller = await callerFor(pvpRankRouter, USER);
    const measured = await recordQueries(() => caller.getRankedLoadout());
    expect(measured.result.loadout).toEqual(loadout([]));
    expect(
      measured.statements.filter((statement) =>
        /from `JutsuEquipLimit`/i.test(statement),
      ),
    ).toHaveLength(1);
    expect(measured.roundTrips).toBe(1);
  });

  it("cleans equipped and favorite selections before queueing and reports removals", async () => {
    const result = await (await callerFor(pvpRankRouter, USER)).queueForRankedPvp();
    expect(result.success).toBe(true);
    expect(result.removedJutsuIds?.sort()).toEqual([
      "pve-jutsu",
      "skill-jutsu",
      "village-jutsu",
    ]);
    expect(result.removedItemIds?.sort()).toEqual(["bloodline-item", "skill-item"]);
    expect((await storedLoadout()).loadout).toEqual(loadout(["usable"], ["weapon"]));
    expect(await (await callerFor(pvpRankRouter, USER)).getRankedQueueCount()).toBe(1);
  });

  it.each([true, false])(
    "excludes favorite-only heal and poison selections from queue caps (cleanup: %s)",
    async (needsCleanup) => {
      const original = await storedLoadout();
      const selected = needsCleanup
        ? original.loadout
        : loadout(["usable"], ["weapon"]);
      const favorites = {
        favoriteJutsuIds: [...(selected.favoriteJutsuIds ?? []), ...FAVORITE_HEAL_IDS],
        favoriteWeaponIds: [...(selected.favoriteWeaponIds ?? []), "weapon-two"],
        favoriteConsumableIds: ["favorite-consumable"],
      };
      const db = await getTestDatabase();
      await db
        .update(rankedLoadout)
        .set({ loadout: { ...selected, ...favorites } })
        .where(eq(rankedLoadout.userId, USER));

      const result = await (await callerFor(pvpRankRouter, USER)).queueForRankedPvp();

      expect(result.success).toBe(true);
      expect((await storedLoadout()).loadout).toEqual({
        ...loadout(["usable"], ["weapon"]),
        favoriteJutsuIds: ["usable", ...FAVORITE_HEAL_IDS],
        favoriteWeaponIds: ["weapon", "weapon-two"],
        favoriteConsumableIds: ["favorite-consumable"],
      });
    },
  );

  it.each([0, 2000])(
    "preserves a valid selection saved after %i ms",
    async (offset) => {
      const db = await getTestDatabase();
      const original = await storedLoadout();
      setSystemTime(new Date(original.updatedAt.getTime() + offset));
      try {
        const saved = await (await callerFor(pvpRankRouter, USER)).updateRankedLoadout(
          loadout(["usable-two"], ["weapon-two"]),
        );
        expect(saved.success).toBe(true);
        const measured = await recordQueries(() =>
          cleanRankedProhibitedSelections(db, original, equipLimitFixture),
        );
        const cleaned = measured.result;
        expect(
          measured.statements.some((statement) =>
            statement.includes("JutsuEquipLimit"),
          ),
        ).toBe(false);
        expect(cleaned.loadout.loadout).toEqual(
          loadout(["usable-two"], ["weapon-two"]),
        );
        expect(cleaned.jutsus.map((entry) => entry.id)).toEqual(["usable-two"]);
        expect(cleaned.items.map((entry) => entry.id)).toEqual(["weapon-two"]);
        expect((await storedLoadout()).loadout).toEqual(
          loadout(["usable-two"], ["weapon-two"]),
        );
        expect((await storedLoadout()).updatedAt.getTime()).toBeGreaterThan(
          original.updatedAt.getTime(),
        );
      } finally {
        setSystemTime();
      }
    },
  );
  it("strips deleted, unshoppable and duplicate selections so the loadout can be edited", async () => {
    await insertItems([
      { id: "retired-item", name: "Retired item", itemType: "WEAPON", inShop: false },
      { id: "new-weapon", name: "New weapon", itemType: "WEAPON" },
    ]);
    const db = await getTestDatabase();
    await db
      .update(rankedLoadout)
      .set({
        loadout: loadout(
          ["usable", "usable", "deleted-jutsu"],
          ["weapon", "weapon", "retired-item", "deleted-item"],
        ),
      })
      .where(eq(rankedLoadout.userId, USER));
    const caller = await callerFor(pvpRankRouter, USER);

    const cleaned = await caller.getRankedLoadout();

    expect(cleaned.loadout).toEqual(loadout(["usable"], ["weapon"]));
    expect((await storedLoadout()).loadout).toEqual(loadout(["usable"], ["weapon"]));
    const saved = await caller.updateRankedLoadout({
      ...cleaned.loadout,
      weaponIds: [...cleaned.loadout.weaponIds, "new-weapon"],
    });
    expect(saved.success).toBe(true);
    expect((await storedLoadout()).loadout.weaponIds).toEqual(["weapon", "new-weapon"]);
  });

  it("ignores duplicate ids when updating the loadout", async () => {
    const saved = await (await callerFor(pvpRankRouter, USER)).updateRankedLoadout(
      loadout(["usable", "usable"], ["weapon", "weapon"]),
    );

    expect(saved.success).toBe(true);
    expect((await storedLoadout()).loadout).toEqual({
      ...loadout(["usable"], ["weapon"]),
      favoriteJutsuIds: ["usable", "usable"],
      favoriteWeaponIds: ["weapon", "weapon"],
    });
  });
});
