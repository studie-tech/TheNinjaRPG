import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  clan,
  tournament,
  tournamentMatch,
  tournamentRecord,
  userData,
  village,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { syncTournamentState, tournamentRouter } from "@/server/api/routers/tournament";
import { updateRewards } from "@/server/utils/questRewards";
import { ObjectiveReward, PostProcessedRewardSchema } from "@/validators/rewards";
import { insertClans, insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

describeWithDatabase("tournament PvP reward boost", () => {
  beforeEach(async () => {
    await resetTables(
      tournamentRecord,
      tournamentMatch,
      tournament,
      clan,
      userData,
      village,
    );
    await insertUsers([
      {
        userId: "prize-winner",
        username: "prize-winner",
        clanId: "prize-clan",
        pvpExperience: 1400,
        money: 0,
      },
      { userId: "prize-other", username: "prize-other", pvpExperience: 600 },
    ]);
    await insertClans([
      {
        id: "prize-clan",
        name: "Prize clan",
        villageId: "",
        leaderId: "prize-winner",
        bank: 1000,
      },
    ]);
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("transfers the clan treasury exactly once without boosting its principal", async () => {
    const db = await getTestDatabase();
    const caller = await callerFor(tournamentRouter, "prize-winner");
    expect(
      (
        await caller.createTournament({
          id: "prize-clan",
          name: "Prize tournament",
          image: "",
          description: "Prize tournament",
          type: "CLAN",
          rewards: ObjectiveReward.parse({}),
        })
      ).success,
    ).toBe(true);
    expect(
      await db.query.clan.findFirst({ where: eq(clan.id, "prize-clan") }),
    ).toMatchObject({ bank: 0 });
    await db
      .update(tournament)
      .set({ status: "IN_PROGRESS", roundStartedAt: new Date(0) })
      .where(eq(tournament.id, "prize-clan"));
    await db.insert(tournamentMatch).values({
      id: "prize-final",
      tournamentId: "prize-clan",
      round: 1,
      match: 1,
      userId1: "prize-winner",
      winnerId: "prize-winner",
      startedAt: new Date(0),
    });
    expect((await syncTournamentState(db, "prize-clan", updateRewards)).success).toBe(
      true,
    );
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, "prize-winner") }),
    ).toMatchObject({ money: 1000 });
    expect(
      await db.query.tournamentRecord.findFirst({
        where: eq(tournamentRecord.id, "prize-clan"),
      }),
    ).toMatchObject({ winnerId: "prize-winner", rewards: { reward_money: 1000 } });
    await syncTournamentState(db, "prize-clan", updateRewards);
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, "prize-winner") }),
    ).toMatchObject({ money: 1000 });
  });

  it("keeps generated prizes eligible for the shared multiplier", async () => {
    const db = await getTestDatabase();
    const winner = (await db.query.userData.findFirst({
      where: eq(userData.userId, "prize-winner"),
    }))!;
    await updateRewards({
      client: db,
      user: winner,
      rewards: PostProcessedRewardSchema.parse({ reward_money: 1000 }),
      reason: "TOURNAMENT",
    });
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, "prize-winner") }),
    ).toMatchObject({ money: 1150 });
    expect(
      await db.query.clan.findFirst({ where: eq(clan.id, "prize-clan") }),
    ).toMatchObject({ bank: 1000 });
  });

  it("applies winner loyalty to configured prestige and tokens exactly once", async () => {
    const db = await getTestDatabase();
    await db
      .insert(village)
      .values({ id: "prize-village", name: "Prize village", kageId: "", tokens: 0 });
    await db
      .update(userData)
      .set({
        villageId: "prize-village",
        villagePrestige: 0,
        joinedVillageAt: new Date(Date.now() - 100 * 86_400_000),
      })
      .where(eq(userData.userId, "prize-winner"));
    await db.insert(tournament).values({
      id: "loyalty-prize",
      name: "Loyalty prize",
      image: "",
      description: "",
      type: "CLAN",
      status: "IN_PROGRESS",
      roundStartedAt: new Date(0),
      rewards: ObjectiveReward.parse({ reward_tokens: 1000, reward_prestige: 1000 }),
    });
    await db.insert(tournamentMatch).values({
      id: "loyalty-final",
      tournamentId: "loyalty-prize",
      round: 1,
      match: 1,
      userId1: "prize-winner",
      winnerId: "prize-winner",
      startedAt: new Date(0),
    });
    expect(
      (await syncTournamentState(db, "loyalty-prize", updateRewards)).success,
    ).toBe(true);
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, "prize-winner") }),
    ).toMatchObject({ villagePrestige: 1130 });
    expect(
      await db.query.village.findFirst({ where: eq(village.id, "prize-village") }),
    ).toMatchObject({ tokens: 1130 });
    await syncTournamentState(db, "loyalty-prize", updateRewards);
    expect(
      await db.query.village.findFirst({ where: eq(village.id, "prize-village") }),
    ).toMatchObject({ tokens: 1130 });
  });
});
