import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as clerk from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import {
  accountDeletion,
  actionLog,
  bloodline,
  historicalIp,
  sanctionTombstone,
  storeUserIdAlias,
  type UserReport,
  userData,
  userReport,
  userReportComment,
  village,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { fetchActiveSanctionTombstones } from "@/queries/reports";
import { profileRouter } from "@/server/api/routers/profile";
import { reportsRouter } from "@/server/api/routers/reports";
import { removeAccountGameData } from "@/server/utils/accountDeletion/cleanup";
import { processAccountDeletions } from "@/server/utils/accountDeletion/process";
import * as sanctions from "@/server/utils/sanctionTombstone";
import {
  hashSanctionIdentifier,
  hashSanctionIp,
  recordSanctionTombstone,
  type SanctionIdentity,
} from "@/server/utils/sanctionTombstone";
import { deferred } from "../../setup/deferred";
import { insertUsers } from "../../setup/factories";
import { insertRegistrationContent, registerCharacter } from "../../setup/registration";
import {
  insertSanctionReports,
  sanctionIdentity,
  stubClerkUsers,
} from "../../setup/sanctions";
import {
  aroundStatements,
  beforeStatements,
  interceptExecute,
} from "../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const DAY = 86_400_000;
const NATIVE_USER = "native-deleting";
const identity = sanctionIdentity("native-appeal@example.com", [
  { provider: "oauth_google", providerUserId: "native-subject" },
]);
const hashes = {
  emailHash: hashSanctionIdentifier("email", "native-appeal@example.com"),
  accountHashes: [hashSanctionIdentifier("oauth", "google:native-subject")],
};

const addReport = (
  id: string,
  status: "BAN_ACTIVATED" | "SILENCE_ACTIVATED" | "TIMEOUT_ACTIVATED",
  end: Date,
) => insertSanctionReports([{ id, reportedUserId: NATIVE_USER, status, banEnd: end }]);

const startDeletion = async () => {
  const database = await getTestDatabase();
  await database.insert(accountDeletion).values({ userId: NATIVE_USER });
  expect(await processAccountDeletions(NATIVE_USER)).toEqual({
    processed: 1,
    failed: 0,
  });
  const job = await database.query.accountDeletion.findFirst({
    where: eq(accountDeletion.userId, NATIVE_USER),
  });
  expect(job).toMatchObject({ phase: "IDENTITY_DELETED" });
  expect(job!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 299_000);
  expect(await database.query.userReport.findFirst()).toBeDefined();
  expect(
    await database.query.userData.findFirst({
      where: eq(userData.userId, NATIVE_USER),
    }),
  ).toBeDefined();
  expect(await database.query.sanctionTombstone.findMany()).toEqual(
    expect.arrayContaining([expect.objectContaining(hashes)]),
  );
};

const finishDeletion = async (userId = NATIVE_USER) => {
  const database = await getTestDatabase();
  await database
    .update(accountDeletion)
    .set({ nextAttemptAt: new Date(Date.now() - 1) })
    .where(eq(accountDeletion.userId, userId));
  expect(await processAccountDeletions(userId)).toEqual({
    processed: 1,
    failed: 0,
  });
  expect(
    await database.query.accountDeletion.findFirst({
      where: eq(accountDeletion.userId, userId),
    }),
  ).toMatchObject({ phase: "COMPLETE" });
  expect(
    await database.query.userReport.findFirst({
      where: eq(userReport.reportedUserId, userId),
    }),
  ).toBeUndefined();
};

const register = async (userId: string, userIp?: string) => {
  expect(
    await registerCharacter(
      userId,
      { username: userId, bloodlineId: "native-bloodline" },
      { userIp },
    ),
  ).toMatchObject({ success: true });
  return (await getTestDatabase()).query.userReport.findMany({
    where: eq(userReport.reportedUserId, userId),
  });
};

const decisionInput = {
  object_id: "original",
  comment: "Revise the original case after an appeal",
  banTime: 1,
  banTimeUnit: "days" as const,
};

/** Native re-registration can reuse an identity only after its Clerk owner is deleted. */
const stubSingleIdentity = (afterDelete?: () => Promise<void>) => {
  const liveOwners = new Map([[NATIVE_USER, identity]]);
  stubClerkUsers((userId) => liveOwners.get(userId), {
    deleteUser: async (userId) => {
      liveOwners.delete(userId);
      await afterDelete?.();
    },
  });
  return {
    register: async (userId: string, ownerIdentity = identity, userIp?: string) => {
      expect(liveOwners.size).toBe(0);
      liveOwners.set(userId, ownerIdentity);
      return register(userId, userIp);
    },
    replace: (userId: string, replacement: SanctionIdentity) => {
      expect(liveOwners.has(userId)).toBe(true);
      liveOwners.set(userId, replacement);
    },
  };
};

const deleteReplacement = async () => {
  await (await getTestDatabase())
    .insert(accountDeletion)
    .values({ userId: "DuringDelay" });
  expect(await processAccountDeletions("DuringDelay")).toEqual({
    processed: 1,
    failed: 0,
  });
  await finishDeletion("DuringDelay");
};

/** Pause an atomic decision write to interleave authorized actions and cleanup. */
const pauseNextDecision = async (beforeWrite = false) => {
  const database = await getTestDatabase();
  const { promise: entered, resolve: enter } = deferred<void>();
  const { promise: gate, resolve: release } = deferred<void>();
  let paused = false;
  const client = interceptExecute(database, async (_query, run) => {
    if (paused) return run();
    paused = true;
    if (beforeWrite) {
      enter();
      await gate;
    }
    const result = await run();
    if (!beforeWrite) {
      enter();
      await gate;
    }
    return result;
  });
  return { client, entered, release };
};

describeWithDatabase("original sanctions during native deletion", () => {
  beforeEach(async () => {
    await resetTables(
      accountDeletion,
      actionLog,
      bloodline,
      historicalIp,
      sanctionTombstone,
      storeUserIdAlias,
      userData,
      userReport,
      userReportComment,
      village,
    );
    await Promise.all([
      insertUsers([{ userId: "staff", role: "OWNER" }, { userId: NATIVE_USER }]),
      insertRegistrationContent("native"),
    ]);
    const deletedIdentities = new Set<string>();
    stubClerkUsers((userId) => (deletedIdentities.has(userId) ? undefined : identity), {
      deleteUser: async (userId) => {
        deletedIdentities.add(userId);
      },
    });
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await resetTables(sanctionTombstone);
  });

  it.each(["clear", "silence", "ban"] as const)(
    "preserves carryover %s while the original Clerk deletion retries",
    async (decision) => {
      const database = await getTestDatabase();
      const ip = "192.0.2.71";
      await database
        .update(userData)
        .set({ lastIp: ip })
        .where(eq(userData.userId, NATIVE_USER));
      await addReport("original", "BAN_ACTIVATED", new Date(Date.now() + 10 * DAY));
      let failsOnce = true;
      const deleted = new Set<string>();
      stubClerkUsers(
        (userId) =>
          deleted.has(userId) ? undefined : sanctionIdentity(`${userId}@example.com`),
        {
          deleteUser: async (userId) => {
            if (failsOnce) {
              failsOnce = false;
              throw new Error("Clerk temporarily unavailable");
            }
            deleted.add(userId);
          },
        },
      );
      await database.insert(accountDeletion).values({ userId: NATIVE_USER });
      expect(await processAccountDeletions(NATIVE_USER)).toEqual({
        processed: 0,
        failed: 1,
      });
      expect(await database.query.accountDeletion.findFirst()).toMatchObject({
        phase: "QUEUED",
      });
      const [inherited] = await register("DuringDelay", ip);
      expect(inherited).toMatchObject({ status: "BAN_ACTIVATED" });
      const paused = await pauseNextDecision();
      const deciding = callerForDatabase(reportsRouter, "staff", paused.client)[
        decision
      ]({
        ...decisionInput,
        object_id: inherited!.id,
        banTime: 30,
      });
      await paused.entered;
      try {
        // Recapture after the decision but before closure/pruning must not revive it.
        const before = await database.query.sanctionTombstone.findMany();
        await recordSanctionTombstone(database, NATIVE_USER);
        expect(await database.query.sanctionTombstone.findMany()).toEqual(before);
      } finally {
        paused.release();
        await deciding;
      }
      expect(await deciding).toMatchObject({ success: true });
      const expected = await database.query.sanctionTombstone.findMany();
      if (decision === "clear") {
        expect(expected).toHaveLength(0);
        expect(
          await database.query.userReport.findFirst({
            where: eq(userReport.id, "original"),
          }),
        ).toMatchObject({ status: "REPORT_CLEARED" });
      } else {
        expect(expected).toMatchObject([
          { sanction: decision === "ban" ? "BAN" : "SILENCE" },
        ]);
        expect(expected[0]!.sanctionEndsAt.getTime()).toBeGreaterThan(
          Date.now() + 29 * DAY,
        );
      }
      await database
        .update(accountDeletion)
        .set({ nextAttemptAt: new Date(Date.now() - 1) })
        .where(eq(accountDeletion.userId, NATIVE_USER));
      expect(await processAccountDeletions(NATIVE_USER)).toEqual({
        processed: 1,
        failed: 0,
      });
      expect(await database.query.sanctionTombstone.findMany()).toEqual(expected);
      const later = await register("AfterRetry", ip);
      expect(later).toHaveLength(decision === "clear" ? 0 : 1);
      if (decision !== "clear")
        expect(later[0]).toEqual(
          expect.objectContaining({
            status: decision === "ban" ? "BAN_ACTIVATED" : "SILENCE_ACTIVATED",
            banEnd: expected[0]!.sanctionEndsAt,
          }),
        );
      await finishDeletion();
    },
  );

  it.each([false, true])(
    "finishes a clear after source pruning (deadlock: %p)",
    async (deadlock) => {
      const database = await getTestDatabase();
      await addReport("original", "BAN_ACTIVATED", new Date(Date.now() + DAY));
      await database
        .update(userData)
        .set({ isBanned: true })
        .where(eq(userData.userId, NATIVE_USER));
      await recordSanctionTombstone(database, NATIVE_USER, identity);
      let attempts = 0;
      const injected = aroundStatements(
        database,
        sanctionTombstone,
        async (run) => {
          attempts += 1;
          if (deadlock && attempts === 1)
            throw Object.assign(
              new Error(
                "Deadlock found when trying to get lock; try restarting transaction",
              ),
              { errno: 1213, code: "ER_LOCK_DEADLOCK", sqlState: "40001" },
            );
          return run();
        },
        { operations: ["delete"] },
      );
      expect(
        await callerForDatabase(reportsRouter, "staff", injected).clear(decisionInput),
      ).toMatchObject({ success: true });
      expect(
        await database.query.userReport.findFirst({
          where: eq(userReport.id, "original"),
        }),
      ).toMatchObject({ status: "REPORT_CLEARED" });
      expect(
        await database.query.userData.findFirst({
          where: eq(userData.userId, NATIVE_USER),
        }),
      ).toMatchObject({ isBanned: false });
      expect(await database.query.userReportComment.findMany()).toHaveLength(1);
      expect(await database.query.sanctionTombstone.findMany()).toHaveLength(0);
      expect(attempts).toBe(deadlock ? 2 : 1);
    },
  );

  it.each([
    ["BAN_ACTIVATED", "warn"],
    ["SILENCE_ACTIVATED", "warn"],
    ["BAN_ACTIVATED", "tradeBan"],
    ["SILENCE_ACTIVATED", "tradeBan"],
  ] as const)(
    "retires original %s replaced by %s before and after game cleanup",
    async (status, decision) => {
      await addReport("original", status, new Date(Date.now() + 10 * DAY));
      await startDeletion();
      expect(
        await (await callerFor(reportsRouter, "staff"))[decision](decisionInput),
      ).toMatchObject({ success: true });
      expect(await register("DuringDelay")).toHaveLength(0);
      await finishDeletion();
      expect(await register("AfterCleanup")).toHaveLength(0);
      expect(
        await (await getTestDatabase()).query.sanctionTombstone.findMany(),
      ).toHaveLength(0);
    },
  );

  it.each([
    ["BAN_ACTIVATED", "silence", "SILENCE_ACTIVATED"],
    ["SILENCE_ACTIVATED", "ban", "BAN_ACTIVATED"],
  ] as const)(
    "preserves captured identifiers when original %s changes via %s",
    async (status, decision, revisedStatus) => {
      await addReport("original", status, new Date(Date.now() + 10 * DAY));
      await startDeletion();
      expect(
        await (await callerFor(reportsRouter, "staff"))[decision](decisionInput),
      ).toMatchObject({ success: true });
      const revised = await (await getTestDatabase()).query.userReport.findFirst({
        where: eq(userReport.id, "original"),
      });
      for (const userId of ["DuringDelay", "AfterCleanup"]) {
        if (userId === "AfterCleanup") await finishDeletion();
        const reports = await register(userId);
        expect(reports).toHaveLength(1);
        expect(reports[0]).toEqual(
          expect.objectContaining({
            status: revisedStatus,
            banEnd: revised!.banEnd,
          }),
        );
        expect(
          await (await getTestDatabase()).query.sanctionTombstone.findMany(),
        ).toMatchObject([
          { ...hashes, sanction: decision === "ban" ? "BAN" : "SILENCE" },
        ]);
      }
    },
  );

  it.each(["clear", "warn", "tradeBan"] as const)(
    "keeps a shorter independent ban and a separate silence after %s",
    async (decision) => {
      const shorterEnd = new Date(Date.now() + 3 * DAY);
      const silenceEnd = new Date(Date.now() + 20 * DAY);
      await addReport("original", "BAN_ACTIVATED", new Date(Date.now() + 10 * DAY));
      await addReport("independent-ban", "BAN_ACTIVATED", shorterEnd);
      await addReport("independent-silence", "SILENCE_ACTIVATED", silenceEnd);
      await startDeletion();
      expect(
        await (await callerFor(reportsRouter, "staff"))[decision](decisionInput),
      ).toMatchObject({ success: true });
      for (const userId of ["DuringDelay", "AfterCleanup"]) {
        if (userId === "AfterCleanup") await finishDeletion();
        const reports = await register(userId);
        expect(reports).toHaveLength(2);
        expect(reports).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ status: "BAN_ACTIVATED", banEnd: shorterEnd }),
            expect.objectContaining({
              status: "SILENCE_ACTIVATED",
              banEnd: silenceEnd,
            }),
          ]),
        );
        const sources = await (
          await getTestDatabase()
        ).query.sanctionTombstone.findMany();
        expect(sources).toHaveLength(2);
        expect(sources).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              ...hashes,
              sourceId: "independent-ban",
              sanctionEndsAt: shorterEnd,
            }),
            expect.objectContaining({
              ...hashes,
              sourceId: "independent-silence",
              sanctionEndsAt: silenceEnd,
            }),
          ]),
        );
      }
    },
  );

  it.each([
    ["BAN_ACTIVATED", "silence", "SILENCE_ACTIVATED"],
    ["SILENCE_ACTIVATED", "ban", "BAN_ACTIVATED"],
  ] as const)(
    "keeps independent reports when one of a grouped %s converts via %s",
    async (status, decision, revisedStatus) => {
      const independentEnd = new Date(Date.now() + 3 * DAY);
      await addReport("original", status, new Date(Date.now() + 10 * DAY));
      await addReport("independent-same", status, independentEnd);
      await addReport(
        "independent-other",
        revisedStatus,
        new Date(Date.now() + 20 * DAY),
      );
      await startDeletion();
      const staff = await callerFor(reportsRouter, "staff");
      expect(await staff[decision](decisionInput)).toMatchObject({ success: true });
      const revised = await (await getTestDatabase()).query.userReport.findFirst({
        where: eq(userReport.id, "original"),
      });
      const sources = await (
        await getTestDatabase()
      ).query.sanctionTombstone.findMany();
      expect(sources).toHaveLength(3);
      expect(sources.every((source) => source.emailHash === hashes.emailHash)).toBe(
        true,
      );
      expect(
        sources.find(
          (source) => source.sanction === (decision === "ban" ? "SILENCE" : "BAN"),
        ),
      ).toEqual(
        expect.objectContaining({
          sourceId: "independent-same",
          sanctionEndsAt: independentEnd,
        }),
      );
      expect(
        await staff.clear({ ...decisionInput, object_id: "independent-other" }),
      ).toMatchObject({ success: true });
      const duringDelay = await register("DuringDelay");
      expect(duringDelay).toHaveLength(2);
      expect(duringDelay).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status, banEnd: independentEnd }),
          expect.objectContaining({ status: revisedStatus, banEnd: revised!.banEnd }),
        ]),
      );
      await finishDeletion();
      expect(await register("AfterCleanup")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status, banEnd: independentEnd }),
          expect.objectContaining({ status: revisedStatus, banEnd: revised!.banEnd }),
        ]),
      );
    },
  );

  it.each(["ban", "silence", "timeout"] as const)(
    "uses the revised original deadline immediately after staff %s",
    async (decision) => {
      await addReport(
        "original",
        decision === "timeout" ? "TIMEOUT_ACTIVATED" : "BAN_ACTIVATED",
        new Date(Date.now() + (decision === "timeout" ? 30 * 60_000 : 10 * DAY)),
      );
      await startDeletion();
      if (decision === "timeout") {
        await (await getTestDatabase())
          .update(userData)
          .set({ role: "CONTENT-ADMIN" })
          .where(eq(userData.userId, "staff"));
      }
      expect(
        await (await callerFor(reportsRouter, "staff"))[decision](decisionInput),
      ).toMatchObject({ success: true });
      const revised = await (await getTestDatabase()).query.userReport.findFirst({
        where: eq(userReport.id, "original"),
      });
      const status = decision === "ban" ? "BAN_ACTIVATED" : "SILENCE_ACTIVATED";
      expect(await register("DuringDelay")).toEqual([
        expect.objectContaining({ status, banEnd: revised!.banEnd }),
      ]);
      await finishDeletion();
      expect(await register("AfterCleanup")).toEqual([
        expect.objectContaining({ status, banEnd: revised!.banEnd }),
      ]);
    },
  );

  it("carries an unchanged original ban through both native deletion stages", async () => {
    const end = new Date(Date.now() + 10 * DAY);
    await addReport("original", "BAN_ACTIVATED", end);
    await startDeletion();
    await finishDeletion();
    expect(await register("AfterCleanup")).toEqual([
      expect.objectContaining({ status: "BAN_ACTIVATED", banEnd: end }),
    ]);
  });

  it("retains late IPs after the original report expires and staff extends its carryover", async () => {
    const { register: registerIdentity } = stubSingleIdentity();
    const database = await getTestDatabase();
    const oldIp = "192.0.2.10";
    const lateIp = "192.0.2.20";
    const end = new Date(Date.now() + 2_000);
    await addReport("original", "BAN_ACTIVATED", end);
    await database
      .update(userData)
      .set({
        lastIp: oldIp,
        isBanned: true,
        villageId: "native-horizon",
        updatedAt: new Date(Date.now() - 360_000),
      })
      .where(eq(userData.userId, NATIVE_USER));
    const { promise: entered, resolve: enter } = deferred<void>();
    const { promise: gate, resolve: release } = deferred<void>();
    const paused = beforeStatements(database, historicalIp, [
      async () => {
        enter();
        await gate;
      },
    ]);
    const pending = profileRouter
      .createCaller({
        drizzle: paused,
        userId: NATIVE_USER,
        userIp: lateIp,
      } as never)
      .getUser();
    await entered;
    try {
      await startDeletion();
    } finally {
      release();
    }
    await pending;
    expect(
      await database.query.historicalIp.findFirst({
        where: eq(historicalIp.userId, NATIVE_USER),
      }),
    ).toMatchObject({ ip: lateIp });
    expect(
      await database.query.userData.findFirst({
        where: eq(userData.userId, NATIVE_USER),
      }),
    ).toMatchObject({ lastIp: lateIp });
    const [inherited] = await registerIdentity("DuringDelay", identity, oldIp);
    expect(inherited).toBeDefined();
    expect(
      await (await callerFor(reportsRouter, "staff")).ban({
        ...decisionInput,
        object_id: inherited!.id,
      }),
    ).toMatchObject({ success: true });
    const revised = await database.query.userReport.findFirst({
      where: eq(userReport.id, inherited!.id),
    });
    expect(revised!.banEnd!.getTime()).toBeGreaterThan(end.getTime());
    // The raw report can expire during the native drain while its retained case runs on.
    // Cleanup also compares MySQL's clock, so advancing only Bun would change the report state.
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, end.getTime() - Date.now() + 30)),
    );
    expect(
      await database.query.userReport.findFirst({
        where: eq(userReport.id, "original"),
      }),
    ).toEqual(expect.objectContaining({ banEnd: end }));
    expect(end.getTime()).toBeLessThan(Date.now());
    await finishDeletion();
    expect(
      await database.query.historicalIp.findMany({
        where: eq(historicalIp.userId, NATIVE_USER),
      }),
    ).toHaveLength(0);
    const retained = await database.query.sanctionTombstone.findFirst();
    await deleteReplacement();
    expect(
      await registerIdentity(
        "AfterCleanup",
        {
          ...identity,
          emailAddresses: [
            {
              id: "primary",
              emailAddress: "new@example.com",
              verification: { status: "verified" },
            },
          ],
          externalAccounts: [],
        },
        lateIp,
      ),
    ).toEqual([
      expect.objectContaining({ status: "BAN_ACTIVATED", banEnd: revised!.banEnd }),
    ]);
    expect(
      await database.query.userData.findFirst({
        where: eq(userData.userId, "AfterCleanup"),
      }),
    ).toMatchObject({ isBanned: true });
    expect(retained).toEqual(
      expect.objectContaining({
        ...hashes,
        sanction: "BAN",
        sanctionEndsAt: revised!.banEnd,
        ipHashes: expect.arrayContaining([
          hashSanctionIp(oldIp),
          hashSanctionIp(lateIp),
        ]),
      }),
    );
  });

  it.each([
    ["ban", true, false],
    ["silence", true, false],
    ["clear", true, false],
    ["silence", false, false],
    ["clear", false, false],
    ["ban", false, true],
    ["silence", false, true],
    ["clear", false, true],
  ] as const)(
    "preserves carryover %s through cleanup with independent silence: %p, raw reports removed: %p",
    async (decision, hasIndependentSilence, reportsRemoved) => {
      const database = await getTestDatabase();
      const originalEnd = new Date(Date.now() + 10 * DAY);
      const independentEnd = new Date(Date.now() + 20 * DAY);
      await addReport("original", "BAN_ACTIVATED", originalEnd);
      if (hasIndependentSilence)
        await addReport("independent-silence", "SILENCE_ACTIVATED", independentEnd);
      await startDeletion();
      const duringDelay = await register("DuringDelay");
      const inherited = duringDelay.find(
        (report) => report.status === "BAN_ACTIVATED",
      )!;
      expect(
        await (await callerFor(reportsRouter, "staff"))[decision]({
          ...decisionInput,
          object_id: inherited.id,
          banTime: decision === "ban" ? 20 : 1,
        }),
      ).toMatchObject({ success: true });
      const revised = await database.query.userReport.findFirst({
        where: eq(userReport.id, inherited.id),
      });
      const snapshot = await database.query.sanctionTombstone.findMany({
        where: eq(sanctionTombstone.userId, NATIVE_USER),
      });
      if (decision === "clear") {
        expect(snapshot.some((source) => source.sourceId === "original")).toBe(false);
      } else {
        expect(snapshot.find((source) => source.sourceId === "original")).toEqual(
          expect.objectContaining({
            ...hashes,
            sanction: decision === "ban" ? "BAN" : "SILENCE",
            sanctionEndsAt: revised!.banEnd,
          }),
        );
      }
      // Late IP capture must leave the carryover's decision authoritative over the original report.
      const lateIp = "192.0.2.30";
      await database
        .update(userData)
        .set({ lastIp: lateIp })
        .where(eq(userData.userId, NATIVE_USER));
      const withLateIp = snapshot.map((source) => ({
        ...source,
        ipHashes: [...new Set([...source.ipHashes, hashSanctionIp(lateIp)!])],
      }));
      if (reportsRemoved)
        await database
          .delete(userReport)
          .where(eq(userReport.reportedUserId, NATIVE_USER));
      const clerkLookup = vi.spyOn(clerk, "clerkClient").mockClear();
      await recordSanctionTombstone(database, NATIVE_USER);
      if (reportsRemoved) expect(clerkLookup).not.toHaveBeenCalled();
      expect(
        await database.query.sanctionTombstone.findMany({
          where: eq(sanctionTombstone.userId, NATIVE_USER),
        }),
      ).toEqual(withLateIp);
      await finishDeletion();
      expect(
        await database.query.sanctionTombstone.findMany({
          where: eq(sanctionTombstone.userId, NATIVE_USER),
        }),
      ).toEqual(withLateIp);
      // A retry after the reports are gone must preserve the retained staff decision.
      await removeAccountGameData(NATIVE_USER);
      expect(
        await database.query.sanctionTombstone.findMany({
          where: eq(sanctionTombstone.userId, NATIVE_USER),
        }),
      ).toEqual(withLateIp);

      // Release the replacement's sign-in identity before another account reuses it.
      await deleteReplacement();
      const returned = await register("AfterCleanup");
      const expected = [
        ...(decision === "ban"
          ? [{ status: "BAN_ACTIVATED", banEnd: revised!.banEnd }]
          : []),
        ...(hasIndependentSilence
          ? [{ status: "SILENCE_ACTIVATED", banEnd: independentEnd }]
          : decision === "silence"
            ? [{ status: "SILENCE_ACTIVATED", banEnd: revised!.banEnd }]
            : []),
      ];
      expect(returned).toHaveLength(expected.length);
      expect(returned).toEqual(
        expect.arrayContaining(
          expected.map((report) => expect.objectContaining(report)),
        ),
      );
      if (hasIndependentSilence) {
        expect(
          snapshot.find((source) => source.sourceId === "independent-silence"),
        ).toEqual(
          expect.objectContaining({
            ...hashes,
            sanction: "SILENCE",
            sanctionEndsAt: independentEnd,
          }),
        );
      } else if (decision === "clear") {
        expect(await database.query.sanctionTombstone.findMany()).toHaveLength(0);
      }
    },
  );

  it.each([
    ["ban", false],
    ["silence", false],
    ["clear", false],
    ["ban", true],
    ["silence", true],
    ["clear", true],
  ] as const)(
    "preserves carryover %s across an independent original edit: %p",
    async (decision, editIndependent) => {
      const { register: registerIdentity } = stubSingleIdentity();
      const database = await getTestDatabase();
      const independentEnd = new Date(Date.now() + 20 * DAY);
      await addReport("original", "BAN_ACTIVATED", new Date(Date.now() + 10 * DAY));
      await addReport("independent-silence", "SILENCE_ACTIVATED", independentEnd);
      await startDeletion();
      const inherited = (await registerIdentity("DuringDelay")).find(
        (report) => report.status === "BAN_ACTIVATED",
      )!;
      const staff = await callerFor(reportsRouter, "staff");
      expect(
        await staff[decision]({ ...decisionInput, object_id: inherited.id }),
      ).toMatchObject({ success: true });
      const revised = await database.query.userReport.findFirst({
        where: eq(userReport.id, inherited.id),
      });
      const before = await database.query.sanctionTombstone.findMany();
      if (editIndependent) {
        expect(
          await staff.clear({ ...decisionInput, object_id: "independent-silence" }),
        ).toMatchObject({ success: true });
      }
      const expected = before.filter(
        (source) => !editIndependent || source.sourceId !== "independent-silence",
      );
      expect(await database.query.sanctionTombstone.findMany()).toEqual(expected);
      await recordSanctionTombstone(database, NATIVE_USER, null);
      await finishDeletion();
      await removeAccountGameData(NATIVE_USER);
      expect(await database.query.sanctionTombstone.findMany()).toEqual(expected);
      await deleteReplacement();
      const returned = await registerIdentity("AfterCleanup");
      const returnedBan = returned.find((report) => report.status === "BAN_ACTIVATED");
      if (decision === "ban") {
        expect(returnedBan).toEqual(
          expect.objectContaining({ banEnd: revised!.banEnd }),
        );
      } else {
        expect(returnedBan).toBeUndefined();
      }
      // The replacement's separate silence remains its own live moderation case.
      expect(returned.find((report) => report.status === "SILENCE_ACTIVATED")).toEqual(
        expect.objectContaining({ banEnd: independentEnd }),
      );
      expect(returned).toHaveLength(decision === "ban" ? 2 : 1);
      const active = await (await callerFor(reportsRouter, "AfterCleanup")).getBan();
      expect(active?.status === "BAN_ACTIVATED").toBe(decision === "ban");
      expect(
        await database.query.userData.findFirst({
          columns: { isBanned: true, isSilenced: true },
          where: eq(userData.userId, "AfterCleanup"),
        }),
      ).toEqual({ isBanned: decision === "ban", isSilenced: true });
    },
  );

  it.each([
    ["BAN_ACTIVATED", "SILENCE_ACTIVATED", "silence", "ban"],
    ["SILENCE_ACTIVATED", "BAN_ACTIVATED", "ban", "silence"],
  ] as const)(
    "keeps each original %s case's carryover decision after one case is revised and cleared",
    async (originalStatus, convertedStatus, convert, independentDecision) => {
      const { register: registerIdentity, replace } = stubSingleIdentity();
      const database = await getTestDatabase();
      await addReport("original", originalStatus, new Date(Date.now() + 10 * DAY));
      await addReport(
        "independent-same",
        originalStatus,
        new Date(Date.now() + 3 * DAY),
      );
      await addReport(
        "independent-other",
        convertedStatus,
        new Date(Date.now() + 20 * DAY),
      );
      await startDeletion();
      const inherited = await registerIdentity("DuringDelay");
      expect(inherited).toHaveLength(2);
      const grouped = inherited.find((report) => report.status === originalStatus)!;
      const independent = inherited.find(
        (report) => report.status === convertedStatus,
      )!;
      const staff = await callerFor(reportsRouter, "staff");
      expect(
        await staff[convert]({ ...decisionInput, object_id: grouped.id }),
      ).toMatchObject({ success: true });
      expect(
        await staff[independentDecision]({
          ...decisionInput,
          object_id: independent.id,
          banTime: 2,
        }),
      ).toMatchObject({ success: true });
      const before = await database.query.sanctionTombstone.findMany();
      const remaining = before.find(
        (source) => source.sourceId === "independent-same",
      )!;
      const separate = before.find(
        (source) => source.sourceId === "independent-other",
      )!;
      expect(await staff[convert]({ ...decisionInput, banTime: 4 })).toMatchObject({
        success: true,
      });
      const revised = await database.query.userReport.findFirst({
        where: eq(userReport.id, "original"),
      });
      expect(await database.query.sanctionTombstone.findMany()).toEqual(
        expect.arrayContaining([
          remaining,
          separate,
          expect.objectContaining({
            sourceId: "original",
            ...hashes,
            sanction: convert === "ban" ? "BAN" : "SILENCE",
            sanctionEndsAt: revised!.banEnd,
            carryoverReportIds: [grouped.id],
          }),
        ]),
      );
      expect(await staff.clear(decisionInput)).toMatchObject({ success: true });
      const expected = [remaining, separate].sort((a, b) =>
        a.sourceId.localeCompare(b.sourceId),
      );
      expect(await database.query.sanctionTombstone.findMany()).toEqual(expected);
      await finishDeletion();
      await removeAccountGameData(NATIVE_USER);
      expect(await database.query.sanctionTombstone.findMany()).toEqual(expected);
      // Only the original account's captured identifiers can match the next account.
      replace("DuringDelay", {
        primaryEmailAddressId: "changed-email",
        emailAddresses: [
          {
            id: "changed-email",
            emailAddress: "changed-native@example.com",
            verification: { status: "verified" },
          },
        ],
        externalAccounts: [],
      });
      await deleteReplacement();
      const returned = await registerIdentity("AfterCleanup");
      expect(returned).toHaveLength(2);
      expect(returned).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: convertedStatus,
            banEnd: remaining.sanctionEndsAt,
          }),
          expect.objectContaining({
            status: originalStatus,
            banEnd: separate.sanctionEndsAt,
          }),
        ]),
      );
      expect(
        await database.query.actionLog.findMany({
          where: eq(actionLog.userId, "AfterCleanup"),
        }),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            changes: expect.arrayContaining([
              expect.stringContaining("independent-same"),
            ]),
          }),
          expect.objectContaining({
            changes: expect.arrayContaining([
              expect.stringContaining("independent-other"),
            ]),
          }),
        ]),
      );
    },
  );

  it.each([
    ["ban", "silence"],
    ["silence", "ban"],
    ["ban", "ban"],
    ["ban", "clear"],
  ] as const)(
    "keeps the later %s → %s decision when an earlier response is delayed across cleanup",
    async (earlier, later) => {
      const { register: registerIdentity } = stubSingleIdentity();
      const database = await getTestDatabase();
      await addReport("original", "BAN_ACTIVATED", new Date(Date.now() + 10 * DAY));
      await startDeletion();
      const { client, entered, release } = await pauseNextDecision();
      const staff = callerForDatabase(reportsRouter, "staff", client);
      const pending = staff[earlier](decisionInput);
      await entered;
      let current!: UserReport;
      try {
        expect(await staff[later]({ ...decisionInput, banTime: 2 })).toMatchObject({
          success: true,
        });
        current = (await database.query.userReport.findFirst({
          where: eq(userReport.id, "original"),
        }))!;
        const active = await fetchActiveSanctionTombstones(database);
        expect(active).toHaveLength(later === "clear" ? 0 : 1);
        if (later !== "clear")
          expect(active[0]).toEqual(
            expect.objectContaining({
              sanction: later === "ban" ? "BAN" : "SILENCE",
              sanctionEndsAt: current.banEnd,
              ...hashes,
            }),
          );
        await finishDeletion();
      } finally {
        release();
      }
      expect(await pending).toMatchObject({ success: true });
      const returned = await registerIdentity("AfterCleanup");
      expect(returned).toHaveLength(later === "clear" ? 0 : 1);
      if (later !== "clear")
        expect(returned[0]).toEqual(
          expect.objectContaining({
            status: current.status,
            banEnd: current.banEnd,
            adminResolved: true,
          }),
        );
    },
  );

  it.each([
    ["ban", false],
    ["silence", false],
    ["timeout", false],
    ["ban", true],
    ["silence", true],
    ["timeout", true],
  ] as const)(
    "rejects an authorized %s after a concurrent clear (pruned: %p)",
    async (decision, hasPruned) => {
      const { register: registerIdentity } = stubSingleIdentity();
      const database = await getTestDatabase();
      await addReport(
        "original",
        decision === "timeout" ? "TIMEOUT_ACTIVATED" : "BAN_ACTIVATED",
        new Date(Date.now() + 10 * DAY),
      );
      await database
        .update(userData)
        .set({
          status: "TRAVEL",
          travelFinishAt: new Date(Date.now() + DAY),
          isBanned: decision !== "timeout",
          isSilenced: decision === "timeout",
        })
        .where(eq(userData.userId, NATIVE_USER));
      await startDeletion();
      if (decision === "timeout")
        await database
          .update(userData)
          .set({ role: "CONTENT-ADMIN" })
          .where(eq(userData.userId, "staff"));
      // Both actions pass moderation guards while the report is still resolvable.
      const later = await pauseNextDecision(true);
      const pending = callerForDatabase(reportsRouter, "staff", later.client)[decision](
        decisionInput,
      );
      await later.entered;
      const earlier = await pauseNextDecision();
      const clearing = callerForDatabase(reportsRouter, "staff", earlier.client).clear(
        decisionInput,
      );
      await earlier.entered;
      try {
        if (hasPruned) {
          earlier.release();
          expect(await clearing).toMatchObject({ success: true });
        }
        const current = await database.query.userReport.findFirst({
          where: eq(userReport.id, "original"),
        });
        const account = await database.query.userData.findFirst({
          where: eq(userData.userId, NATIVE_USER),
        });
        const comments = await database.query.userReportComment.findMany();
        const sources = await database.query.sanctionTombstone.findMany();
        expect(current?.status).toBe("REPORT_CLEARED");
        expect(sources).toHaveLength(hasPruned ? 0 : 1);
        later.release();
        expect(await pending).toEqual({
          success: false,
          message:
            "Report or account is no longer available for this decision. Please refresh.",
        });
        expect(
          await database.query.userReport.findFirst({
            where: eq(userReport.id, "original"),
          }),
        ).toEqual(current);
        expect(
          await database.query.userData.findFirst({
            where: eq(userData.userId, NATIVE_USER),
          }),
        ).toEqual(account);
        expect(await database.query.userReportComment.findMany()).toEqual(comments);
        expect(await database.query.sanctionTombstone.findMany()).toEqual(sources);
      } finally {
        later.release();
        earlier.release();
      }
      expect(await clearing).toMatchObject({ success: true });
      await finishDeletion();
      expect(await registerIdentity("AfterCleanup")).toHaveLength(0);
      expect(await database.query.sanctionTombstone.findMany()).toHaveLength(0);
      expect(
        await database.query.userData.findFirst({
          columns: { isBanned: true, isSilenced: true },
          where: eq(userData.userId, "AfterCleanup"),
        }),
      ).toEqual({ isBanned: false, isSilenced: false });
    },
  );

  it.each(["ban", "silence", "timeout", "warn", "tradeBan", "clear"] as const)(
    "rejects %s when native cleanup removes its report before the write",
    async (decision) => {
      const { register: registerIdentity } = stubSingleIdentity();
      const database = await getTestDatabase();
      const status = decision === "timeout" ? "TIMEOUT_ACTIVATED" : "BAN_ACTIVATED";
      const end = new Date(Date.now() + DAY);
      await addReport("original", status, end);
      await startDeletion();
      if (decision === "timeout")
        await database
          .update(userData)
          .set({ role: "CONTENT-ADMIN" })
          .where(eq(userData.userId, "staff"));
      const { client, entered, release } = await pauseNextDecision(true);
      const pending = callerForDatabase(reportsRouter, "staff", client)[decision](
        decisionInput,
      );
      await entered;
      const sources = await database.query.sanctionTombstone.findMany();
      try {
        await finishDeletion();
      } finally {
        release();
      }
      expect(await pending).toEqual({
        success: false,
        message:
          "Report or account is no longer available for this decision. Please refresh.",
      });
      expect(await database.query.userReportComment.findMany()).toHaveLength(0);
      expect(await database.query.sanctionTombstone.findMany()).toEqual(sources);
      expect(await registerIdentity("AfterCleanup")).toEqual([
        expect.objectContaining({
          status: decision === "timeout" ? "SILENCE_ACTIVATED" : "BAN_ACTIVATED",
          banEnd: end,
        }),
      ]);
    },
  );

  it.each(["ban", "silence", "clear"] as const)(
    "keeps the latest %s decision when cleanup removes its report before the response",
    async (decision) => {
      const { register: registerIdentity } = stubSingleIdentity();
      const database = await getTestDatabase();
      await addReport("original", "BAN_ACTIVATED", new Date(Date.now() + 10 * DAY));
      await startDeletion();
      const { client, entered, release } = await pauseNextDecision();
      const pending = callerForDatabase(reportsRouter, "staff", client)[decision](
        decisionInput,
      );
      await entered;
      const current = (await database.query.userReport.findFirst({
        where: eq(userReport.id, "original"),
      }))!;
      try {
        await finishDeletion();
      } finally {
        release();
      }
      expect(await pending).toMatchObject({ success: true });
      const returned = await registerIdentity("AfterCleanup");
      expect(returned).toHaveLength(decision === "clear" ? 0 : 1);
      if (decision !== "clear")
        expect(returned[0]).toEqual(
          expect.objectContaining({
            status: current.status,
            banEnd: current.banEnd,
          }),
        );
    },
  );

  it("does not retain identifiers when an ordinary account receives a sanction", async () => {
    await addReport("original", "BAN_ACTIVATED", new Date(Date.now() + 10 * DAY));
    expect(
      await (await callerFor(reportsRouter, "staff")).silence(decisionInput),
    ).toMatchObject({ success: true });
    expect(
      await (await getTestDatabase()).query.sanctionTombstone.findMany(),
    ).toHaveLength(0);
  });
  it.each([
    ["warn", false],
    ["tradeBan", false],
    ["expiry", false],
    ["expiry", true],
  ] as const)(
    "rejects active decisions after %s retires a pending native source (timeout: %p)",
    async (retiring, isTimeout) => {
      const { register: registerIdentity } = stubSingleIdentity();
      const database = await getTestDatabase();
      await addReport(
        "original",
        isTimeout ? "TIMEOUT_ACTIVATED" : "BAN_ACTIVATED",
        new Date(Date.now() + (retiring === "expiry" ? 1200 : 10 * DAY)),
      );
      await startDeletion();
      const staff = await callerFor(reportsRouter, "staff");
      if (retiring === "expiry") {
        // Cleanup's CURRENT_TIMESTAMP guard must observe expiry on the database clock.
        await new Promise((resolve) => setTimeout(resolve, 1300));
        await sanctions.removeExpiredSanctionTombstones(database);
      } else {
        expect(await staff[retiring](decisionInput)).toMatchObject({ success: true });
      }
      expect(await database.query.sanctionTombstone.findMany()).toHaveLength(0);
      await database
        .update(userData)
        .set({ status: "TRAVEL", travelFinishAt: new Date(Date.now() + DAY) })
        .where(eq(userData.userId, NATIVE_USER));
      const [report, account, comments] = await Promise.all([
        database.query.userReport.findFirst({ where: eq(userReport.id, "original") }),
        database.query.userData.findFirst({ where: eq(userData.userId, NATIVE_USER) }),
        database.query.userReportComment.findMany(),
      ]);
      const decisions = isTimeout
        ? (["timeout"] as const)
        : (["ban", "silence"] as const);
      for (const decision of decisions) {
        if (decision === "timeout")
          await database
            .update(userData)
            .set({ role: "CONTENT-ADMIN" })
            .where(eq(userData.userId, "staff"));
        expect(await staff[decision](decisionInput)).toEqual({
          success: false,
          message:
            "Report or account is no longer available for this decision. Please refresh.",
        });
      }
      expect(
        await database.query.userReport.findFirst({
          where: eq(userReport.id, "original"),
        }),
      ).toEqual(report);
      expect(
        await database.query.userData.findFirst({
          where: eq(userData.userId, NATIVE_USER),
        }),
      ).toEqual(account);
      expect(await database.query.userReportComment.findMany()).toEqual(comments);
      expect(await database.query.sanctionTombstone.findMany()).toHaveLength(0);
      await database
        .update(userData)
        .set({ role: "OWNER" })
        .where(eq(userData.userId, "staff"));
      for (const decision of ["warn", "tradeBan", "clear"] as const)
        expect(await staff[decision](decisionInput)).toMatchObject({ success: true });
      await finishDeletion();
      expect(await registerIdentity("AfterCleanup")).toHaveLength(0);
    },
  );

  it("requires a captured source while a deleted Clerk identity's response is pending", async () => {
    const { promise: entered, resolve: enter } = deferred<void>();
    const { promise: gate, resolve: release } = deferred<void>();
    const { register: registerIdentity } = stubSingleIdentity(async () => {
      enter();
      await gate;
    });
    const database = await getTestDatabase();
    await addReport("original", "BAN_ACTIVATED", new Date(Date.now() + 10 * DAY));
    await database.insert(accountDeletion).values({ userId: NATIVE_USER });
    const deletion = processAccountDeletions(NATIVE_USER);
    await entered;
    try {
      expect(await database.query.accountDeletion.findFirst()).toMatchObject({
        phase: "QUEUED",
      });
      const staff = await callerFor(reportsRouter, "staff");
      expect(await staff.warn(decisionInput)).toMatchObject({ success: true });
      expect(await database.query.sanctionTombstone.findMany()).toHaveLength(0);
      expect(await staff.ban(decisionInput)).toEqual({
        success: false,
        message:
          "Report or account is no longer available for this decision. Please refresh.",
      });
    } finally {
      release();
    }
    expect(await deletion).toEqual({ processed: 1, failed: 0 });
    await finishDeletion();
    expect(await registerIdentity("AfterCleanup")).toHaveLength(0);
  });

  it.each([false, true])(
    "requires the deleting account's own source despite linked ancestors (own source: %p)",
    async (hasOwnSource) => {
      const { register: registerIdentity, replace } = stubSingleIdentity();
      const database = await getTestDatabase();
      await addReport("original", "BAN_ACTIVATED", new Date(Date.now() + 10 * DAY));
      await startDeletion();
      const inherited = (await registerIdentity("DuringDelay"))[0]!;
      const changedIdentity: SanctionIdentity = {
        primaryEmailAddressId: "changed",
        emailAddresses: [
          {
            id: "changed",
            emailAddress: "changed@example.com",
            verification: { status: "verified" },
          },
        ],
        externalAccounts: [],
      };
      replace("DuringDelay", changedIdentity);
      const staff = await callerFor(reportsRouter, "staff");
      expect(
        await staff.ban({
          ...decisionInput,
          object_id: inherited.id,
          banTime: hasOwnSource ? 1 : 0.00002,
        }),
      ).toMatchObject({ success: true });
      await database.insert(accountDeletion).values({ userId: "DuringDelay" });
      expect(await processAccountDeletions("DuringDelay")).toEqual({
        processed: 1,
        failed: 0,
      });
      expect(
        await database.query.sanctionTombstone.findMany({
          where: eq(sanctionTombstone.userId, "DuringDelay"),
        }),
      ).toHaveLength(1);
      expect(await staff.ban({ ...decisionInput, banTime: 10 })).toMatchObject({
        success: true,
      });
      if (!hasOwnSource) {
        // Both the retained source and its SQL clock guards must cross the deadline.
        await new Promise((resolve) => setTimeout(resolve, 1800));
        await sanctions.removeExpiredSanctionTombstones(database);
      }
      const before = await database.query.sanctionTombstone.findMany();
      expect(before).toHaveLength(hasOwnSource ? 2 : 1);
      const result = await staff.ban({
        ...decisionInput,
        object_id: inherited.id,
        banTime: 2,
      });
      expect(result.success).toBe(hasOwnSource);
      const revised = await database.query.userReport.findFirst({
        where: eq(userReport.id, inherited.id),
      });
      if (hasOwnSource) {
        const sources = await database.query.sanctionTombstone.findMany();
        expect(sources).toHaveLength(2);
        expect(
          sources.every(
            (source) =>
              source.sanction === "BAN" &&
              source.sanctionEndsAt.getTime() === revised!.banEnd!.getTime(),
          ),
        ).toBe(true);
        expect(
          sources.find((source) => source.userId === "DuringDelay")?.emailHash,
        ).toBe(hashSanctionIdentifier("email", "changed@example.com"));
      } else {
        expect(await database.query.sanctionTombstone.findMany()).toEqual(before);
      }
      await finishDeletion();
      await finishDeletion("DuringDelay");
      const returned = await registerIdentity("AfterCleanup", changedIdentity);
      expect(returned).toHaveLength(hasOwnSource ? 1 : 0);
      if (hasOwnSource)
        expect(returned[0]).toEqual(
          expect.objectContaining({
            status: "BAN_ACTIVATED",
            banEnd: revised!.banEnd,
          }),
        );
      expect(
        await database.query.userData.findFirst({
          columns: { isBanned: true },
          where: eq(userData.userId, "AfterCleanup"),
        }),
      ).toEqual({ isBanned: hasOwnSource });
    },
  );
});
