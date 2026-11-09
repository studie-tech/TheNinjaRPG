import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import {
  aiProfile,
  battle,
  battleAction,
  jutsu,
  userData,
  userJutsu,
} from "@/drizzle/schema";
import { SAGE_MODE_ACTIVATION_JUTSU_ID } from "@/drizzle/constants";
import { Pusher } from "@/libs/pusher";
import { initiateBattle } from "@/server/api/routers/combat";
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
    const stored = (await db.query.battle.findFirst())!;
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
});
