import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { SAGE_MODE_ACTIVATION_JUTSU_ID } from "@/drizzle/constants";
import {
  aiProfile,
  battle,
  battleAction,
  jutsu,
  userData,
  userJutsu,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { fetchBattle } from "@/queries/combat";
import { initiateBattle } from "@/server/api/routers/combat";
import { packBattleExtraState } from "@/server/utils/battleStorage";
import { ActionEndTurn } from "@/validators/ai";
import { insertUsers } from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const jutsuRow = (id: string, extra: Partial<typeof jutsu.$inferInsert> = {}) => ({
  id,
  name: id,
  image: "/jutsu.png",
  description: "Authored text",
  battleDescription: "%user acts",
  effects: [],
  target: "SELF" as const,
  range: 0,
  requiredRank: "STUDENT" as const,
  jutsuType: "NORMAL" as const,
  actionCostPerc: 40,
  ...extra,
});

describeWithDatabase("stored battle catalogs", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(battleAction, battle, userJutsu, jutsu, aiProfile, userData);
  });
  afterEach(() => vi.restoreAllMocks());

  it("compacts every jutsu in the row, including those merged in as the battle is written", async () => {
    const db = await getTestDatabase();
    await insertUsers([
      {
        userId: "player",
        username: "Player",
        rank: "JONIN",
        level: 50,
        ninjutsuMastery: 100,
      },
      {
        userId: "ai",
        username: "AI",
        isAi: true,
        inArena: true,
        rank: "JONIN",
        level: 50,
      },
    ]);
    await db.insert(aiProfile).values({
      id: "Default",
      userId: "ai",
      includeDefaultRules: false,
      rules: [{ conditions: [], action: ActionEndTurn.parse({}) }],
    });
    await db
      .insert(jutsu)
      .values([
        jutsuRow("owned"),
        jutsuRow("gated", { requiredNinjutsuMastery: 10 }),
        jutsuRow("injectable", { injectableInBattle: true }),
      ]);
    await db.insert(userJutsu).values([
      { id: "owned-jutsu", userId: "player", jutsuId: "owned", equipped: true },
      { id: "gated-jutsu", userId: "player", jutsuId: "gated", equipped: true },
    ]);
    expect(
      (
        await initiateBattle(
          { client: db, userIds: ["player"], targetIds: ["ai"] },
          "ARENA",
        )
      ).success,
    ).toBe(true);
    const row = (await db.query.battle.findFirst())!;
    // Initiation stores the catalogs compressed and keeps turn-written state as JSON.
    expect(row.catalogs?.byteLength).toBeGreaterThan(0);
    expect(row.extraState).not.toHaveProperty("jutsus");
    expect(row.extraState).toHaveProperty("energyRegeneration");
    const stored = (await fetchBattle(db, row.id))!;
    expect(stored).not.toHaveProperty("catalogs");
    expect(stored.extraState).toMatchObject(row.extraState);
    const { jutsus } = stored.extraState;
    expect(Object.keys(jutsus)).toEqual(
      expect.arrayContaining(["owned", "injectable", SAGE_MODE_ACTIVATION_JUTSU_ID]),
    );
    for (const row of Object.values(jutsus)) {
      expect(row).not.toHaveProperty("description");
      expect(row).not.toHaveProperty("createdAt");
      expect(row).not.toHaveProperty("requiredSkillId");
    }
    expect(jutsus.gated?.requiredNinjutsuMastery).toBe(10);
  });

  it("loads a row that keeps every catalog as JSON exactly as its compressed form", async () => {
    const db = await getTestDatabase();
    await insertUsers([
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
    await db.insert(aiProfile).values({
      id: "Default",
      userId: "ai",
      includeDefaultRules: false,
      rules: [{ conditions: [], action: ActionEndTurn.parse({}) }],
    });
    await db
      .insert(jutsu)
      .values([jutsuRow("injectable", { injectableInBattle: true })]);
    expect(
      (
        await initiateBattle(
          { client: db, userIds: ["player"], targetIds: ["ai"] },
          "ARENA",
        )
      ).success,
    ).toBe(true);
    const { id } = (await db.query.battle.findFirst())!;
    const complete = (await fetchBattle(db, id))!;
    // Rows written with compressed writes off hold their whole state as JSON.
    await db
      .update(battle)
      .set(packBattleExtraState(complete.extraState, false))
      .where(eq(battle.id, id));
    const legacy = (await db.query.battle.findFirst())!;
    expect(legacy.catalogs).toBeNull();
    expect(legacy.extraState).toHaveProperty("jutsus");
    expect(await fetchBattle(db, id)).toEqual(complete);
  });
});
