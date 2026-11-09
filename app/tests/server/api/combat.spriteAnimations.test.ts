import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import * as nextServer from "next/server";
import {
  actionLog,
  aiProfile,
  aiSpriteAnimation,
  battle,
  battleAction,
  jutsu,
  spriteAnimation,
  userData,
  userJutsu,
} from "@/drizzle/schema";
import type { ReturnedBattle } from "@/libs/combat/types";
import { Pusher } from "@/libs/pusher";
import { combatRouter, initiateBattle } from "@/server/api/routers/combat";
import { spriteAnimationRouter } from "@/server/api/routers/spriteAnimation";
import { ActionEndTurn, ActionUseSpecificJutsu } from "@/validators/ai";
import { makeTag } from "../../setup/combat";
import {
  insertUsers,
  insertJutsus,
  insertDefaultAiProfile,
} from "../../setup/factories";
import { stubRateLimitTransport } from "../../setup/rateLimit";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

describeWithDatabase("combat sprite animation delivery", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    vi.spyOn(nextServer, "after").mockImplementation(() => {});
    stubRateLimitTransport({ answerOtherRequests: true });
    await resetTables(
      aiSpriteAnimation,
      spriteAnimation,
      battleAction,
      battle,
      actionLog,
      userJutsu,
      jutsu,
      aiProfile,
      userData,
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["ARENA", "QUEST"] as const)(
    "replays an assigned jutsu before the following wait in manual %s combat",
    async (battleType) => {
      const { api, saved, npc, player, perform, logs } = await startBattle({
        battleType,
      });

      const turn = await perform();
      const [strike, wait] = replayed(turn, npc.userId);
      expect(strike?.actionKey).toBe("jutsu:strike");
      expect(wait?.actionKey).toBe("basic:wait");
      expect(wait?.id).not.toBe(strike?.id);
      expect(turn.activeUserId).toBe(player.userId);
      expect(
        turn.usersState.find((user) => user.userId === player.userId)!.curHealth,
      ).toBeLessThan(player.curHealth);
      expect((await logs()).map((row) => row.actionId)).toEqual(["strike", "wait"]);

      // A later read holds the settled snapshot and has nothing left to replay.
      const polled = await api.getBattle({ battleId: saved.id });
      expect(polled.battle!.version).toBe(turn.version);
      expect(polled.battle!.playback).toBeUndefined();
      expect(
        polled.battle!.usersState.find((user) => user.userId === npc.userId)!
          .spriteAnimationEvent,
      ).toEqual(wait);
      expect(await logs()).toHaveLength(2);
    },
  );

  it("resolves a human end-turn and the animated AI's reply in order within one response", async () => {
    const { npc, player, perform, logs } = await startBattle({ firstActor: "player" });
    const turn = await perform({
      actionId: "wait",
      longitude: player.longitude,
      latitude: player.latitude,
    });
    expect(turn.playback?.map((step) => step.actorId)).toEqual([
      player.userId,
      npc.userId,
      npc.userId,
    ]);
    expect(replayed(turn, npc.userId).map((event) => event?.actionKey)).toEqual([
      "jutsu:strike",
      "basic:wait",
    ]);
    expect((await logs()).map((row) => row.actionId)).toEqual([
      "wait",
      "strike",
      "wait",
    ]);
  });

  it("orders movement, strike and wait, with damage only on the strike", async () => {
    const { npc, player, perform, logs } = await startBattle({ withMovement: true });
    const turn = await perform();
    const events = replayed(turn, npc.userId);
    expect(events.map((event) => event?.actionKey)).toEqual([
      "jutsu:jump",
      "jutsu:strike",
      "basic:wait",
    ]);
    expect(new Set(events.map((event) => event?.id)).size).toBe(3);
    const hits = turn.playback!.map(
      (step) => step.users.find((user) => user.userId === player.userId)?.curHealth,
    );
    expect(hits[0]).toBeUndefined();
    expect(hits[1]).toBeLessThan(player.curHealth);
    expect(hits[2]).toBeUndefined();
    expect(
      turn.playback![0]!.users.find((user) => user.userId === npc.userId)?.longitude,
    ).toBe(5);
    expect(turn.playback!.map((step) => step.version)).toEqual(
      [0, 1, 2].map((offset) => turn.version - 3 + offset),
    );
    const rows = await logs();
    expect(rows.map((row) => row.actionId)).toEqual(["jump", "strike", "wait"]);
    expect(rows.map((row) => row.battleVersion)).toEqual(
      turn.playback!.map((step) => step.version),
    );
  });

  it("resolves auto combat one action per response, so each can be watched and taken back", async () => {
    const { db, saved, player, perform, logs } = await startBattle({
      animated: false,
      firstActor: "ai",
    });
    saved.usersState.find((user) => user.userId === player.userId)!.isAutoCombat = true;
    await db
      .update(battle)
      .set({ usersState: saved.usersState })
      .where(eq(battle.id, saved.id));
    const first = await perform();
    expect(first.playback).toHaveLength(1);
    expect(await logs()).toHaveLength(1);
  });

  it("keeps one action per response when another human only sees the latest state", async () => {
    const { db, saved, npc, player, perform, logs } = await startBattle({
      firstActor: "ai",
    });
    const observer = structuredClone(
      saved.usersState.find((user) => user.userId === player.userId)!,
    );
    saved.usersState.push({
      ...observer,
      userId: "observer",
      controllerId: "observer",
      username: "Observer",
      longitude: 9,
      latitude: 1,
    });
    await db
      .update(battle)
      .set({ usersState: saved.usersState })
      .where(eq(battle.id, saved.id));
    const attack = await perform();
    expect(
      attack.usersState.find((user) => user.userId === npc.userId)!.spriteAnimationEvent
        ?.actionKey,
    ).toBe("jutsu:strike");
    expect((await logs()).map((row) => row.actionId)).toEqual(["strike"]);
  });

  it("delivers an animated summon's strike and wait separately after activating its hidden template", async () => {
    const { db } = await startBattle({ animated: false, firstActor: "player" });
    await db.delete(battle);
    await db.update(userData).set({ status: "AWAKE", battleId: null });
    await insertUsers([
      { userId: "enemy", username: "Enemy", isAi: true, rank: "JONIN", level: 50 },
    ]);
    await insertJutsus([
      {
        id: "summon",
        name: "Summon",
        effects: [makeTag("summon", { aiId: "ai", aiHp: 1000, power: 100, rounds: 3 })],
        target: "EMPTY_GROUND",
        range: 3,
        actionCostPerc: 100,
      },
    ]);
    await db.insert(userJutsu).values({
      id: "owned-summon",
      userId: "player",
      jutsuId: "summon",
      equipped: true,
    });
    await db.insert(spriteAnimation).values(
      ["idle", "attack", "wait"].map((id) => ({
        id,
        name: id,
        url: `https://example.com/${id}.png`,
        columns: 6,
        rows: 2,
        frameCount: 12,
        fps: 12,
        facing: "left" as const,
        createdByUserId: "editor",
      })),
    );
    const editor = callerForDatabase(spriteAnimationRouter, "editor", db);
    for (const [actionKey, animationId] of [
      ["idle", "idle"],
      ["jutsu:strike", "attack"],
      ["basic:wait", "wait"],
    ] as const)
      expect(
        (await editor.assign({ userId: "ai", actionKey, animationId })).success,
      ).toBe(true);
    expect(
      (
        await initiateBattle(
          { client: db, userIds: ["player"], targetIds: ["enemy"] },
          "QUEST",
        )
      ).success,
    ).toBe(true);
    const saved = (await db.query.battle.findFirst())!;
    const player = saved.usersState.find((user) => user.userId === "player")!;
    const enemy = saved.usersState.find((user) => user.controllerId === "enemy")!;
    const template = saved.usersState.find((user) => user.isSummonTemplate)!;
    expect(template.curHealth).toBe(0);
    expect(template.spriteAnimations?.["jutsu:strike"]?.id).toBe("attack");
    player.longitude = 1;
    player.latitude = 1;
    player.initiative = 100;
    enemy.longitude = 6;
    enemy.latitude = 1;
    enemy.initiative = 0;
    saved.usersState.sort((a, b) => b.initiative - a.initiative);
    await db
      .update(battle)
      .set({
        usersState: saved.usersState,
        activeUserId: player.userId,
        roundStartAt: new Date(),
      })
      .where(eq(battle.id, saved.id));
    const api = callerForDatabase(combatRouter, "player", db);
    const summon = await api.performAction({
      battleId: saved.id,
      version: saved.version,
      actionId: "summon",
      longitude: 2,
      latitude: 1,
    });
    if (!("battleUpdate" in summon) || !summon.battleUpdate)
      throw new Error("Missing summon update");
    const spawned = summon.battleUpdate.usersState.find(
      (user) =>
        user.isSummon && !user.isSummonTemplate && user.controllerId === player.userId,
    )!;
    expect(spawned.curHealth).toBeGreaterThan(0);
    const [attackEvent, waitEvent] = replayed(summon.battleUpdate, spawned.userId);
    expect(attackEvent?.actionKey).toBe("jutsu:strike");
    expect(waitEvent?.actionKey).toBe("basic:wait");
    expect(waitEvent?.id).not.toBe(attackEvent?.id);
    expect(summon.battleUpdate.playback?.[0]?.userIds).toContain(spawned.userId);
    expect(
      summon.battleUpdate.usersState.find((user) => user.userId === enemy.userId)!
        .curHealth,
    ).toBeLessThan(enemy.curHealth);
    const logs = await db.query.battleAction.findMany({
      where: eq(battleAction.battleId, saved.id),
      orderBy: (row, { asc }) => asc(row.battleVersion),
    });
    expect(logs.map((row) => row.actionId).slice(0, 3)).toEqual([
      "summon",
      "strike",
      "wait",
    ]);
  });

  it.each(["none", "dead", "fled", "left", "template"] as const)(
    "keeps batching unanimated AI actions (animated participant: %s)",
    async (inactive) => {
      const { db, saved, npc, player, perform, logs } = await startBattle({
        animated: false,
      });
      if (inactive !== "none") {
        saved.usersState.push({
          ...structuredClone(npc),
          userId: "departed-ai",
          controllerId: "departed-ai",
          curHealth: inactive === "dead" || inactive === "template" ? 0 : npc.curHealth,
          isSummonTemplate: inactive === "template",
          fledBattle: inactive === "fled",
          leftBattle: inactive === "left",
          spriteAnimations: {
            idle: {
              id: "idle",
              name: "Idle",
              url: "https://example.com/idle.png",
              smallUrl: null,
              columns: 6,
              rows: 2,
              frameCount: 12,
              fps: 12,
              facing: "left",
            },
          },
        });
        await db
          .update(battle)
          .set({ usersState: saved.usersState })
          .where(eq(battle.id, saved.id));
      }
      const response = await perform();
      expect(response.activeUserId).toBe(player.userId);
      expect((await logs()).map((row) => row.actionId)).toEqual(["strike", "wait"]);
      expect(
        response.usersState.find((user) => user.userId === npc.userId)!
          .spriteAnimationEvent,
      ).toBeUndefined();
    },
  );
});

/** Each event an actor played within a response, in the order the server resolved them. */
const replayed = (view: ReturnedBattle, userId: string) =>
  (view.playback ?? []).flatMap((step) =>
    step.users.flatMap((user) =>
      user.userId === userId && user.spriteAnimationEvent
        ? [user.spriteAnimationEvent]
        : [],
    ),
  );

const startBattle = async ({
  battleType = "ARENA",
  animated = true,
  firstActor = "ai",
  withMovement = false,
}: {
  battleType?: "ARENA" | "QUEST";
  animated?: boolean;
  firstActor?: "ai" | "player";
  withMovement?: boolean;
} = {}) => {
  const db = await getTestDatabase();
  await insertUsers([
    { userId: "editor", username: "Editor", role: "CONTENT", rank: "JONIN", level: 50 },
    { userId: "player", username: "Player", rank: "JONIN", level: 50 },
    {
      userId: "ai",
      username: "AI",
      isAi: true,
      inArena: true,
      rank: "JONIN",
      level: 50,
    },
  ]);
  await insertDefaultAiProfile({
    userId: "ai",
    includeDefaultRules: false,
    rules: [
      ...(withMovement
        ? [
            {
              conditions: [],
              action: ActionUseSpecificJutsu.parse({
                jutsuId: "jump",
                target: "COORDINATE",
                coordinates: { longitude: 5, latitude: 1 },
              }),
            },
          ]
        : []),
      {
        conditions: [],
        action: ActionUseSpecificJutsu.parse({
          jutsuId: "strike",
          target: "CLOSEST_OPPONENT",
        }),
      },
      { conditions: [], action: ActionEndTurn.parse({}) },
    ],
  });
  if (withMovement) {
    await insertJutsus([
      {
        id: "jump",
        name: "Jump",
        effects: [makeTag("move", { power: 100, rounds: 0 })],
        target: "EMPTY_GROUND",
        range: 10,
        cooldown: 1,
        actionCostPerc: 20,
      },
    ]);
    await db
      .insert(userJutsu)
      .values({ id: "owned-jump", userId: "ai", jutsuId: "jump", equipped: true });
  }
  await insertJutsus([
    {
      id: "strike",
      name: "Strike",
      effects: [
        makeTag("damage", {
          power: 1,
          powerPerLevel: 0,
          calculation: "static",
          statTypes: [],
          generalTypes: [],
          elements: [],
          rounds: 0,
        }),
      ],
      target: "OTHER_USER",
      range: 10,
      cooldown: 1,
      actionCostPerc: 40,
    },
  ]);
  await db
    .insert(userJutsu)
    .values({ id: "owned-strike", userId: "ai", jutsuId: "strike", equipped: true });
  if (animated) {
    await db.insert(spriteAnimation).values(
      ["idle", "attack", "wait", ...(withMovement ? ["move"] : [])].map((id) => ({
        id,
        name: id,
        url: `https://example.com/${id}.png`,
        columns: 6,
        rows: 2,
        frameCount: 12,
        fps: 12,
        facing: "left" as const,
        createdByUserId: "editor",
      })),
    );
    const editor = callerForDatabase(spriteAnimationRouter, "editor", db);
    for (const [actionKey, animationId] of [
      ["idle", "idle"],
      ["jutsu:strike", "attack"],
      ["basic:wait", "wait"],
    ] as const) {
      expect(
        (await editor.assign({ userId: "ai", actionKey, animationId })).success,
      ).toBe(true);
    }
    if (withMovement)
      expect(
        (await editor.assign({ userId: "ai", actionKey: "move", animationId: "move" }))
          .success,
      ).toBe(true);
  }
  expect(
    (
      await initiateBattle(
        { client: db, userIds: ["player"], targetIds: ["ai"] },
        battleType,
      )
    ).success,
  ).toBe(true);
  const saved = (await db.query.battle.findFirst())!;
  const npc = saved.usersState.find((user) => user.controllerId === "ai")!;
  const player = saved.usersState.find((user) => user.userId === "player")!;
  npc.longitude = 1;
  npc.latitude = 1;
  player.longitude = withMovement ? 6 : 2;
  player.latitude = 1;
  player.initiative = firstActor === "player" ? 100 : 0;
  npc.initiative = firstActor === "ai" ? 100 : 0;
  saved.activeUserId = firstActor === "ai" ? npc.userId : player.userId;
  await db
    .update(battle)
    .set({
      usersState: saved.usersState,
      activeUserId: saved.activeUserId,
      roundStartAt: new Date(),
    })
    .where(eq(battle.id, saved.id));
  const api = callerForDatabase(combatRouter, "player", db);
  let version = saved.version;
  const perform = async (
    action: { actionId?: string; longitude?: number; latitude?: number } = {},
  ) => {
    const result = await api.performAction({ battleId: saved.id, version, ...action });
    expect(result.updateClient).toBe(true);
    if (!("battleUpdate" in result) || !result.battleUpdate)
      throw new Error("Missing battle update");
    version = result.battleUpdate.version;
    return result.battleUpdate;
  };
  const logs = () =>
    db.query.battleAction.findMany({
      where: eq(battleAction.battleId, saved.id),
      orderBy: (row, { asc }) => asc(row.battleVersion),
    });
  return { db, api, saved, npc, player, perform, logs };
};
