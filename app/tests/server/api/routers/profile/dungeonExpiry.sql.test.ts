/** Keep profile data and navigation consistent with expiry and competing floor publication. */
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { battle, dungeonMember, dungeonRun, userData, userVote, village } from "@/drizzle/schema";
import { markDungeonFloorPublished, updateDungeonRunForReserve } from "@/queries/dungeon";
import { profileRouter } from "@/server/api/routers/profile";
import { makeCompleteBattle, makeUser } from "../../../../libs/combat/helpers/battleScenario";
import { dungeonBattleState, dungeonContent } from "../../../../setup/dungeon";
import { insertUsers } from "../../../../setup/factories";
import { beforeStatements } from "../../../../setup/statements";
import { callerFor, callerForDatabase, describeWithDatabase, getTestDatabase, recordQueries, resetTables } from "../../../../setup/testDatabase";

const USER_ID = "dungeon-profile-owner";

describeWithDatabase("profile dungeon expiry reconciliation", () => {
  beforeEach(async () => {
    await resetTables(userData, userVote, dungeonRun, dungeonMember, battle, village);
    await insertUsers([{
      userId: USER_ID, username: "DungeonOwner", status: "QUEUED", level: 50,
      rank: "JONIN", experience: 20000000, villageId: "home", sector: 1,
      curHealth: 1, maxHealth: 100, curChakra: 2, maxChakra: 200,
      curStamina: 3, maxStamina: 300, regenAt: new Date(), updatedAt: new Date(),
    }]);
    const db = await getTestDatabase();
    await db.insert(village).values({ id: "home", name: "Home", kageId: "other", sector: 1 });
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns restored pools and clears combat navigation after a fighting run expires", async () => {
    const db = await getTestDatabase();
    await seedRun("FIGHTING", new Date(Date.now() - 1000));
    const response = await (await callerFor(profileRouter, USER_ID)).getUser();
    const stored = await db.query.userData.findFirst({ where: eq(userData.userId, USER_ID) });
    expect(stored).toMatchObject({ status: "AWAKE", battleId: null, curHealth: 100, curChakra: 200, curStamina: 300 });
    expect(response.userData).toMatchObject({
      status: stored?.status, battleId: stored?.battleId,
      curHealth: stored?.curHealth, curChakra: stored?.curChakra, curStamina: stored?.curStamina,
      curEnergy: stored?.curEnergy, regenAt: stored?.regenAt, updatedAt: stored?.updatedAt,
    });
    expect(await db.query.battle.findFirst()).toBeUndefined();
    expect(await db.query.dungeonMember.findFirst()).toMatchObject({ activeUserId: null });
    expect(response.notifications.some(link => link.name === "In combat" || link.name === "Active Dungeon Squad")).toBe(false);
  });

  it("returns the published battle and squad when a floor start wins the expiry claim", async () => {
    const db = await getTestDatabase();
    const run = await seedRun("LOBBY", new Date(Date.now() - 1000));
    let started = false;
    const raced = beforeStatements(db, dungeonRun, [async () => {
      started = true;
      // A launcher can pass its deadline check before expiry loads the same version.
      const claim = await updateDungeonRunForReserve(db, "new-battle", new Date(Date.now() + 3600000), run, run.state);
      expect(claim.rowsAffected).toBe(1);
      await db.insert(battle).values(makeCompleteBattle({ id: "new-battle" }));
      expect((await markDungeonFloorPublished(db, run.id, "new-battle", 1, { ...run.state, entryPaidAt: Date.now(), battlePublished: true })).rowsAffected).toBe(1);
      await db.update(userData).set({ status: "BATTLE", battleId: "new-battle" }).where(eq(userData.userId, USER_ID));
    }]);
    const response = await callerForDatabase(profileRouter, USER_ID, raced).getUser();
    expect(started).toBe(true);
    expect(await db.query.dungeonRun.findFirst()).toMatchObject({ status: "FIGHTING", battleId: "new-battle", version: 1 });
    expect(await db.query.userData.findFirst()).toMatchObject({ status: "BATTLE", battleId: "new-battle" });
    expect(response.userData).toMatchObject({ status: "BATTLE", battleId: "new-battle" });
    expect(response.notifications).toContainEqual(expect.objectContaining({ name: "Active Dungeon Squad", href: "/dungeon" }));
    expect(response.notifications).toContainEqual(expect.objectContaining({ name: "In combat", href: "/combat" }));
  });

  it("keeps an unchanged active run on the initial profile and reservation reads", async () => {
    const db = await getTestDatabase();
    await seedRun("FIGHTING", new Date(Date.now() + 3600000));
    const actualRead = db.query.userData.findFirst.bind(db.query.userData);
    let profileReads = 0;
    vi.spyOn(db.query.userData, "findFirst").mockImplementation(((config: Parameters<typeof actualRead>[0]) => {
      if (config?.with) profileReads++;
      return actualRead(config);
    }) as never);
    const { result, statements } = await recordQueries(() => callerForDatabase(profileRouter, USER_ID, db).getUser());
    expect(result.userData).toMatchObject({ status: "BATTLE", battleId: "fight", curHealth: 1 });
    expect(result.notifications).toContainEqual(expect.objectContaining({ name: "Active Dungeon Squad" }));
    expect(profileReads).toBe(1);
    expect(statements.filter(statement => /^select .* from .DungeonMember. inner join .DungeonRun./is.test(statement))).toHaveLength(1);
  });
});

/** Seed a reserved profile and its optional playable battle for expiry reconciliation. */
const seedRun = async (status: "LOBBY" | "FIGHTING", expiresAt: Date) => {
  const db = await getTestDatabase();
  const meta = dungeonBattleState({
    runId: "run", expiresAt: expiresAt.getTime(),
    runState: { ...dungeonBattleState().runState, memberIds: [USER_ID], ...(status === "FIGHTING" ? { entryPaidAt: Date.now() - 3600000 } : {}) },
  });
  await db.insert(dungeonRun).values({
    id: "run", dungeonId: "definition", leaderId: USER_ID, content: dungeonContent(),
    state: meta.runState, status, version: status === "FIGHTING" ? 1 : 0,
    battleId: status === "FIGHTING" ? "fight" : null, createdAt: new Date(), expiresAt,
  });
  await db.insert(dungeonMember).values({ runId: "run", userId: USER_ID, activeUserId: USER_ID });
  if (status === "FIGHTING") {
    await db.update(userData).set({ status: "BATTLE", battleId: "fight" }).where(eq(userData.userId, USER_ID));
    await db.insert(battle).values(makeCompleteBattle({
      id: "fight", extraState: { ...makeCompleteBattle().extraState, dungeon: meta },
      usersState: [makeUser({ userId: USER_ID, controllerId: USER_ID })],
    }));
  }
  const run = await db.query.dungeonRun.findFirst();
  if (!run) throw new Error("Missing dungeon run");
  return run;
};
