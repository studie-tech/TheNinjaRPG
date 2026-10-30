import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { BattleUsageTypes } from "@/drizzle/constants";
import {
  aiProfile,
  battle,
  battleAction,
  battleHistory,
  dungeon,
  dungeonMember,
  dungeonRun,
  jutsu,
  jutsuLoadout,
  userData,
  userJutsu,
  village,
} from "@/drizzle/schema";
import { availableUserActions } from "@/libs/combat/actions";
import { Pusher } from "@/libs/pusher";
import { combatRouter } from "@/server/api/routers/combat";
import { dungeonRouter } from "@/server/api/routers/dungeon";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import { getTagSchema } from "@/validators/combat";
import { dungeonContent } from "../../../../setup/dungeon";
import { insertUsers } from "../../../../setup/factories";
import { stubRateLimitTransport } from "../../../../setup/rateLimit";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const members = ["leader", "ally", "helper"];

describeWithDatabase("dungeon jutsu loadouts", () => {
  beforeEach(async () => {
    stubRateLimitTransport();
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(
      aiProfile, battle, battleAction, battleHistory, dungeon, dungeonMember,
      dungeonRun, jutsu, jutsuLoadout, userData, userJutsu, village,
    );
    await insertUsers([
      ...members.map((userId) => ({
        userId, username: userId, status: "AWAKE" as const, rank: "JONIN" as const, level: 50,
        experience: 20_000_000, sector: 1, villageId: "home", defaultAutoCombat: false,
        curHealth: 100, maxHealth: 100, curChakra: 100, maxChakra: 100,
        curStamina: 100, maxStamina: 100, updatedAt: new Date(), regenAt: new Date(),
      })),
      { userId: "enemy", username: "Enemy", isAi: true, level: 10, rank: "GENIN" },
    ]);
    const db = await getTestDatabase();
    await db.insert(village).values({ id: "home", name: "Home", sector: 1, kageId: "leader" });
    await db.insert(aiProfile).values({ id: "Default", userId: "enemy", rules: [] });
    await db.insert(dungeon).values({ id: "dungeon", content: dungeonContent(), updatedAt: new Date() });
    await db.insert(jutsu).values(BattleUsageTypes.map((usage) => ({
      id: `jutsu-${usage}`, name: `Jutsu ${usage}`, image: "", description: "Restore health",
      battleDescription: "%user restores their health", jutsuType: "NORMAL" as const,
      battleUsageType: usage, requiredRank: "STUDENT" as const, target: "SELF" as const,
      range: 0, chakraCost: 0, staminaCost: 0, actionCostPerc: 40,
      effects: [getTagSchema("heal").parse({ power: 5, calculation: "static", target: "SELF" })],
    })));
    await db.insert(userJutsu).values(members.flatMap((userId) =>
      BattleUsageTypes.map((usage) => ({
        id: `${userId}-${usage}`, userId, jutsuId: `jutsu-${usage}`, equipped: false,
      })),
    ));
    await db.insert(jutsuLoadout).values(members.map((userId) => ({
      id: `loadout-${userId}`, userId, jutsuIds: BattleUsageTypes.map((usage) => `jutsu-${usage}`),
    })));
  });

  afterEach(() => vi.restoreAllMocks());

  it("keeps selected PvE and shared jutsu usable for every member while excluding PvP jutsu", async () => {
    const db = await getTestDatabase();
    for (const userId of members) {
      const loadouts = await callerFor(jutsuRouter, userId);
      expect((await loadouts.selectJutsuLoadout({ id: `loadout-${userId}` })).success).toBe(true);
      const equipped = await db.query.userJutsu.findMany({ where: eq(userJutsu.userId, userId) });
      expect(equipped.filter((entry) => entry.equipped).map((entry) => entry.jutsuId).sort())
        .toEqual(BattleUsageTypes.map((usage) => `jutsu-${usage}`).sort());
    }
    const leader = await callerFor(dungeonRouter, "leader");
    const created = await leader.create({ id: "dungeon" });
    if (!created.success || !("id" in created)) throw new Error("Missing dungeon lobby");
    const id = created.id;
    for (const userId of members.slice(1)) {
      expect((await leader.act({ id, action: "invite", userId })).success).toBe(true);
      expect((await (await callerFor(dungeonRouter, userId)).act({ id, action: "accept" })).success).toBe(true);
    }
    for (const userId of members) {
      expect((await (await callerFor(dungeonRouter, userId)).act({ id, action: "ready" })).success).toBe(true);
    }
    expect((await leader.act({ id, action: "start" })).success).toBe(true);
    const saved = await db.query.battle.findFirst();
    if (!saved) throw new Error("Missing dungeon battle");
    expect(saved.battleType).toBe("QUEST");
    expect(saved.extraState.dungeon?.runId).toBe(id);
    for (const userId of members) {
      const response = await (await callerFor(combatRouter, userId)).getBattle({ battleId: saved.id });
      const actions = availableUserActions(response.battle, userId).map((action) => action.id);
      expect(actions).toEqual(expect.arrayContaining(["jutsu-PVE", "jutsu-BOTH"]));
      expect(actions).not.toContain("jutsu-PVP");
    }
    const current = await db.query.battle.findFirst({ where: eq(battle.id, saved.id) });
    const actor = current?.usersState.find((entry) => entry.userId === current.activeUserId);
    if (!current || !actor || !members.includes(actor.userId)) throw new Error("Missing player turn");
    const combat = await callerFor(combatRouter, actor.userId);
    const input = { battleId: current.id, version: current.version, longitude: actor.longitude, latitude: actor.latitude };
    expect(await combat.performAction({ ...input, actionId: "jutsu-PVP" })).toMatchObject({
      notification: "Action not valid anymore. Try something else",
    });
    expect(await combat.performAction({ ...input, actionId: "jutsu-PVE" })).toMatchObject({ updateClient: true });
    expect(await db.query.battleAction.findMany()).toContainEqual(expect.objectContaining({
      battleId: saved.id, userId: actor.userId, actionId: "jutsu-PVE",
    }));
  });
});
