import { beforeEach, expect, it } from "bun:test";
import {
  mpvpBattleQueue,
  quest,
  sector,
  userData,
  village,
  war,
} from "@/drizzle/schema";
import { fetchUpdatedUser, type UserWithRelations } from "@/routers/profile";
import { RaidObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { insertQuests, insertUsers } from "../../../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const raid = (
  id: string,
  task: "open_raid" | "exclusive_raid",
  raidSector: number,
) => ({
  id,
  name: `Raid ${id}`,
  description: `About ${id}`,
  image: `${id}.webp`,
  questType: "raid" as const,
  hidden: false,
  raidBossMaxHealth: 100,
  raidBossCurrentHealth: 100,
  raidEndsAt: new Date(Date.now() + 3_600_000),
  content: {
    objectives: [
      RaidObjective.parse({
        id: "boss",
        task,
        sector: raidSector,
        opponentAIs: [{ ids: ["boss"], number: 1 }],
      }),
    ],
    reward: ObjectiveReward.parse({}),
    sceneBackground: "",
    sceneCharacters: [],
  },
});

const fetchProfile = async (userId: string) =>
  (
    await fetchUpdatedUser({
      client: await getTestDatabase(),
      userId,
      includeNotifications: true,
    })
  ).user as UserWithRelations;

describeWithDatabase("profile faction attachments", () => {
  beforeEach(async () => {
    await resetTables(mpvpBattleQueue, quest, sector, userData, village, war);
    const db = await getTestDatabase();
    await db.insert(village).values(
      ["home", "foe", "other"].map((id, index) => ({
        id,
        name: id,
        sector: 200 + index,
        kageId: `${id}-kage`,
      })),
    );
    await db.insert(sector).values({ sector: 7, villageId: "home" });
    await insertUsers([
      { userId: "member", villageId: "home" },
      { userId: "wanderer", villageId: null },
    ]);
  });

  it("attaches the wars and shrine lobbies of the user's village", async () => {
    const db = await getTestDatabase();
    await db.insert(war).values([
      {
        id: "own",
        type: "SECTOR_WAR",
        status: "ACTIVE",
        sector: 7,
        attackerVillageId: "foe",
        defenderVillageId: "home",
      },
      {
        id: "foreign",
        type: "SECTOR_WAR",
        status: "ACTIVE",
        sector: 8,
        attackerVillageId: "foe",
        defenderVillageId: "other",
      },
    ]);
    await db.insert(mpvpBattleQueue).values([
      {
        id: "defending",
        battleType: "SHRINE_BATTLE",
        attackerEntityId: "foe",
        defenderEntityId: "home",
        sector: 7,
      },
      {
        id: "attacking",
        battleType: "SHRINE_BATTLE",
        attackerEntityId: "home",
        defenderEntityId: "foe",
        sector: 8,
      },
      {
        id: "elsewhere",
        battleType: "SHRINE_BATTLE",
        attackerEntityId: "foe",
        defenderEntityId: "other",
        sector: 9,
      },
    ]);
    const member = await fetchProfile("member");
    expect(member?.activeWars?.map((entry) => entry.id)).toEqual(["own"]);
    expect(member?.shrineBattles?.map((entry) => entry.id).sort()).toEqual([
      "attacking",
      "defending",
    ]);
    const wanderer = await fetchProfile("wanderer");
    expect(wanderer?.activeWars).toBeUndefined();
    expect(wanderer?.shrineBattles).toBeUndefined();
  });

  it("lists open raids plus exclusive raids in owned or shrine-defeated sectors", async () => {
    const db = await getTestDatabase();
    await db.insert(war).values([
      {
        id: "won",
        type: "SECTOR_WAR",
        status: "ACTIVE",
        sector: 9,
        attackerVillageId: "home",
        defenderVillageId: "foe",
        defenderShrineHp: 0,
      },
      {
        id: "standing",
        type: "SECTOR_WAR",
        status: "ACTIVE",
        sector: 10,
        attackerVillageId: "home",
        defenderVillageId: "foe",
        defenderShrineHp: 100,
      },
      {
        id: "foreign",
        type: "SECTOR_WAR",
        status: "ACTIVE",
        sector: 11,
        attackerVillageId: "foe",
        defenderVillageId: "other",
        defenderShrineHp: 0,
      },
      {
        id: "raid-war",
        type: "WAR_RAID",
        status: "ACTIVE",
        sector: 12,
        attackerVillageId: "home",
        defenderVillageId: "foe",
        defenderShrineHp: 0,
      },
    ]);
    await insertQuests([
      raid("open", "open_raid", 3),
      raid("owned", "exclusive_raid", 7),
      raid("defeated", "exclusive_raid", 9),
      raid("standing", "exclusive_raid", 10),
      raid("foreign", "exclusive_raid", 11),
      raid("non-sector-war", "exclusive_raid", 12),
    ]);
    const member = await fetchProfile("member");
    const listed = [...(member?.activeRaids ?? [])].sort(
      (a, b) => (a.sector ?? 0) - (b.sector ?? 0),
    );
    expect(listed).toEqual([
      expect.objectContaining({ id: "open", raidType: "open", sector: 3 }),
      expect.objectContaining({ id: "owned", raidType: "exclusive", sector: 7 }),
      expect.objectContaining({ id: "defeated", raidType: "exclusive", sector: 9 }),
    ]);
    expect(Object.keys(listed[0] ?? {}).sort()).toEqual(
      ["description", "id", "image", "name", "raidEndsAt", "raidType", "sector"].sort(),
    );
    expect(listed[0]).toMatchObject({
      name: "Raid open",
      description: "About open",
      image: "open.webp",
    });
    expect(
      (await fetchProfile("wanderer"))?.activeRaids?.map((entry) => entry.id),
    ).toEqual(["open"]);
  });
});
