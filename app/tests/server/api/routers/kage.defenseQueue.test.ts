import { afterEach, beforeEach, expect, it, setSystemTime, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  KAGE_DEFENSE_INSTANT_REQUEST_MINUTES,
  KAGE_PRESTIGE_REQUIREMENT,
} from "@/drizzle/constants";
import {
  aiProfile,
  battle,
  battleHistory,
  kageDefendedChallenges,
  userData,
  village,
  villageElderVote,
  war,
} from "@/drizzle/schema";
import { AUTO_CHECKOUT_MESSAGE, AUTO_WAKE_MESSAGE } from "@/libs/actionReadiness";
import { updateBattle, updateKage } from "@/libs/combat/database";
import { calcBattleResult } from "@/libs/combat/settlement";
import * as pusherModule from "@/libs/pusher";
import { Pusher } from "@/libs/pusher";
import * as combat from "@/server/api/routers/combat";
import { kageRouter } from "@/server/api/routers/kage";
import { villageRouter } from "@/server/api/routers/village";
import type { DrizzleClient } from "@/server/db";
import {
  syncKageDefense,
  syncLockedKageDefense,
  withinKageChallengeLimits,
  withKageDefense,
} from "@/server/utils/kage";
import * as liveActivity from "@/server/utils/push/liveActivity";
import { getKageSlots } from "@/utils/kage";
import { makeBattleUser, makeCompleteBattle } from "../../../setup/combat";
import { deferred } from "../../../setup/deferred";
import { insertDefaultAiProfile, insertUsers } from "../../../setup/factories";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import {
  beforeStatements,
  beforeTransaction,
  failCommits,
  failStatements,
  inTransactions,
} from "../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../../setup/testDatabase";

const now = new Date("2026-10-12T12:00:00Z");
const windows = [
  { day: 2, hour: 14 },
  { day: 4, hour: 14 },
];
const villageId = "defense-home";

describeWithDatabase("scheduled Kage defenses", () => {
  beforeEach(async () => {
    // Bun retains other suites' Pusher factories; keep notification spies local to this suite.
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    vi.spyOn(pusherModule, "getServerPusher").mockReturnValue(
      new Pusher("", "", "", ""),
    );
    setSystemTime(now);
    await resetTables(
      aiProfile,
      battleHistory,
      battle,
      kageDefendedChallenges,
      userData,
      village,
      villageElderVote,
      war,
    );
    const db = await getTestDatabase();
    await insertDefaultAiProfile();
    await db.insert(village).values({
      id: villageId,
      name: "Defense home",
      kageId: "defender",
      leaderUpdatedAt: now,
      kageScheduleAvailableAt: now,
    });
    await insertUsers(
      ["defender", "first", "second", "third"].map((id) => ({
        userId: id,
        username: id,
        villageId,
        rank: "JONIN",
        status: "AWAKE",
        villagePrestige: KAGE_PRESTIGE_REQUIREMENT,
        joinedVillageAt: new Date("2026-01-01"),
      })),
    );
    expect(
      (
        await (
          await callerFor(kageRouter, "defender")
        ).publishSchedule({ villageId, windows })
      ).success,
    ).toBe(true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    setSystemTime();
  });

  /** Join and return the challenger's assigned FIFO entry from the public hall. */
  const join = async (id = "first") => {
    const caller = await callerFor(kageRouter, id);
    await caller.joinDefenseQueue({ villageId });
    return (await caller.getDefenses({ villageId })).hall!.queue.find(
      (m) => m.challengerId === id,
    )!;
  };
  /** Enter check-in time with a current observation so attendance tests do not simulate an outage. */
  const due = async () => {
    const m = await join();
    setSystemTime(new Date(m.scheduledAt!.getTime() - 60_000));
    const db = await getTestDatabase();
    const v = await db.query.village.findFirst();
    await db
      .update(village)
      .set({
        kageSchedule: { ...v!.kageSchedule!, observedAt: new Date().toISOString() },
      })
      .where(eq(village.id, villageId));
    return m;
  };

  /** Send an invitation for a future appointment without entering its check-in window. */
  const invite = async () => {
    const m = await join();
    const defender = await callerFor(kageRouter, "defender");
    expect((await defender.requestInstantDefense({ id: m.id })).success).toBe(true);
    const invitation = (await defender.getDefenses({ villageId })).hall!.schedule!
      .instantChallenge!;
    return {
      m,
      invitation,
      defender,
      input: { id: m.id, instantRequestId: invitation.id },
    };
  };
  /** Prepare the explicit actor's supported launch path with the other participant awake. */
  const launchInput = async (actor: string) => {
    if (actor === "first") return (await invite()).input;
    const m = await due();
    expect(
      (await (await callerFor(kageRouter, "first")).checkInDefense({ id: m.id }))
        .success,
    ).toBe(true);
    setSystemTime(m.scheduledAt!);
    return { id: m.id };
  };
  it.each(
    ["defender", "first"].flatMap((actor) => [
      { actor, status: "ASLEEP" as const, autoWakeUp: true, success: true },
      { actor, status: "ASLEEP" as const, autoWakeUp: false, success: false },
      { actor, status: "HOSPITALIZED" as const, autoWakeUp: true, success: true },
      { actor, status: "HOSPITALIZED" as const, autoWakeUp: false, success: true },
    ]),
  )(
    "recovers only an eligible explicit Kage launch actor: %j",
    async ({ actor, status, autoWakeUp, success }) => {
      const input = await launchInput(actor);
      const db = await getTestDatabase();
      await db
        .update(userData)
        .set({ status, autoWakeUp, curHealth: 100, maxHealth: 100, money: 1234 })
        .where(eq(userData.userId, actor));
      const result = await (await callerFor(kageRouter, actor)).startDefense(input);
      expect(result.success).toBe(success);
      const fights = await db.query.battle.findMany();
      expect(fights).toHaveLength(success ? 1 : 0);
      const stored = (await db.query.userData.findFirst({
        where: eq(userData.userId, actor),
      }))!;
      expect(stored).toMatchObject({
        status: success ? "BATTLE" : status,
        money: 1234,
      });
      if (success) {
        expect(result.message).toContain(
          status === "ASLEEP" ? AUTO_WAKE_MESSAGE : AUTO_CHECKOUT_MESSAGE,
        );
        expect(stored.battleId).toBe(fights[0]!.id);
        expect(
          (
            await db.query.userData.findFirst({
              where: eq(userData.userId, actor === "first" ? "defender" : "first"),
            })
          )?.status,
        ).toBe("BATTLE");
      } else expect(result).not.toHaveProperty("actionNotice");
    },
  );
  it.each(
    ["defender", "first"].flatMap((actor) =>
      ["ASLEEP", "HOSPITALIZED"].map((status) => ({
        actor,
        status: status as "ASLEEP" | "HOSPITALIZED",
      })),
    ),
  )("keeps the other Kage participant unavailable: %j", async ({ actor, status }) => {
    const input = await launchInput(actor);
    const db = await getTestDatabase();
    const other = actor === "first" ? "defender" : "first";
    await db
      .update(userData)
      .set({ status, autoWakeUp: true, curHealth: 100, maxHealth: 100 })
      .where(eq(userData.userId, other));
    expect(
      (await (await callerFor(kageRouter, actor)).startDefense(input)).success,
    ).toBe(false);
    expect(await db.query.battle.findMany()).toHaveLength(0);
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, other) }))
        ?.status,
    ).toBe(status);
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, actor) }))
        ?.status,
    ).toBe("AWAKE");
  });
  it.each(["defender", "first"])(
    "rejects %s recovery when the preference changes after combat preload",
    async (actor) => {
      const input = await launchInput(actor);
      const db = await getTestDatabase();
      await db
        .update(userData)
        .set({ status: "ASLEEP", autoWakeUp: true })
        .where(eq(userData.userId, actor));
      const racing = inTransactions(db, (tx, attempt) =>
        attempt === 2
          ? beforeStatements(tx, userData, [
              async () => {
                await tx
                  .update(userData)
                  .set({ autoWakeUp: false })
                  .where(eq(userData.userId, actor));
              },
            ])
          : tx,
      );
      const result = await callerForDatabase(kageRouter, actor, racing).startDefense(
        input,
      );
      expect(result.success).toBe(false);
      expect(result).not.toHaveProperty("actionNotice");
      expect(await db.query.battle.findMany()).toHaveLength(0);
      expect(await db.query.kageDefendedChallenges.findFirst()).toMatchObject({
        status: actor === "first" ? "SCHEDULED" : "QUEUED",
        battleId: null,
        startedAt: null,
      });
      expect(
        (await db.query.userData.findFirst({ where: eq(userData.userId, actor) }))
          ?.status,
      ).toBe("ASLEEP");
      expect(
        (
          await db.query.userData.findFirst({
            where: eq(userData.userId, actor === "first" ? "defender" : "first"),
          })
        )?.status,
      ).toBe("AWAKE");
    },
  );
  it("restricts instant invitations to the current Kage and leaves the appointment untouched", async () => {
    const m = await join();
    const db = await getTestDatabase();
    const first = await callerFor(kageRouter, "first");
    expect((await first.requestInstantDefense({ id: m.id })).success).toBe(false);
    const defender = await callerFor(kageRouter, "defender");
    const results = await Promise.all([
      defender.requestInstantDefense({ id: m.id }),
      defender.requestInstantDefense({ id: m.id }),
    ]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(await db.query.kageDefendedChallenges.findFirst()).toEqual(
      expect.objectContaining({
        scheduledAt: m.scheduledAt,
        checkedInAt: null,
        status: "SCHEDULED",
        startedAt: null,
        rescheduled: false,
      }),
    );
    expect(Pusher.prototype.trigger).toHaveBeenCalledWith(
      "first",
      "event",
      expect.objectContaining({ route: "/townhall#Kage" }),
    );
  });
  it("sends and dismisses invitations with one guarded write each and no transactions", async () => {
    const m = await join();
    const db = await getTestDatabase();
    const defender = await callerFor(kageRouter, "defender");
    const sent = await recordQueries(() =>
      defender.requestInstantDefense({ id: m.id }),
    );
    expect(sent.result.success).toBe(true);
    const home = (await db.query.village.findFirst())!;
    const dismissed = await recordQueries(() =>
      defender.dismissInstantDefense({
        id: m.id,
        instantRequestId: home.kageSchedule!.instantChallenge!.id,
      }),
    );
    expect(dismissed.result.success).toBe(true);
    for (const result of [sent, dismissed]) {
      expectSingleGuardedUpdate(result.statements);
    }
    const after = (await db.query.village.findFirst())!;
    expect(after.kageSchedule!.instantChallenge).toBeUndefined();
    expect({ ...after.kageSchedule, instantChallenge: undefined }).toEqual({
      ...home.kageSchedule,
      instantChallenge: undefined,
    });
  });
  it.each(["leadership", "war", "withdraw", "reschedule", "mode", "hospital", "busy"])(
    "rejects an invitation when %s changes before its guarded write",
    async (change) => {
      const m = await join();
      const db = await getTestDatabase();
      const defender = await callerFor(kageRouter, "defender");
      const challenger = await callerFor(kageRouter, "first");
      const racing = callerForDatabase(
        kageRouter,
        "defender",
        beforeStatements(db, village, [
          async () => {
            if (change === "leadership")
              await db
                .update(village)
                .set({ kageId: "third", leaderUpdatedAt: new Date(now.getTime() + 1) })
                .where(eq(village.id, villageId));
            if (change === "war")
              await db.insert(war).values({
                id: "invite-write-war",
                attackerVillageId: villageId,
                defenderVillageId: "enemy",
                type: "VILLAGE_WAR",
                status: "ACTIVE",
              });
            if (change === "withdraw") await challenger.withdrawDefense({ id: m.id });
            if (change === "reschedule") await defender.rescheduleDefense({ id: m.id });
            if (change === "mode")
              await challenger.setDefenseAi({ id: m.id, consent: true });
            if (change === "hospital")
              await db
                .update(kageDefendedChallenges)
                .set({ hospitalDeferred: true })
                .where(eq(kageDefendedChallenges.id, m.id));
            if (change === "busy")
              await db
                .update(userData)
                .set({ status: "ASLEEP" })
                .where(eq(userData.userId, "defender"));
          },
        ]),
      );
      expect((await racing.requestInstantDefense({ id: m.id })).success).toBe(false);
      expect(
        (await db.query.village.findFirst())!.kageSchedule!.instantChallenge,
      ).toBeUndefined();
      expect(Pusher.prototype.trigger).not.toHaveBeenCalled();
    },
  );
  it.each(["send", "dismiss"])(
    "serializes invitation %s behind an existing schedule snapshot without a transaction",
    async (action) => {
      const m = await join();
      const db = await getTestDatabase();
      const defender = await callerFor(kageRouter, "defender");
      if (action === "dismiss")
        expect((await defender.requestInstantDefense({ id: m.id })).success).toBe(true);
      const invitation = (await db.query.village.findFirst())!.kageSchedule!
        .instantChallenge;
      const { syncing, release: resumeSync } = await pauseKageSync(db);
      const { promise: submitted, resolve: markSubmitted } = deferred<void>();
      const caller = callerForDatabase(
        kageRouter,
        "defender",
        beforeStatements(db, village, [
          async () => {
            markSubmitted();
          },
        ]),
      );
      const changing =
        action === "send"
          ? caller.requestInstantDefense({ id: m.id })
          : caller.dismissInstantDefense({
              id: m.id,
              instantRequestId: invitation!.id,
            });
      try {
        await submitted;
        const blocked = await stillPending(changing);
        expect(blocked).toBe(true);
      } finally {
        resumeSync();
        await syncing;
        await changing;
      }
      expect((await changing).success).toBe(true);
      const saved = (await db.query.village.findFirst())!.kageSchedule!
        .instantChallenge;
      if (action === "send") expect(saved?.matchId).toBe(m.id);
      else expect(saved).toBeUndefined();
    },
  );
  it("replaces an expired invitation without reconciling or changing the appointment", async () => {
    const { m, input, defender } = await invite();
    const db = await getTestDatabase();
    setSystemTime(
      new Date(now.getTime() + KAGE_DEFENSE_INSTANT_REQUEST_MINUTES * 60_000),
    );
    expect((await defender.requestInstantDefense({ id: m.id })).success).toBe(true);
    expect(
      (await db.query.village.findFirst())!.kageSchedule!.instantChallenge!.id,
    ).not.toBe(input.instantRequestId);
    expect(await db.query.kageDefendedChallenges.findFirst()).toEqual(
      expect.objectContaining({
        scheduledAt: m.scheduledAt,
        checkedInAt: null,
        status: "SCHEDULED",
        rescheduled: false,
      }),
    );
  });
  it("expires an unanswered invitation without attendance, prestige or scheduling penalties", async () => {
    const { m, input } = await invite();
    const db = await getTestDatabase();
    setSystemTime(
      new Date(now.getTime() + KAGE_DEFENSE_INSTANT_REQUEST_MINUTES * 60_000),
    );
    const challenger = await callerFor(kageRouter, "first");
    expect((await challenger.startDefense(input)).success).toBe(false);
    const home = (await db.query.village.findFirst())!;
    expect(home.kageSchedule!.instantChallenge).toBeUndefined();
    expect(home.kageSchedule!.missedStarts).toBe(0);
    expect(await db.query.kageDefendedChallenges.findFirst()).toEqual(
      expect.objectContaining({
        scheduledAt: m.scheduledAt,
        checkedInAt: null,
        status: "SCHEDULED",
        startedAt: null,
        rescheduled: false,
      }),
    );
    expect(
      (await db.query.userData.findMany()).every(
        (user) => user.villagePrestige === KAGE_PRESTIGE_REQUIREMENT,
      ),
    ).toBe(true);
  });
  it.each(["defender", "first"])(
    "lets %s dismiss an invitation while stale and outsider responses cannot affect a new one",
    async (actor) => {
      const { m, input, defender } = await invite();
      expect(
        (await (await callerFor(kageRouter, "second")).dismissInstantDefense(input))
          .success,
      ).toBe(false);
      expect(
        (await (await callerFor(kageRouter, actor)).dismissInstantDefense(input))
          .success,
      ).toBe(true);
      expect((await defender.requestInstantDefense({ id: m.id })).success).toBe(true);
      expect(
        (await (await callerFor(kageRouter, actor)).dismissInstantDefense(input))
          .success,
      ).toBe(false);
      expect(
        (await (await callerFor(kageRouter, "first")).startDefense(input)).success,
      ).toBe(false);
      expect(
        (await defender.getDefenses({ villageId })).hall!.schedule!.instantChallenge
          ?.id,
      ).not.toBe(input.instantRequestId);
    },
  );
  it.each(["defender", "second"])("rejects acceptance by %s", async (actor) => {
    const { input } = await invite();
    expect(
      (await (await callerFor(kageRouter, actor)).startDefense(input)).success,
    ).toBe(false);
    expect(await (await getTestDatabase()).query.battle.findMany()).toHaveLength(0);
  });
  it.each(["war", "leadership", "reschedule", "withdraw", "mode"])(
    "revokes instant acceptance after %s changes",
    async (change) => {
      const { m, input, defender } = await invite();
      const db = await getTestDatabase();
      const challenger = await callerFor(kageRouter, "first");
      if (change === "war")
        await db.insert(war).values({
          id: "instant-war",
          attackerVillageId: villageId,
          defenderVillageId: "enemy",
          type: "VILLAGE_WAR",
          status: "ACTIVE",
        });
      if (change === "leadership")
        await db
          .update(village)
          .set({ kageId: "third", leaderUpdatedAt: new Date(now.getTime() + 1) })
          .where(eq(village.id, villageId));
      if (change === "reschedule") await defender.rescheduleDefense({ id: m.id });
      if (change === "withdraw") await challenger.withdrawDefense({ id: m.id });
      if (change === "mode") {
        await challenger.setDefenseAi({ id: m.id, consent: true });
        await defender.setDefenseAi({ id: m.id, consent: true });
      }
      expect((await challenger.startDefense(input)).success).toBe(false);
      expect(await db.query.battle.findMany()).toHaveLength(0);
    },
  );
  it("starts exactly one immediate title battle without check-in and retains the scheduled timestamp", async () => {
    const { m, input } = await invite();
    const db = await getTestDatabase();
    const challenger = await callerFor(kageRouter, "first");
    const results = await Promise.all([
      challenger.startDefense(input),
      challenger.startDefense(input),
    ]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    const fights = await db.query.battle.findMany();
    expect(fights).toHaveLength(1);
    expect(fights[0]?.battleType).toBe("KAGE_PVP");
    expect(await db.query.kageDefendedChallenges.findFirst()).toEqual(
      expect.objectContaining({
        scheduledAt: m.scheduledAt,
        status: "BATTLE",
        startedAt: now,
      }),
    );
    expect(
      (await db.query.village.findFirst())!.kageSchedule!.instantChallenge,
    ).toBeUndefined();
    expect(
      (await db.query.userData.findMany())
        .filter((u) => ["first", "defender"].includes(u.userId))
        .every((u) => u.status === "BATTLE" && u.battleId === fights[0]!.id),
    ).toBe(true);
  });
  it.each(["cancel", "expire", "busy"])(
    "rolls back immediate combat when %s wins after preload",
    async (change) => {
      const { m, input, defender } = await invite();
      const db = await getTestDatabase();
      // Admission reconciles first; the second transaction is the atomic launch after
      // combat preload. Interleave here to exercise the final guards rather than preflight.
      const wrapped = beforeTransaction(db, async (call) => {
        if (call !== 2) return;
        if (change === "cancel") await defender.dismissInstantDefense(input);
        if (change === "expire")
          setSystemTime(
            new Date(now.getTime() + KAGE_DEFENSE_INSTANT_REQUEST_MINUTES * 60_000),
          );
        if (change === "busy")
          await db
            .update(userData)
            .set({ status: "ASLEEP" })
            .where(eq(userData.userId, "defender"));
      });
      expect(
        (await callerForDatabase(kageRouter, "first", wrapped).startDefense(input))
          .success,
      ).toBe(false);
      expect(await db.query.battle.findMany()).toHaveLength(0);
      expect(await db.query.kageDefendedChallenges.findFirst()).toEqual(
        expect.objectContaining({
          scheduledAt: m.scheduledAt,
          status: "SCHEDULED",
          startedAt: null,
        }),
      );
    },
  );

  it("reads completed defense history while waiting challengers retain no result", async () => {
    // Keep the public village middleware active without requiring Redis for its SQL read.
    stubRateLimitTransport();
    const m = await join();
    const db = await getTestDatabase();
    const completedAt = new Date("2026-10-11T11:00:00Z");
    await db.insert(kageDefendedChallenges).values({
      id: "legacy-defense",
      villageId,
      userId: "second",
      kageId: "defender",
      battleId: "legacy-battle",
      status: "COMPLETED",
      notBefore: completedAt,
      createdAt: completedAt,
      startedAt: completedAt,
      resolvedAt: completedAt,
      didWin: 1,
      rounds: 5,
      outcome: "Challenger won the title fight",
    });
    const current = await db.query.kageDefendedChallenges.findFirst({
      where: eq(kageDefendedChallenges.id, m.id),
    });
    expect(current?.didWin).toBeNull();
    expect(current?.rounds).toBeNull();
    const view = await (await callerFor(villageRouter, "first")).get({ id: villageId });
    expect(view.defendedChallenges.map((row) => row.id)).toEqual(["legacy-defense"]);
    expect(view.defendedChallenges[0]).toMatchObject({
      userId: "second",
      didWin: 1,
      rounds: 5,
      tenure: null,
    });
    const hall = (
      await (await callerFor(kageRouter, "first")).getDefenses({ villageId })
    ).hall!;
    expect(hall.history).toEqual([
      {
        id: "legacy-defense",
        challengerId: "second",
        outcome: "Challenger won the title fight",
        resolvedAt: completedAt,
      },
    ]);
    expect(hall.queue.map((row) => row.id)).toEqual([m.id]);
  });
  it("keeps players awake and atomically rejects duplicate concurrent joins", async () => {
    const caller = await callerFor(kageRouter, "first");
    const results = await Promise.all([
      caller.joinDefenseQueue({ villageId }),
      caller.joinDefenseQueue({ villageId }),
    ]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    const db = await getTestDatabase();
    expect(await db.query.kageDefendedChallenges.findMany()).toHaveLength(1);
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, "first") }))
        ?.status,
    ).toBe("AWAKE");
  });
  it("assigns named challengers in FIFO order with advance notice and locks occupied schedules", async () => {
    const first = await join();
    const second = await join("second");
    expect(first.scheduledAt!.getTime()).toBeGreaterThanOrEqual(
      now.getTime() + 86400_000,
    );
    expect(second.scheduledAt!.getTime()).toBeGreaterThan(first.scheduledAt!.getTime());
    const caller = await callerFor(kageRouter, "defender");
    expect((await caller.publishSchedule({ villageId, windows })).success).toBe(false);
  });
  it("locks the schedule when publishing assigns a newly queued challenger", async () => {
    const challenger = await callerFor(kageRouter, "first");
    expect((await challenger.joinDefenseQueue({ villageId })).success).toBe(true);
    const db = await getTestDatabase();
    expect((await db.query.kageDefendedChallenges.findFirst())?.status).toBe("QUEUED");
    const defender = await callerFor(kageRouter, "defender");
    const result = await defender.publishSchedule({
      villageId,
      windows: [
        { day: 3, hour: 16 },
        { day: 5, hour: 16 },
      ],
    });
    const [match, home] = await Promise.all([
      db.query.kageDefendedChallenges.findFirst(),
      db.query.village.findFirst(),
    ]);
    expect(match?.status).toBe("SCHEDULED");
    expect(match?.scheduledAt?.toISOString()).toBe("2026-10-13T14:00:00.000Z");
    expect(result).toEqual({
      success: false,
      message:
        "Assigned matches lock the schedule. Use the match reschedule action instead.",
    });
    expect(home?.kageSchedule?.windows).toEqual(windows);
  });
  it("rejects invalid weekly windows and unauthorized publishing", async () => {
    const caller = await callerFor(kageRouter, "first");
    expect((await caller.publishSchedule({ villageId, windows })).success).toBe(false);
    await expect(
      caller.publishSchedule({
        villageId,
        windows: [
          { day: 1, hour: 10 },
          { day: 1, hour: 12 },
        ],
      }),
    ).rejects.toThrow();
  });
  it("allows one reschedule by either side and retains FIFO priority", async () => {
    const first = await join();
    await join("second");
    const caller = await callerFor(kageRouter, "defender");
    expect((await caller.rescheduleDefense({ id: first.id })).success).toBe(true);
    const hall = (await caller.getDefenses({ villageId })).hall!;
    expect(hall.queue.map((m) => m.challengerId)).toEqual(["first", "second"]);
    expect(hall.queue[0]!.scheduledAt!.getTime()).toBeGreaterThan(
      first.scheduledAt!.getTime(),
    );
    expect(hall.queue[1]!.scheduledAt!.getTime()).toBeGreaterThan(
      hall.queue[0]!.scheduledAt!.getTime(),
    );
    expect(
      (await (await callerFor(kageRouter, "first")).rescheduleDefense({ id: first.id }))
        .success,
    ).toBe(false);
  });
  it("pauses during war and preserves queue order after war and a leadership change", async () => {
    await join();
    await join("second");
    const db = await getTestDatabase();
    await db.insert(war).values({
      id: "pause-war",
      attackerVillageId: villageId,
      defenderVillageId: "enemy",
      type: "VILLAGE_WAR",
      status: "ACTIVE",
    });
    await syncKageDefense(db, villageId);
    let hall = (await (await callerFor(kageRouter, "first")).getDefenses({ villageId }))
      .hall!;
    expect(hall.schedule?.paused).toBe(true);
    expect(hall.queue.every((m) => !m.scheduledAt)).toBe(true);
    await db
      .update(war)
      .set({ status: "DRAW", endedAt: now })
      .where(eq(war.id, "pause-war"));
    await db
      .update(village)
      .set({ kageId: "third", leaderUpdatedAt: new Date(now.getTime() + 1) })
      .where(eq(village.id, villageId));
    hall = (await (await callerFor(kageRouter, "first")).getDefenses({ villageId }))
      .hall!;
    expect(hall.schedule?.windows).toHaveLength(0);
    expect(hall.queue.map((m) => m.challengerId)).toEqual(["first", "second"]);
    expect(hall.queue.every((m) => !m.scheduledAt)).toBe(true);
  });
  it("removes an ineligible challenger and never converts ordinary offline time into prestige charges", async () => {
    const m = await join();
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ anbuId: "new-anbu" })
      .where(eq(userData.userId, "first"));
    await syncKageDefense(db, villageId);
    expect(
      (
        await db.query.kageDefendedChallenges.findFirst({
          where: eq(kageDefendedChallenges.id, m.id),
        })
      )?.status,
    ).toBe("CANCELLED");
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, "defender") }))
        ?.villagePrestige,
    ).toBe(KAGE_PRESTIGE_REQUIREMENT);
  });
  it("withdraws a waiting entry once with one joined write and rejects outsiders", async () => {
    const m = await join();
    const db = await getTestDatabase();
    expect(
      await (await callerFor(kageRouter, "second")).withdrawDefense({ id: m.id }),
    ).toEqual({ success: false, message: "Only your waiting entry can be withdrawn" });
    const initialVersion = (await db.query.village.findFirst())!.kageScheduleVersion;
    const challenger = await callerFor(kageRouter, "first");
    const recorded = await recordQueries(() =>
      challenger.withdrawDefense({ id: m.id }),
    );
    expect(recorded.result).toEqual({
      success: true,
      message: "Withdrawn from the queue",
    });
    expectSingleGuardedUpdate(recorded.statements);
    expect((await db.query.village.findFirst())!.kageScheduleVersion).toBe(
      initialVersion + 1,
    );
    expect((await challenger.withdrawDefense({ id: m.id })).success).toBe(false);
    await syncKageDefense(db, villageId);
    const stored = await db.query.kageDefendedChallenges.findFirst({
      where: eq(kageDefendedChallenges.id, m.id),
    });
    expect(stored?.status).toBe("CANCELLED");
    expect(stored?.resolvedAt).toEqual(now);
    expect(stored?.outcome).toBe("Challenger withdrew; no prestige charged");
  });
  it("claims one concurrent withdrawal while AI saves and synchronization contend", async () => {
    const m = await join();
    const db = await getTestDatabase();
    const challenger = await callerFor(kageRouter, "first");
    const [first, second] = await Promise.all([
      challenger.withdrawDefense({ id: m.id }),
      challenger.withdrawDefense({ id: m.id }),
      challenger.setDefenseAi({ id: m.id, consent: true }),
      syncKageDefense(db, villageId),
    ]);
    expect([first, second].filter((result) => result.success)).toHaveLength(1);
    expect((await db.query.kageDefendedChallenges.findFirst())?.status).toBe(
      "CANCELLED",
    );
  });
  it("serializes withdrawal behind a loaded sync snapshot without resurrecting the entry", async () => {
    const db = await getTestDatabase();
    const challenger = await callerFor(kageRouter, "first");
    expect((await challenger.joinDefenseQueue({ villageId })).success).toBe(true);
    const m = (await db.query.kageDefendedChallenges.findFirst())!;
    const { syncing, release: resumeSync } = await pauseKageSync(db);
    const { promise: submitted, resolve: markSubmitted } = deferred<void>();
    const withdrawing = callerForDatabase(
      kageRouter,
      "first",
      beforeStatements(db, kageDefendedChallenges, [
        async () => {
          markSubmitted();
        },
      ]),
    ).withdrawDefense({ id: m.id });
    try {
      await submitted;
      // A queue-only write would complete here while sync still owns a stale QUEUED snapshot.
      const pending = await stillPending(withdrawing);
      expect(pending).toBe(true);
    } finally {
      resumeSync();
      await syncing;
      await withdrawing;
    }
    expect((await withdrawing).success).toBe(true);
    expect(
      (
        await db.query.kageDefendedChallenges.findFirst({
          where: eq(kageDefendedChallenges.id, m.id),
        })
      )?.status,
    ).toBe("CANCELLED");
    await syncKageDefense(db, villageId);
    expect(
      (
        await db.query.kageDefendedChallenges.findFirst({
          where: eq(kageDefendedChallenges.id, m.id),
        })
      )?.status,
    ).toBe("CANCELLED");
  });
  it("requires check-in near the match and mutual AI consent", async () => {
    const m = await join();
    const challenger = await callerFor(kageRouter, "first");
    const defender = await callerFor(kageRouter, "defender");
    expect((await challenger.checkInDefense({ id: m.id })).success).toBe(false);
    expect(await defender.setDefenseAi({ id: m.id, consent: true })).toEqual({
      success: false,
      message: "The challenger must request AI combat first",
    });
    expect(
      await (await callerFor(kageRouter, "second")).setDefenseAi({
        id: m.id,
        consent: true,
      }),
    ).toEqual({ success: false, message: "Only participants can select combat mode" });
    expect((await challenger.setDefenseAi({ id: m.id, consent: true })).success).toBe(
      true,
    );
    expect((await defender.setDefenseAi({ id: m.id, consent: true })).success).toBe(
      true,
    );
    const db = await getTestDatabase();
    const version = (await db.query.village.findFirst())!.kageScheduleVersion;
    const recorded = await recordQueries(() =>
      defender.setDefenseAi({ id: m.id, consent: true }),
    );
    expect(recorded.result.success).toBe(true);
    expectSingleGuardedUpdate(recorded.statements);
    expect((await db.query.village.findFirst())!.kageScheduleVersion).toBe(version + 1);
    expect((await defender.setDefenseAi({ id: m.id, consent: false })).success).toBe(
      true,
    );
    expect((await db.query.kageDefendedChallenges.findFirst())?.aiRequested).toBe(true);
    expect((await db.query.kageDefendedChallenges.findFirst())?.aiAccepted).toBe(false);
    expect((await defender.setDefenseAi({ id: m.id, consent: true })).success).toBe(
      true,
    );
    // Repeating the challenger's request invalidates the incumbent's prior acceptance.
    expect((await challenger.setDefenseAi({ id: m.id, consent: true })).success).toBe(
      true,
    );
    expect((await db.query.kageDefendedChallenges.findFirst())?.aiAccepted).toBe(false);
    expect((await defender.setDefenseAi({ id: m.id, consent: true })).success).toBe(
      true,
    );
    expect((await challenger.setDefenseAi({ id: m.id, consent: false })).success).toBe(
      true,
    );
    expect((await db.query.kageDefendedChallenges.findFirst())?.aiRequested).toBe(
      false,
    );
    expect((await db.query.kageDefendedChallenges.findFirst())?.aiAccepted).toBe(false);
  });
  it("uses the incumbent at the AI write boundary after leadership changes", async () => {
    const m = await join();
    const db = await getTestDatabase();
    await (await callerFor(kageRouter, "first")).setDefenseAi({
      id: m.id,
      consent: true,
    });
    const formerKage = callerForDatabase(
      kageRouter,
      "defender",
      beforeStatements(db, kageDefendedChallenges, [
        async () => {
          await db
            .update(village)
            .set({ kageId: "third", leaderUpdatedAt: new Date(now.getTime() + 1) })
            .where(eq(village.id, villageId));
        },
      ]),
    );
    expect(await formerKage.setDefenseAi({ id: m.id, consent: true })).toEqual({
      success: false,
      message: "Only participants can select combat mode",
    });
    expect((await db.query.kageDefendedChallenges.findFirst())?.aiAccepted).toBe(false);
    expect(
      (
        await (
          await callerFor(kageRouter, "third")
        ).setDefenseAi({ id: m.id, consent: true })
      ).success,
    ).toBe(true);
    expect((await db.query.kageDefendedChallenges.findFirst())?.aiAccepted).toBe(true);
  });
  it("rechecks revoked AI requests and a launch claim after the initial match read", async () => {
    const m = await join();
    const db = await getTestDatabase();
    const challenger = await callerFor(kageRouter, "first");
    await challenger.setDefenseAi({ id: m.id, consent: true });
    const defender = callerForDatabase(
      kageRouter,
      "defender",
      beforeStatements(db, kageDefendedChallenges, [
        async () => {
          await challenger.setDefenseAi({ id: m.id, consent: false });
        },
      ]),
    );
    expect(await defender.setDefenseAi({ id: m.id, consent: true })).toEqual({
      success: false,
      message: "The challenger must request AI combat first",
    });
    const launching = callerForDatabase(
      kageRouter,
      "first",
      beforeStatements(db, kageDefendedChallenges, [
        async () => {
          await db
            .update(kageDefendedChallenges)
            .set({ status: "BATTLE", aiRequested: true, aiAccepted: true })
            .where(eq(kageDefendedChallenges.id, m.id));
        },
      ]),
    );
    expect(await launching.setDefenseAi({ id: m.id, consent: false })).toEqual({
      success: false,
      message: "The match can no longer change combat mode",
    });
    expect((await db.query.kageDefendedChallenges.findFirst())?.aiRequested).toBe(true);
    expect((await db.query.kageDefendedChallenges.findFirst())?.aiAccepted).toBe(true);
  });
  it.each(["STARTING", "BATTLE", "COMPLETED", "CANCELLED", "FORFEITED"] as const)(
    "rejects withdrawal and AI changes for a %s match",
    async (status) => {
      const m = await join();
      const db = await getTestDatabase();
      await db
        .update(kageDefendedChallenges)
        .set({ status, aiRequested: true, aiAccepted: true })
        .where(eq(kageDefendedChallenges.id, m.id));
      const version = (await db.query.village.findFirst())!.kageScheduleVersion;
      const caller = await callerFor(kageRouter, "first");
      expect(await caller.withdrawDefense({ id: m.id })).toEqual({
        success: false,
        message: "Only your waiting entry can be withdrawn",
      });
      expect(await caller.setDefenseAi({ id: m.id, consent: false })).toEqual({
        success: false,
        message: "The match can no longer change combat mode",
      });
      const stored = await db.query.kageDefendedChallenges.findFirst();
      expect(stored?.status).toBe(status);
      expect(stored?.aiRequested).toBe(true);
      expect(stored?.aiAccepted).toBe(true);
      expect((await db.query.village.findFirst())!.kageScheduleVersion).toBe(version);
    },
  );
  it("retains missing-match and unsupported-village errors", async () => {
    const caller = await callerFor(kageRouter, "first");
    expect(await caller.withdrawDefense({ id: "missing" })).toEqual({
      success: false,
      message: "Match not found",
    });
    expect(await caller.setDefenseAi({ id: "missing", consent: true })).toEqual({
      success: false,
      message: "Match not found",
    });
    const m = await join();
    const db = await getTestDatabase();
    await db.update(village).set({ type: "HIDEOUT" }).where(eq(village.id, villageId));
    expect(await caller.withdrawDefense({ id: m.id })).toEqual({
      success: false,
      message: "Village not found",
    });
    expect(await caller.setDefenseAi({ id: m.id, consent: true })).toEqual({
      success: false,
      message: "Village not found",
    });
    expect((await db.query.kageDefendedChallenges.findFirst())?.status).toBe(
      "SCHEDULED",
    );
  });
  it("publishes recovery only after the check-in transaction commits", async () => {
    const match = await due();
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({
        status: "HOSPITALIZED",
        regenAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      })
      .where(eq(userData.userId, "first"));
    const publication = vi
      .spyOn(liveActivity, "pushActivityUpdate")
      .mockResolvedValue(undefined);
    const rejectedCommit = failCommits(db, 1);
    await expect(
      callerForDatabase(kageRouter, "first", rejectedCommit.client).checkInDefense({
        id: match.id,
      }),
    ).rejects.toThrow("Commit failed on purpose");
    expect(publication).not.toHaveBeenCalled();
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, "first") }),
    ).toMatchObject({ status: "HOSPITALIZED" });
    expect(
      await db.query.kageDefendedChallenges.findFirst({
        where: eq(kageDefendedChallenges.id, match.id),
      }),
    ).toMatchObject({ checkedInAt: null });
  });

  it("defers hospital stays only when the scheduled match is due", async () => {
    const m = await join();
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ status: "HOSPITALIZED" })
      .where(eq(userData.userId, "first"));
    await syncKageDefense(db, villageId);
    expect((await db.query.kageDefendedChallenges.findFirst())?.hospitalDeferred).toBe(
      false,
    );
    setSystemTime(m.scheduledAt!);
    await syncKageDefense(db, villageId);
    expect((await db.query.kageDefendedChallenges.findFirst())?.hospitalDeferred).toBe(
      true,
    );
    await db
      .update(userData)
      .set({ status: "AWAKE" })
      .where(eq(userData.userId, "first"));
    await syncKageDefense(db, villageId);
    expect(
      (await db.query.kageDefendedChallenges.findFirst())?.scheduledAt?.getTime(),
    ).toBe(m.scheduledAt!.getTime() + 5 * 60_000);
  });
  it("records a missed attended start once, and does not penalize a service outage", async () => {
    const m = await due();
    expect(
      (await (await callerFor(kageRouter, "first")).checkInDefense({ id: m.id }))
        .success,
    ).toBe(true);
    const db = await getTestDatabase();
    setSystemTime(new Date(m.scheduledAt!.getTime() + 4 * 60_000));
    await syncKageDefense(db, villageId);
    setSystemTime(new Date(m.scheduledAt!.getTime() + 6 * 60_000));
    await syncKageDefense(db, villageId);
    await syncKageDefense(db, villageId);
    expect((await db.query.village.findFirst())?.kageSchedule?.missedStarts).toBe(1);
    expect((await db.query.kageDefendedChallenges.findFirst())?.status).toBe(
      "FORFEITED",
    );
    const next = await join("second");
    setSystemTime(new Date(next.scheduledAt!.getTime() + 86400_000));
    await syncKageDefense(db, villageId);
    expect((await db.query.village.findFirst())?.kageSchedule?.missedStarts).toBe(1);
    expect(
      (
        await db.query.kageDefendedChallenges.findFirst({
          where: eq(kageDefendedChallenges.id, next.id),
        })
      )?.status,
    ).toBe("SCHEDULED");
  });
  it("does not blame the Kage if a checked-in challenger leaves ordinary play", async () => {
    const m = await due();
    const challenger = await callerFor(kageRouter, "first");
    await challenger.checkInDefense({ id: m.id });
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ status: "ASLEEP" })
      .where(eq(userData.userId, "first"));
    setSystemTime(new Date(m.scheduledAt!.getTime() + 4 * 60_000));
    await syncKageDefense(db, villageId);
    setSystemTime(new Date(m.scheduledAt!.getTime() + 6 * 60_000));
    await syncKageDefense(db, villageId);
    expect((await db.query.village.findFirst())?.kageSchedule?.missedStarts).toBe(0);
    expect((await db.query.kageDefendedChallenges.findFirst())?.status).toBe(
      "FORFEITED",
    );
  });
  it.each([false, true])(
    "keeps queue priority after failed combat creation (throws %s)",
    async (throws) => {
      const m = await due();
      await (await callerFor(kageRouter, "first")).checkInDefense({ id: m.id });
      setSystemTime(m.scheduledAt!);
      const db = await getTestDatabase();
      const spy = vi.spyOn(combat, "initiateBattle");
      if (throws) spy.mockRejectedValue(new Error("Injected creation failure"));
      else
        spy.mockResolvedValue({
          success: false,
          message: "Injected creation failure",
        } as never);
      const start = (await callerFor(kageRouter, "defender")).startDefense({
        id: m.id,
      });
      if (throws) await expect(start).rejects.toThrow("Injected creation failure");
      else expect((await start).success).toBe(false);
      setSystemTime(new Date(m.scheduledAt!.getTime() + 6 * 60_000));
      await syncKageDefense(db, villageId);
      const stored = await db.query.kageDefendedChallenges.findFirst();
      expect(stored?.status).toBe("SCHEDULED");
      expect(stored?.startedAt).toBeNull();
      expect(stored?.rescheduled).toBe(false);
      expect(stored!.scheduledAt!.getTime()).toBeGreaterThan(m.scheduledAt!.getTime());
      expect((await db.query.village.findFirst())?.kageSchedule?.missedStarts).toBe(0);
    },
  );
  it("transfers an NPC title once using the canonical defender and rejects stale tenures", async () => {
    const m = await join();
    const db = await getTestDatabase();
    await db
      .update(kageDefendedChallenges)
      .set({ status: "BATTLE", battleId: "defense-battle", startedAt: now })
      .where(eq(kageDefendedChallenges.id, m.id));
    const b = makeCompleteBattle({
      id: "defense-battle",
      battleType: "KAGE_PVP",
      usersState: [
        makeBattleUser("first", { isAggressor: true, villageId, curHealth: 100 }),
        makeBattleUser("npc-clone", {
          isAggressor: false,
          villageId,
          curHealth: 0,
          isAi: true,
        }),
      ],
    });
    b.extraState.kageMatch = {
      id: m.id,
      villageId,
      kageId: "defender",
      tenure: now.toISOString(),
      ai: false,
    };
    await updateKage(db, b, {} as never);
    await updateKage(db, b, {} as never);
    expect((await db.query.village.findFirst())?.kageId).toBe("first");
    expect(await db.query.kageDefendedChallenges.findMany()).toHaveLength(1);
    expect((await db.query.kageDefendedChallenges.findFirst())?.kageId).toBe(
      "defender",
    );
    await db
      .update(village)
      .set({ kageId: "defender", leaderUpdatedAt: new Date(now.getTime() + 1) })
      .where(eq(village.id, villageId));
    await updateKage(db, b, {} as never);
    expect((await db.query.village.findFirst())?.kageId).toBe("defender");
  });
  it("keeps hospital recovery from overlapping the following assigned slot", async () => {
    const m = await due();
    const next = await join("second");
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ status: "HOSPITALIZED" })
      .where(eq(userData.userId, "first"));
    setSystemTime(m.scheduledAt!);
    await syncKageDefense(db, villageId);
    setSystemTime(new Date(next.scheduledAt!.getTime() - 3 * 60_000));
    await db
      .update(userData)
      .set({ status: "AWAKE" })
      .where(eq(userData.userId, "first"));
    await syncKageDefense(db, villageId);
    const entries = await db.query.kageDefendedChallenges.findMany();
    const head = entries.find((m) => m.userId === "first")!;
    const tail = entries.find((m) => m.userId === "second")!;
    expect(
      tail.scheduledAt!.getTime() - head.scheduledAt!.getTime(),
    ).toBeGreaterThanOrEqual(60 * 60_000);
  });
  it("retains FIFO order when an outage moves the head past a later assignment", async () => {
    const head = await join();
    const tail = await join("second");
    await join("third");
    const db = await getTestDatabase();
    setSystemTime(new Date(head.scheduledAt!.getTime() + 6 * 60_000));
    await syncKageDefense(db, villageId);
    const hall = (
      await (await callerFor(kageRouter, "first")).getDefenses({ villageId })
    ).hall!;
    expect(hall.queue.map((m) => m.challengerId)).toEqual(["first", "second", "third"]);
    expect(hall.queue[0]!.scheduledAt!.toISOString()).toBe("2026-10-15T14:00:00.000Z");
    expect(hall.queue[0]!.scheduledAt!.getTime()).toBeGreaterThan(
      tail.scheduledAt!.getTime(),
    );
    expect(hall.queue[1]!.scheduledAt!.getTime()).toBeGreaterThan(
      hall.queue[0]!.scheduledAt!.getTime(),
    );
  });
  it.each(["BATTLE", "STARTING"] as const)(
    "releases an orphaned %s reservation without prestige, attendance or allowance penalties",
    async (status) => {
      const m = await join();
      await join("second");
      const db = await getTestDatabase();
      await db
        .update(kageDefendedChallenges)
        .set({ status, battleId: "deleted-defense", startedAt: now })
        .where(eq(kageDefendedChallenges.id, m.id));
      await syncKageDefense(db, villageId);
      const stored = (await db.query.kageDefendedChallenges.findFirst({
        where: eq(kageDefendedChallenges.id, m.id),
      }))!;
      expect(stored.status).toBe("CANCELLED");
      expect({
        sameDay: withinKageChallengeLimits([stored], now),
        thirdThisWeek: withinKageChallengeLimits(
          [
            stored,
            ...[13, 14].map((day) => ({
              startedAt: new Date(`2026-10-${day}T12:00Z`),
            })),
          ],
          new Date("2026-10-15T12:00Z"),
        ),
      }).toEqual({ sameDay: true, thirdThisWeek: true });
      expect(stored.startedAt).toBeNull();
      expect(
        (await (await callerFor(kageRouter, "first")).joinDefenseQueue({ villageId }))
          .success,
      ).toBe(true);
      expect(
        (await db.query.userData.findFirst({ where: eq(userData.userId, "first") }))
          ?.villagePrestige,
      ).toBe(KAGE_PRESTIGE_REQUIREMENT);
      expect((await db.query.village.findFirst())?.kageSchedule?.missedStarts).toBe(0);
    },
  );
  it("never removes an NPC incumbent when a checked-in challenger declines to start", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ isAi: true })
      .where(eq(userData.userId, "defender"));
    for (let i = 0; i < 3; i++) {
      const m = await due();
      expect(
        (await (await callerFor(kageRouter, "first")).checkInDefense({ id: m.id }))
          .success,
      ).toBe(true);
      setSystemTime(new Date(m.scheduledAt!.getTime() + 4 * 60_000));
      await syncKageDefense(db, villageId);
      setSystemTime(new Date(m.scheduledAt!.getTime() + 6 * 60_000));
      await syncKageDefense(db, villageId);
      expect(
        (
          await db.query.kageDefendedChallenges.findFirst({
            where: eq(kageDefendedChallenges.id, m.id),
          })
        )?.status,
      ).toBe("FORFEITED");
      expect((await db.query.village.findFirst())?.kageId).toBe("defender");
      expect((await db.query.village.findFirst())?.kageSchedule?.missedStarts).toBe(0);
    }
  });
  /** Persist a terminal challenger forfeit with its active receipt for settlement and recovery tests. */
  const terminalDefense = async () => {
    const m = await join();
    const db = await getTestDatabase();
    const fight = makeCompleteBattle({
      id: "atomic-defense",
      version: 1,
      battleType: "KAGE_PVP",
      background: "default",
      usersState: [
        makeBattleUser("first", {
          isAggressor: true,
          villageId,
          curHealth: 100,
          fledBattle: true,
          leftBattle: true,
        }),
        makeBattleUser("defender", { isAggressor: false, villageId, curHealth: 100 }),
      ],
    });
    fight.extraState.kageMatch = {
      id: m.id,
      villageId,
      kageId: "defender",
      tenure: now.toISOString(),
      ai: false,
    };
    const result = calcBattleResult(fight, "defender", []);
    expect(result).not.toBeNull();
    expect(result!.friendsLeft + result!.targetsLeft).toBe(0);
    await db.insert(battle).values(fight);
    await db
      .update(kageDefendedChallenges)
      .set({ status: "BATTLE", battleId: fight.id, startedAt: now })
      .where(eq(kageDefendedChallenges.id, m.id));
    return { db, m, fight, result };
  };
  it("completes a forfeited battle before orphan recovery and retains its challenge allowance", async () => {
    const { db, m, fight, result } = await terminalDefense();
    await syncKageDefense(db, villageId);
    expect(
      (
        await db.query.kageDefendedChallenges.findFirst({
          where: eq(kageDefendedChallenges.id, m.id),
        })
      )?.status,
    ).toBe("BATTLE");
    const claims = await Promise.all([
      updateBattle(db, result, "defender", structuredClone(fight), fight.version),
      updateBattle(db, result, "defender", structuredClone(fight), fight.version),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await db.query.battle.findFirst()).toBeUndefined();
    await syncKageDefense(db, villageId);
    const stored = (await db.query.kageDefendedChallenges.findFirst({
      where: eq(kageDefendedChallenges.id, m.id),
    }))!;
    expect(stored).toEqual(
      expect.objectContaining({
        id: m.id,
        status: "COMPLETED",
        didWin: 0,
        rounds: fight.round,
        resolvedAt: now,
        userId: "first",
        kageId: "defender",
      }),
    );
    await updateKage(db, fight, result);
    await updateKage(db, fight, result);
    expect(await db.query.kageDefendedChallenges.findMany()).toHaveLength(1);
    expect(stored.startedAt).toEqual(now);
    expect(withinKageChallengeLimits([stored], now)).toBe(false);
    expect(
      withinKageChallengeLimits(
        [
          stored,
          ...[13, 14].map((day) => ({ startedAt: new Date(`2026-10-${day}T12:00Z`) })),
        ],
        new Date("2026-10-15T12:00Z"),
      ),
    ).toBe(false);
  });
  it("rolls back battle deletion if its queue receipt cannot complete", async () => {
    const { db, m, fight, result } = await terminalDefense();
    const failing = inTransactions(db, (tx) =>
      failStatements(tx, kageDefendedChallenges),
    );
    await expect(
      updateBattle(failing, result, "defender", fight, fight.version),
    ).rejects.toThrow("Statement failed on purpose");
    expect((await db.query.battle.findFirst())?.id).toBe(fight.id);
    expect(
      (
        await db.query.kageDefendedChallenges.findFirst({
          where: eq(kageDefendedChallenges.id, m.id),
        })
      )?.status,
    ).toBe("BATTLE");
  });
  it("reuses recent public snapshots while cron and mutation synchronization remain authoritative", async () => {
    const db = await getTestDatabase();
    const reader = await callerFor(kageRouter, "first");
    const initial = (await db.query.village.findFirst())!.kageScheduleVersion;
    await reader.getDefenses({ villageId });
    await reader.getDefenses({ villageId });
    expect((await db.query.village.findFirst())?.kageScheduleVersion).toBe(initial);
    setSystemTime(new Date(now.getTime() + 31_000));
    await reader.getDefenses({ villageId });
    expect((await db.query.village.findFirst())!.kageScheduleVersion).toBeGreaterThan(
      initial,
    );
    const prior = (await db.query.village.findFirst())!.kageScheduleVersion;
    await syncKageDefense(db, villageId);
    expect((await db.query.village.findFirst())!.kageScheduleVersion).toBeGreaterThan(
      prior,
    );
  });
  it("freezes an unpublished schedule deadline across service interruptions", async () => {
    const db = await getTestDatabase();
    await db
      .update(village)
      .set({ kageSchedule: null })
      .where(eq(village.id, villageId));
    await syncKageDefense(db, villageId);
    setSystemTime(new Date(now.getTime() + 86400_000));
    await syncKageDefense(db, villageId);
    expect((await db.query.village.findFirst())?.kageId).toBe("defender");
    expect(
      new Date(
        (await db.query.village.findFirst())!.kageSchedule!.setupDueAt!,
      ).getTime(),
    ).toBeGreaterThan(Date.now());
  });
  it("removes a Kage who fails to publish within 24 hours without confiscating prestige", async () => {
    const db = await getTestDatabase();
    await db
      .update(village)
      .set({ kageSchedule: null })
      .where(eq(village.id, villageId));
    await syncKageDefense(db, villageId);
    const v = (await db.query.village.findFirst())!;
    await db
      .update(village)
      .set({
        kageSchedule: {
          ...v.kageSchedule!,
          observedAt: new Date(now.getTime() + 86340_000).toISOString(),
        },
      })
      .where(eq(village.id, villageId));
    setSystemTime(new Date(now.getTime() + 86400_000));
    await syncKageDefense(db, villageId);
    expect((await db.query.village.findFirst())?.kageId).toBe("");
    await db.insert(villageElderVote).values([
      {
        id: "old-removal",
        villageId,
        type: "KAGE_REMOVAL",
        status: "APPROVED",
        resolvedAt: now,
        targetId: "defender",
        initiatedByUserId: "second",
        endsAt: now,
      },
      {
        id: "other-removal",
        villageId,
        type: "KAGE_REMOVAL",
        status: "APPROVED",
        resolvedAt: new Date(),
        targetId: "other-kage",
        initiatedByUserId: "second",
        endsAt: now,
      },
    ]);
    await db
      .update(userData)
      .set({ rank: "ELDER" })
      .where(eq(userData.userId, "second"));
    expect(
      (
        await (
          await callerFor(kageRouter, "second")
        ).nominateKage({ villageId, userId: "first" })
      ).success,
    ).toBe(true);
    expect((await db.query.village.findFirst())?.kageId).toBe("first");
    expect(
      (await db.query.villageElderVote.findMany()).every(
        (motion) => motion.successorId === null,
      ),
    ).toBe(true);
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, "defender") }))
        ?.villagePrestige,
    ).toBe(KAGE_PRESTIGE_REQUIREMENT);
  });
});

it("uses UTC days and Monday calendar weeks for challenger caps", () => {
  expect(
    withinKageChallengeLimits(
      [{ startedAt: new Date("2026-10-12T00:00Z") }],
      new Date("2026-10-12T23:59Z"),
    ),
  ).toBe(false);
  expect(
    withinKageChallengeLimits(
      [{ startedAt: new Date("2026-10-11T23:59Z") }],
      new Date("2026-10-12T00:00Z"),
    ),
  ).toBe(true);
  expect(
    withinKageChallengeLimits(
      [13, 14, 15].map((day) => ({ startedAt: new Date(`2026-10-${day}T12:00Z`) })),
      new Date("2026-10-16T12:00Z"),
    ),
  ).toBe(false);
  expect(
    getKageSlots(windows, now)
      .slice(0, 2)
      .map((d) => d.toISOString()),
  ).toEqual(["2026-10-13T14:00:00.000Z", "2026-10-13T15:00:00.000Z"]);
});

/** Start a Kage defense sync and hold it after it loads its locked snapshot until `release`. */
async function pauseKageSync(db: DrizzleClient) {
  const { promise: loaded, resolve: markLoaded } = deferred<void>();
  const { promise: resume, resolve: release } = deferred<void>();
  const syncing = withKageDefense(db, villageId, async (tx, hall) => {
    markLoaded();
    await resume;
    return syncLockedKageDefense(tx, hall);
  });
  await loaded;
  return { syncing, release };
}

/** Resolves true when `promise` is still unsettled 50 ms later. */
function stillPending(promise: Promise<unknown>) {
  return Promise.race([
    promise.then(() => false),
    new Promise<true>((resolve) => setTimeout(() => resolve(true), 50)),
  ]);
}

/** A recorded mutation wrote exactly one guarded UPDATE and opened no transaction. */
function expectSingleGuardedUpdate(statements: string[]) {
  expect(statements.filter((statement) => /^\s*update /i.test(statement))).toHaveLength(
    1,
  );
  expect(
    statements.some((statement) => /begin|start transaction|commit/i.test(statement)),
  ).toBe(false);
}
