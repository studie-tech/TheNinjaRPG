import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { inArray } from "drizzle-orm";
import {
  ELITE_JONIN_BRACKET,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
} from "@/drizzle/constants";
import {
  aiProfile,
  battle,
  battleAction,
  battleHistory,
  gameAsset,
  userData,
  village,
  villageAlliance,
  war,
  warAlly,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { initiateBattle } from "@/server/api/routers/combat";
import { defaultWarRules } from "@/validators/war";
import { insertDefaultAiProfile, insertUsers } from "../../../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const attackerId = "guard-attacker";
const secondAttackerId = "guard-second";
const defenderId = "guard-defender";
const sector = 100;
const bracketOne = 1_000;
const bracketFour = 1_700_000;
const later = () => new Date(Date.now() + 3_600_000);

const patch = async (
  userIds: string[],
  values: Partial<typeof userData.$inferInsert>,
) =>
  (await getTestDatabase())
    .update(userData)
    .set(values)
    .where(inArray(userData.userId, userIds));

const attack = async (userIds = [attackerId], attackSector = sector) =>
  initiateBattle(
    {
      client: await getTestDatabase(),
      userIds,
      targetIds: [defenderId],
      sector: attackSector,
    },
    "COMBAT",
  );

/** A war where both duelists fight on the sides `attacker` and `defender`. */
const startWar = async (attacker: string, defender: string) =>
  (await getTestDatabase()).insert(war).values({
    id: "guard-war",
    type: "VILLAGE_WAR",
    status: "ACTIVE",
    attackerVillageId: attacker,
    defenderVillageId: defender,
    combatStartedAt: new Date(Date.now() - 3_600_000),
    rules: defaultWarRules,
  });

describeWithDatabase("open-world attack guards", () => {
  beforeEach(async () => {
    await resetTables(
      battleAction,
      battleHistory,
      battle,
      aiProfile,
      gameAsset,
      villageAlliance,
      warAlly,
      war,
      village,
      userData,
    );
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    const db = await getTestDatabase();
    await db.insert(village).values([
      { id: "home", name: "Home", sector: 1, kageId: "home-kage" },
      { id: "enemy", name: "Enemy", sector: 2, kageId: "enemy-kage" },
      { id: "third", name: "Third", sector: 3, kageId: "third-kage" },
    ]);
    await insertUsers(
      [attackerId, secondAttackerId, defenderId].map((userId) => ({
        userId,
        username: userId,
        villageId: userId === defenderId ? "enemy" : "home",
        status: "AWAKE",
        rank: "JONIN",
        level: 100,
        experience: bracketOne,
        sector,
        curHealth: 100,
        maxHealth: 100,
        curStamina: 100,
        maxStamina: 100,
        curChakra: 100,
        maxChakra: 100,
        regeneration: 0,
        warParticipantUntil: new Date(0),
        bracketImmunityLiftedUntil: new Date(0),
      })),
    );
    await insertDefaultAiProfile();
  });
  afterEach(() => vi.restoreAllMocks());

  it("allows an ordinary attack in the same bracket", async () => {
    expect((await attack()).success).toBe(true);
  });

  it("rejects same-village targets by name", async () => {
    await patch([defenderId], { villageId: "home" });
    expect(await attack()).toEqual({
      success: false,
      message: `Cannot attack ${defenderId} — they are in your village`,
    });
  });

  it("rejects war-side participants before the village check", async () => {
    await startWar("home", "third");
    await (await getTestDatabase()).insert(warAlly).values({
      id: "guard-ally",
      warId: "guard-war",
      villageId: "enemy",
      supportVillageId: "home",
      tokensPaid: 0,
    });
    expect(await attack()).toEqual({
      success: false,
      message: "Cannot attack a participant on your war side",
    });
  });

  it("rejects targets from allied villages by name", async () => {
    await (await getTestDatabase()).insert(villageAlliance).values({
      id: "guard-alliance",
      villageIdA: "enemy",
      villageIdB: "home",
      status: "ALLY",
    });
    expect(await attack()).toEqual({
      success: false,
      message: `Cannot attack ${defenderId} — their village is allied with yours`,
    });
  });

  it("lets a war override a formal alliance", async () => {
    await (await getTestDatabase()).insert(villageAlliance).values({
      id: "guard-alliance",
      villageIdA: "enemy",
      villageIdB: "home",
      status: "ALLY",
    });
    await startWar("home", "enemy");
    expect((await attack()).success).toBe(true);
  });

  it("protects targets more than one bracket below the attacker", async () => {
    await patch([attackerId], { experience: bracketFour });
    expect(await attack()).toEqual({
      success: false,
      message: `Cannot attack ${defenderId} — different combat bracket (4 vs 1)`,
    });
  });

  it("allows lower brackets to attack upward", async () => {
    await patch([defenderId], { experience: bracketFour });
    expect((await attack()).success).toBe(true);
  });

  it("checks brackets for the lead attacker only", async () => {
    await patch([secondAttackerId], { experience: bracketFour });
    expect((await attack([attackerId, secondAttackerId])).success).toBe(true);
  });

  it("lifts bracket protection for a target that recently attacked", async () => {
    await patch([attackerId], { experience: bracketFour });
    await patch([defenderId], { bracketImmunityLiftedUntil: later() });
    expect((await attack()).success).toBe(true);
  });

  it("lifts bracket protection only between active participants of opposing war sides", async () => {
    await patch([attackerId], {
      experience: bracketFour,
      warParticipantUntil: later(),
    });
    await patch([defenderId], { warParticipantUntil: later() });
    expect((await attack()).success).toBe(false);
    await startWar("home", "enemy");
    expect((await attack()).success).toBe(true);
  });

  it("keeps bracket protection when only one war participant is active", async () => {
    await startWar("home", "enemy");
    await patch([attackerId], {
      experience: bracketFour,
      warParticipantUntil: later(),
    });
    expect((await attack()).success).toBe(false);
  });

  it("skips village and bracket rules in the war-torn sector", async () => {
    await patch([attackerId, defenderId], {
      sector: MAP_WAR_TORN_BATTLEGROUND_SECTOR,
      villageId: "home",
    });
    await patch([attackerId], { experience: bracketFour });
    expect((await attack([attackerId], MAP_WAR_TORN_BATTLEGROUND_SECTOR)).success).toBe(
      true,
    );
  });

  it("limits Elite Jonin to the top brackets even in the war-torn sector", async () => {
    await patch([attackerId, defenderId], { sector: MAP_WAR_TORN_BATTLEGROUND_SECTOR });
    await patch([attackerId], { rank: "ELITE JONIN" });
    expect(await attack([attackerId], MAP_WAR_TORN_BATTLEGROUND_SECTOR)).toEqual({
      success: false,
      message: `Elite Jonin can only fight players in brackets ${ELITE_JONIN_BRACKET - 1} and ${ELITE_JONIN_BRACKET}.`,
    });
  });

  it("applies the Elite limit to a target's rank too", async () => {
    await patch([defenderId], { rank: "ELITE JONIN" });
    expect((await attack()).success).toBe(false);
    await patch([attackerId], { experience: 3_500_000 });
    expect((await attack()).success).toBe(true);
  });

  it("places a starting barrier on a free tile for each low roll and none on participants", async () => {
    const db = await getTestDatabase();
    await db.insert(gameAsset).values({
      id: "guard-asset",
      name: "Rock",
      image: "rock.png",
      url: "rock.png",
      licenseDetails: "test",
      type: "STATIC",
      onInitialBattleField: true,
      hidden: false,
    } as never);
    vi.spyOn(Math, "random").mockReturnValue(0.05);
    const result = await attack();
    expect(result.success).toBe(true);
    const row = await db.query.battle.findFirst();
    const taken = new Set(
      row!.usersState.map((user) => `${user.longitude}-${user.latitude}`),
    );
    const initial = row!.groundEffects.filter(
      (effect) => effect.creatorId === "ground",
    );
    expect(initial.length).toBe(row!.width * row!.height - taken.size);
    for (const effect of initial) {
      expect(taken.has(`${effect.longitude}-${effect.latitude}`)).toBe(false);
      expect(effect).toMatchObject({
        id: `initial-${effect.longitude}-${effect.latitude}`,
        type: "barrier",
        staticAssetPath: "guard-asset",
        actionId: "initial",
        createdRound: 0,
        level: 0,
        isNew: false,
        barrierAbsorb: 0,
        castThisRound: false,
        power: 2,
      });
    }
  });

  it("leaves the field clear on a high roll", async () => {
    const db = await getTestDatabase();
    await db.insert(gameAsset).values({
      id: "guard-asset",
      name: "Rock",
      image: "rock.png",
      url: "rock.png",
      licenseDetails: "test",
      type: "STATIC",
      onInitialBattleField: true,
      hidden: false,
    } as never);
    const random = vi.spyOn(Math, "random").mockReturnValue(0.95);
    expect((await attack()).success).toBe(true);
    random.mockRestore();
    const row = await db.query.battle.findFirst();
    expect(
      row!.groundEffects.filter((effect) => effect.creatorId === "ground"),
    ).toEqual([]);
  });
});
