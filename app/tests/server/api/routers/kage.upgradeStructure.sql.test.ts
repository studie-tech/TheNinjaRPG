import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  BUILDING_UPGRADE_BASE_COST,
  BUILDING_UPGRADE_PER_LEVEL_COST,
} from "@/drizzle/constants";
import { clan, userData, village, villageStructure } from "@/drizzle/schema";
import { kageRouter } from "@/server/api/routers/kage";
import { insertClans, insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const COST = BUILDING_UPGRADE_BASE_COST + BUILDING_UPGRADE_PER_LEVEL_COST;
const LONG_AGO = new Date("2020-01-01");
const upgrade = async (clanId?: string) =>
  (await callerFor(kageRouter, "leader")).upgradeStructure({
    structureId: "bank",
    villageId: "v1",
    clanId,
  });

const seedVillage = async (
  type: "VILLAGE" | "STRONGHOLD" | "HIDEOUT" | "OUTLAW",
  patch: Record<string, unknown> = {},
) => {
  const db = await getTestDatabase();
  await db.insert(village).values({
    id: "v1",
    name: "V1",
    type,
    sector: 10,
    kageId: "leader",
    tokens: COST,
    leaderUpdatedAt: LONG_AGO,
    ...patch,
  });
  await db.insert(villageStructure).values({
    id: "bank",
    name: "Bank",
    image: "",
    villageId: "v1",
    level: 1,
    maxLevel: 5,
  });
};

describeWithDatabase("structure upgrades by village type", () => {
  beforeEach(async () => {
    await resetTables(villageStructure, clan, village, userData);
    await insertUsers([
      {
        userId: "leader",
        username: "Leader",
        villageId: "v1",
        clanId: "c1",
        rank: "JONIN",
      },
    ]);
  });

  it("pays from village tokens in a village", async () => {
    await seedVillage("VILLAGE");
    expect(await upgrade()).toEqual({ success: true, message: "Structure upgraded" });
    const db = await getTestDatabase();
    expect(
      (await db.query.village.findFirst({ where: eq(village.id, "v1") }))?.tokens,
    ).toBe(0);
  });

  it("keeps a clan out of a village's funding", async () => {
    await seedVillage("VILLAGE", { tokens: 0 });
    await insertClans([
      { id: "c1", name: "Faction", villageId: "v1", leaderId: "leader", points: COST },
    ]);
    expect(await upgrade("c1")).toEqual({
      success: false,
      message: "Not enough tokens",
    });
  });

  it("pays from clan points in a stronghold", async () => {
    await seedVillage("STRONGHOLD", { tokens: 0 });
    await insertClans([
      { id: "c1", name: "Faction", villageId: "v1", leaderId: "leader", points: COST },
    ]);
    expect(await upgrade("c1")).toEqual({
      success: true,
      message: "Structure upgraded",
    });
    const db = await getTestDatabase();
    expect((await db.query.clan.findFirst({ where: eq(clan.id, "c1") }))?.points).toBe(
      0,
    );
  });

  it("requires the faction, its points and the leadership delay in a stronghold", async () => {
    await seedVillage("STRONGHOLD", { leaderUpdatedAt: new Date() });
    expect(await upgrade()).toEqual({ success: false, message: "Faction not found" });
    await insertClans([
      { id: "c1", name: "Faction", villageId: "v1", leaderId: "leader", points: 0 },
    ]);
    expect((await upgrade("c1")).message).toContain("Must have been in charge");
    const db = await getTestDatabase();
    await db
      .update(village)
      .set({ leaderUpdatedAt: LONG_AGO })
      .where(eq(village.id, "v1"));
    expect(await upgrade("c1")).toEqual({
      success: false,
      message: "Not enough clan points",
    });
  });

  it("asks a hideout for its faction before refusing the village type", async () => {
    await seedVillage("HIDEOUT");
    expect(await upgrade()).toEqual({ success: false, message: "Faction not found" });
    await insertClans([
      { id: "c1", name: "Faction", villageId: "v1", leaderId: "leader", points: COST },
    ]);
    expect(await upgrade("c1")).toEqual({
      success: false,
      message: "Only for villages",
    });
  });

  it("refuses other village types", async () => {
    await seedVillage("OUTLAW");
    expect(await upgrade()).toEqual({ success: false, message: "Only for villages" });
  });
});
