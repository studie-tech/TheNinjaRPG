import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { jutsu, jutsuEquipLimit, userData, userJutsu } from "@/drizzle/schema";
import { getJutsuCapFlags } from "@/libs/jutsu";
import { fetchJutsuEquipCaps } from "@/queries/jutsuEquipLimit";
import { tryEquipUserJutsuAtomically } from "@/server/api/routers/jutsu";
import { miscRouter } from "@/server/api/routers/misc";
import { DamageTag } from "@/validators/combat";
import { insertUsers } from "../../../../setup/factories";
import { stubRateLimitTransport } from "../../../../setup/rateLimit";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../../../setup/testDatabase";

describeWithDatabase("configured equipment limits", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    // The table is shared across suites, and a leftover cap breaks their loadouts.
    await resetTables(jutsuEquipLimit);
  });
  beforeEach(async () => {
    stubRateLimitTransport({ unexpectedRequestMessage: "Unexpected HTTP request" });
    await resetTables(jutsuEquipLimit, userJutsu, jutsu, userData);
    await insertUsers([{ userId: "staff", role: "CONTENT" }, { userId: "player", role: "USER" }]);
  });
  it("requires staff permission and saves both mode values together", async () => {
    const staff = await callerFor(miscRouter, "staff");
    const player = await callerFor(miscRouter, "player");
    const input = { category: "summon", unrankedMaxEquipped: null, rankedMaxEquipped: 0 };
    expect(await player.setJutsuEquipLimit(input)).toMatchObject({ success: false });
    expect(await staff.setJutsuEquipLimit(input)).toMatchObject({ success: true });
    expect(await staff.getJutsuEquipLimits()).toEqual([input]);
    expect(await player.removeJutsuEquipLimit({ category: "summon" })).toMatchObject({ success: false });
    expect(await staff.removeJutsuEquipLimit({ category: "summon" })).toMatchObject({ success: true });
    expect(await staff.getJutsuEquipLimits()).toEqual([]);
  });
  it("keeps concurrent equips within an arbitrary tag cap and handles unlimited rules", async () => {
    const db = await getTestDatabase();
    await db.insert(jutsuEquipLimit).values({ category: "damage", unrankedMaxEquipped: 1, rankedMaxEquipped: 0 });
    const effects = [DamageTag.parse({})];
    await db.insert(jutsu).values(["a", "b"].map((id) => ({
      id, name: id, effects, description: id, battleDescription: id,
      target: "SELF" as const, range: 0, requiredRank: "GENIN" as const,
      jutsuType: "NORMAL" as const, image: "",
    })));
    await db.insert(userJutsu).values(["a", "b"].map((id) => ({ id, userId: "player", jutsuId: id, equipped: false })));
    const flags = getJutsuCapFlags({ effects, jutsuType: "NORMAL" });
    const caps = await fetchJutsuEquipCaps(db);
    await Promise.all(["a", "b"].map((userJutsuId) => tryEquipUserJutsuAtomically({ client: db, userId: "player", userJutsuId, maxEquip: 15, flags, caps })));
    const equipped = await db.query.userJutsu.findMany();
    expect(equipped.filter((entry) => entry.equipped)).toHaveLength(1);
    const remaining = equipped.find((entry) => !entry.equipped)!;
    expect(await tryEquipUserJutsuAtomically({ client: db, userId: "player", userJutsuId: remaining.id, maxEquip: 15, flags, caps: [] })).toBe("equipped");
  });
});
