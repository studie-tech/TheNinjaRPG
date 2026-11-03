import { combatSharedCooldown, jutsuEquipLimit } from "@/drizzle/schema";
import { equipLimitFixture } from "../../../../setup/jutsuEquipLimits";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import {
  AutoCombatBattleTypes,
  type BattleType,
  BattleTypes,
  ManualStartBattleTypes,
  PvpBattleTypes,
} from "@/drizzle/constants";
import { battle, userData } from "@/drizzle/schema";
import type { CompleteBattle } from "@/libs/combat/types";
import { Pusher } from "@/libs/pusher";
import { initiateBattle } from "@/server/api/routers/combat";
import type { DrizzleClient } from "@/server/db";
import { makeUser } from "../../../../libs/combat/helpers/battleScenario";

const participant = (
  userId: string,
  opts: { isAi?: boolean; defaultAutoCombat?: boolean; villageId?: string } = {},
) => ({
  ...Object.fromEntries(
    Object.entries(getTableColumns(userData)).map(([key, column]) => [
      key,
      column.default && typeof column.default === "object" && "queryChunks" in column.default
        ? new Date()
        : (column.default ?? null),
    ]),
  ),
  ...makeUser({
    userId,
    username: userId,
    controllerId: userId,
    villageId: opts.villageId ?? "a",
    isAi: opts.isAi ?? false,
    experience: 3339000,
    rank: "JONIN",
    status: "AWAKE",
  }),
  defaultAutoCombat: opts.defaultAutoCombat ?? true,
  inArena: opts.isAi ?? false,
  items: [],
  jutsus: [],
  userSkills: [],
  queue: [],
  cookingJobs: [],
  raidBuffs: [],
  userQuests: [],
  completedQuests: [],
  bounties: [],
  bountySignups: [],
  bloodline: null,
  sageMode: null,
  village: null,
  clan: null,
  regenAt: new Date(),
  joinedVillageAt: new Date(),
});

type Participant = ReturnType<typeof participant>;

const startBattle = async (
  battleType: BattleType,
  users: Participant[],
  info: Partial<Parameters<typeof initiateBattle>[0]>,
) => {
  let saved: CompleteBattle | undefined;
  const client = {
    query: new Proxy(
      {},
      {
        get: (_target, key) => ({
          findMany: async () => (key === "userData" ? structuredClone(users) : []),
          findFirst: async () =>
            key === "aiProfile"
              ? { id: "Default", rules: [], includeDefaultRules: false }
              : undefined,
        }),
      },
    ),
    select: () => ({
      from: (table: object) => {
        if (table === combatSharedCooldown) return { orderBy: async () => [] };
        if (table === jutsuEquipLimit) return { orderBy: async () => equipLimitFixture };
        const rows = table === userData ? [{ average: 0 }] : [{ count: 0 }];
        const builder = {
          innerJoin: () => builder,
          where: () => builder,
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve),
        };
        return builder;
      },
    }),
    insert: (table: object) => ({
      values: async (value: unknown) => {
        if (table === battle) saved = value as CompleteBattle;
        return { rowsAffected: 1 };
      },
    }),
    update: () => ({
      set: () => ({
        where: async () => ({ rowsAffected: users.filter((user) => !user.isAi).length }),
      }),
    }),
  } as unknown as DrizzleClient;
  const humans = users.filter((user) => !user.isAi).map((user) => user.userId);
  const ais = users.filter((user) => user.isAi).map((user) => user.userId);
  const result = await initiateBattle(
    { client, userIds: humans, targetIds: ais, biome: "default", ...info },
    battleType,
  );
  expect(result.success).toBe(true);
  if (!saved) throw new Error("Battle was not inserted");
  return Object.fromEntries(
    saved.usersState.map((user) => [user.controllerId, !!user.isAutoCombat]),
  ) as Record<string, boolean>;
};

describe("auto combat battle type eligibility", () => {
  it("admits every battle type except PvP ones and shrine wars", () => {
    expect([...AutoCombatBattleTypes].sort()).toEqual(
      BattleTypes.filter(
        (type) => !PvpBattleTypes.includes(type) && type !== "SHRINE_WAR",
      ).sort(),
    );
    expect(AutoCombatBattleTypes).toEqual(
      expect.arrayContaining([
        "ARENA",
        "TRAINING",
        "QUEST",
        "RANDOM_ENCOUNTER",
        "VILLAGE_PROTECTOR",
        "CLAN_CHALLENGE",
        "RAID",
        "OVERWORLD",
      ]),
    );
    for (const type of ManualStartBattleTypes) {
      expect(AutoCombatBattleTypes).not.toContain(type);
    }
    expect(ManualStartBattleTypes).toContain("SHRINE_WAR");
  });

  it("classifies every battle type as either auto-eligible or manual", () => {
    for (const type of BattleTypes) {
      expect(
        AutoCombatBattleTypes.includes(type) !== ManualStartBattleTypes.includes(type),
      ).toBe(true);
    }
  });
});

describe("initiateBattle auto combat start", () => {
  beforeEach(() => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });
  afterEach(() => vi.restoreAllMocks());

  it("starts a random encounter (hunting) on auto combat for a player who prefers it", async () => {
    const auto = await startBattle(
      "RANDOM_ENCOUNTER",
      [participant("hunter"), participant("beast", { isAi: true, villageId: "b" })],
      { autoCombatUserIds: ["hunter"] },
    );
    expect(auto.hunter).toBe(true);
    expect(auto.beast).toBe(false);
  });

  it("keeps a PvP battle manual even when auto combat is requested", async () => {
    const auto = await startBattle(
      "COMBAT",
      [participant("attacker"), participant("defender", { isAi: true, villageId: "b" })],
      { autoCombatUserIds: ["attacker"] },
    );
    expect(auto.attacker).toBe(false);
  });

  it("reads each group member's own preference when starting from defaults", async () => {
    const auto = await startBattle(
      "RANDOM_ENCOUNTER",
      [
        participant("keen", { defaultAutoCombat: true }),
        participant("manual", { defaultAutoCombat: false }),
        participant("boss", { isAi: true, villageId: "b" }),
      ],
      { autoCombatFromDefaults: true },
    );
    expect(auto).toEqual({ keen: true, manual: false, boss: false });
  });
});
