import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import * as nextServer from "next/server";
import { battle, battleAction, userData } from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { combatRouter } from "@/server/api/routers/combat";
import {
  makeBattleUser,
  makeCompleteBattle,
  makeEffect,
} from "../../../../setup/combat";
import { insertUsers } from "../../../../setup/factories";
import { stubRateLimitTransport } from "../../../../setup/rateLimit";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

describeWithDatabase("polling combat ground expiry history", () => {
  beforeEach(async () => {
    await resetTables(battleAction, battle, userData);
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    vi.spyOn(nextServer, "after").mockImplementation(() => {});
    stubRateLimitTransport({ answerOtherRequests: true });
  });
  afterEach(() => vi.restoreAllMocks());

  for (const [type, expires, hadActivity] of [
    ["summon", true, false],
    ["clone", true, false],
    ["summon", false, false],
    ["summon", true, true],
    ["clone", true, true],
  ] as const) {
    it(`persists one ${type} history entry (expires=${expires}, had activity=${hadActivity})`, async () => {
      const client = await getTestDatabase();
      const old = new Date(Date.now() - 600_000);
      const snapshot = makeCompleteBattle({
        id: "ground-expiry",
        battleType: "SPARRING",
        activeUserId: "opponent",
        width: 13,
        height: 9,
        version: 1,
        round: 3,
        rewardScaling: 1,
        background: "default",
        createdAt: old,
        roundStartAt: old,
        updatedAt: hadActivity ? new Date(old.getTime() + 1000) : old,
        usersState: [
          makeBattleUser("caster", {
            round: 3,
            initiative: 30,
            curHealth: 100,
            longitude: 0,
            direction: "left",
            villageId: "red",
            isAi: false,
            isSummon: false,
          }),
          makeBattleUser("creature", {
            round: 3,
            initiative: 20,
            curHealth: 100,
            longitude: 1,
            direction: "left",
            villageId: "red",
            isAi: true,
            isSummon: true,
            isSummonTemplate: false,
            isOriginal: type === "summon",
            controllerId: "caster",
          }),
          makeBattleUser("opponent", {
            round: 2,
            initiative: 10,
            curHealth: 100,
            longitude: 3,
            direction: "right",
            villageId: "blue",
            isAi: false,
            isSummon: false,
          }),
        ],
        groundEffects: [
          makeEffect(
            type,
            { rounds: 2 },
            {
              creatorId: type === "clone" ? "creature" : "caster",
              summonedUserId: "creature",
              aiId: "template",
              isNew: false,
              castThisRound: false,
              createdRound: 1,
            },
          ),
        ],
        usersEffects: [
          makeEffect(
            "damage",
            {
              power: 8,
              calculation: "static",
              rounds: 3,
              statTypes: [],
              generalTypes: [],
              elements: [],
            },
            {
              id: "dot",
              creatorId: "caster",
              targetId: "opponent",
              targetType: "user",
              isNew: false,
              castThisRound: false,
              createdRound: 1,
              level: 1,
            },
          ),
        ],
      });
      snapshot.groundEffects[0]!.rounds = expires ? 1 : 2;
      await insertUsers(
        ["caster", "opponent"].map((userId) => ({
          userId,
          username: userId,
          status: "BATTLE",
          battleId: snapshot.id,
        })),
      );
      await client.insert(battle).values(snapshot);
      const caller = await callerFor(combatRouter, "caster");
      const result = await caller.getBattle({ battleId: snapshot.id });
      const saved = await client.query.battle.findFirst({
        where: eq(battle.id, snapshot.id),
      });
      const logs = await client.query.battleAction.findMany({
        where: eq(battleAction.battleId, snapshot.id),
      });

      expect(result.battle?.round).toBe(4);
      expect(result.battle?.usersState.some((user) => user.userId === "creature")).toBe(
        !expires,
      );
      const health = hadActivity ? 100 : 93.6;
      expect(
        result.battle?.usersState.find((user) => user.userId === "opponent")?.curHealth,
      ).toBeCloseTo(health);
      expect(
        saved?.usersState.find((user) => user.userId === "opponent")?.curHealth,
      ).toBeCloseTo(health);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        battleVersion: 1,
        battleRound: 4,
        actionId: "wait",
        description: hadActivity
          ? "Battlefield effects expire."
          : "opponent stands and does nothing. ",
      });
      expect(
        logs[0]!.appliedEffects.some((effect) => effect.txt.includes("creature")),
      ).toBe(expires);
      expect(
        logs[0]!.appliedEffects.some((effect) =>
          effect.txt.includes("residual damage"),
        ),
      ).toBe(!hadActivity);

      const repeated = await caller.getBattle({ battleId: snapshot.id });
      expect(
        repeated.battle?.usersState.find((user) => user.userId === "opponent")
          ?.curHealth,
      ).toBeCloseTo(health);
      expect(
        await client.query.battleAction.findMany({
          where: eq(battleAction.battleId, snapshot.id),
        }),
      ).toHaveLength(1);
    });
  }

  for (const type of ["summon", "clone", "none"] as const) {
    for (const withAction of [false, true]) {
      it(`preserves performAction history for ${type} expiry (with action=${withAction})`, async () => {
        const client = await getTestDatabase();
        const old = new Date(Date.now() - 600_000);
        const snapshot = makeCompleteBattle({
          id: "action-expiry",
          battleType: "SPARRING",
          activeUserId: "opponent",
          width: 13,
          height: 9,
          version: 1,
          round: 3,
          rewardScaling: 1,
          background: "default",
          createdAt: old,
          roundStartAt: old,
          updatedAt: old,
          usersState: [
            makeBattleUser("caster", {
              round: 3,
              initiative: 30,
              curHealth: 100,
              longitude: 0,
              direction: "left",
              villageId: "red",
              isAi: false,
              isSummon: false,
            }),
            makeBattleUser("opponent", {
              round: 2,
              initiative: 10,
              curHealth: 100,
              longitude: 3,
              direction: "right",
              villageId: "blue",
              isAi: false,
              isSummon: false,
            }),
          ],
        });
        if (type !== "none") {
          snapshot.usersState.push(
            makeBattleUser("creature", {
              round: 3,
              initiative: 20,
              curHealth: 100,
              longitude: 1,
              direction: "left",
              villageId: "red",
              isAi: true,
              isSummon: true,
              isSummonTemplate: false,
              isOriginal: type === "summon",
              controllerId: "caster",
            }),
          );
          snapshot.groundEffects = [
            makeEffect(
              type,
              { rounds: 2 },
              {
                creatorId: type === "clone" ? "creature" : "caster",
                summonedUserId: "creature",
                aiId: "template",
                isNew: false,
                castThisRound: false,
                createdRound: 1,
              },
            ),
          ];
          snapshot.groundEffects[0]!.rounds = 1;
        }
        await insertUsers(
          ["caster", "opponent"].map((userId) => ({
            userId,
            username: userId,
            status: "BATTLE",
            battleId: snapshot.id,
          })),
        );
        await client.insert(battle).values(snapshot);
        const result = await (await callerFor(combatRouter, "caster")).performAction({
          battleId: snapshot.id,
          ...(withAction
            ? { version: snapshot.version, actionId: "wait", longitude: 0, latitude: 0 }
            : {}),
        });
        const saved = await client.query.battle.findFirst({
          where: eq(battle.id, snapshot.id),
        });
        const logs = await client.query.battleAction.findMany({
          where: eq(battleAction.battleId, snapshot.id),
        });

        expect(result.updateClient).toBe(true);
        expect(saved?.round).toBe(4);
        expect(saved?.version).toBe(2);
        expect(saved?.usersState.some((user) => user.userId === "creature")).toBe(
          false,
        );
        expect(saved?.groundEffects.some((effect) => effect.type === type)).toBe(false);
        const hasHistory = withAction || type !== "none";
        expect(logs).toHaveLength(hasHistory ? 1 : 0);
        expect("logEntries" in result ? result.logEntries : undefined).toHaveLength(
          hasHistory ? 1 : 0,
        );
        if (hasHistory) {
          expect(logs[0]).toMatchObject({
            battleVersion: 1,
            battleRound: 4,
            userId: "caster",
            actionId: withAction ? "wait" : "unknown",
            description: withAction
              ? "End Turn: caster stands and does nothing on <b>A1</b>"
              : "Battlefield effects expire.",
          });
          expect(
            logs[0]!.appliedEffects.some((effect) => effect.txt.includes("creature")),
          ).toBe(type !== "none");
        }
      });
    }
  }
});
