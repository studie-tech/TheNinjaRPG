import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  aiProfile,
  battle,
  battleHistory,
  clan,
  dataBattleAction,
  userData,
  village,
} from "@/drizzle/schema";
import type { BattleUserState, CompleteBattle } from "@/libs/combat/types";
import { Pusher } from "@/libs/pusher";
import { combatRouter, initiateBattle } from "@/server/api/routers/combat";
import {
  insertClans,
  insertDefaultAiProfile,
  insertUsers,
} from "../../../../setup/factories";
import { stubRateLimitTransport } from "../../../../setup/rateLimit";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const CHALLENGER = "poll-challenger";
const LEADER = "poll-leader";

describeWithDatabase("getBattle settlement of a clan challenge", () => {
  beforeEach(async () => {
    stubRateLimitTransport({ answerOtherRequests: true });
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(
      aiProfile,
      battle,
      battleHistory,
      clan,
      dataBattleAction,
      userData,
      village,
    );
    const db = await getTestDatabase();
    await insertDefaultAiProfile();
    await db.insert(village).values({ id: "v", name: "V", sector: 1, kageId: "kage" });
    await insertClans([
      { id: "c", name: "C", villageId: "v", leaderId: LEADER, coLeader1: CHALLENGER },
    ]);
    await insertUsers(
      [CHALLENGER, LEADER].map((userId) => ({
        userId,
        username: userId,
        villageId: "v",
        clanId: "c",
        status: "AWAKE",
        rank: "JONIN",
        sector: 1,
        curHealth: 100,
        maxHealth: 100,
        curStamina: 100,
        maxStamina: 100,
        curChakra: 100,
        maxChakra: 100,
      })),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  const startDecidedChallenge = async () => {
    const db = await getTestDatabase();
    const started = await initiateBattle(
      { userIds: [CHALLENGER], targetIds: [LEADER], client: db, biome: "arena" },
      "CLAN_CHALLENGE",
    );
    expect(started.success).toBe(true);
    const current = (await db.query.battle.findFirst()) as CompleteBattle;
    const usersState = current.usersState.map((user: BattleUserState) => ({
      ...user,
      curHealth: user.userId === LEADER ? 0 : user.curHealth,
      usedActions:
        user.userId === CHALLENGER
          ? [{ id: "strike", type: "basic" as const }]
          : user.usedActions,
    }));
    await db.update(battle).set({ usersState }).where(eq(battle.id, current.id));
    return { db, battleId: current.id };
  };

  it("transfers leadership and records usage once when the winner settles on a poll", async () => {
    const { db, battleId } = await startDecidedChallenge();
    const combat = callerForDatabase(combatRouter, CHALLENGER, db);

    const first = await combat.getBattle({ battleId });
    expect(first.result?.didWin).toBe(1);
    await combat.getBattle({ battleId });

    const settled = await db.query.clan.findFirst({ where: eq(clan.id, "c") });
    expect(settled).toMatchObject({ leaderId: CHALLENGER, coLeader1: null });
    const usage = await db.query.dataBattleAction.findMany({
      where: eq(dataBattleAction.contentId, "strike"),
    });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ battleWon: 1, count: 1 });
  });

  it("keeps the leader when the challenger loses on a poll", async () => {
    const { db, battleId } = await startDecidedChallenge();
    const combat = callerForDatabase(combatRouter, LEADER, db);

    expect((await combat.getBattle({ battleId })).result?.didWin).toBe(0);

    const settled = await db.query.clan.findFirst({ where: eq(clan.id, "c") });
    expect(settled).toMatchObject({ leaderId: LEADER, coLeader1: CHALLENGER });
  });
});
