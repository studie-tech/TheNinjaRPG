import { fetchEvent, fetchEventNoticeState } from "@/queries/tournamentEvents";
import * as eventQueries from "@/queries/tournamentEvents";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import * as nextServer from "next/server";
import {
  ENERGY_PVP_WIN_REWARD,
  EVENT_TOURNAMENT_LAUNCH_RECOVERY_SECONDS,
  EVENT_TOURNAMENT_RETENTION_DAYS,
  MAP_WAKE_ISLAND_SECTOR,
  PVP_EXPERIENCE_PARTICIPATION_REWARD,
  PVP_EXPERIENCE_WIN_REWARD,
  RANKED_PVP_STATS,
  REGEN_SECONDS,
} from "@/drizzle/constants";
import {
  aiProfile,
  battle,
  battleHistory,
  questHistory,
  quest,
  tournament,
  tournamentMatch,
  tournamentRewardClaim,
  trainingLog,
  userData,
  userCookingJob,
  userQueue,
} from "@/drizzle/schema";
import { updateUser } from "@/libs/combat/database";
import { calcBattleResult } from "@/libs/combat/util";
import { getServerPusher, Pusher } from "@/libs/pusher";
import * as pusherModule from "@/libs/pusher";
import {
  beginEventRound,
  createEventState,
  generateEventBracket,
} from "@/libs/tournament/events";
import { combatRouter, initiateBattle } from "@/server/api/routers/combat";
import { profileRouter } from "@/server/api/routers/profile";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { tournamentRouter } from "@/server/api/routers/tournament";
import { maintainEventTournaments, syncEventTournament } from "@/server/api/routers/tournamentEvents";
import type { DrizzleClient } from "@/server/db";
import { eventTournamentConfigSchema, type EventParticipant } from "@/validators/tournament";
import { ObjectiveReward } from "@/validators/rewards";
import { insertUsers } from "../../../setup/factories";
import { queueEnergy } from "../../../setup/queues";
import { beforeStatements } from "../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  recordQueries,
} from "../../../setup/testDatabase";

describeWithDatabase("event tournament persistence", () => {
  beforeEach(async () => {
    // Bun retains other suites' Pusher factories; keep notification spies local to this suite.
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    vi.spyOn(pusherModule, "getServerPusher").mockReturnValue(new Pusher("", "", "", ""));
    // Rate limiting is external to settlement; SQL tests must not contact Redis.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      Response.json(
        String(url).endsWith("/pipeline")
          ? [{ result: [59, 60] }]
          : { result: [59, 60] },
      ),
    );
    await resetTables(
      tournamentRewardClaim,
      tournamentMatch,
      tournament,
      battleHistory,
      battle,
      aiProfile,
      trainingLog,
      userQueue,
      userCookingJob,
      questHistory,
      quest,
      userData,
    );
  });
  afterEach(() => vi.restoreAllMocks());


  it("loads an idle authorized event only once and keeps draft authorization", async () => {
    await insertUsers([{ userId: "reader" }, { userId: "staff", role: "CODER" }]);
    const staff = await callerFor(tournamentRouter, "staff");
    const reader = await callerFor(tournamentRouter, "reader");
    const created = await staff.saveEvent({ config: eventConfig("Idle event") });
    if (!("tournamentId" in created)) throw new Error(created.message);
    const { tournamentId } = created;
    expect(await reader.getEvent({ tournamentId })).toBeNull();
    for (const status of ["DRAFT", "REGISTRATION"] as const) {
      if (status === "REGISTRATION") await staff.manageEvent({ tournamentId, action: "PUBLISH" });
      const measured = await recordQueries(() => staff.getEvent({ tournamentId }));
      expect(measured.result?.eventData?.status).toBe(status);
      expect(measured.statements.filter((statement) => /from .Tournament./i.test(statement))).toHaveLength(1);
    }
  });

  it("preserves a published event when optional actor confirmation fails", async () => {
    const db = await getTestDatabase();
    await insertUsers([{ userId: "staff", role: "CODER" }]);
    const staff = await callerFor(tournamentRouter, "staff");
    const created = await staff.saveEvent({ config: eventConfig("Publish confirmation") });
    if (!("tournamentId" in created)) throw new Error(created.message);
    const original = eventQueries.findEventActorCacheState;
    vi.spyOn(eventQueries, "findEventActorCacheState")
      .mockImplementationOnce(original)
      .mockRejectedValueOnce(new Error("Event confirmation unavailable"));
    const result = await staff.manageEvent({ tournamentId: created.tournamentId, action: "PUBLISH" });
    expect(result.success).toBe(true);
    expect(result.userPatch).toBeUndefined();
    expect(result.eventNotices).toBeUndefined();
    expect(await db.query.tournament.findFirst()).toMatchObject({ eventData: { status: "REGISTRATION" } });
  });

  it.each([false, true])("refreshes an expired event after its synchronization claim (competing: %s)", async (competing) => {
    const db = await getTestDatabase();
    await insertUsers([{ userId: "reader" }]);
    const state = createEventState(eventConfig("Expired event"));
    state.status = "REGISTRATION";
    state.config.endsAt = Date.now() - 1000;
    await db.insert(tournament).values({ id: "expiring", name: "Expired", image: "", description: "", type: "EVENT", rewards: ObjectiveReward.parse({}), eventData: state });
    const client = competing ? beforeStatements(db, tournament, [async () => {
      await db.update(tournament).set({ version: 1, eventData: { ...state, status: "CANCELLED", config: { ...state.config, name: "Concurrent cancellation" } } }).where(eq(tournament.id, "expiring"));
    }]) : db;
    const reader = callerForDatabase(tournamentRouter, "reader", client);
    const measured = await recordQueries(() => reader.getEvent({ tournamentId: "expiring" }));
    expect(measured.result?.eventData?.status).toBe("CANCELLED");
    expect(measured.result?.eventData?.config.name).toBe(competing ? "Concurrent cancellation" : "Expired event");
    expect(measured.statements.filter((statement) => /from .Tournament./i.test(statement))).toHaveLength(2);
  });

  it("tracks invitation responses and advisory readiness separately from match acceptance", async () => {
    const database = await getTestDatabase();
    await insertUsers(["staff", "first", "second", "outsider", "replacement"].map((userId) => ({
      userId, role: userId === "staff" ? "CODER" : "USER", status: "AWAKE", sector: MAP_WAKE_ISLAND_SECTOR,
    })));
    const staff = await callerFor(tournamentRouter, "staff");
    const first = await callerFor(tournamentRouter, "first");
    const second = await callerFor(tournamentRouter, "second");
    const outsider = await callerFor(tournamentRouter, "outsider");
    const created = await staff.saveEvent({ config: { ...eventConfig("Ready roster"), registration: "INVITE_ONLY" } });
    if (!("tournamentId" in created)) throw new Error(created.message);
    const { tournamentId } = created;
    await staff.manageEvent({ tournamentId, action: "PUBLISH" });
    for (const userId of ["first", "second"]) await staff.manageEvent({ tournamentId, action: "INVITE", userId, originSocketId: "1.1" });
    expect(Pusher.prototype.trigger).toHaveBeenCalledWith("first", "event", { type: "eventTournament" });
    expect((await first.getEventNotices())[0]?.message).toBe("You have a tournament invitation");
    vi.spyOn(Pusher.prototype, "trigger").mockClear();
    expect(await first.participateEvent({ tournamentId, action: "JOIN" })).toMatchObject({ success: true,
      userPatch: { status: "AWAKE", battleId: null }, eventNotices: [], isEventParticipant: true });
    expect(Pusher.prototype.trigger).toHaveBeenCalledWith("first", "event", { type: "eventTournament" });
    expect(await first.getEventNotices()).toEqual([]);
    expect((await second.getEventNotices())[0]?.message).toBe("You have a tournament invitation");
    await second.participateEvent({ tournamentId, action: "JOIN" });
    await staff.manageEvent({ tournamentId, action: "SEED" });
    const seriesId = (await fetchEvent(database, tournamentId))!.eventData!.series[0]!.id;
    expect((await outsider.participateEvent({ tournamentId, seriesId, action: "READY" })).success).toBe(false);
    expect((await first.participateEvent({ tournamentId, seriesId: "other", action: "READY" })).success).toBe(false);
    await database.update(userData).set({ status: "ASLEEP" }).where(eq(userData.userId, "first"));
    expect((await first.participateEvent({ tournamentId, seriesId, action: "READY" })).success).toBe(false);
    await database.update(userData).set({ status: "AWAKE" }).where(eq(userData.userId, "first"));
    const marked = await Promise.all([first, second].map((player) => player.participateEvent({ tournamentId, seriesId, action: "READY" })));
    expect(marked.every((result) => result.success)).toBe(true);
    let event = (await fetchEvent(database, tournamentId))!.eventData!;
    expect(event.status).toBe("PREPARED");
    expect(event.series[0]!.readyUserIds?.sort()).toEqual(["first", "second"]);
    expect(event.series[0]!.games).toEqual([]);
    await first.participateEvent({ tournamentId, seriesId, action: "NOT_READY" });
    expect((await fetchEvent(database, tournamentId))!.eventData!.series[0]!.readyUserIds).toEqual(["second"]);
    const seatId = event.participants.find((p) => p.userId === "second")!.id;
    expect((await staff.manageEvent({ tournamentId, action: "SUBSTITUTE", seatId, userId: "replacement", originSocketId: "1.1" })).success).toBe(true);
    expect(Pusher.prototype.trigger).toHaveBeenCalledWith("replacement", "event", { type: "eventTournament" });
    event = (await fetchEvent(database, tournamentId))!.eventData!;
    expect(event.series[0]!.readyUserIds).toEqual([]);
    expect((await staff.manageEvent({ tournamentId, action: "BEGIN" })).success).toBe(true);
    event = (await fetchEvent(database, tournamentId))!.eventData!;
    expect(event.series[0]!.games[0]!.accepted).toEqual([]);
    expect((await first.getEventNotices())[0]?.message).toBe("Your tournament match is ready");
    expect((await first.participateEvent({ tournamentId, seriesId, action: "READY" })).success).toBe(false);
    expect((await first.participateEvent({ tournamentId, seriesId, action: "ACCEPT" })).success).toBe(true);
    expect(await first.getEventNotices()).toEqual([]);
  });

  it.each(["JOIN", "WITHDRAW", "DECLINE"] as const)("identifies the originating socket for %s without suppressing other tabs", async (action) => {
    await insertUsers(["staff", "player"].map((userId) => ({
      userId, role: userId === "staff" ? "CODER" : "USER", status: "AWAKE", sector: MAP_WAKE_ISLAND_SECTOR,
    })));
    const staff = await callerFor(tournamentRouter, "staff");
    const player = await callerFor(tournamentRouter, "player");
    const created = await staff.saveEvent({ config: eventConfig("Socket roster") });
    if (!("tournamentId" in created)) throw new Error(created.message);
    const { tournamentId } = created;
    await staff.manageEvent({ tournamentId, action: "PUBLISH" });
    if (action === "WITHDRAW") await player.participateEvent({ tournamentId, action: "JOIN" });
    if (action === "DECLINE") await staff.manageEvent({ tournamentId, action: "INVITE", userId: "player" });
    vi.spyOn(Pusher.prototype, "trigger").mockClear();
    expect((await player.participateEvent({ tournamentId, action, originSocketId: "2.1" })).success).toBe(true);
    expect(Pusher.prototype.trigger).toHaveBeenCalledWith("player", "event", { type: "eventTournament", originSocketId: "2.1" });
    expect(Pusher.prototype.trigger).toHaveBeenCalledTimes(1);
  });

  it("identifies the actor's socket when staff invite themselves", async () => {
    await insertUsers([{ userId: "staff", role: "CODER", status: "AWAKE", sector: MAP_WAKE_ISLAND_SECTOR }]);
    const staff = await callerFor(tournamentRouter, "staff");
    const created = await staff.saveEvent({ config: eventConfig("Staff invitation") });
    if (!("tournamentId" in created)) throw new Error(created.message);
    const { tournamentId } = created;
    await staff.manageEvent({ tournamentId, action: "PUBLISH" });
    vi.spyOn(Pusher.prototype, "trigger").mockClear();
    expect((await staff.manageEvent({ tournamentId, action: "INVITE", userId: "staff", originSocketId: "3.1" })).success).toBe(true);
    expect(Pusher.prototype.trigger).toHaveBeenCalledWith("staff", "event", { type: "eventTournament", originSocketId: "3.1" });
  });

  it("returns invitations and ready matches after unrelated active events fill the notice limit", async () => {
    const database = await getTestDatabase();
    /** Build pending or confirmed seats with the same neutral eligibility snapshot. */
    const participant = (userId: string, accepted: boolean): EventParticipant => ({
      id: `seat-${userId}`, userId, username: userId, accepted,
      invited: true, withdrawn: false, seed: 0,
      snapshot: { bracket: 0, pvpWins: 0, winRate: 0, masteredJutsu: 0 },
      previousUsers: [],
    });
    const invitation = createEventState({ ...eventConfig("Invitation"), registration: "INVITE_ONLY" });
    invitation.status = "REGISTRATION";
    invitation.participants = [participant("target", false)];
    const ready = createEventState(eventConfig("Ready match"));
    ready.participants = [participant("target", true), participant("opponent", true)];
    generateEventBracket(ready, ready.participants.map((seat) => seat.id));
    beginEventRound(ready, Date.now() - 1000);
    const game = ready.series[0]!.games[0]!;
    game.opensAt = Date.now() - 1000;
    game.deadline = Date.now() + 3600_000;
    const base = { image: "", description: "", type: "EVENT" as const, rewards: ObjectiveReward.parse({}) };
    await database.insert(tournament).values([
      { ...base, id: "900-invite", name: "Invitation", status: "OPEN", eventData: invitation },
      { ...base, id: "901-ready", name: "Ready match", status: "IN_PROGRESS", eventData: ready },
      { ...base, id: "902-withdrawn", name: "Withdrawn", status: "OPEN", eventData: {
        ...invitation, participants: [{ ...participant("target", false), withdrawn: true }],
      } },
    ]);
    const expected = [
      { tournamentId: "900-invite", message: "You have a tournament invitation" },
      { tournamentId: "901-ready", message: "Your tournament match is ready" },
    ];
    /** Compare actionable notices independently of their generated timestamps. */
    const notices = async () => (await fetchEventNoticeState(database, "target")).notices
      .map(({ tournamentId, message }) => ({ tournamentId, message }))
      .sort((a, b) => a.tournamentId.localeCompare(b.tournamentId));
    expect(await notices()).toEqual(expected);
    await database.insert(tournament).values(Array.from({ length: 100 }, (_, index) => ({
      ...base, id: `000-${String(index).padStart(3, "0")}`, name: `Unrelated ${index}`,
      status: "OPEN" as const, eventData: {
        ...invitation, participants: [participant(`other-${index}`, false)],
      },
    })));
    expect(await notices()).toEqual(expected);
    expect(await fetchEventNoticeState(database, "unregistered")).toEqual({ notices: [], isEventParticipant: false });
  });

  for (const [battleType, isEvent] of [
    ["SPARRING", true],
    ["RANKED_SPARRING", true],
    ["SPARRING", false],
    ["TOURNAMENT", false],
  ] as const) {
    for (const reversed of [false, true]) {
      it(`counts only ordinary ${battleType} history toward later PvP rewards (event=${isEvent}, reversed=${reversed})`, async () => {
        const database = await getTestDatabase();
        await insertUsers(
          ["hero", "foe"].map((userId) => ({
            userId,
            username: userId,
            villageId: `village-${userId}`,
            status: "AWAKE",
            rank: "JONIN",
            experience: 500000,
            level: 50,
            isOutlaw: true,
            sector: MAP_WAKE_ISLAND_SECTOR,
            curHealth: 1000,
            curChakra: 1000,
            curStamina: 1000,
            maxHealth: 1000,
            maxChakra: 1000,
            maxStamina: 1000,
          })),
        );
        await database
          .insert(aiProfile)
          .values({ id: "Default", userId: "ai", rules: [] });
        if (isEvent || battleType === "TOURNAMENT") {
          await database.insert(tournament).values({
            id: "prior-tournament",
            name: "Prior tournament",
            description: "",
            image: "",
            type: isEvent ? "EVENT" : "CLAN",
            rewards: ObjectiveReward.parse({}),
          });
          await database.insert(tournamentMatch).values({
            id: "prior-game",
            tournamentId: "prior-tournament",
            round: 1,
            match: 1,
            userId1: "hero",
            userId2: "foe",
            battleId: "prior-battle",
            startedAt: new Date(),
          });
        }
        const distribution =
          battleType === "RANKED_SPARRING" ? RANKED_PVP_STATS : undefined;
        const prior = await initiateBattle(
          {
            client: database,
            userIds: ["hero"],
            targetIds: ["foe"],
            tournamentGame: isEvent
              ? { id: "prior-game", battleId: "prior-battle", aiOnly: false }
              : undefined,
            userStatDistribution: distribution,
            targetStatDistribution: distribution,
          },
          battleType,
          isEvent ? 0 : 1,
        );
        expect(prior.success, prior.message).toBe(true);
        if (battleType === "TOURNAMENT")
          await database
            .update(tournamentMatch)
            .set({ battleId: prior.battleId })
            .where(eq(tournamentMatch.id, "prior-game"));
        const history = (await database.query.battleHistory.findFirst())!;
        expect(history).toMatchObject({
          attackedId: "hero",
          defenderId: "foe",
          battleType,
        });
        if (isEvent) {
          const exhibition = (await database.query.battle.findFirst())!;
          exhibition.usersState.find((u) => u.userId === "foe")!.curHealth = 0;
          for (const userId of ["hero", "foe"])
            await updateUser(
              database,
              getServerPusher(),
              exhibition,
              calcBattleResult(exhibition, userId, []),
              userId,
            );
        }
        // Expired battle snapshots must not be needed to identify exhibition history.
        await database.delete(battle);
        await database
          .update(userData)
          .set({ status: "AWAKE", battleId: null, sector: 0 });

        const winnerId = reversed ? "foe" : "hero";
        const loserId = reversed ? "hero" : "foe";
        const started = await initiateBattle(
          {
            client: database,
            userIds: [winnerId],
            targetIds: [loserId],
            sector: 0,
          },
          "COMBAT",
        );
        expect(started.success, started.message).toBe(true);
        const ordinary = (await database.query.battle.findFirst())!;
        expect(ordinary.rewardScaling).toBe(isEvent ? 1 : 0.5);
        expect(ordinary.extraState.energyRewardEligible).toBe(isEvent);
        ordinary.usersState.find((u) => u.userId === loserId)!.curHealth = 0;
        const result = calcBattleResult(ordinary, winnerId, []);
        await updateUser(database, getServerPusher(), ordinary, result, winnerId);
        expect(result?.pvpExperience).toBe(
          (PVP_EXPERIENCE_PARTICIPATION_REWARD + PVP_EXPERIENCE_WIN_REWARD) *
            (isEvent ? 1 : 0.5),
        );
        expect(result?.energyReward).toBe(isEvent ? ENERGY_PVP_WIN_REWARD : 0);
        expect(await database.query.battleHistory.findMany()).toHaveLength(2);
      });
    }
  }

  for (const battleType of ["SPARRING", "RANKED_SPARRING"] as const) {
    for (const queued of [false, true]) {
      it(`preserves real entry recovery through ${battleType} settlement (queued=${queued})`, async () => {
        const database = await getTestDatabase();
        const regenAt = new Date(Date.now() - 10 * REGEN_SECONDS * 1000 - 1000);
        const exposureEndsAt = new Date(Date.now() + 120_000);
        await insertUsers(
          ["hero", "foe"].map((userId) => ({
            userId,
            status: "AWAKE",
            rank: "JONIN",
            level: 50,
            isOutlaw: true,
            sector: MAP_WAKE_ISLAND_SECTOR,
            regeneration: 10,
            regenAt,
            curHealth: 100,
            curChakra: 100,
            curStamina: 100,
            maxHealth: 1000,
            maxChakra: 1000,
            maxStamina: 1000,
            curEnergy: 100,
            bracketImmunityLiftedUntil: exposureEndsAt,
          })),
        );
        if (queued) await queueEnergy("hero", [{ stat: "strength", energy: 50 }]);
        await database
          .insert(aiProfile)
          .values({ id: "Default", userId: "ai", rules: [] });
        await database.insert(tournamentMatch).values({
          id: "game",
          tournamentId: "event",
          round: 1,
          match: 1,
          userId1: "hero",
          userId2: "foe",
          battleId: "exhibition",
          startedAt: new Date(),
        });
        const distribution =
          battleType === "RANKED_SPARRING" ? RANKED_PVP_STATS : undefined;
        const started = await initiateBattle(
          {
            client: database,
            userIds: ["hero"],
            targetIds: ["foe"],
            tournamentGame: { id: "game", battleId: "exhibition", aiOnly: false },
            userStatDistribution: distribution,
            targetStatDistribution: distribution,
          },
          battleType,
        );
        expect(started.success, started.message).toBe(true);
        const entry = (await database.query.userData.findFirst({
          where: eq(userData.userId, "hero"),
        }))!;
        expect([entry.curHealth, entry.curChakra, entry.curStamina]).toEqual([
          200, 200, 200,
        ]);
        expect(entry.regenAt.getTime()).toBe(
          regenAt.getTime() + 10 * REGEN_SECONDS * 1000,
        );
        expect(entry.curEnergy).toBe(queued ? 150 : 200);
        expect(entry.bracketImmunityPausedAt).not.toBeNull();
        expect(entry.bracketImmunityLiftedUntil).toEqual(exposureEndsAt);
        await database
          .update(userData)
          .set({
            bracketImmunityPausedAt: new Date(
              entry.bracketImmunityPausedAt!.getTime() - 600_000,
            ),
            bracketImmunityLiftedUntil: new Date(exposureEndsAt.getTime() - 600_000),
          })
          .where(eq(userData.userId, "hero"));
        const snapshot = (await database.query.battle.findFirst({
          where: eq(battle.id, "exhibition"),
        }))!;
        if (battleType === "RANKED_SPARRING")
          expect(
            snapshot.usersState.find((u) => u.userId === "hero")!.curHealth,
          ).toBeGreaterThan(200);
        snapshot.usersState.find((u) => u.userId === "hero")!.curHealth = 1;
        snapshot.usersState.find((u) => u.userId === "hero")!.curChakra = 1;
        snapshot.usersState.find((u) => u.userId === "hero")!.curStamina = 1;
        snapshot.usersState.find((u) => u.userId === "foe")!.curHealth = 0;
        const result = calcBattleResult(snapshot, "hero", []);
        expect(result).not.toBeNull();
        await updateUser(database, getServerPusher(), snapshot, result, "hero");
        const settled = (await database.query.userData.findFirst({
          where: eq(userData.userId, "hero"),
        }))!;
        expect(settled.status).toBe("AWAKE");
        expect(settled.battleId).toBeNull();
        expect(settled.bracketImmunityPausedAt).toBeNull();
        expect(settled.bracketImmunityLiftedUntil.getTime()).toBeGreaterThanOrEqual(
          exposureEndsAt.getTime(),
        );
        expect([settled.curHealth, settled.curChakra, settled.curStamina]).toEqual([
          200, 200, 200,
        ]);
        expect(settled.curEnergy).toBeGreaterThanOrEqual(entry.curEnergy);
        expect(settled.curEnergy).toBeLessThan(entry.curEnergy + 10);
      });
    }
  }

  const eventConfig = (id: string) =>
    eventTournamentConfigSchema.parse({
      name: id,
      description: "Wake Island event",
      registration: "OPEN",
      format: "SINGLE_ELIMINATION",
      seeding: "RANDOM",
      rules: "OPEN",
      scheduling: "SIMULTANEOUS",
      capacity: 8,
      bestOf: 1,
      roundBestOf: [],
      minBracket: 0,
      maxBracket: 7,
      minPvpWins: 0,
      minWinRate: 0,
      minMasteredJutsu: 0,
      registrationClosesAt: Date.now() + 3600_000,
      endsAt: Date.now() + 86400_000,
      rewards: {
        winner: {},
        runnerUp: {},
        semifinalist: {},
        participation: { reward_money: 10 },
        perWin: {},
      },
    });

  const readyEvent = async () => {
    const database = await getTestDatabase();
    await insertUsers(
      ["hero", "foe"].map((userId) => ({
        userId,
        username: userId,
        status: "AWAKE",
        rank: "JONIN",
        level: 50,
        isOutlaw: true,
        sector: MAP_WAKE_ISLAND_SECTOR,
        regeneration: 10,
        regenAt: new Date(Date.now() - 10 * REGEN_SECONDS * 1000 - 1000),
        curHealth: 100,
        curChakra: 100,
        curStamina: 100,
        maxHealth: 1000,
        maxChakra: 1000,
        maxStamina: 1000,
        curEnergy: 100,
      })),
    );
    await database.insert(aiProfile).values({ id: "Default", userId: "ai", rules: [] });
    const event = createEventState(eventConfig("Launch race"));
    event.participants = ["hero", "foe"].map((userId, i) => ({
      id: `seat-${i}`,
      userId,
      username: userId,
      invited: false,
      accepted: true,
      withdrawn: false,
      seed: 0,
      snapshot: { bracket: 1, pvpWins: 0, winRate: 0, masteredJutsu: 0 },
      previousUsers: [],
    }));
    generateEventBracket(
      event,
      event.participants.map((p) => p.id),
    );
    beginEventRound(event, Date.now());
    const series = event.series[0]!;
    const game = series.games[0]!;
    game.accepted = [game.userIds[0]!];
    await database.insert(tournament).values({
      id: "launch",
      name: "Launch race",
      description: "Wake Island event",
      image: "",
      type: "EVENT",
      status: "IN_PROGRESS",
      eventData: event,
      rewards: ObjectiveReward.parse({}),
    });
    const accept = (userId: string, client = database) =>
      tournamentRouter
        .createCaller({ drizzle: client, userId } as never)
        .participateEvent({
          tournamentId: "launch",
          action: "ACCEPT",
          seriesId: series.id,
        });
    return { database, game, accept };
  };

  it.each([false, true])("reconciles the accepting actor's Cooking when a match launches (receipt: %s)", async (hasCooking) => {
    const { database, game, accept } = await readyEvent();
    const userId = game.userIds[1]!;
    if (hasCooking) await database.insert(userCookingJob).values({ id: "event-cooking", userId, experience: 99, finishesAt: new Date(Date.now() + 3600_000) });
    const profile = await callerFor(profileRouter, userId);
    const initial = await profile.getUser();
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["event-admission-profile"];
    const read = vi.fn(() => profile.getUser());
    cache.setQueryDefaults(key, { queryFn: read });
    cache.setQueryData(key, initial);
    const observer = new QueryObserver(cache, { queryKey: key, queryFn: read, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => {});
    const revision = prepareUserUpdate(cache, key);
    try {
      if (hasCooking) await database.update(userCookingJob).set({ finishesAt: new Date(0) });
      const response = await accept(userId);
      expect(response.success).toBe(true);
      await updateUserCache(cache, key, response.userPatch, { revision, isEventParticipant: response.isEventParticipant });
      const saved = await database.query.userData.findFirst({ where: eq(userData.userId, userId) });
      const cached = cache.getQueryData<typeof initial>(key)!.userData;
      expect(saved?.cookingExperience).toBe(hasCooking ? 99 : 0);
      expect(cached?.cookingExperience).toBe(saved?.cookingExperience);
      expect(cached?.cookingJobs).toHaveLength(0);
      expect(cached?.status).toBe("BATTLE");
      expect(cached?.battleId).toBe(saved?.battleId);
      expect(read).toHaveBeenCalledTimes(hasCooking ? 1 : 0);
      if (hasCooking) expect(response.userPatch).toBeUndefined();
      else expect(response.userPatch).toHaveProperty("status", "BATTLE");
    } finally { unsubscribe(); cache.clear(); }
  });
  it("blocks open-world attacks on registered entrants until they withdraw", async () => {
    const database = await getTestDatabase();
    await insertUsers(
      ["hero", "foe"].map((userId) => ({
        userId,
        username: userId,
        status: "AWAKE",
        rank: "JONIN",
        level: 50,
        isOutlaw: true,
        sector: MAP_WAKE_ISLAND_SECTOR,
        curHealth: 1000,
        curChakra: 1000,
        curStamina: 1000,
        maxHealth: 1000,
        maxChakra: 1000,
        maxStamina: 1000,
      })),
    );
    await database.insert(aiProfile).values({ id: "Default", userId: "ai", rules: [] });
    const event = createEventState(eventConfig("Queue guard"));
    event.status = "REGISTRATION";
    event.participants = [
      {
        id: "seat-foe",
        userId: "foe",
        username: "foe",
        invited: false,
        accepted: true,
        withdrawn: false,
        seed: 0,
        snapshot: { bracket: 1, pvpWins: 0, winRate: 0, masteredJutsu: 0 },
        previousUsers: [],
      },
    ];
    await database.insert(tournament).values({
      id: "queue-guard",
      name: "Queue guard",
      description: "Wake Island event",
      image: "",
      type: "EVENT",
      eventData: event,
      rewards: ObjectiveReward.parse({}),
    });
    const attack = () =>
      initiateBattle(
        {
          client: database,
          userIds: ["hero"],
          targetIds: ["foe"],
          sector: MAP_WAKE_ISLAND_SECTOR,
        },
        "COMBAT",
      );
    const blocked = await attack();
    expect(blocked.success).toBe(false);
    expect(blocked.message).toContain("registered for an ongoing tournament");
    expect(await database.query.battle.findFirst()).toBeUndefined();
    event.participants[0]!.withdrawn = true;
    await database
      .update(tournament)
      .set({ eventData: event })
      .where(eq(tournament.id, "queue-guard"));
    const allowed = await attack();
    expect(allowed.success, allowed.message).toBe(true);
  });

  it("recovers a crash after STARTING commits but before the launch token exists", async () => {
    const { database, game, accept } = await readyEvent();
    await expect(
      accept(
        game.userIds[1]!,
        beforeStatements(database, tournamentMatch, [
          async () => {
            throw new Error("Launch token write failed");
          },
        ]),
      ),
    ).rejects.toThrow("Launch token write failed");
    expect(
      (await fetchEvent(database, "launch"))!.eventData!.series[0]!.games[0],
    ).toMatchObject({ id: game.id, status: "STARTING" });
    expect(await database.query.tournamentMatch.findMany()).toHaveLength(0);
    vi.spyOn(Date, "now").mockReturnValue(
      game.deadline + (EVENT_TOURNAMENT_LAUNCH_RECOVERY_SECONDS + 1) * 1000,
    );
    await syncEventTournament(database, "launch");
    const recovered = (await fetchEvent(database, "launch"))!.eventData!;
    expect(recovered.series[0]!.games).toHaveLength(2);
    expect(recovered.series[0]!.games[0]).toMatchObject({
      id: game.id,
      status: "COMPLETE",
      outcome: "DRAW",
    });
    expect(recovered.series[0]!.games[1]!.status).toBe("READY");
    expect(await database.query.tournamentMatch.findMany()).toMatchObject([
      { id: game.id, state: "NO_SHOW" },
    ]);
    expect(await database.query.battle.findMany()).toHaveLength(0);
    expect(await database.query.battleHistory.findMany()).toHaveLength(0);
  });

  it("leaves recovery in control when a delayed launch collides with its missing-token tombstone", async () => {
    const { database, game, accept } = await readyEvent();
    const inserting = deferred();
    const releaseLaunch = deferred();
    const savingRecovery = deferred();
    const releaseRecovery = deferred();
    const launching = accept(
      game.userIds[1]!,
      beforeStatements(database, tournamentMatch, [
        async () => {
          inserting.resolve();
          await releaseLaunch.promise;
        },
      ]),
    );
    let recovering: Promise<boolean> | undefined;
    try {
      await inserting.promise;
      expect(await database.query.tournamentMatch.findMany()).toHaveLength(0);
      vi.spyOn(Date, "now").mockReturnValue(
        game.deadline + (EVENT_TOURNAMENT_LAUNCH_RECOVERY_SECONDS + 1) * 1000,
      );
      recovering = syncEventTournament(
        beforeStatements(database, tournament, [
          async () => {
            savingRecovery.resolve();
            await releaseRecovery.promise;
          },
        ]),
        "launch",
      );
      await savingRecovery.promise;
      expect((await database.query.tournamentMatch.findFirst())?.state).toBe("NO_SHOW");
      releaseLaunch.resolve();
      expect((await launching).success).toBe(true);
      // The duplicate insert must return without a setup failure winning the event CAS.
      const pending = (await fetchEvent(database, "launch"))!.eventData!.series[0]!;
      expect(pending.games).toHaveLength(1);
      expect(pending.games[0]!.status).toBe("STARTING");
      releaseRecovery.resolve();
      await recovering;
      const recovered = (await fetchEvent(database, "launch"))!.eventData!.series[0]!;
      expect(recovered.begun).toBe(true);
      expect(recovered.games).toHaveLength(2);
      expect(recovered.games[0]!.outcome).toBe("DRAW");
      expect(recovered.games[1]!.status).toBe("READY");
      expect(await database.query.battle.findMany()).toHaveLength(0);
      expect(await database.query.battleHistory.findMany()).toHaveLength(0);
      expect(await database.query.userData.findMany()).toMatchObject([
        { status: "AWAKE", battleId: null },
        { status: "AWAKE", battleId: null },
      ]);
    } finally {
      releaseLaunch.resolve();
      releaseRecovery.resolve();
      await Promise.allSettled([launching, recovering]);
    }
  });

  it("keeps a valid battle when launch wins after recovery reads a missing token and battle", async () => {
    const { database, game, accept } = await readyEvent();
    const inserting = deferred();
    const releaseLaunch = deferred();
    const committedBattle = deferred();
    const releaseFighting = deferred();
    const insertingRecovery = deferred();
    const releaseRecovery = deferred();
    const launching = accept(
      game.userIds[1]!,
      beforeStatements(
        beforeStatements(database, tournament, [
          async () => {},
          async () => {},
          async () => {
            committedBattle.resolve();
            await releaseFighting.promise;
          },
        ]),
        tournamentMatch,
        [
          async () => {
            inserting.resolve();
            await releaseLaunch.promise;
          },
        ],
      ),
    );
    let recovering: Promise<boolean> | undefined;
    try {
      await inserting.promise;
      vi.spyOn(Date, "now").mockReturnValue(
        game.deadline + (EVENT_TOURNAMENT_LAUNCH_RECOVERY_SECONDS + 1) * 1000,
      );
      recovering = syncEventTournament(
        beforeStatements(database, tournamentMatch, [
          async () => {
            insertingRecovery.resolve();
            await releaseRecovery.promise;
          },
        ]),
        "launch",
      );
      await insertingRecovery.promise;
      releaseLaunch.resolve();
      await committedBattle.promise;
      expect(await database.query.battle.findMany()).toMatchObject([
        { id: game.battleId },
      ]);
      releaseRecovery.resolve();
      await recovering;
      // The no-op duplicate insert can report one affected row for this WAITING token.
      // Recovery must reread it and let NOT EXISTS Battle arbitrate before drawing.
      const pending = (await fetchEvent(database, "launch"))!.eventData!.series[0]!;
      expect(pending.games).toHaveLength(1);
      expect(pending.games[0]!.status).toBe("STARTING");
      expect((await database.query.tournamentMatch.findFirst())?.state).toBe("WAITING");
      releaseFighting.resolve();
      expect((await launching).success).toBe(true);
      const fighting = (await fetchEvent(database, "launch"))!.eventData!.series[0]!;
      expect(fighting.games).toHaveLength(1);
      expect(fighting.games[0]!.status).toBe("FIGHTING");
      expect(await database.query.battleHistory.findMany()).toHaveLength(1);
      expect(await database.query.userData.findMany()).toMatchObject([
        { status: "BATTLE", battleId: game.battleId },
        { status: "BATTLE", battleId: game.battleId },
      ]);
    } finally {
      releaseLaunch.resolve();
      releaseRecovery.resolve();
      releaseFighting.resolve();
      await Promise.allSettled([launching, recovering]);
    }
  });

  it("claims one token and battle for concurrent ready acceptance", async () => {
    const { database, game, accept } = await readyEvent();
    await Promise.all([accept(game.userIds[1]!), accept(game.userIds[1]!)]);
    expect(await database.query.tournamentMatch.findMany()).toMatchObject([
      { id: game.id, state: "WAITING", battleId: game.battleId },
    ]);
    expect(await database.query.battle.findMany()).toMatchObject([
      { id: game.battleId },
    ]);
    expect(await database.query.battleHistory.findMany()).toHaveLength(1);
    const series = (await fetchEvent(database, "launch"))!.eventData!.series[0]!;
    expect(series.games).toHaveLength(1);
    expect(series.games[0]!.status).toBe("FIGHTING");
  });

  it("retains a READY game ID during substitution and launches only its replacement roster", async () => {
    const { database, game, accept } = await readyEvent();
    await insertUsers([
      { userId: "staff", role: "CODER" },
      {
        userId: "replacement",
        username: "replacement",
        status: "AWAKE",
        rank: "JONIN",
        level: 50,
        sector: MAP_WAKE_ISLAND_SECTOR,
      },
    ]);
    const before = (await fetchEvent(database, "launch"))!.eventData!;
    const original = game.userIds[0]!;
    const seat = before.participants.find((p) => p.userId === original)!;
    const result = await callerForDatabase(
      tournamentRouter,
      "staff",
      database,
    ).manageEvent({
      tournamentId: "launch",
      action: "SUBSTITUTE",
      seatId: seat.id,
      userId: "replacement",
    });
    expect(result.success).toBe(true);
    const substituted = (await fetchEvent(database, "launch"))!.eventData!;
    const ready = substituted.series[0]!.games[0]!;
    expect(ready).toMatchObject({ id: game.id, status: "READY", accepted: [] });
    expect(ready.userIds).toEqual(["replacement", game.userIds[1]!]);
    expect(await database.query.tournamentMatch.findMany()).toHaveLength(0);
    expect((await accept(original)).success).toBe(false);
    for (const userId of ready.userIds)
      expect((await accept(userId)).success).toBe(true);
    expect(await database.query.tournamentMatch.findMany()).toMatchObject([
      { id: game.id, userId1: "replacement", userId2: game.userIds[1]! },
    ]);
    const started = (await database.query.battle.findFirst())!;
    expect(started.usersState.map((u) => u.userId).sort()).toEqual(
      [...ready.userIds].sort(),
    );
    expect(
      await database.query.userData.findFirst({ where: eq(userData.userId, original) }),
    ).toMatchObject({ status: "AWAKE", battleId: null });
  });

  it("recovers a stalled launch without exposing claims or allowing its late battle", async () => {
    const { database, game, accept } = await readyEvent();
    const reached = deferred();
    const release = deferred();
    const stalled = beforeTransactionalWrite(database, battle, async () => {
      reached.resolve();
      await release.promise;
    });
    const launching = accept(game.userIds[1]!, stalled);
    try {
      await reached.promise;
      expect(await database.query.userData.findMany()).toMatchObject([
        { status: "AWAKE", battleId: null },
        { status: "AWAKE", battleId: null },
      ]);
      expect(await database.query.battle.findMany()).toHaveLength(0);
      expect(await database.query.battleHistory.findMany()).toHaveLength(0);
      const clock = vi
        .spyOn(Date, "now")
        .mockReturnValue(
          game.deadline + (EVENT_TOURNAMENT_LAUNCH_RECOVERY_SECONDS + 1) * 1000,
        );
      await syncEventTournament(database, "launch");
      const recovered = (await fetchEvent(database, "launch"))!.eventData!;
      expect(recovered.series[0]!.games).toHaveLength(2);
      expect((await database.query.tournamentMatch.findFirst())?.state).toBe("NO_SHOW");
      release.resolve();
      await launching;
      expect(await database.query.battle.findMany()).toHaveLength(0);
      expect(await database.query.battleHistory.findMany()).toHaveLength(0);
      const next = recovered.series[0]!.games.at(-1)!;
      clock.mockReturnValue(next.opensAt + 1);
      for (const userId of next.userIds)
        expect((await accept(userId)).success).toBe(true);
      expect(await database.query.battle.findMany()).toMatchObject([
        { id: next.battleId },
      ]);
      expect(await database.query.userData.findMany()).toMatchObject([
        { status: "BATTLE", battleId: next.battleId },
        { status: "BATTLE", battleId: next.battleId },
      ]);
    } finally {
      release.resolve();
      await launching;
    }
  });

  for (const route of ["getBattle", "performAction"] as const) {
    for (const beforeCommit of [true, false]) {
      it(`preserves ${route} results when recovery runs ${beforeCommit ? "before" : "after"} final settlement commits`, async () => {
        vi.spyOn(nextServer, "after").mockImplementation(() => {});
        const { database, game, accept } = await readyEvent();
        expect((await accept(game.userIds[1]!)).success).toBe(true);
        const row = (await fetchEvent(database, "launch"))!;
        row.eventData!.config.rewards.winner.reward_money = 100;
        const active = row.eventData!.series[0]!.games[0]!;
        active.deadline =
          Date.now() - (EVENT_TOURNAMENT_LAUNCH_RECOVERY_SECONDS + 1) * 1000;
        await database
          .update(tournament)
          .set({ eventData: row.eventData })
          .where(eq(tournament.id, row.id));
        const snapshot = (await database.query.battle.findFirst())!;
        snapshot.usersState.find((u) => u.userId === "foe")!.curHealth = 0;
        await database
          .update(battle)
          .set({
            usersState: snapshot.usersState,
            activeUserId: "hero",
            createdAt: new Date(Date.now() - 1000),
            roundStartAt: new Date(),
            updatedAt: new Date(Date.now() + 1000),
          })
          .where(eq(battle.id, game.battleId));
        const before = await database.query.userData.findMany();
        const firstReached = deferred();
        const secondReached = deferred();
        const release = deferred();
        // Delay the first player's ordinary result write. The last player's claim
        // must make deletion and the outcome visible together even in this gap.
        const first = callerForDatabase(
          combatRouter,
          "foe",
          beforeStatements(database, tournamentMatch, [
            async () => {
              firstReached.resolve();
              await release.promise;
            },
          ]),
        ).getBattle({ battleId: game.battleId });
        let second: Promise<unknown> | undefined;
        try {
          await firstReached.promise;
          const wait = async () => {
            secondReached.resolve();
            await release.promise;
          };
          const last = callerForDatabase(
            combatRouter,
            "hero",
            beforeCommit
              ? beforeTransactionalWrite(database, tournamentMatch, wait)
              : afterTransactionCommit(database, wait),
          );
          const current = (await database.query.battle.findFirst())!;
          second =
            route === "getBattle"
              ? last.getBattle({ battleId: game.battleId })
              : last.performAction({
                  battleId: game.battleId,
                  version: current.version,
                });
          await secondReached.promise;
          await syncEventTournament(database, "launch");
          const during = (await fetchEvent(database, "launch"))!.eventData!;
          expect(during.series[0]!.games).toHaveLength(1);
          expect(during.series[0]!.games[0]!.outcome).not.toBe("DRAW");
          release.resolve();
          const [foeResult, heroResult] = await Promise.all([first, second]);
          expect(foeResult.result?.outcome).toBe("Lost");
          expect(heroResult).toMatchObject({ result: { outcome: "Won" } });
          await Promise.all([
            syncEventTournament(database, "launch"),
            syncEventTournament(database, "launch"),
          ]);
          const finished = (await fetchEvent(database, "launch"))!;
          expect(finished.matches[0]).toMatchObject({
            state: "PLAYED",
            winnerId: "hero",
          });
          expect(finished.eventData!.status).toBe("COMPLETED");
          expect(finished.eventData!.series[0]!.games).toHaveLength(1);
          expect(finished.eventData!.series[0]!.scores).toEqual(
            game.userIds[0] === "hero" ? [1, 0] : [0, 1],
          );
          expect(await database.query.battle.findMany()).toHaveLength(0);
          for (const user of before) {
            const after = (await database.query.userData.findFirst({
              where: eq(userData.userId, user.userId),
            }))!;
            expect(after).toMatchObject({
              status: "AWAKE",
              battleId: null,
              money: user.money + 10 + (user.userId === "hero" ? 100 : 0),
              pvpWins: user.pvpWins,
              pvpLosses: user.pvpLosses,
              rankedLp: user.rankedLp,
            });
          }
          const claims = await database.query.tournamentRewardClaim.findMany();
          await syncEventTournament(database, "launch");
          expect(await database.query.tournamentRewardClaim.findMany()).toEqual(claims);
          expect(
            await callerForDatabase(combatRouter, "hero", database).getBattle({
              battleId: game.battleId,
            }),
          ).toEqual({ battle: null, result: null });
        } finally {
          release.resolve();
          await Promise.allSettled([first, second]);
        }
      }, 15000);
    }
  }

  for (const inFlight of [false, true]) {
    it(`arbitrates launch against recovery's stale missing-battle read (inFlight=${inFlight})`, async () => {
      const { database, game, accept } = await readyEvent();
      const reached = deferred();
      const release = deferred();
      const revoking = deferred();
      const releaseRecovery = deferred();
      const stalled = beforeTransactionalWrite(database, battleHistory, async () => {
        reached.resolve();
        await release.promise;
      });
      const launching = accept(game.userIds[1]!, stalled);
      let recovering: Promise<boolean> | undefined;
      try {
        await reached.promise;
        // Let independently dispatched siblings settle before checking atomic visibility.
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(await database.query.battle.findMany()).toHaveLength(0);
        expect(await database.query.userData.findMany()).toMatchObject([
          { status: "AWAKE", battleId: null },
          { status: "AWAKE", battleId: null },
        ]);
        vi.spyOn(Date, "now").mockReturnValue(
          game.deadline + (EVENT_TOURNAMENT_LAUNCH_RECOVERY_SECONDS + 1) * 1000,
        );
        recovering = syncEventTournament(
          beforeStatements(database, tournamentMatch, [
            async () => {
              revoking.resolve();
              if (!inFlight) await releaseRecovery.promise;
            },
          ]),
          "launch",
        );
        await revoking.promise;
        if (inFlight) await database.query.tournament.findFirst();
        release.resolve();
        await launching;
        releaseRecovery.resolve();
        await recovering;
        const event = (await fetchEvent(database, "launch"))!.eventData!;
        const match = (await database.query.tournamentMatch.findFirst())!;
        if (inFlight && match.state === "NO_SHOW") {
          expect(event.series[0]!.games).toHaveLength(2);
          expect(event.series[0]!.games.at(-1)?.status).toBe("READY");
          expect(await database.query.battle.findMany()).toHaveLength(0);
          expect(await database.query.battleHistory.findMany()).toHaveLength(0);
          expect(await database.query.userData.findMany()).toMatchObject([
            { status: "AWAKE", battleId: null },
            { status: "AWAKE", battleId: null },
          ]);
        } else {
          expect(event.series[0]!.games).toHaveLength(1);
          expect(event.series[0]!.games[0]?.status).toBe("FIGHTING");
          expect(match.state).toBe("WAITING");
          expect(await database.query.battle.findMany()).toMatchObject([
            { id: game.battleId },
          ]);
          expect(await database.query.battleHistory.findMany()).toHaveLength(1);
          expect(await database.query.userData.findMany()).toMatchObject([
            { status: "BATTLE", battleId: game.battleId },
            { status: "BATTLE", battleId: game.battleId },
          ]);
        }
      } finally {
        release.resolve();
        releaseRecovery.resolve();
        await Promise.all([launching, recovering]);
      }
    });
  }

  it("rolls back battle, history, recovery and training when only one participant is claimed", async () => {
    const { database, game } = await readyEvent();
    await queueEnergy("foe", [{ stat: "strength", energy: 50 }]);
    const before = (await database.query.userData.findFirst({
      where: eq(userData.userId, "foe"),
    }))!;
    await database.insert(tournamentMatch).values({
      id: game.id,
      tournamentId: "launch",
      round: 1,
      match: 1,
      userId1: game.userIds[0]!,
      userId2: game.userIds[1]!,
      battleId: game.battleId,
      startedAt: new Date(),
    });
    const raced = beforeTransactionalWrite(database, battle, async () => {
      await database
        .update(userData)
        .set({ status: "ASLEEP" })
        .where(eq(userData.userId, "hero"));
    });
    const result = await initiateBattle(
      {
        client: raced,
        userIds: [game.userIds[0]!],
        targetIds: [game.userIds[1]!],
        tournamentGame: { id: game.id, battleId: game.battleId, aiOnly: false },
      },
      "SPARRING",
    );
    expect(result.success).toBe(false);
    expect(await database.query.battle.findMany()).toHaveLength(0);
    expect(await database.query.battleHistory.findMany()).toHaveLength(0);
    expect(
      await database.query.userData.findFirst({ where: eq(userData.userId, "foe") }),
    ).toEqual(before);
    expect(await database.query.trainingLog.findMany()).toHaveLength(0);
    expect(
      (await database.query.userData.findFirst({ where: eq(userData.userId, "hero") }))
        ?.status,
    ).toBe("ASLEEP");
    await database
      .update(userData)
      .set({ status: "AWAKE" })
      .where(eq(userData.userId, "hero"));
    expect(
      (
        await initiateBattle(
          {
            client: database,
            userIds: [game.userIds[0]!],
            targetIds: [game.userIds[1]!],
            tournamentGame: { id: game.id, battleId: game.battleId, aiOnly: false },
          },
          "SPARRING",
        )
      ).success,
    ).toBe(true);
    const retried = (await database.query.userData.findFirst({
      where: eq(userData.userId, "foe"),
    }))!;
    expect(retried.energyQueueHead).toBe(1);
    expect(retried.experience).toBeGreaterThan(before.experience);
    expect(retried.curEnergy).toBe(150);
  });

  const completedEvent = (id: string) => {
    const event = createEventState(eventConfig(id));
    event.status = "COMPLETED";
    event.finishedAt = Date.now();
    event.payRewards = true;
    event.participants = ["deleted", "remaining"].map((userId, i) => ({
      id: `seat-${i}`,
      userId,
      username: userId,
      invited: false,
      accepted: true,
      withdrawn: false,
      seed: i + 1,
      snapshot: { bracket: 1, pvpWins: 0, winRate: 0, masteredJutsu: 0 },
      previousUsers: [],
    }));
    return {
      id,
      name: id,
      description: "event",
      image: "",
      type: "EVENT" as const,
      status: "COMPLETED" as const,
      rewards: ObjectiveReward.parse({}),
      eventData: event,
    };
  };

  for (const published of [false, true]) {
    it(`applies the event deadline and retention only after publication (published=${published})`, async () => {
      const database = await getTestDatabase();
      await insertUsers([{ userId: "staff", role: "CODER" }]);
      const staff = await callerFor(tournamentRouter, "staff");
      const config = eventConfig("Unseeded event");
      const created = await staff.saveEvent({ config });
      if (!("tournamentId" in created)) throw new Error(created.message);
      const { tournamentId } = created;
      if (published)
        expect(
          (await staff.manageEvent({ tournamentId, action: "PUBLISH" })).success,
        ).toBe(true);
      const clock = vi.spyOn(Date, "now").mockReturnValue(config.endsAt - 1);
      await maintainEventTournaments(database);
      expect((await fetchEvent(database, tournamentId))?.eventData?.status).toBe(
        published ? "REGISTRATION" : "DRAFT",
      );
      clock.mockReturnValue(config.endsAt);
      await maintainEventTournaments(database);
      const ended = (await fetchEvent(database, tournamentId))!;
      expect(ended.eventData?.status).toBe(published ? "CANCELLED" : "DRAFT");
      expect(ended.eventData?.finishedAt).toBe(published ? config.endsAt : null);
      expect(ended.eventData?.payRewards).toBe(false);
      expect(await database.query.tournamentRewardClaim.findMany()).toHaveLength(0);
      clock.mockReturnValue(
        config.endsAt + EVENT_TOURNAMENT_RETENTION_DAYS * 86400_000 + 1,
      );
      await maintainEventTournaments(database);
      const retained = await fetchEvent(database, tournamentId);
      if (published) expect(retained).toBeUndefined();
      else expect(retained?.eventData?.status).toBe("DRAFT");
    });
  }

  for (const expired of [false, true]) {
    it(`starts scheduled series only before the event deadline (expired=${expired})`, async () => {
      const database = await getTestDatabase();
      await insertUsers(
        ["staff", "first", "second"].map((userId) => ({
          userId,
          role: userId === "staff" ? "CODER" : "USER",
          status: "AWAKE",
          sector: MAP_WAKE_ISLAND_SECTOR,
        })),
      );
      const staff = await callerFor(tournamentRouter, "staff");
      const config = eventConfig("Scheduled series");
      config.scheduling = "SEQUENTIAL";
      const created = await staff.saveEvent({ config });
      if (!("tournamentId" in created)) throw new Error(created.message);
      const { tournamentId } = created;
      expect(
        (await staff.manageEvent({ tournamentId, action: "PUBLISH" })).success,
      ).toBe(true);
      for (const userId of ["first", "second"])
        expect(
          (
            await (await callerFor(tournamentRouter, userId)).participateEvent({
              tournamentId,
              action: "JOIN",
            })
          ).success,
        ).toBe(true);
      expect((await staff.manageEvent({ tournamentId, action: "SEED" })).success).toBe(
        true,
      );
      const seriesId = (await fetchEvent(database, tournamentId))!.eventData!
        .series[0]!.id;
      const scheduledAt = config.endsAt - 30_000;
      expect(
        (
          await staff.manageEvent({
            tournamentId,
            action: "BEGIN",
            seriesId,
            scheduledAt,
          })
        ).success,
      ).toBe(true);
      const now = expired ? config.endsAt + 1 : scheduledAt;
      vi.spyOn(Date, "now").mockReturnValue(now);
      await maintainEventTournaments(database);
      const saved = (await fetchEvent(database, tournamentId))!;
      const player = await callerFor(tournamentRouter, "first");
      const [notices, listing] = await Promise.all([
        player.getEventNotices(),
        player.listEvents(),
      ]);
      const status = expired ? "CANCELLED" : "RUNNING";
      expect(saved.eventData?.status).toBe(status);
      expect(saved.status).toBe(expired ? "COMPLETED" : "IN_PROGRESS");
      expect(saved.eventData?.finishedAt).toBe(expired ? now : null);
      expect(saved.eventData?.series[0]!.games).toHaveLength(expired ? 0 : 1);
      expect(listing[0]?.eventData?.status).toBe(status);
      if (expired) expect(notices).toEqual([]);
      else
        expect(notices).toEqual([
          {
            tournamentId,
            name: config.name,
            message: "Your tournament match is ready",
            deadline: saved.eventData!.series[0]!.games[0]!.deadline,
          },
        ]);
      expect(await database.query.tournamentRewardClaim.findMany()).toHaveLength(0);
    });
  }

  it("pays the final bye as a championship after both upper finalists no-show", async () => {
    const database = await getTestDatabase();
    const entrants = ["first", "second", "third", "fourth"];
    await insertUsers(
      ["staff", ...entrants].map((userId) => ({
        userId,
        role: userId === "staff" ? "CODER" : "USER",
        status: "AWAKE",
        sector: MAP_WAKE_ISLAND_SECTOR,
        money: 0,
      })),
    );
    const staff = await callerFor(tournamentRouter, "staff");
    const config = eventConfig("Final bye");
    config.format = "DOUBLE_ELIMINATION";
    config.rewards.participation.reward_money = 0;
    config.rewards.winner.reward_money = 100;
    config.rewards.runnerUp.reward_money = 20;
    const created = await staff.saveEvent({ config });
    if (!("tournamentId" in created)) throw new Error(created.message);
    const { tournamentId } = created;
    expect((await staff.manageEvent({ tournamentId, action: "PUBLISH" })).success).toBe(
      true,
    );
    for (const userId of entrants) {
      const player = await callerFor(tournamentRouter, userId);
      expect(
        (await player.participateEvent({ tournamentId, action: "JOIN" })).success,
      ).toBe(true);
    }
    expect((await staff.manageEvent({ tournamentId, action: "SEED" })).success).toBe(
      true,
    );
    let champion = "";
    let championSeat = "";
    for (const round of [1, 2]) {
      expect((await staff.manageEvent({ tournamentId, action: "BEGIN" })).success).toBe(
        true,
      );
      const event = (await fetchEvent(database, tournamentId))!.eventData!;
      for (const series of event.series.filter((s) => s.begun && !s.complete)) {
        if (round === 1 || series.bracket === "LOSERS") {
          const userId = series.games.at(-1)!.userIds[0]!;
          const player = await callerFor(tournamentRouter, userId);
          expect(
            (
              await player.participateEvent({
                tournamentId,
                action: "ACCEPT",
                seriesId: series.id,
              })
            ).success,
          ).toBe(true);
          if (round === 2) {
            champion = userId;
            championSeat = series.seats[0]!;
          }
        }
      }
      const accepted = (await fetchEvent(database, tournamentId))!.eventData!;
      for (const series of accepted.series.filter((s) => s.begun && !s.complete))
        series.games.at(-1)!.deadline = Date.now() - 1;
      await database
        .update(tournament)
        .set({ eventData: accepted })
        .where(eq(tournament.id, tournamentId));
      await syncEventTournament(database, tournamentId);
    }
    const finished = (await fetchEvent(database, tournamentId))!.eventData!;
    expect(finished.status).toBe("COMPLETED");
    expect(finished.standings[0]).toBe(championSeat);
    expect(finished.series.filter((s) => s.bracket === "FINAL")).toHaveLength(1);
    await syncEventTournament(database, tournamentId);
    expect(
      (
        await database.query.userData.findFirst({
          where: eq(userData.userId, champion),
        })
      )?.money,
    ).toBe(100);
    expect(await database.query.tournamentRewardClaim.findMany()).toHaveLength(4);
  });

  for (const registration of ["OPEN", "INVITE_ONLY"] as const) {
    for (const resolution of ["deadline", "withdrawal"] as const) {
      it(`keeps a rejoined ${registration} entrant's current seat through ${resolution}`, async () => {
        const database = await getTestDatabase();
        await insertUsers(
          ["staff", "returning", "opponent"].map((userId) => ({
            userId,
            role: userId === "staff" ? "CODER" : "USER",
            status: "AWAKE",
            sector: MAP_WAKE_ISLAND_SECTOR,
          })),
        );
        const staff = await callerFor(tournamentRouter, "staff");
        const returning = await callerFor(tournamentRouter, "returning");
        const opponent = await callerFor(tournamentRouter, "opponent");
        const created = await staff.saveEvent({
          config: { ...eventConfig("Rejoin"), registration },
        });
        if (!("tournamentId" in created)) throw new Error(created.message);
        const { tournamentId } = created;
        expect(
          (await staff.manageEvent({ tournamentId, action: "PUBLISH" })).success,
        ).toBe(true);
        const invite = async (userId: string) => {
          if (registration === "INVITE_ONLY")
            expect(
              (await staff.manageEvent({ tournamentId, action: "INVITE", userId }))
                .success,
            ).toBe(true);
        };
        await invite("returning");
        expect(
          (await returning.participateEvent({ tournamentId, action: "JOIN" })).success,
        ).toBe(true);
        expect(
          (await returning.participateEvent({ tournamentId, action: "WITHDRAW" }))
            .success,
        ).toBe(true);
        await invite("returning");
        expect(
          (await returning.participateEvent({ tournamentId, action: "JOIN" })).success,
        ).toBe(true);
        await invite("opponent");
        expect(
          (await opponent.participateEvent({ tournamentId, action: "JOIN" })).success,
        ).toBe(true);
        const joined = (await returning.getEvent({ tournamentId }))!;
        expect(
          joined.eventData!.participants.filter((p) => p.userId === "returning"),
        ).toHaveLength(1);
        const seat = joined.eventData!.participants.find(
          (p) => p.id === joined.participantId,
        )!;
        expect(seat.withdrawn).toBe(false);
        expect(
          (await staff.manageEvent({ tournamentId, action: "SEED" })).success,
        ).toBe(true);
        expect(
          (await staff.manageEvent({ tournamentId, action: "BEGIN" })).success,
        ).toBe(true);
        const event = (await fetchEvent(database, tournamentId))!.eventData!;
        const seriesId = event.series[0]!.id;
        if (resolution === "deadline") {
          expect(
            (
              await returning.participateEvent({
                tournamentId,
                action: "ACCEPT",
                seriesId,
              })
            ).success,
          ).toBe(true);
          const accepted = (await fetchEvent(database, tournamentId))!.eventData!;
          accepted.series[0]!.games[0]!.deadline = Date.now() - 1;
          await database
            .update(tournament)
            .set({ eventData: accepted })
            .where(eq(tournament.id, tournamentId));
          await syncEventTournament(database, tournamentId);
        } else {
          expect(
            (await opponent.participateEvent({ tournamentId, action: "WITHDRAW" }))
              .success,
          ).toBe(true);
        }
        const finished = (await fetchEvent(database, tournamentId))!.eventData!;
        expect(finished.series[0]!.games[0]!.outcome).toBe("NO_SHOW");
        expect(finished.series[0]!.winnerId).toBe(seat.id);
        expect(finished.series[0]!.winnerUserId).toBe("returning");
        expect(finished.series[0]!.scores.reduce((sum, score) => sum + score, 0)).toBe(
          1,
        );
        expect(finished.standings[0]).toBe(seat.id);
      });
    }
  }

  it("reinvites withdrawn users and overwrites pending invitations without duplicate seats", async () => {
    const database = await getTestDatabase();
    await insertUsers(
      ["staff", "first", "replacement"].map((userId) => ({
        userId,
        role: userId === "staff" ? "CODER" : "USER",
      })),
    );
    const staff = await callerFor(tournamentRouter, "staff");
    const first = await callerFor(tournamentRouter, "first");
    const created = await staff.saveEvent({
      config: { ...eventConfig("Invites"), registration: "INVITE_ONLY" },
    });
    if (!("tournamentId" in created)) throw new Error(created.message);
    const { tournamentId } = created;
    expect((await staff.manageEvent({ tournamentId, action: "PUBLISH" })).success).toBe(
      true,
    );
    expect(
      (await staff.manageEvent({ tournamentId, action: "INVITE", userId: "first" }))
        .success,
    ).toBe(true);
    let event = (await fetchEvent(database, tournamentId))!.eventData!;
    expect(
      (
        await staff.manageEvent({
          tournamentId,
          action: "REMOVE_INVITE",
          seatId: event.participants[0]!.id,
        })
      ).success,
    ).toBe(true);
    expect(
      (await staff.manageEvent({ tournamentId, action: "INVITE", userId: "first" }))
        .success,
    ).toBe(true);
    event = (await fetchEvent(database, tournamentId))!.eventData!;
    expect(event.participants).toHaveLength(1);
    expect((await first.getEvent({ tournamentId }))?.participantId).toBe(
      event.participants[0]!.id,
    );
    expect(
      (
        await staff.manageEvent({
          tournamentId,
          action: "INVITE",
          userId: "replacement",
          seatId: event.participants[0]!.id,
        })
      ).success,
    ).toBe(true);
    event = (await fetchEvent(database, tournamentId))!.eventData!;
    expect(event.participants.map((p) => p.userId)).toEqual(["replacement"]);
    expect((await first.getEvent({ tournamentId }))?.participantId).toBeNull();
  });

  it("keeps event drafts private through the clan reader and preserves published event and clan reads", async () => {
    const database = await getTestDatabase();
    await insertUsers([{ userId: "reader" }, { userId: "staff", role: "CODER" }]);
    const reader = await callerFor(tournamentRouter, "reader");
    const staff = await callerFor(tournamentRouter, "staff");
    const created = await staff.saveEvent({ config: eventConfig("Private draft") });
    if (!("tournamentId" in created)) throw new Error(created.message);
    const { tournamentId } = created;
    expect(await reader.listEvents()).toHaveLength(0);
    expect(await reader.getEvent({ tournamentId })).toBeNull();
    expect((await staff.getEvent({ tournamentId }))?.eventData?.status).toBe("DRAFT");
    expect(await reader.getTournament({ tournamentId })).toBeNull();
    expect((await staff.manageEvent({ tournamentId, action: "PUBLISH" })).success).toBe(
      true,
    );
    expect(await reader.listEvents()).toHaveLength(1);
    expect((await reader.getEvent({ tournamentId }))?.eventData?.status).toBe(
      "REGISTRATION",
    );
    expect(await reader.getTournament({ tournamentId })).toBeNull();
    await database
      .insert(tournament)
      .values({
        id: "clan",
        name: "Clan tournament",
        type: "CLAN",
        image: "",
        description: "Clan event",
        rewards: ObjectiveReward.parse({}),
      });
    expect((await reader.getTournament({ tournamentId: "clan" }))?.type).toBe("CLAN");
  });

  it("commits absent recipients' receipts and pays remaining entrants exactly once", async () => {
    const database = await getTestDatabase();
    await insertUsers([{ userId: "remaining", money: 0 }]);
    await database.insert(tournament).values(completedEvent("event"));
    await Promise.all([
      syncEventTournament(database, "event"),
      syncEventTournament(database, "event"),
    ]);
    const receipts = await database.query.tournamentRewardClaim.findMany();
    expect(receipts.map((r) => r.userId).sort()).toEqual(["deleted", "remaining"]);
    expect((await database.query.userData.findFirst())?.money).toBe(10);
    await insertUsers([{ userId: "deleted", username: "deleted", money: 0 }]);
    await syncEventTournament(database, "event");
    expect(
      (
        await database.query.userData.findFirst({
          where: eq(userData.userId, "deleted"),
        })
      )?.money,
    ).toBe(0);
    expect(
      (
        await database.query.userData.findFirst({
          where: eq(userData.userId, "remaining"),
        })
      )?.money,
    ).toBe(10);
  });

  it("continues maintenance and retention after an absent recipient", async () => {
    const database = await getTestDatabase();
    await insertUsers([{ userId: "remaining", money: 0 }]);
    const expired = completedEvent("expired");
    expired.eventData.finishedAt =
      Date.now() - (EVENT_TOURNAMENT_RETENTION_DAYS + 1) * 86400_000;
    expired.eventData.payRewards = false;
    await database
      .insert(tournament)
      .values([completedEvent("first"), completedEvent("later"), expired]);
    await maintainEventTournaments(database);
    expect((await database.query.userData.findFirst())?.money).toBe(20);
    expect(await database.query.tournamentRewardClaim.findMany()).toHaveLength(4);
    expect(
      await database.query.tournament.findFirst({
        where: eq(tournament.id, "expired"),
      }),
    ).toBeUndefined();
    await maintainEventTournaments(database);
    expect((await database.query.userData.findFirst())?.money).toBe(20);
  });
});

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

/** Interleave a real SQL write inside or outside a transaction. */
const beforeTransactionalWrite = (
  client: DrizzleClient,
  table: object,
  hook: () => Promise<void>,
) => {
  let pending = true;
  const once = async () => {
    if (!pending) return;
    pending = false;
    await hook();
  };
  return new Proxy(beforeStatements(client, table, [once]), {
    get(target, property, receiver) {
      if (property === "transaction")
        return (callback: Parameters<typeof client.transaction>[0]) =>
          client.transaction((tx) =>
            callback(
              beforeStatements(tx as unknown as DrizzleClient, table, [
                once,
              ]) as typeof tx,
            ),
          );
      return Reflect.get(target, property, receiver);
    },
  });
};

/** Pause after the first real SQL transaction commits, before its caller can continue. */
const afterTransactionCommit = (client: DrizzleClient, hook: () => Promise<void>) => {
  let pending = true;
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === "transaction")
        return async (callback: Parameters<typeof client.transaction>[0]) => {
          const result = await client.transaction(callback);
          if (pending) {
            pending = false;
            await hook();
          }
          return result;
        };
      return Reflect.get(target, property, receiver);
    },
  });
};
