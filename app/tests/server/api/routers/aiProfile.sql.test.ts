import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { AI_PROFILE_MAX_RULES } from "@/drizzle/constants";
import { aiProfile, jutsuLoadout, userData } from "@/drizzle/schema";
import { aiRouter } from "@/server/api/routers/ai";
import {
  ActionEndTurn,
  AiRule,
  type AiRuleType,
  getBackupRules,
} from "@/validators/ai";
import { insertDefaultAiProfile, insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const custom = (count: number): AiRuleType[] =>
  Array.from({ length: count }, () =>
    AiRule.parse({ conditions: [], action: ActionEndTurn.parse({}) }),
  );

const player = async () =>
  (await getTestDatabase()).query.userData.findFirst({
    where: eq(userData.userId, "player"),
    columns: { aiProfileId: true, jutsuLoadout: true },
  });
const loadouts = async () =>
  (await getTestDatabase()).query.jutsuLoadout.findMany({
    where: eq(jutsuLoadout.userId, "player"),
    columns: { id: true, customAi: true },
    with: { aiProfile: { columns: { id: true } } },
    orderBy: (table, { asc }) => [asc(table.id)],
  });

describeWithDatabase("AI rules per jutsu loadout", () => {
  beforeEach(async () => {
    await resetTables(aiProfile, jutsuLoadout, userData);
    await insertDefaultAiProfile();
    await insertUsers([
      { userId: "player", username: "player", jutsuLoadout: "l1" },
      { userId: "other", username: "other", jutsuLoadout: "o1" },
      { userId: "unloaded", username: "unloaded" },
      { userId: "staff", username: "staff", role: "CODER" },
      { userId: "bot", username: "bot", isAi: true },
    ]);
    await (await getTestDatabase()).insert(jutsuLoadout).values([
      { id: "l1", userId: "player", jutsuIds: [] },
      { id: "l2", userId: "player", jutsuIds: [] },
      { id: "o1", userId: "other", jutsuIds: [] },
    ]);
  });

  it("gives the active jutsu loadout its own rules, and keeps them while it uses Default", async () => {
    const api = await callerFor(aiRouter, "player");
    const on = await api.toggleAiProfile({ aiId: "player", custom: true });
    expect(on.success).toBe(true);
    const [first] = await loadouts();
    const own = first?.aiProfile?.id as string;
    expect(own).toBeDefined();
    expect(
      (await loadouts()).map((row) => ({
        id: row.id,
        customAi: row.customAi,
        rules: row.aiProfile?.id ?? "none",
      })),
    ).toEqual([
      { id: "l1", customAi: true, rules: own },
      { id: "l2", customAi: false, rules: "none" },
    ]);
    expect((await player())?.aiProfileId).toBe(own as string);
    // The response patches the profile cache for the player's own toggle.
    expect("userPatch" in on && on.userPatch).toEqual({
      aiProfileId: own,
      jutsuLoadout: "l1",
    });

    await api.updateAiProfile({
      id: own as string,
      rules: [...custom(3), ...getBackupRules()],
      includeDefaultRules: true,
    });
    const off = await api.toggleAiProfile({ aiId: "player", custom: false });
    expect(off.success).toBe(true);
    expect((await player())?.aiProfileId).toBeNull();
    expect((await loadouts())[0]?.customAi).toBe(false);

    // Back to custom: the loadout's rules are still there.
    await api.toggleAiProfile({ aiId: "player", custom: true });
    expect((await player())?.aiProfileId).toBe(own as string);
    const kept = await api.getAiProfile({ id: own as string });
    expect(kept.rules).toHaveLength(3 + getBackupRules().length);
  });

  it("flips the active loadout's rules for a page that does not say which way", async () => {
    const api = await callerFor(aiRouter, "player");
    await api.toggleAiProfile({ aiId: "player" });
    expect((await loadouts())[0]?.customAi).toBe(true);
    await api.toggleAiProfile({ aiId: "player" });
    expect((await loadouts())[0]?.customAi).toBe(false);
  });

  it("does not fail when the same loadout is switched to custom twice at once", async () => {
    const api = await callerFor(aiRouter, "player");
    const results = await Promise.all([
      api.toggleAiProfile({ aiId: "player", custom: true }),
      api.toggleAiProfile({ aiId: "player", custom: true }),
    ]);
    expect(results.every((result) => result.success)).toBe(true);
    const rows = await (await getTestDatabase()).query.aiProfile.findMany({
      where: eq(aiProfile.userId, "player"),
    });
    expect(rows).toHaveLength(1);
  });

  it("writes no rules for a loadout the player does not own", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ jutsuLoadout: "o1" })
      .where(eq(userData.userId, "player"));
    const api = await callerFor(aiRouter, "player");
    const result = await api.toggleAiProfile({ aiId: "player", custom: true });
    expect(result.success).toBe(false);
    const claimed = await db.query.aiProfile.findFirst({
      where: eq(aiProfile.jutsuLoadoutId, "o1"),
    });
    expect(claimed).toBeUndefined();
  });

  it("asks for a jutsu loadout before a player without one writes rules", async () => {
    const api = await callerFor(aiRouter, "unloaded");
    const result = await api.toggleAiProfile({ aiId: "unloaded", custom: true });
    expect(result).toMatchObject({
      success: false,
      message: "Choose a jutsu loadout above first",
    });
  });

  it("lets a player write 20 custom rules besides the backup rules", async () => {
    const api = await callerFor(aiRouter, "player");
    await api.toggleAiProfile({ aiId: "player", custom: true });
    const id = (await player())?.aiProfileId as string;
    const full = await api.updateAiProfile({
      id,
      rules: [...custom(AI_PROFILE_MAX_RULES), ...getBackupRules()],
      includeDefaultRules: true,
    });
    expect(full.success).toBe(true);
    const over = await api.updateAiProfile({
      id,
      rules: [...custom(AI_PROFILE_MAX_RULES + 1), ...getBackupRules()],
      includeDefaultRules: true,
    });
    expect(over).toMatchObject({
      success: false,
      message: `Maximum of ${AI_PROFILE_MAX_RULES} custom rules allowed`,
    });
  });

  it("keeps staff AI profiles to 20 rules in total", async () => {
    const staff = await callerFor(aiRouter, "staff");
    await staff.toggleAiProfile({ aiId: "bot", custom: true });
    const bot = await (await getTestDatabase()).query.userData.findFirst({
      where: eq(userData.userId, "bot"),
    });
    const id = bot?.aiProfileId as string;
    const row = await (await getTestDatabase()).query.aiProfile.findFirst({
      where: eq(aiProfile.id, id),
    });
    expect(row?.jutsuLoadoutId).toBeNull();
    const over = await staff.updateAiProfile({
      id,
      rules: [...custom(AI_PROFILE_MAX_RULES - 2), ...getBackupRules()],
      includeDefaultRules: true,
    });
    expect(over).toMatchObject({
      success: false,
      message: `Maximum of ${AI_PROFILE_MAX_RULES} rules allowed`,
    });
  });

  it("lets a player read the rules of each of their loadouts, but not another player's", async () => {
    const api = await callerFor(aiRouter, "player");
    await api.toggleAiProfile({ aiId: "player", custom: true });
    const id = (await player())?.aiProfileId as string;
    // Rules stay readable to their owner after a switch to another loadout.
    await (await getTestDatabase())
      .update(userData)
      .set({ jutsuLoadout: "l2", aiProfileId: null })
      .where(eq(userData.userId, "player"));
    expect((await api.getAiProfile({ id })).id).toBe(id);
    const other = await callerFor(aiRouter, "other");
    await expect(other.getAiProfile({ id })).rejects.toThrow("Unauthorized");
  });
});
