import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import * as nextServer from "next/server";
import { Group, Sprite, Texture, TextureLoader } from "three";
import type { UserData } from "@/drizzle/schema";
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
import { Pusher } from "@/libs/pusher";
import type { ReturnedBattle } from "@/libs/combat/types";
import { getBattleGrid } from "@/libs/combat/util";
import { createAggroHalo } from "@/libs/threejs/aggroHalo";
import { updateCharacterAnimation } from "@/libs/threejs/characterAnimation";
import { AI_AVATAR_SPRITE, drawCombatUsers, resetCombatCaches } from "@/libs/threejs/combat";
import { combatRouter, initiateBattle } from "@/server/api/routers/combat";
import { spriteAnimationRouter } from "@/server/api/routers/spriteAnimation";
import { ActionEndTurn, ActionUseSpecificJutsu } from "@/validators/ai";
import { makeTag } from "../../libs/combat/helpers/battleScenario";
import { insertUsers } from "../../setup/factories";
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
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      Response.json(
        String(url).endsWith("/pipeline")
          ? [{ result: [59, 60] }]
          : { result: [59, 60] },
      ),
    );
    await resetTables(
      aiSpriteAnimation, spriteAnimation, battleAction, battle, actionLog,
      userJutsu, jutsu, aiProfile, userData,
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetCombatCaches();
  });

  it.each(["ARENA", "QUEST"] as const)(
    "delivers an assigned jutsu before the following wait in manual %s combat",
    async (battleType) => {
      const { api, saved, npc, player, perform, logs } = await startBattle({ battleType });
      const sprite = new Sprite();
      const rendering = {
        sprite, animations: npc.spriteAnimations, moving: false,
        facing: "left" as const, staticMap: loadedTexture(), textureForPath: loadedTexture,
      };
      updateCharacterAnimation({ ...rendering, event: undefined, now: 0 });

      const attack = await perform();
      const event = attack.usersState.find((user) => user.userId === npc.userId)!.spriteAnimationEvent;
      expect(event?.actionKey).toBe("jutsu:strike");
      expect(attack.activeUserId).toBe(npc.userId);
      expect(attack.usersState.find((user) => user.userId === player.userId)!.curHealth)
        .toBeLessThan(player.curHealth);
      expect((await logs()).map((row) => row.actionId)).toEqual(["strike"]);
      updateCharacterAnimation({ ...rendering, event, now: 100 });
      expect(sprite.userData.characterAnimation.animationId).toBe("attack");

      const polled = await api.getBattle({ battleId: saved.id });
      const polledEvent = polled.battle!.usersState.find((user) => user.userId === npc.userId)!.spriteAnimationEvent;
      expect(polledEvent).toEqual(event);
      expect(polled.battle!.version).toBe(attack.version);
      expect(await logs()).toHaveLength(1);
      updateCharacterAnimation({ ...rendering, event: polledEvent, now: 400 });
      expect(sprite.userData.characterAnimation.startedAt).toBe(100);
      updateCharacterAnimation({ ...rendering, event: polledEvent, now: 1200 });
      expect(sprite.userData.characterAnimation.animationId).toBe("idle");
      updateCharacterAnimation({ ...rendering, event: polledEvent, now: 1300 });
      expect(sprite.userData.characterAnimation.animationId).toBe("idle");
      const remounted = new Sprite();
      updateCharacterAnimation({ ...rendering, sprite: remounted, event: polledEvent, now: 1300 });
      expect(remounted.userData.characterAnimation.animationId).toBe("idle");

      const wait = await perform();
      const waitEvent = wait.usersState.find((user) => user.userId === npc.userId)!.spriteAnimationEvent;
      expect(waitEvent?.actionKey).toBe("basic:wait");
      expect(waitEvent?.id).not.toBe(event?.id);
      expect(wait.activeUserId).toBe(player.userId);
      expect((await logs()).map((row) => row.actionId)).toEqual(["strike", "wait"]);
      updateCharacterAnimation({ ...rendering, event: waitEvent, now: 1400 });
      expect(sprite.userData.characterAnimation.animationId).toBe("wait");
    },
  );

  it("delivers a human end-turn before advancing the animated AI", async () => {
    const { npc, player, perform, logs } = await startBattle({ firstActor: "player" });
    const handoff = await perform({ actionId: "wait", longitude: player.longitude, latitude: player.latitude });
    expect(handoff.activeUserId).toBe(npc.userId);
    expect(handoff.usersState.find((user) => user.userId === npc.userId)!.spriteAnimationEvent).toBeUndefined();
    expect((await logs()).map((row) => row.actionId)).toEqual(["wait"]);
    const attack = await perform();
    expect(attack.usersState.find((user) => user.userId === npc.userId)!.spriteAnimationEvent?.actionKey).toBe("jutsu:strike");
    expect((await logs()).map((row) => row.actionId)).toEqual(["wait", "strike"]);
  });

  it("plays a delivered strike and wait after the AI finishes a four-tile movement", async () => {
    const { saved, npc, player, perform, logs } = await startBattle({ withMovement: true });
    resetCombatCaches();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(TextureLoader.prototype, "load").mockImplementation(loadedTexture);
    const grid = getBattleGrid(20, saved, { x: 0, y: 0 });
    const group = new Group();
    const actor = new Group();
    actor.name = npc.userId;
    const sprite = new Sprite();
    sprite.name = AI_AVATAR_SPRITE;
    sprite.userData = { avatarFacing: "left", avatarPath: "https://example.com/avatar.png", mirrored: false };
    actor.add(sprite, createAggroHalo(20, 20, false));
    group.add(actor);
    let view = saved as unknown as ReturnedBattle;
    const played: string[] = [];
    let movementCompletedAt: number | undefined;
    const draw = (ms: number) => {
      now = ms;
      const user = view.usersState.find((entry) => entry.userId === npc.userId)!;
      const moving = drawCombatUsers({ group_users: group, users: [user], usersEffects: view.usersEffects, grid,
        playerId: player.userId, userData: { userId: player.userId } as UserData, battle: view, sfxEnabled: false });
      if (ms > 0 && !moving) movementCompletedAt ??= ms;
      const animationId = sprite.userData.characterAnimation.animationId as string;
      if (played.at(-1) !== animationId) played.push(animationId);
    };
    draw(0);
    view = await perform();
    const events = [view.usersState.find((user) => user.userId === npc.userId)!.spriteAnimationEvent];
    for (let ms = 20; ms <= 1000; ms += 20) draw(ms);
    view = await perform();
    events.push(view.usersState.find((user) => user.userId === npc.userId)!.spriteAnimationEvent);
    draw(1000);
    expect(sprite.userData.characterAnimation.animationId).toBe("move");
    for (let ms = 1020; ms <= 2000; ms += 20) draw(ms);
    view = await perform();
    events.push(view.usersState.find((user) => user.userId === npc.userId)!.spriteAnimationEvent);
    draw(2000);
    expect(sprite.userData.characterAnimation.animationId).toBe("move");
    for (let ms = 2020; ms <= 6500; ms += 20) draw(ms);
    expect(events.map((event) => event?.actionKey)).toEqual(["jutsu:jump", "jutsu:strike", "basic:wait"]);
    expect((await logs()).map((row) => row.actionId)).toEqual(["jump", "strike", "wait"]);
    expect(view.usersState.find((user) => user.userId === player.userId)!.curHealth).toBeLessThan(player.curHealth);
    expect(movementCompletedAt).toBe(4000);
    expect(played).toEqual(["idle", "move", "attack", "wait", "idle"]);
    const target = grid.getHex({ col: 5, row: 1 })!;
    expect(actor.position.x).toBe(-target.center.x);
    expect(actor.position.y).toBe(-target.center.y);
  });

  it("delivers an animated summon's strike and wait separately after activating its hidden template", async () => {
    const { db } = await startBattle({ animated: false, firstActor: "player" });
    await db.delete(battle);
    await db.update(userData).set({ status: "AWAKE", battleId: null });
    await insertUsers([{ userId: "enemy", username: "Enemy", isAi: true, rank: "JONIN", level: 50 }]);
    await db.insert(jutsu).values({
      id: "summon", name: "Summon", description: "Summon", battleDescription: "%user summons a creature",
      image: "/jutsu.png", effects: [makeTag("summon", { aiId: "ai", aiHp: 1000, power: 100, rounds: 3 })],
      target: "EMPTY_GROUND", range: 3, requiredRank: "STUDENT", jutsuType: "NORMAL", actionCostPerc: 100,
    });
    await db.insert(userJutsu).values({ id: "owned-summon", userId: "player", jutsuId: "summon", equipped: true });
    await db.insert(spriteAnimation).values(["idle", "attack", "wait"].map((id) => ({
      id, name: id, url: `https://example.com/${id}.png`, columns: 6, rows: 2,
      frameCount: 12, fps: 12, facing: "left" as const, createdByUserId: "editor",
    })));
    const editor = callerForDatabase(spriteAnimationRouter, "editor", db);
    for (const [actionKey, animationId] of [["idle", "idle"], ["jutsu:strike", "attack"], ["basic:wait", "wait"]] as const)
      expect((await editor.assign({ userId: "ai", actionKey, animationId })).success).toBe(true);
    expect((await initiateBattle({ client: db, userIds: ["player"], targetIds: ["enemy"] }, "QUEST")).success).toBe(true);
    const saved = (await db.query.battle.findFirst())!;
    const player = saved.usersState.find((user) => user.userId === "player")!;
    const enemy = saved.usersState.find((user) => user.controllerId === "enemy")!;
    const template = saved.usersState.find((user) => user.isSummonTemplate)!;
    expect(template.curHealth).toBe(0);
    expect(template.spriteAnimations?.["jutsu:strike"]?.id).toBe("attack");
    player.longitude = 1; player.latitude = 1; player.initiative = 100;
    enemy.longitude = 6; enemy.latitude = 1; enemy.initiative = 0;
    saved.usersState.sort((a, b) => b.initiative - a.initiative);
    await db.update(battle).set({ usersState: saved.usersState, activeUserId: player.userId, roundStartAt: new Date() }).where(eq(battle.id, saved.id));
    const api = callerForDatabase(combatRouter, "player", db);
    const summon = await api.performAction({ battleId: saved.id, version: saved.version, actionId: "summon", longitude: 2, latitude: 1 });
    if (!("battleUpdate" in summon) || !summon.battleUpdate) throw new Error("Missing summon update");
    const spawned = summon.battleUpdate.usersState.find((user) => user.isSummon && !user.isSummonTemplate && user.controllerId === player.userId)!;
    expect(spawned.curHealth).toBeGreaterThan(0);
    expect(summon.battleUpdate.activeUserId).toBe(spawned.userId);
    expect(spawned.spriteAnimationEvent).toBeUndefined();
    const logs = () => db.query.battleAction.findMany({ where: eq(battleAction.battleId, saved.id), orderBy: (row, { asc }) => asc(row.battleVersion) });
    expect((await logs()).map((row) => row.actionId)).toEqual(["summon"]);
    const attack = await api.performAction({ battleId: saved.id, version: summon.battleUpdate.version });
    if (!("battleUpdate" in attack) || !attack.battleUpdate) throw new Error("Missing attack update");
    const attackEvent = attack.battleUpdate.usersState.find((user) => user.userId === spawned.userId)!.spriteAnimationEvent;
    expect(attackEvent?.actionKey).toBe("jutsu:strike");
    expect(attack.battleUpdate.usersState.find((user) => user.userId === enemy.userId)!.curHealth).toBeLessThan(enemy.curHealth);
    expect((await logs()).map((row) => row.actionId)).toEqual(["summon", "strike"]);
    const wait = await api.performAction({ battleId: saved.id, version: attack.battleUpdate.version });
    if (!("battleUpdate" in wait) || !wait.battleUpdate) throw new Error("Missing wait update");
    const waitEvent = wait.battleUpdate.usersState.find((user) => user.userId === spawned.userId)!.spriteAnimationEvent;
    expect(waitEvent?.actionKey).toBe("basic:wait");
    expect(waitEvent?.id).not.toBe(attackEvent?.id);
    expect((await logs()).map((row) => row.actionId)).toEqual(["summon", "strike", "wait"]);
  });

  it.each(["none", "dead", "fled", "left", "template"] as const)(
    "keeps batching unanimated AI actions (animated participant: %s)",
    async (inactive) => {
      const { db, saved, npc, player, perform, logs } = await startBattle({ animated: false });
      if (inactive !== "none") {
        saved.usersState.push({
          ...structuredClone(npc), userId: "departed-ai", controllerId: "departed-ai",
          curHealth: inactive === "dead" || inactive === "template" ? 0 : npc.curHealth,
          isSummonTemplate: inactive === "template",
          fledBattle: inactive === "fled", leftBattle: inactive === "left",
          spriteAnimations: { idle: {
            id: "idle", name: "Idle", url: "https://example.com/idle.png",
            columns: 6, rows: 2, frameCount: 12, fps: 12, facing: "left",
          } },
        });
        await db.update(battle).set({ usersState: saved.usersState }).where(eq(battle.id, saved.id));
      }
      const response = await perform();
      expect(response.activeUserId).toBe(player.userId);
      expect((await logs()).map((row) => row.actionId)).toEqual(["strike", "wait"]);
      expect(response.usersState.find((user) => user.userId === npc.userId)!.spriteAnimationEvent).toBeUndefined();
    },
  );
});

const startBattle = async ({
  battleType = "ARENA", animated = true, firstActor = "ai", withMovement = false,
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
    { userId: "ai", username: "AI", isAi: true, inArena: true, rank: "JONIN", level: 50 },
  ]);
  await db.insert(aiProfile).values({
    id: "Default", userId: "ai", includeDefaultRules: false, rules: [
      ...(withMovement ? [{ conditions: [], action: ActionUseSpecificJutsu.parse({ jutsuId: "jump", target: "COORDINATE", coordinates: { longitude: 5, latitude: 1 } }) }] : []),
      { conditions: [], action: ActionUseSpecificJutsu.parse({ jutsuId: "strike", target: "CLOSEST_OPPONENT" }) },
      { conditions: [], action: ActionEndTurn.parse({}) },
    ],
  });
  if (withMovement) {
    await db.insert(jutsu).values({
      id: "jump", name: "Jump", description: "Jump", battleDescription: "%user jumps across the battlefield",
      image: "/jutsu.png", effects: [makeTag("move", { power: 100, rounds: 0 })],
      target: "EMPTY_GROUND", range: 10, requiredRank: "STUDENT", jutsuType: "NORMAL", cooldown: 1, actionCostPerc: 20,
    });
    await db.insert(userJutsu).values({ id: "owned-jump", userId: "ai", jutsuId: "jump", equipped: true });
  }
  await db.insert(jutsu).values({
    id: "strike", name: "Strike", description: "Strike", battleDescription: "%user strikes %target",
    image: "/jutsu.png", effects: [makeTag("damage", {
      power: 1, powerPerLevel: 0, calculation: "static", statTypes: [], generalTypes: [], elements: [], rounds: 0,
    })], target: "OTHER_USER", range: 10, requiredRank: "STUDENT", jutsuType: "NORMAL",
    cooldown: 1, actionCostPerc: 40,
  });
  await db.insert(userJutsu).values({ id: "owned-strike", userId: "ai", jutsuId: "strike", equipped: true });
  if (animated) {
    await db.insert(spriteAnimation).values(["idle", "attack", "wait", ...(withMovement ? ["move"] : [])].map((id) => ({
      id, name: id, url: `https://example.com/${id}.png`, columns: 6, rows: 2,
      frameCount: 12, fps: 12, facing: "left" as const, createdByUserId: "editor",
    })));
    const editor = callerForDatabase(spriteAnimationRouter, "editor", db);
    for (const [actionKey, animationId] of [["idle", "idle"], ["jutsu:strike", "attack"], ["basic:wait", "wait"]] as const) {
      expect((await editor.assign({ userId: "ai", actionKey, animationId })).success).toBe(true);
    }
    if (withMovement) expect((await editor.assign({ userId: "ai", actionKey: "move", animationId: "move" })).success).toBe(true);
  }
  expect((await initiateBattle({ client: db, userIds: ["player"], targetIds: ["ai"] }, battleType)).success).toBe(true);
  const saved = (await db.query.battle.findFirst())!;
  const npc = saved.usersState.find((user) => user.controllerId === "ai")!;
  const player = saved.usersState.find((user) => user.userId === "player")!;
  npc.longitude = 1; npc.latitude = 1;
  player.longitude = withMovement ? 6 : 2; player.latitude = 1;
  player.initiative = firstActor === "player" ? 100 : 0;
  npc.initiative = firstActor === "ai" ? 100 : 0;
  saved.activeUserId = firstActor === "ai" ? npc.userId : player.userId;
  await db.update(battle).set({
    usersState: saved.usersState, activeUserId: saved.activeUserId, roundStartAt: new Date(),
  }).where(eq(battle.id, saved.id));
  const api = callerForDatabase(combatRouter, "player", db);
  let version = saved.version;
  const perform = async (action: { actionId?: string; longitude?: number; latitude?: number } = {}) => {
    const result = await api.performAction({ battleId: saved.id, version, ...action });
    expect(result.updateClient).toBe(true);
    if (!("battleUpdate" in result) || !result.battleUpdate) throw new Error("Missing battle update");
    version = result.battleUpdate.version;
    return result.battleUpdate;
  };
  const logs = () => db.query.battleAction.findMany({
    where: eq(battleAction.battleId, saved.id), orderBy: (row, { asc }) => asc(row.battleVersion),
  });
  return { db, api, saved, npc, player, perform, logs };
};

const loadedTexture = () => {
  const texture = new Texture<HTMLImageElement>();
  texture.image = document.createElement("img");
  texture.image.width = 3072;
  texture.image.height = 1024;
  return texture;
};
