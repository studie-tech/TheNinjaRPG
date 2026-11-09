import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import {
  AutoCombatBattleTypes,
  type BattleType,
  BattleTypes,
  ManualStartBattleTypes,
  PvpBattleTypes,
} from "@/drizzle/constants";
import type { Jutsu } from "@/drizzle/schema";
import { battle, jutsu } from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { initiateBattle } from "@/server/api/routers/combat";
import { HealTag } from "@/validators/combat";
import {
  fakeInitiationClient,
  makeInitiationUser,
} from "../../../../libs/combat/helpers/preload";
import { equipLimitFixture } from "../../../../setup/jutsuEquipLimits";

const participant = (
  userId: string,
  opts: { isAi?: boolean; defaultAutoCombat?: boolean; villageId?: string } = {},
) => ({
  ...makeInitiationUser({
    userId,
    villageId: opts.villageId ?? "a",
    isAi: opts.isAi ?? false,
  }),
  defaultAutoCombat: opts.defaultAutoCombat ?? true,
  inArena: opts.isAi ?? false,
});

type Participant = ReturnType<typeof participant>;

const startBattle = async (
  battleType: BattleType,
  users: Participant[],
  info: Partial<Parameters<typeof initiateBattle>[0]>,
  equipLimits = equipLimitFixture,
) => {
  const {
    client,
    saved: savedBattle,
    readEquipLimits,
  } = fakeInitiationClient(users, {
    equipLimits,
    otherRows: [{ count: 0 }],
  });
  const humans = users.filter((user) => !user.isAi).map((user) => user.userId);
  const ais = users.filter((user) => user.isAi).map((user) => user.userId);
  const result = await initiateBattle(
    { client, userIds: humans, targetIds: ais, biome: "default", ...info },
    battleType,
  );
  expect(result.success).toBe(true);
  const saved = savedBattle();
  if (!saved) throw new Error("Battle was not inserted");
  return {
    auto: Object.fromEntries(
      saved.usersState.map((user) => [user.controllerId, !!user.isAutoCombat]),
    ) as Record<string, boolean>,
    usersState: saved.usersState,
    equipLimitReads: readEquipLimits.mock.calls.length,
  };
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
    const { auto } = await startBattle(
      "RANDOM_ENCOUNTER",
      [participant("hunter"), participant("beast", { isAi: true, villageId: "b" })],
      { autoCombatUserIds: ["hunter"] },
    );
    expect(auto.hunter).toBe(true);
    expect(auto.beast).toBe(false);
  });

  it("keeps a PvP battle manual even when auto combat is requested", async () => {
    const { auto } = await startBattle(
      "COMBAT",
      [
        participant("attacker"),
        participant("defender", { isAi: true, villageId: "b" }),
      ],
      { autoCombatUserIds: ["attacker"] },
    );
    expect(auto.attacker).toBe(false);
  });

  it("reads each group member's own preference when starting from defaults", async () => {
    const { auto } = await startBattle(
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

describe("initiateBattle jutsu equipment limits", () => {
  beforeEach(() => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(
    (["RANKED_SPARRING", "RANKED_PVP", "SPARRING"] as const).flatMap((battleType) =>
      (["fetch", "configured", "unlimited"] as const).map(
        (preload) => [battleType, preload] as const,
      ),
    ),
  )(
    "uses the matching equipment limits for %s (rules: %s)",
    async (battleType, preload) => {
      const player = participant("player");
      if (battleType === "RANKED_PVP") player.status = "QUEUED";
      const definition = {
        ...Object.fromEntries(
          Object.entries(getTableColumns(jutsu)).map(([key, column]) => [
            key,
            column.default &&
            typeof column.default === "object" &&
            "queryChunks" in column.default
              ? new Date()
              : (column.default ?? null),
          ]),
        ),
        id: "ranked-heal",
        name: "Ranked Heal",
        effects: [HealTag.parse({})],
        jutsuType: "NORMAL",
        battleUsageType: "BOTH",
      } as Jutsu;
      player.jutsus = [
        {
          id: "owned-heal",
          userId: player.userId,
          jutsuId: definition.id,
          level: 25,
          experience: 0,
          equipped: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          trainingStartedAt: null,
          finishTraining: null,
          reskinId: null,
          jutsu: definition,
        },
      ];
      const limits = [
        { category: "heal", unrankedMaxEquipped: 0, rankedMaxEquipped: 3 },
      ];
      const { usersState, equipLimitReads } = await startBattle(
        battleType,
        [player, participant("opponent", { isAi: true, villageId: "b" })],
        {
          jutsuEquipLimits:
            preload === "fetch" ? undefined : preload === "configured" ? limits : [],
        },
        limits,
      );
      expect(
        usersState
          .find((user) => user.controllerId === player.userId)
          ?.jutsus.map((entry) => entry.jutsuId),
      ).toEqual(
        battleType === "SPARRING" && preload !== "unlimited" ? [] : [definition.id],
      );
      expect(equipLimitReads).toBe(preload === "fetch" ? 1 : 0);
    },
  );
});
