import { stubRateLimitTransport } from "../../../../setup/rateLimit";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { AutoBattleTypes, ManualStartBattleTypes, type BattleType } from "@/drizzle/constants";
import { battle, userData } from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { combatRouter } from "@/server/api/routers/combat";
import { makeCompleteBattle, makeUser } from "../../../../libs/combat/helpers/battleScenario";
import { insertUsers } from "../../../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../../../setup/testDatabase";

const USER = "auto-toggle-player";
const BATTLE = "auto-toggle-battle";

describeWithDatabase("battle AI control preference scope", () => {
  beforeEach(async () => {
    // Exercise the procedure middleware without requiring external Redis in SQL tests.
    stubRateLimitTransport();
    await resetTables(battle, userData);
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  const seed = async (battleType: BattleType, preference: boolean) => {
    const db = await getTestDatabase();
    await insertUsers([{ userId: USER, username: USER, defaultAutoCombat: preference }]);
    const row = makeCompleteBattle({
      id: BATTLE, battleType, width: 13, height: 9, background: "default",
      usersState: [
        makeUser({ userId: USER, controllerId: USER, isAi: false }),
        makeUser({ userId: "summon", controllerId: USER, isSummon: true, isPiloted: true }),
      ],
      usersEffects: [], groundEffects: [], extraState: {},
    });
    await db.insert(battle).values(row);
    return { db, caller: await callerFor(combatRouter, USER) };
  };

  it.each(ManualStartBattleTypes.filter((type) => !AutoBattleTypes.includes(type)))("keeps %s handovers local to the battle, including repeated requests", async (battleType) => {
    const { db, caller } = await seed(battleType, false);
    for (const enabled of [true, true, false, false]) {
      expect(await caller.toggleAutoCombat({ battleId: BATTLE, enabled })).toMatchObject({ success: true, userPatch: {} });
      const saved = (await db.query.battle.findFirst({ where: eq(battle.id, BATTLE) }))!;
      expect(saved.usersState.every((user) => !!user.isAutoCombat === enabled)).toBe(true);
      const profile = (await db.query.userData.findFirst({ where: eq(userData.userId, USER) }))!;
      expect(profile.defaultAutoCombat).toBe(false);
    }
  });

  it("does not turn off the PvE default when taking back a PvP fight", async () => {
    const { db, caller } = await seed("COMBAT", true);
    await caller.toggleAutoCombat({ battleId: BATTLE, enabled: true });
    await caller.toggleAutoCombat({ battleId: BATTLE, enabled: false });
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, USER) }))!.defaultAutoCombat).toBe(true);
  });

  it("retains the saved non-PvP preference for arena handovers", async () => {
    const { db, caller } = await seed("ARENA", false);
    for (const enabled of [true, false]) {
      expect(await caller.toggleAutoCombat({ battleId: BATTLE, enabled })).toMatchObject({ success: true, userPatch: { defaultAutoCombat: enabled } });
      expect((await db.query.userData.findFirst({ where: eq(userData.userId, USER) }))!.defaultAutoCombat).toBe(enabled);
    }
  });

  it("keeps always-AI battles locked without changing the PvE preference", async () => {
    const { db, caller } = await seed("KAGE_AI", false);
    expect((await caller.toggleAutoCombat({ battleId: BATTLE, enabled: true })).success).toBe(false);
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, USER) }))!.defaultAutoCombat).toBe(false);
  });

  it("rejects changes from someone outside the battle without changing their preference", async () => {
    const { db } = await seed("COMBAT", false);
    await insertUsers([{ userId: "outsider", username: "outsider", defaultAutoCombat: false }]);
    const caller = await callerFor(combatRouter, "outsider");
    expect((await caller.toggleAutoCombat({ battleId: BATTLE, enabled: true })).success).toBe(false);
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, "outsider") }))!.defaultAutoCombat).toBe(false);
  });
});
