import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  aiProfile,
  battle,
  battleAction,
  bloodline,
  bloodrightOption,
  jutsu,
  jutsuLoadout,
  rankedPvpQueue,
  userData,
  userJutsu,
} from "@/drizzle/schema";
import { availableUserActions } from "@/libs/combat/actions";
import { maskBattle } from "@/libs/combat/masking";
import { Pusher } from "@/libs/pusher";
import { fetchBattle } from "@/queries/combat";
import { combatRouter, initiateBattle } from "@/server/api/routers/combat";
import { DamageTag, InjectJutsusTag } from "@/validators/combat";
import {
  insertDefaultAiProfile,
  insertJutsus,
  insertUsers,
} from "../../setup/factories";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../setup/testDatabase";

const damage = DamageTag.parse({ power: 20 });

describeWithDatabase("Bloodright battle snapshots", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(
      battleAction,
      battle,
      userJutsu,
      jutsuLoadout,
      rankedPvpQueue,
      bloodrightOption,
      jutsu,
      bloodline,
      aiProfile,
      userData,
    );
    const db = await getTestDatabase();
    await insertDefaultAiProfile();
    await db.insert(bloodline).values({
      id: "line",
      name: "Line",
      image: "",
      description: "Line",
      rank: "D",
      effects: [InjectJutsusTag.parse({ jutsuIds: ["injected"], power: 1 })],
    });
    await insertUsers([
      {
        userId: "owner",
        username: "Owner",
        rank: "JONIN",
        level: 50,
        bloodlineId: "line",
        bloodright: [{ optionId: "upgrade", cost: 100 }],
      },
      {
        userId: "opponent",
        username: "Opponent",
        rank: "JONIN",
        level: 50,
        bloodlineId: "line",
      },
    ]);
    await insertJutsus([
      {
        id: "target",
        name: "Target",
        bloodlineId: "line",
        jutsuType: "BLOODLINE",
        effects: [damage],
      },
      {
        id: "injected",
        name: "Injected",
        bloodlineId: "line",
        jutsuType: "BLOODLINE",
        injectableInBattle: true,
        parentJutsuId: "target",
        effects: [damage],
      },
      { id: "unrelated", name: "Unrelated", effects: [damage] },
    ]);
    await db.insert(bloodrightOption).values({
      id: "upgrade",
      bloodlineId: "line",
      jutsuId: "target",
      name: "Upgrade",
      description: "Upgrade",
      changes: [{ tagIndex: 0, tag: damage, field: "power", mode: "FLAT", value: 5 }],
    });
    await db.insert(userJutsu).values([
      { id: "owned-unrelated", userId: "owner", jutsuId: "unrelated", equipped: true },
      { id: "owned-target", userId: "owner", jutsuId: "target", equipped: false },
      { id: "opponent-target", userId: "opponent", jutsuId: "target", equipped: true },
    ]);
    await db
      .insert(jutsuLoadout)
      .values({ id: "target-loadout", userId: "owner", jutsuIds: ["target"] });
  });
  afterEach(() => vi.restoreAllMocks());

  it("preloads unequipped targets and injected evolutions while keeping upgrades private to their owner", async () => {
    const db = await getTestDatabase();
    expect(
      (
        await initiateBattle(
          { client: db, userIds: ["owner"], targetIds: ["opponent"] },
          "SPARRING",
        )
      ).success,
    ).toBe(true);
    const row = await db.query.battle.findFirst();
    if (!row) throw new Error("Missing battle");
    const stored = await fetchBattle(db, row.id);
    if (!stored) throw new Error("Missing hydrated battle");
    expect(stored.extraState.bloodrightChanges?.owner?.target).toHaveLength(1);
    expect(stored.extraState.bloodrightChanges?.owner?.injected).toHaveLength(1);
    expect(stored.extraState.bloodrightChanges?.opponent).toBeUndefined();
    const enemyView = maskBattle(stored, "opponent");
    expect(enemyView.extraState.bloodrightChanges).not.toHaveProperty("owner");
    const actor = stored.usersState.find((user) => user.userId === "owner");
    if (!actor) throw new Error("Missing owner");
    const actions = availableUserActions(maskBattle(stored, "owner"), actor.userId);
    expect(
      actions.find((action) => action.id === "injected")?.effects[0],
    ).toMatchObject({ power: 25 });
    expect(
      actions.find((action) => action.id === "unrelated")?.effects[0],
    ).toMatchObject({ power: 20 });
    await db
      .update(battle)
      .set({ roundStartAt: new Date(Date.now() + 60_000) })
      .where(eq(battle.id, row.id));
    const result = await callerForDatabase(
      combatRouter,
      "owner",
      db,
    ).updateCombatLoadout({ battleId: row.id, jutsuLoadoutId: "target-loadout" });
    expect(result.success).toBe(true);
    const switched = await fetchBattle(db, row.id);
    if (!switched) throw new Error("Missing switched battle");
    const owner = switched.usersState.find((user) => user.userId === "owner");
    if (!owner) throw new Error("Missing switched owner");
    expect(
      availableUserActions(maskBattle(switched, "owner"), owner.userId).find(
        (action) => action.id === "target",
      )?.effects[0],
    ).toMatchObject({ power: 25 });
  });

  it.each(["RANKED_PVP", "RANKED_SPARRING"] as const)(
    "skips Bloodright catalog reads and changes in %s",
    async (battleType) => {
      const db = await getTestDatabase();
      if (battleType === "RANKED_PVP") {
        await db.update(userData).set({ status: "QUEUED" });
        await db.insert(rankedPvpQueue).values(
          ["owner", "opponent"].map((userId) => ({
            id: userId,
            userId,
            rankedLp: 1000,
            hasClaimed: true,
          })),
        );
      }
      const captured = await recordQueries(() =>
        initiateBattle(
          { client: db, userIds: ["owner"], targetIds: ["opponent"] },
          battleType,
        ),
      );
      expect(captured.result).toMatchObject({ success: true });
      expect(
        captured.statements.filter(
          (statement) =>
            /^select `id`, `parentJutsuId`, `reskinParentJutsuId` from `Jutsu`/i.test(
              statement,
            ) ||
            /^select `id`, `effects` from `Jutsu`.*`bloodlineId` in \(select/i.test(
              statement,
            ),
        ),
      ).toHaveLength(0);
      const row = await db.query.battle.findFirst();
      if (!row) throw new Error("Missing ranked battle");
      const stored = await fetchBattle(db, row.id);
      expect(stored?.extraState.bloodrightChanges).toBeUndefined();
    },
  );
  for (const battleType of ["KAGE_AI", "CLAN_CHALLENGE"] as const) {
    it(`applies owned changes to the automatic player actor in ${battleType}`, async () => {
      const db = await getTestDatabase();
      await db
        .update(userJutsu)
        .set({ equipped: true })
        .where(eq(userJutsu.id, "owned-target"));
      await db
        .update(userData)
        .set({ isAi: true, bloodright: [{ optionId: "upgrade", cost: 100 }] })
        .where(eq(userData.userId, "opponent"));
      expect(
        await initiateBattle(
          { client: db, userIds: ["owner"], targetIds: ["opponent"] },
          battleType,
        ),
      ).toMatchObject({ success: true });
      const row = await db.query.battle.findFirst();
      if (!row) throw new Error("Missing automatic battle");
      const stored = await fetchBattle(db, row.id);
      if (!stored) throw new Error("Missing hydrated automatic battle");
      const actor = stored.usersState.find(
        (user) => user.controllerId === "owner" && !user.isSummon,
      );
      if (!actor) throw new Error("Missing owner actor");
      expect(actor).toMatchObject({ isAi: true, isOriginal: false });
      expect(
        availableUserActions(stored, actor.userId).find(
          (action) => action.id === "target",
        )?.effects[0],
      ).toMatchObject({ power: 25 });
      const opponent = stored.usersState.find(
        (user) => user.controllerId === "opponent" && !user.isSummon,
      );
      if (!opponent) throw new Error("Missing opponent actor");
      expect(stored.extraState.bloodrightChanges?.[opponent.userId]).toBeUndefined();
    });
  }
});
