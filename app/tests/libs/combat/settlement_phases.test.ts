import { afterEach, describe, expect, it, vi } from "bun:test";
import {
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
  WAR_HEALTH_KAGEDEATH_REMOVE,
  WAR_HEALTH_RECOVER,
  WAR_HEALTH_REMOVE,
  WAR_SECTORWAR_AI_SHRINE_RECOVER,
  WAR_SECTORWAR_AI_SHRINE_REDUCE,
  WAR_SECTORWAR_PVP_SHRINE_RECOVER,
  WAR_SECTORWAR_PVP_SHRINE_REDUCE,
  WAR_TORN_SECTOR_BASE_MONEY,
} from "@/drizzle/constants";
import type { BattleUserState } from "@/libs/combat/types";
import { calcBattleResult } from "@/libs/combat/settlement";
import { makeCompleteBattle, makeUser } from "../../setup/combat";

const villages = {
  home: {
    id: "home",
    name: "Home",
    sector: 1,
    kageId: "",
    structures: [],
    sectors: [],
  },
  enemy: {
    id: "enemy",
    name: "Enemy",
    sector: 2,
    kageId: "",
    structures: [],
    sectors: [],
  },
};

/** A war between the duel's villages, with the hero's village attacking. */
const makeWar = (overrides: Record<string, unknown> = {}) => ({
  id: "war",
  type: "VILLAGE_WAR",
  sector: 7,
  attackerVillageId: "home",
  defenderVillageId: "enemy",
  warAllies: [],
  attackerVillage: { name: "Home", sector: 1 },
  defenderVillage: { name: "Enemy", sector: 2 },
  ...overrides,
});

type DuelInput = {
  hero?: Partial<BattleUserState> & Record<string, unknown>;
  foe?: Partial<BattleUserState> & Record<string, unknown>;
  battle?: Record<string, unknown>;
  extraState?: Record<string, unknown>;
};

/** A decided one-on-one; the hero wins unless the override says otherwise. */
const duel = ({ hero, foe, battle, extraState }: DuelInput = {}) =>
  makeCompleteBattle({
    battleType: "COMBAT",
    rewardScaling: 1,
    usersState: [
      makeUser({
        userId: "hero",
        rank: "JONIN",
        pvpStreak: 0,
        villageId: "home",
        direction: "left",
        isAggressor: true,
        level: 100,
        curHealth: 100,
        sector: 1,
        ...hero,
      }),
      makeUser({
        userId: "foe",
        rank: "JONIN",
        pvpStreak: 0,
        villageId: "enemy",
        direction: "right",
        level: 100,
        curHealth: 0,
        sector: 1,
        ...foe,
      }),
    ],
    extraState: { villages, wars: {}, ...extraState } as never,
    ...battle,
  });

const settle = (input: DuelInput = {}) => calcBattleResult(duel(input), "hero")!;
const defeated = { curHealth: 0 };
const alive = { curHealth: 100 };

afterEach(() => {
  vi.restoreAllMocks();
});

/** Replace Math.random with a fixed sequence that fails when a roll is added or dropped. */
const rollSequence = (...rolls: number[]) => {
  const queue = [...rolls];
  vi.spyOn(Math, "random").mockImplementation(() => {
    const roll = queue.shift();
    if (roll === undefined) throw new Error("Unexpected extra Math.random call");
    return roll;
  });
  return queue;
};

describe("calcBattleResult settlement contract", () => {
  it("returns null without touching battle state while the fight is undecided", () => {
    const battle = duel({ hero: { moneyStolen: 5 }, foe: alive });
    const hero = battle.usersState[0]!;
    expect(calcBattleResult(battle, "hero")).toBeNull();
    expect(hero.leftBattle).toBe(false);
    expect(hero.moneyStolen).toBe(5);
    expect(hero.usedStats).toEqual({ offence: 0, defence: 0 });
  });

  it("marks the departure, settles stolen money and spreads unused stat credit", () => {
    const battle = duel({ hero: { moneyStolen: -50 } });
    const hero = battle.usersState[0]!;
    expect(calcBattleResult(battle, "hero")).not.toBeNull();
    expect(hero.leftBattle).toBe(true);
    expect(hero.moneyStolen).toBe(0);
    expect(hero.usedStats).toEqual({ offence: 1, defence: 1 });
    expect(hero.usedGenerals).toEqual({
      strength: 1,
      intelligence: 1,
      willpower: 1,
      speed: 1,
    });
    expect(calcBattleResult(battle, "hero")).toBeNull();
  });
});

describe("calcBattleResult Elo gain", () => {
  it("floors the winner's expected gain to two decimals with a minimum", () => {
    expect(
      settle({ hero: { experience: 1000 }, foe: { experience: 1000 } }).eloDiff,
    ).toBe(16);
    expect(settle({ hero: { experience: 1000 }, foe: { experience: 0 } }).eloDiff).toBe(
      16,
    );
    expect(
      settle({ hero: { experience: 1000 }, foe: { experience: 3000 } }).eloDiff,
    ).toBe(31.99);
    expect(
      settle({ hero: { experience: 10_000_000 }, foe: { experience: 1 } }).eloDiff,
    ).toBe(0.02);
  });
});

describe("calcBattleResult PvP streak", () => {
  it.each([
    ["an even win extends it", { hero: {}, foe: {} }, 4],
    ["an aggressor preying on a low level keeps it", { hero: { level: 111 } }, 3],
    ["an aggressor at the level limit extends it", { hero: { level: 110 } }, 4],
    [
      "a defender beating a low level extends it",
      { hero: { level: 111, isAggressor: false } },
      4,
    ],
    ["a lost attack resets it", { hero: { ...defeated }, foe: { ...alive } }, 0],
    [
      "a defender losing to a near level resets it",
      { hero: { ...defeated, isAggressor: false }, foe: { ...alive, level: 109 } },
      0,
    ],
    [
      "a defender losing to a far higher level keeps it",
      { hero: { ...defeated, isAggressor: false }, foe: { ...alive, level: 110 } },
      3,
    ],
    [
      "AI opponents count towards the level gap",
      {
        hero: { ...defeated, isAggressor: false },
        foe: { ...alive, level: 110, isAi: true },
      },
      3,
    ],
  ])("%s", (_label, input, expected) => {
    const result = settle({ ...input, hero: { pvpStreak: 3, ...input.hero } });
    expect(result.pvpStreak).toBe(expected);
  });

  it("only changes in open-world combat", () => {
    const result = settle({ hero: { pvpStreak: 3 }, battle: { battleType: "ARENA" } });
    expect(result.pvpStreak).toBe(3);
  });
});

describe("calcBattleResult war damage", () => {
  it("scales war health by the reward scaling but keeps shrine damage per kill", () => {
    const result = settle({
      hero: { sector: 2 },
      battle: { rewardScaling: 0.5 },
      extraState: { wars: { war: makeWar() } },
    });
    expect(result.warHealthChange).toBe(WAR_HEALTH_RECOVER * 0.5);
    expect(result.warHealthInfo).toEqual({
      Home: WAR_HEALTH_RECOVER * 0.5,
      Enemy: -WAR_HEALTH_REMOVE * 0.5,
    });
    expect(result.villageWarShrineInfo).toEqual({
      war: { attacker: 0, defender: -WAR_SECTORWAR_PVP_SHRINE_REDUCE },
    });
    expect(result.villageWarShrineDisplay).toEqual({
      "Home vs Enemy": -WAR_SECTORWAR_PVP_SHRINE_REDUCE,
    });
  });

  it("reduces a stronger winner's war damage to its sign", () => {
    const result = settle({
      hero: { sector: 2, level: 111 },
      extraState: { wars: { war: makeWar() } },
    });
    expect(result.warHealthChange).toBe(1);
    expect(result.warHealthInfo).toEqual({ Home: 1, Enemy: -1 });
    expect(result.villageWarShrineInfo).toEqual({ war: { attacker: 0, defender: -1 } });
    expect(result.villageWarShrineDisplay).toEqual({ "Home vs Enemy": -1 });
  });

  it("keeps full war damage when the defeated side lost its kage", () => {
    const result = settle({
      hero: { sector: 2, level: 111 },
      extraState: {
        villages: { ...villages, enemy: { ...villages.enemy, kageId: "foe" } },
        wars: { war: makeWar() },
      },
    });
    expect(result.warHealthInfo).toEqual({
      Home: WAR_HEALTH_RECOVER,
      Enemy: -WAR_HEALTH_REMOVE - WAR_HEALTH_KAGEDEATH_REMOVE,
    });
  });

  it("charges a loser's own side, with the kage penalty for a fallen kage", () => {
    const result = settle({
      hero: { ...defeated, sector: 2 },
      foe: { ...alive },
      extraState: {
        villages: { ...villages, home: { ...villages.home, kageId: "hero" } },
        wars: { war: makeWar() },
      },
    });
    expect(result.warHealthChange).toBe(
      -WAR_HEALTH_REMOVE - WAR_HEALTH_KAGEDEATH_REMOVE,
    );
    expect(result.warHealthInfo).toEqual({
      Home: -WAR_HEALTH_REMOVE - WAR_HEALTH_KAGEDEATH_REMOVE,
      Enemy: 0,
    });
    expect(result.villageWarShrineInfo).toEqual({ war: { attacker: 0, defender: 0 } });
  });

  it("measures the level gap against human opponents only", () => {
    const shrineWar = {
      foe: { isAi: true },
      battle: { battleType: "SHRINE_WAR" },
      extraState: { wars: { war: makeWar({ type: "SECTOR_WAR" }) } },
    };
    const strong = settle({ ...shrineWar, hero: { level: 11 } });
    expect(strong.shrineChangeHp).toBe(-1);
    expect(strong.shrineInfo).toEqual({ 7: -1 });
    const weak = settle({ ...shrineWar, hero: { level: 10 } });
    expect(weak.shrineChangeHp).toBe(-WAR_SECTORWAR_AI_SHRINE_REDUCE);
    expect(weak.shrineInfo).toEqual({ 7: -WAR_SECTORWAR_AI_SHRINE_REDUCE });
  });

  it("damages the sector shrine for a losing defender without crediting shrine hp", () => {
    const result = settle({
      hero: { ...defeated, villageId: "enemy", level: 100 },
      foe: { ...alive, villageId: "home" },
      extraState: { wars: { war: makeWar({ type: "SECTOR_WAR" }) } },
    });
    expect(result.shrineChangeHp).toBe(0);
    expect(result.shrineInfo).toEqual({ 7: -WAR_SECTORWAR_PVP_SHRINE_REDUCE });
  });

  it("credits shrine recovery when a defender wins at their own village", () => {
    const result = settle({
      hero: { villageId: "enemy", sector: 2 },
      foe: { villageId: "home" },
      extraState: { wars: { war: makeWar() } },
    });
    expect(result.villageWarShrineInfo).toEqual({
      war: { attacker: 0, defender: WAR_SECTORWAR_PVP_SHRINE_RECOVER },
    });
  });

  it("recovers an own shrine in a defend fight against the village's own AI", () => {
    const result = settle({
      hero: { level: 5, sector: 1 },
      foe: { villageId: "home", isAi: true },
      battle: { battleType: "SHRINE_WAR" },
      extraState: { wars: { war: makeWar() } },
    });
    expect(result.warHealthInfo).toEqual({});
    expect(result.villageWarShrineInfo).toEqual({
      war: { attacker: WAR_SECTORWAR_AI_SHRINE_RECOVER, defender: 0 },
    });
    expect(result.villageWarShrineDisplay).toEqual({
      "Home vs Enemy": WAR_SECTORWAR_AI_SHRINE_RECOVER,
    });
  });

  it("names a shrine entry for a war without loaded villages", () => {
    const result = settle({
      hero: { level: 5, sector: 1 },
      foe: { villageId: "home", isAi: true },
      battle: { battleType: "SHRINE_WAR" },
      extraState: {
        wars: {
          war: makeWar({ attackerVillage: { sector: 1 }, defenderVillage: null }),
        },
      },
    });
    expect(result.villageWarShrineDisplay).toEqual({
      "Attacker vs Defender": WAR_SECTORWAR_AI_SHRINE_RECOVER,
    });
  });

  it.each([
    ["a fled fighter", { fledBattle: true }, {}],
    ["a war-torn fight", { sector: MAP_WAR_TORN_BATTLEGROUND_SECTOR }, {}],
    ["an objective war", {}, { rules: {} }],
  ])("records nothing for %s", (_label, hero, war) => {
    const result = settle({ hero, extraState: { wars: { war: makeWar(war) } } });
    expect(result.warHealthChange).toBe(0);
    expect(result.warHealthInfo).toEqual({});
    expect(result.shrineInfo).toEqual({});
    expect(result.villageWarShrineInfo).toEqual({});
  });
});

describe("calcBattleResult bounties and drops", () => {
  const bounties = {
    bounties: {
      foe: [
        { id: "first", amountRyo: 100 },
        { id: "second", amountRyo: 200 },
      ],
      other: [{ id: "first", amountRyo: 300 }],
    },
    bountySignups: {
      hero: [{ bountyId: "second" }, { bountyId: "first" }, { bountyId: "unknown" }],
    },
  };

  it("claims in signup order, then target order", () => {
    const battle = duel({ extraState: bounties });
    battle.usersState.push(
      makeUser({
        userId: "other",
        villageId: "enemy",
        direction: "right",
        curHealth: 0,
        sector: 1,
      }),
    );
    expect(calcBattleResult(battle, "hero")!.bountiesClaimed).toEqual([
      { bountyId: "second", hunterId: "hero", amountRyo: 200 },
      { bountyId: "first", hunterId: "hero", amountRyo: 100 },
      { bountyId: "first", hunterId: "hero", amountRyo: 300 },
    ]);
  });

  it("claims nothing outside a won open-world fight", () => {
    expect(
      settle({ extraState: bounties, battle: { battleType: "ARENA" } }).bountiesClaimed,
    ).toEqual([]);
    expect(
      settle({ hero: defeated, foe: alive, extraState: bounties }).bountiesClaimed,
    ).toEqual([]);
  });

  it("rolls money before each droppable AI item", () => {
    const items = [
      { id: "kept", itemId: "named", dropChancePerc: 50 },
      { id: "missed", itemId: "named", dropChancePerc: 50 },
      { id: "zero", itemId: "named", dropChancePerc: 0 },
      { id: "unset", itemId: "named" },
      { id: "unnamed", itemId: "missing", dropChancePerc: 50 },
    ] as never;
    const rolls = rollSequence(0.5, 0.4, 0.6, 0.1);
    const result = settle({
      foe: { isAi: true, items },
      extraState: { items: { named: { name: "Named" } } },
    });
    expect(rolls).toEqual([]);
    expect(result.money).toBe(203);
    expect(result.droppedItems).toEqual([
      { itemId: "named", name: "Named", userItemId: "kept", fromUserId: "foe" },
      { itemId: "missing", name: "Item", userItemId: "unnamed", fromUserId: "foe" },
    ]);
  });

  it("drops nothing for a loser", () => {
    rollSequence();
    const items = [{ id: "kept", itemId: "named", dropChancePerc: 100 }] as never;
    expect(
      settle({ hero: defeated, foe: { ...alive, isAi: true, items } }).droppedItems,
    ).toEqual([]);
  });

  it("takes human items out of the drop roll", () => {
    rollSequence(0.5);
    const items = [{ id: "kept", itemId: "named", dropChancePerc: 100 }] as never;
    expect(settle({ foe: { items } }).droppedItems).toEqual([]);
  });
});

describe("calcBattleResult war-torn sector", () => {
  const warTorn = { sector: MAP_WAR_TORN_BATTLEGROUND_SECTOR };
  const clans = { clans: { clan: { id: "clan", ryoBoost: 10 } } };

  it("pays the fixed base with the combat and war-torn multipliers, rolling silver last", () => {
    const rolls = rollSequence(0.04);
    const result = settle({ hero: warTorn });
    expect(rolls).toEqual([]);
    expect(result.money).toBe(WAR_TORN_SECTOR_BASE_MONEY * 1.5 * 1.6);
    expect(result.seichiSilver).toBe(1);
  });

  it("skips the silver roll across a wide level gap and misses above the scaled chance", () => {
    rollSequence();
    expect(settle({ hero: warTorn, foe: { level: 89 } }).seichiSilver).toBe(0);
    vi.restoreAllMocks();
    rollSequence(0.03);
    expect(settle({ hero: warTorn, battle: { rewardScaling: 0.5 } }).seichiSilver).toBe(
      0,
    );
  });

  it("uses AI levels for the silver level gap", () => {
    rollSequence();
    expect(settle({ hero: warTorn, foe: { level: 89, isAi: true } }).seichiSilver).toBe(
      0,
    );
  });

  it("charges a loser what the winner would have gained, capped at their money", () => {
    const loser = { ...warTorn, ...defeated, clanId: "clan", money: 100_000 };
    const penalty = WAR_TORN_SECTOR_BASE_MONEY * 1.1 * 1.5 * 0.5 * 1.6;
    expect(
      settle({
        hero: loser,
        foe: alive,
        battle: { rewardScaling: 0.5 },
        extraState: clans,
      }).money,
    ).toBeCloseTo(-penalty, 8);
    expect(
      settle({ hero: { ...loser, money: 100 }, foe: alive, extraState: clans }).money,
    ).toBe(-100);
    expect(
      settle({ hero: { ...loser, money: 0 }, foe: alive, extraState: clans }).money,
    ).toBe(-0);
  });

  it("charges nothing when the loser fled or the fight is outside the war types", () => {
    const loser = { ...warTorn, ...defeated, money: 100_000 };
    expect(settle({ hero: { ...loser, fledBattle: true }, foe: alive }).money).toBe(0);
    expect(
      settle({ hero: loser, foe: alive, battle: { battleType: "ARENA" } }).money,
    ).toBe(0);
  });

  it("exempts friendly fire from the experience block", () => {
    rollSequence(0.5);
    const home = settle({
      foe: { villageId: "home" },
      hero: { usedStats: { offence: 1, defence: 0 } },
    });
    expect(home.eloDiff).toBe(0);
    expect(home.experience).toBe(0);
    rollSequence(0.99);
    const warTornHome = settle({ hero: warTorn, foe: { villageId: "home" } });
    expect(warTornHome.eloDiff).toBeGreaterThan(0);
  });
});

describe("calcBattleResult exhibition settlement", () => {
  it.each([
    ["tournament", { tournamentGameId: "game" }],
    ["hunting", { hunting: { userId: "hero" } }],
  ])("zeroes progression for a %s battle last", (_label, extraState) => {
    const items = [{ id: "kept", itemId: "named", dropChancePerc: 100 }] as never;
    const result = settle({ foe: { isAi: true, items }, extraState });
    expect(result).toEqual(
      expect.objectContaining({
        droppedItems: [],
        experience: 0,
        earnedExperience: 0,
        money: 0,
        seichiSilver: 0,
        offence: 0,
        defence: 0,
        strength: 0,
        intelligence: 0,
        willpower: 0,
        speed: 0,
        clanPoints: 0,
        anbuPoints: 0,
        villageTokens: 0,
        villagePrestige: 0,
        masteryGains: {},
      }),
    );
    expect(result.outcome).toBe("Won");
  });
});
