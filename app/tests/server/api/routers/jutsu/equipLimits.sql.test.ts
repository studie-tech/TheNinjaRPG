import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { jutsu, jutsuEquipLimit, userData, userJutsu } from "@/drizzle/schema";
import { getJutsuCapFlags } from "@/libs/jutsu";
import { fetchJutsuEquipCaps } from "@/queries/jutsuEquipLimit";
import { tryEquipUserJutsuAtomically } from "@/server/api/routers/jutsu";
import { miscRouter } from "@/server/api/routers/misc";
import { DamageTag } from "@/validators/combat";
import { insertUsers, insertJutsus } from "../../../../setup/factories";
import { stubRateLimitTransport } from "../../../../setup/rateLimit";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

describeWithDatabase("configured equipment limits", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    // The table is shared across suites, and a leftover cap breaks their loadouts.
    await resetTables(jutsuEquipLimit);
  });
  beforeEach(async () => {
    stubRateLimitTransport({ unexpectedRequestMessage: "Unexpected HTTP request" });
    await resetTables(jutsuEquipLimit, userJutsu, jutsu, userData);
    await insertUsers([
      { userId: "staff", role: "CONTENT" },
      { userId: "player", role: "USER" },
    ]);
  });
  it("requires staff permission and saves both mode values together", async () => {
    const staff = await callerFor(miscRouter, "staff");
    const player = await callerFor(miscRouter, "player");
    const input = {
      category: "summon",
      unrankedMaxEquipped: null,
      rankedMaxEquipped: 0,
    };
    expect(await player.setJutsuEquipLimit(input)).toMatchObject({ success: false });
    expect(await staff.setJutsuEquipLimit(input)).toMatchObject({ success: true });
    expect(await staff.getJutsuEquipLimits()).toEqual([input]);
    expect(await player.removeJutsuEquipLimit({ category: "summon" })).toMatchObject({
      success: false,
    });
    expect(await staff.removeJutsuEquipLimit({ category: "summon" })).toMatchObject({
      success: true,
    });
    expect(await staff.getJutsuEquipLimits()).toEqual([]);
  });
  it("keeps concurrent equips within an arbitrary tag cap and handles unlimited rules", async () => {
    const db = await getTestDatabase();
    await db
      .insert(jutsuEquipLimit)
      .values({ category: "damage", unrankedMaxEquipped: 1, rankedMaxEquipped: 0 });
    const effects = [DamageTag.parse({})];
    await insertJutsus(
      ["a", "b"].map((id) => ({ id, effects, requiredRank: "GENIN" as const })),
    );
    await db.insert(userJutsu).values(
      ["a", "b"].map((id) => ({
        id,
        userId: "player",
        jutsuId: id,
        equipped: false,
      })),
    );
    const flags = getJutsuCapFlags({
      effects,
      jutsuType: "NORMAL",
      actionCostPerc: 60,
    });
    const caps = await fetchJutsuEquipCaps(db);
    await Promise.all(
      ["a", "b"].map((userJutsuId) =>
        tryEquipUserJutsuAtomically({
          client: db,
          userId: "player",
          userJutsuId,
          maxEquip: 15,
          flags,
          caps,
        }),
      ),
    );
    const equipped = await db.query.userJutsu.findMany();
    expect(equipped.filter((entry) => entry.equipped)).toHaveLength(1);
    const remaining = equipped.find((entry) => !entry.equipped)!;
    expect(
      await tryEquipUserJutsuAtomically({
        client: db,
        userId: "player",
        userJutsuId: remaining.id,
        maxEquip: 15,
        flags,
        caps: [],
      }),
    ).toBe("equipped");
  });
  it("atomically limits concurrent 40 AP equips without blocking other costs", async () => {
    const db = await getTestDatabase();
    await db
      .insert(jutsuEquipLimit)
      .values({ category: "40 AP", unrankedMaxEquipped: 8, rankedMaxEquipped: 8 });
    const ids = Array.from({ length: 10 }, (_, index) => `ap-${index}`);
    await insertJutsus(
      ids.map((id, index) => ({
        id,
        actionCostPerc: index === 9 ? 60 : 40,
        requiredRank: "GENIN" as const,
      })),
    );
    await db.insert(userJutsu).values(
      ids.map((id, index) => ({
        id,
        userId: "player",
        jutsuId: id,
        equipped: index < 7,
      })),
    );
    const caps = await fetchJutsuEquipCaps(db);
    // Compete for the last 40 AP slot, then equip another cost while the cap is full.
    await Promise.all(
      ids.slice(7, 9).map((userJutsuId) =>
        tryEquipUserJutsuAtomically({
          client: db,
          userId: "player",
          userJutsuId,
          maxEquip: 15,
          caps,
          flags: getJutsuCapFlags({
            effects: [],
            jutsuType: "NORMAL",
            actionCostPerc: 40,
          }),
        }),
      ),
    );
    expect(
      await tryEquipUserJutsuAtomically({
        client: db,
        userId: "player",
        userJutsuId: "ap-9",
        maxEquip: 15,
        caps,
        flags: getJutsuCapFlags({
          effects: [],
          jutsuType: "NORMAL",
          actionCostPerc: 60,
        }),
      }),
    ).toBe("equipped");
    const equipped = await db.query.userJutsu.findMany();
    expect(equipped.filter((entry) => entry.equipped)).toHaveLength(9);
    expect(equipped.find((entry) => entry.jutsuId === "ap-9")?.equipped).toBe(true);
  });

  it("keeps equips within a jutsu-type cap and ignores other jutsu types", async () => {
    const db = await getTestDatabase();
    await db
      .insert(jutsuEquipLimit)
      .values({ category: "event", unrankedMaxEquipped: 1, rankedMaxEquipped: 0 });
    await insertJutsus([
      { id: "festival", jutsuType: "EVENT", requiredRank: "GENIN" as const },
      { id: "parade", jutsuType: "EVENT", requiredRank: "GENIN" as const },
      { id: "ordinary", jutsuType: "NORMAL", requiredRank: "GENIN" as const },
    ]);
    await db.insert(userJutsu).values(
      ["festival", "parade", "ordinary"].map((id) => ({
        id,
        userId: "player",
        jutsuId: id,
        equipped: false,
      })),
    );
    const caps = await fetchJutsuEquipCaps(db);
    const equip = (userJutsuId: string, jutsuType: "EVENT" | "NORMAL") =>
      tryEquipUserJutsuAtomically({
        client: db,
        userId: "player",
        userJutsuId,
        maxEquip: 15,
        flags: getJutsuCapFlags({ effects: [], jutsuType }),
        caps,
      });
    expect(await equip("festival", "EVENT")).toBe("equipped");
    expect(await equip("parade", "EVENT")).toBe("cap-reached");
    expect(await equip("ordinary", "NORMAL")).toBe("equipped");
    const equipped = (await db.query.userJutsu.findMany())
      .filter((entry) => entry.equipped)
      .map((entry) => entry.id);
    expect(equipped.sort()).toEqual(["festival", "ordinary"]);
  });
});
