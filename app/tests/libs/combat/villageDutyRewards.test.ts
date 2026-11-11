import { afterEach, describe, expect, it, vi } from "bun:test";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { isPvpRewardOpponent } from "@/libs/combat/participants";
import { calcBattleResult, villageDutyVictory } from "@/libs/combat/settlement";
import { Pusher } from "@/libs/pusher";
import { initiateBattle } from "@/server/api/routers/combat";
import type { DrizzleClient } from "@/server/db";
import { makeCompleteBattle, makeUser } from "../../setup/combat";
import { fakeInitiationClient, makeInitiationUser } from "./helpers/preload";

/** Decided duel retaining the original copy's reservation and both teams' identities. */
const duel = (battleType: "VILLAGE_PROTECTOR" | "SHRINE_WAR", copyWins = false) =>
  makeCompleteBattle({
    battleType,
    rewardScaling: 1,
    usersState: [
      makeUser({
        userId: "invader",
        controllerId: "invader",
        direction: "left",
        villageId: "enemy",
        curHealth: copyWins ? 0 : 100,
      }),
      makeUser({
        userId: "copy-instance",
        controllerId: "duty:owner",
        direction: "right",
        villageId: "home",
        isAi: true,
        isVillageDutyCopy: true,
        curHealth: copyWins ? 100 : 0,
      }),
    ],
    extraState: {
      villageDuty: {
        userId: "owner",
        villageId: "home",
        startedAt: new Date().toISOString(),
        slot: 0,
      },
      villages: {},
      wars: {},
      pvpExperienceScaling: 0.5,
    },
  });

afterEach(() => vi.restoreAllMocks());

describe("village duty PvP points", () => {
  it.each(["VILLAGE_PROTECTOR", "SHRINE_WAR"] as const)(
    "awards repeat-scaled points and weekly credit for beating a copy in %s",
    (type) => {
      const battle = duel(type);
      expect(calcBattleResult(battle, "invader")).toMatchObject({
        outcome: "Won",
        pvpExperience: 125,
        weeklyPvpKills: 1,
      });
      expect(villageDutyVictory(battle)).toBeUndefined();
    },
  );
  it.each(["VILLAGE_PROTECTOR", "SHRINE_WAR"] as const)(
    "credits only the real owner when their copy beats an invader in %s",
    (type) => {
      const battle = duel(type, true);
      expect(villageDutyVictory(battle)).toEqual({
        userId: "owner",
        pvpExperience: 125,
        weeklyPvpKills: 1,
      });
      expect(calcBattleResult(battle, "invader")).toMatchObject({
        outcome: "Lost",
        pvpExperience: 50,
        weeklyPvpKills: 0,
      });
    },
  );
  it.each([
    "dead copy",
    "fled copy",
    "fled invader",
    "draw",
    "living invader",
    "summoned copy",
    "wrong copy",
    "same village",
  ])("does not award an owner for %s", (scenario) => {
    const battle = duel("VILLAGE_PROTECTOR", true);
    const [invader, copy] = battle.usersState;
    if (!copy || !invader) throw new Error("Missing duel participants");
    if (scenario === "dead copy" || scenario === "draw") copy.curHealth = 0;
    if (scenario === "fled copy") copy.fledBattle = true;
    if (scenario === "fled invader") invader.fledBattle = true;
    if (scenario === "living invader") invader.curHealth = 100;
    if (scenario === "summoned copy") copy.isSummon = true;
    if (scenario === "wrong copy") copy.controllerId = "duty:someone-else";
    if (scenario === "same village") invader.villageId = "home";
    expect(villageDutyVictory(battle)).toBeUndefined();
  });
  it("does not promote authored NPCs, allies, summons or unrelated copies into PvP opponents", () => {
    const battle = duel("VILLAGE_PROTECTOR");
    const [invader, copy] = battle.usersState;
    if (!copy || !invader) throw new Error("Missing duel participants");
    expect(isPvpRewardOpponent(invader, copy, "owner")).toBe(true);
    for (const change of [
      { isVillageDutyCopy: undefined },
      { isSummon: true },
      { direction: "left" as const },
      { controllerId: "duty:someone-else" },
      { villageId: "enemy" },
    ])
      expect(isPvpRewardOpponent(invader, { ...copy, ...change }, "owner")).toBe(false);
    delete copy.isVillageDutyCopy;
    expect(calcBattleResult(battle, "invader")).toMatchObject({
      pvpExperience: 0,
      weeklyPvpKills: 0,
    });
  });
  it.each(["VILLAGE_PROTECTOR", "SHRINE_WAR"] as const)(
    "preloads repeat history for %s copies without reducing shrine rewards",
    async (battleType) => {
      vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
      const history: string[][] = [];
      const fake = fakeInitiationClient(
        [
          makeInitiationUser({ userId: "invader", villageId: "enemy" }),
          {
            ...makeInitiationUser({
              userId: "owner",
              villageId: "home",
              villageDutyVillageId: "home",
              villageDutyStartedAt: new Date("2026-11-09"),
            }),
            joinedVillageAt: new Date("2026-01-01"),
          },
        ],
        {
          historyCount: 2,
          onHistoryRead: (sql) =>
            history.push(
              new MySqlDialect().sqlToQuery(sql).params.slice(0, 4) as string[],
            ),
        },
      );
      const client = Object.create(fake.client) as DrizzleClient;
      client.update = (() => ({
        set: () => ({ where: async () => ({ rowsAffected: 1 }) }),
      })) as unknown as DrizzleClient["update"];
      const startedAt = new Date().toISOString();
      const result = await initiateBattle(
        {
          client,
          userIds: ["invader"],
          targetIds: ["duty:owner"],
          villageDuty: {
            userId: "owner",
            villageId: "home",
            startedAt,
            slot: 0,
            battleId: "reward-battle",
          },
          forceDefenderVillageId: "home",
        },
        battleType,
      );
      expect(result.success, result.message).toBe(true);
      expect(history).toEqual([["invader", "duty:owner", "duty:owner", "invader"]]);
      expect(fake.saved()?.extraState.pvpExperienceScaling).toBe(1 / 3);
      expect(fake.saved()?.rewardScaling).toBe(1);
    },
  );
});
