import { CHARACTER_DELETION_CONFIRMATION } from "@/drizzle/constants";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as clerk from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import {
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
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { profileRouter } from "@/routers/profile";
import { registerRouter } from "@/server/api/routers/register";
import type { DrizzleClient } from "@/server/db";
import { reportsRouter } from "@/server/api/routers/reports";
import { deleteUser } from "@/server/api/routers/staff";
import { removeAccountIdentity } from "@/server/utils/accountDeletion/identity";
import { DELETED_STORE_USER_PREFIX } from "@/server/utils/purchases/grant";
import * as sanctions from "@/server/utils/sanctionTombstone";
import {
  hashSanctionIdentifier,
  hashSanctionIp,
  normalizeEmail,
  removeExpiredSanctionTombstones,
  type SanctionIdentity,
} from "@/server/utils/sanctionTombstone";
import { insertUsers } from "../../setup/factories";
import { beforeStatements, failStatements } from "../../setup/statements";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const DAY = 86_400_000;
const SANCTIONED = "user_sanctioned";

const identity = (
  email: string,
  accounts: SanctionIdentity["externalAccounts"] = [],
): SanctionIdentity => ({
  primaryEmailAddressId: "email_primary",
  emailAddresses: [
    { id: "email_primary", emailAddress: email, verification: { status: "verified" } },
  ],
  externalAccounts: accounts,
});

/** Answer Clerk lookups from this map; a missing id behaves like a deleted Clerk user. */
const stubClerk = (users: Record<string, SanctionIdentity>) => {
  const getUser = vi.fn(async (userId: string) => {
    const user = users[userId];
    if (!user) throw Object.assign(new Error("not found"), { status: 404 });
    return user;
  });
  vi.spyOn(clerk, "clerkClient").mockResolvedValue({
    users: {
      getUser,
      deleteUser: vi.fn(async () => {}),
      getUserOauthAccessToken: vi.fn(async () => ({ data: [] })),
    },
  } as never);
  return getUser;
};

const addSanction = async (
  userId: string,
  status: "BAN_ACTIVATED" | "SILENCE_ACTIVATED" | "TIMEOUT_ACTIVATED",
  banEnd: Date,
  id = `report-${status}`,
) => {
  const database = await getTestDatabase();
  await database.insert(userReport).values({
    id,
    reporterUserId: "reporter",
    reportedUserId: userId,
    system: "tavern_comment",
    infraction: { content: "offending message" },
    reason: "Spam",
    aiInterpretation: "",
    status,
    banEnd,
  });
};

const register = async (userId: string, database?: DrizzleClient, userIp?: string) =>
  registerRouter
    .createCaller({ drizzle: database ?? (await getTestDatabase()), userId, userIp } as never)
    .createCharacter({
      username: `n${userId.slice(-11)}`.replace(/[^a-zA-Z0-9]/g, ""),
      gender: "Male",
      hair_color: "Black",
      eye_color: "Blue",
      skin_color: "Light",
      attribute_1: "Soft features",
      attribute_2: "Glasses",
      attribute_3: "Short Hair",
      read_tos: true,
      read_privacy: true,
      read_earlyaccess: true,
      utm_source: null,
      bloodlineId: "tombstone-bloodline",
    });

const tombstonesOf = async (userId: string) =>
  (await getTestDatabase()).query.sanctionTombstone.findMany({
    where: eq(sanctionTombstone.userId, userId),
  });

/** Hold web deletion after capture, before any report cleanup can start. */
const pauseWebDeletion = async () => {
  const capture = sanctions.recordSanctionTombstone;
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(sanctions, "recordSanctionTombstone").mockImplementation(async (...args) => {
    await capture(...args);
    enter();
    await gate;
  });
  const deleting = (await callerFor(profileRouter, SANCTIONED)).confirmDeletion({
    userId: SANCTIONED,
    confirmation: CHARACTER_DELETION_CONFIRMATION,
  });
  await entered;
  return { deleting, release };
};

describe("sanction identifier normalization", () => {
  it("matches equivalent IPv6 and mapped IPv4 addresses without retaining plain IPs", () => {
    expect(hashSanctionIp(" 2001:0DB8:0:0:0:0:0:1 ")).toBe(hashSanctionIp("2001:db8::1"));
    expect(hashSanctionIp("::ffff:192.0.2.1")).toBe(hashSanctionIp("192.0.2.1"));
    expect(hashSanctionIp("192.0.2.1")).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSanctionIp("192.0.2.1")).not.toBe(hashSanctionIp("192.0.2.2"));
  });

  it.each([undefined, null, "", "unknown", "hidden", "Proxied", "ai-test-broker", "192.0.2.999", "fe80::1%eth0"])(
    "does not match placeholder or invalid address %s", (ip) => {
      expect(hashSanctionIp(ip)).toBeNull();
    },
  );

  it("folds Gmail aliases and preserves distinct local parts at other providers", () => {
    expect(normalizeEmail(" J.Doe+alt@GoogleMail.com ")).toBe("jdoe@gmail.com");
    expect(normalizeEmail("j.doe+x@example.com")).toBe("j.doe+x@example.com");
    expect(hashSanctionIdentifier("email", "a@b.c")).not.toBe(
      hashSanctionIdentifier("oauth", "a@b.c"),
    );
  });
});

describeWithDatabase("sanction tombstones", () => {
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
    const database = await getTestDatabase();
    await Promise.all([
      database
        .insert(village)
        .values({
          id: "tombstone-horizon",
          name: "Horizon",
          sector: 1,
          kageId: "kage",
        }),
      database.insert(bloodline).values({
        id: "tombstone-bloodline",
        name: "tombstone bloodline",
        image: "/bloodline.png",
        description: "test",
        effects: [],
        rank: "D",
      }),
    ]);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    // Other suites must not inherit this suite's sanctions or deletion markers.
    await resetTables(sanctionTombstone, storeUserIdAlias, accountDeletion);
  });

  it.each([
    ["before sources", "unchanged"],
    ["history snapshot", "unchanged"],
    ["captured", "unchanged"],
    ["history removed", "unchanged"],
    ["captured", "clear"],
    ["captured", "silence"],
  ] as const)(
    "retains an in-flight web profile IP at the %s boundary after %s",
    async (boundary, decision) => {
      const database = await getTestDatabase();
      const oldIp = "192.0.2.71";
      const lateIp = "192.0.2.72";
      await insertUsers([
        {
          userId: SANCTIONED,
          lastIp: oldIp,
          isBanned: true,
          villageId: "tombstone-horizon",
          updatedAt: new Date(Date.now() - 360_000),
          deletionAt: new Date(Date.now() - 1),
        },
      ]);
      await addSanction(
        SANCTIONED,
        "BAN_ACTIVATED",
        new Date(Date.now() + 10 * DAY),
        "original",
      );
      await insertUsers([{ userId: "staff", username: "StaffAccount", role: "OWNER" }]);
      vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue();
      stubClerk({
        [SANCTIONED]: identity("original@example.com"),
        user_returned: identity("returned@example.com"),
      });
      let enterIp!: () => void;
      const ipEntered = new Promise<void>((resolve) => {
        enterIp = resolve;
      });
      let releaseIp!: () => void;
      const ipGate = new Promise<void>((resolve) => {
        releaseIp = resolve;
      });
      const profileClient = beforeStatements(database, historicalIp, [async () => {
        enterIp();
        await ipGate;
      }]);
      const profile = profileRouter
        .createCaller({
          drizzle: profileClient,
          userId: SANCTIONED,
          userIp: lateIp,
        } as never)
        .getUser();
      await ipEntered;
      let enterDeletion!: () => void;
      const deletionEntered = new Promise<void>((resolve) => {
        enterDeletion = resolve;
      });
      let releaseDeletion!: () => void;
      const deletionGate = new Promise<void>((resolve) => {
        releaseDeletion = resolve;
      });
      // Read/delete gates must pause after execution; beforeStatements only provides
      // a before-write hook, so those boundaries need the custom proxy below.
      const deletionClient = boundary === "before sources"
        ? beforeStatements(database, sanctionTombstone, [async () => {
            enterDeletion();
            await deletionGate;
          }])
        : new Proxy(database, {
            get(target, property, receiver) {
              if (property === "query" && boundary === "history snapshot")
                return {
                  ...target.query,
                  historicalIp: {
                    ...target.query.historicalIp,
                    findMany: async (
                      ...args: Parameters<typeof target.query.historicalIp.findMany>
                    ) => {
                      const result = await target.query.historicalIp.findMany(...args);
                      enterDeletion();
                      await deletionGate;
                      return result;
                    },
                  },
                };
              if (property === "delete" && boundary === "history removed")
                return (table: Parameters<typeof target.delete>[0]) => {
                  const builder = target.delete(table);
                  if (table !== historicalIp) return builder;
                  return {
                    where: async (...args: Parameters<typeof builder.where>) => {
                      const result = await builder.where(...args);
                      enterDeletion();
                      await deletionGate;
                      return result;
                    },
                  };
                };
              return Reflect.get(target, property, receiver);
            },
          });
      const capture = sanctions.recordSanctionTombstone;
      if (boundary === "captured")
        vi.spyOn(sanctions, "recordSanctionTombstone").mockImplementation(
          async (...args) => {
            await capture(...args);
            enterDeletion();
            await deletionGate;
          },
        );
      const deleting = profileRouter
        .createCaller({ drizzle: deletionClient, userId: SANCTIONED } as never)
        .confirmDeletion({ userId: SANCTIONED, confirmation: CHARACTER_DELETION_CONFIRMATION });
      await deletionEntered;
      try {
        if (decision !== "unchanged")
          expect(
            await (await callerFor(reportsRouter, "staff"))[decision]({
              object_id: "original",
              comment: "Appeal accepted",
              banTime: 30,
              banTimeUnit: "days",
            }),
          ).toMatchObject({ success: true });
        releaseIp();
        await profile;
        expect(
          await database.query.historicalIp.findFirst({
            where: eq(historicalIp.userId, SANCTIONED),
          }),
        ).toMatchObject({ ip: lateIp });
      } finally {
        releaseIp();
        releaseDeletion();
        await Promise.all([profile, deleting]);
      }
      expect(await deleting).toMatchObject({ success: true });
      if (decision === "clear") expect(await tombstonesOf(SANCTIONED)).toHaveLength(0);
      else
        expect(await tombstonesOf(SANCTIONED)).toMatchObject([
          {
            sanction: decision === "silence" ? "SILENCE" : "BAN",
            ipHashes: expect.arrayContaining([
              hashSanctionIp(oldIp),
              hashSanctionIp(lateIp),
            ]),
          },
        ]);
      expect(await register("user_returned", undefined, lateIp)).toMatchObject({
        success: true,
      });
      expect(
        await database.query.userData.findFirst({
          where: eq(userData.userId, "user_returned"),
        }),
      ).toMatchObject({
        isBanned: decision === "unchanged",
        isSilenced: decision === "silence",
      });
    },
  );

  it.each([false, true])(
    "closes stale originals before expiry pruning (closure failure: %p)",
    async (failsOnce) => {
      const database = await getTestDatabase();
      await insertUsers([{ userId: SANCTIONED, lastIp: "192.0.2.71" }]);
      await addSanction(
        SANCTIONED,
        "BAN_ACTIVATED",
        new Date(Date.now() + 10 * DAY),
        "original",
      );
      stubClerk({
        [SANCTIONED]: identity("original@example.com"),
        user_returned: identity("returned@example.com"),
      });
      await sanctions.recordSanctionTombstone(database, SANCTIONED);
      await database
        .update(sanctionTombstone)
        .set({ sanctionEndsAt: new Date(Date.now() - 1) });
      if (failsOnce) {
        const broken = failStatements(database, userReport);
        await expect(removeExpiredSanctionTombstones(broken)).rejects.toThrow(
          "Statement failed on purpose",
        );
        const before = await tombstonesOf(SANCTIONED);
        expect(before).toHaveLength(1);
        await sanctions.recordSanctionTombstone(database, SANCTIONED);
        expect(await tombstonesOf(SANCTIONED)).toEqual(before);
      }
      let enter!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const paused = beforeStatements(database, sanctionTombstone, [
        async () => {}, // Let report closure run before pausing source deletion.
        async () => {
          enter();
          await gate;
        },
      ]);
      const pruning = removeExpiredSanctionTombstones(paused);
      await entered;
      try {
        expect(
          await database.query.userReport.findFirst({
            where: eq(userReport.id, "original"),
          }),
        ).toMatchObject({ status: "REPORT_CLEARED" });
        const before = await tombstonesOf(SANCTIONED);
        await sanctions.recordSanctionTombstone(database, SANCTIONED);
        expect(await tombstonesOf(SANCTIONED)).toEqual(before);
      } finally {
        release();
        await pruning;
      }
      await sanctions.recordSanctionTombstone(database, SANCTIONED);
      expect(await tombstonesOf(SANCTIONED)).toHaveLength(0);
      expect(await register("user_returned", undefined, "192.0.2.71")).toMatchObject({
        success: true,
      });
      expect(
        await database.query.userData.findFirst({
          where: eq(userData.userId, "user_returned"),
        }),
      ).toMatchObject({ isBanned: false });
    },
  );

  it.each(["BAN_ACTIVATED", "SILENCE_ACTIVATED"] as const)(
    "restores %s on a new identity using only a recorded IP and supports staff clearing",
    async (status) => {
      const database = await getTestDatabase();
      const endsAt = new Date(Date.now() + 7 * DAY);
      await insertUsers([
        { userId: SANCTIONED, lastIp: "192.0.2.1" },
        { userId: "staff", role: "OWNER" },
      ]);
      await database.insert(historicalIp).values([
        { userId: SANCTIONED, ip: "2001:0DB8:0:0:0:0:0:1" },
        { userId: SANCTIONED, ip: "::ffff:192.0.2.1" },
        { userId: SANCTIONED, ip: "unknown" },
      ]);
      await addSanction(SANCTIONED, status, endsAt);
      stubClerk({
        [SANCTIONED]: identity("old@example.com"),
        replacement: identity("new@example.com"),
        cleared: identity("cleared@example.com"),
      });
      await deleteUser(database, SANCTIONED);
      const sources = await tombstonesOf(SANCTIONED);
      expect(sources[0]!.ipHashes.sort()).toEqual(
        [
          hashSanctionIdentifier("ip", "192.0.2.1"),
          hashSanctionIdentifier("ip", "2001:db8::1"),
        ].sort(),
      );
      expect(JSON.stringify(sources)).not.toContain("192.0.2.1");
      expect(JSON.stringify(sources)).not.toContain("2001:");
      expect(await database.query.historicalIp.findMany()).toHaveLength(0);
      expect(await register("replacement", database, "2001:db8::1")).toMatchObject({
        success: true,
      });
      const inherited = (await database.query.userReport.findFirst({
        where: eq(userReport.reportedUserId, "replacement"),
      }))!;
      expect(inherited).toMatchObject({ status, banEnd: endsAt });
      const account = await database.query.userData.findFirst({
        where: eq(userData.userId, "replacement"),
      });
      expect(account).toMatchObject({
        isBanned: status === "BAN_ACTIVATED",
        isSilenced: status === "SILENCE_ACTIVATED",
      });
      const audit = await database.query.actionLog.findFirst({
        where: eq(actionLog.relatedId, inherited.id),
      });
      expect(audit!.changes).toContain("Matched by: ip");
      expect(
        await sanctions.updateSanctionReport(database, inherited, {
          status: "REPORT_CLEARED",
          adminResolved: true,
        }),
      ).toBe(true);
      expect(await tombstonesOf(SANCTIONED)).toHaveLength(0);
      expect(await register("cleared", database, "192.0.2.1")).toMatchObject({
        success: true,
      });
      expect(
        await database.query.userReport.findFirst({
          where: eq(userReport.reportedUserId, "cleared"),
        }),
      ).toBeUndefined();
    },
  );

  it("does not sanction a different IP or missing IP, and ignores expired IP sources", async () => {
    const database = await getTestDatabase();
    await insertUsers([{ userId: SANCTIONED, lastIp: "192.0.2.1" }]);
    await addSanction(SANCTIONED, "BAN_ACTIVATED", new Date(Date.now() + DAY));
    stubClerk(
      Object.fromEntries(
        [SANCTIONED, "otherip", "noip", "expiredip"].map((id) => [
          id,
          identity(`${id}@example.com`),
        ]),
      ),
    );
    await deleteUser(database, SANCTIONED);
    expect(await register("otherip", database, "192.0.2.2")).toMatchObject({
      success: true,
    });
    expect(await register("noip", database, "unknown")).toMatchObject({ success: true });
    await database
      .update(sanctionTombstone)
      .set({ sanctionEndsAt: new Date(Date.now() - 1) });
    expect(await register("expiredip", database, "192.0.2.1")).toMatchObject({
      success: true,
    });
    expect(await database.query.userReport.findMany()).toHaveLength(0);
  });

  it("merges newly learned IPs and preserves removed history across deletion retries", async () => {
    const database = await getTestDatabase();
    await insertUsers([{ userId: SANCTIONED, lastIp: "192.0.2.1" }]);
    await addSanction(SANCTIONED, "BAN_ACTIVATED", new Date(Date.now() + DAY));
    stubClerk({
      [SANCTIONED]: identity("old@example.com"),
      retryip: identity("new@example.com"),
    });
    await database.insert(historicalIp).values({ userId: SANCTIONED, ip: "192.0.2.2" });
    await sanctions.recordSanctionTombstone(database, SANCTIONED);
    await database.delete(historicalIp);
    await database
      .update(userData)
      .set({ lastIp: "192.0.2.3" })
      .where(eq(userData.userId, SANCTIONED));
    await sanctions.recordSanctionTombstone(database, SANCTIONED);
    await sanctions.recordSanctionTombstone(database, SANCTIONED);
    await deleteUser(database, SANCTIONED);
    expect((await tombstonesOf(SANCTIONED))[0]!.ipHashes.sort()).toEqual(
      ["192.0.2.1", "192.0.2.2", "192.0.2.3"]
        .map((ip) => hashSanctionIdentifier("ip", ip))
        .sort(),
    );
    expect(await register("retryip", database, "192.0.2.3")).toMatchObject({
      success: true,
    });
    expect(
      await database.query.userData.findFirst({ where: eq(userData.userId, "retryip") }),
    ).toMatchObject({ isBanned: true });
  });

  it("records a running sanction with hashed identifiers only, before the reports go", async () => {
    const silenceEnd = new Date(Date.now() + 30 * DAY);
    await insertUsers([
      { userId: SANCTIONED, username: "Sanctioned", isSilenced: true },
    ]);
    await addSanction(SANCTIONED, "SILENCE_ACTIVATED", silenceEnd);
    await addSanction(SANCTIONED, "TIMEOUT_ACTIVATED", new Date(Date.now() + DAY));
    stubClerk({
      [SANCTIONED]: identity("Player+evade@Example.com", [
        { provider: "oauth_google", providerUserId: "google-123" },
      ]),
    });

    await deleteUser(await getTestDatabase(), SANCTIONED);

    const tombstones = await tombstonesOf(SANCTIONED);
    expect(tombstones).toHaveLength(2);
    for (const tombstone of tombstones) {
      expect(tombstone).toMatchObject({
        sanction: "SILENCE",
        emailHash: hashSanctionIdentifier("email", "player+evade@example.com"),
        accountHashes: [hashSanctionIdentifier("oauth", "google:google-123")],
      });
    }
    expect(
      tombstones.find((source) => source.sourceId === "report-SILENCE_ACTIVATED"),
    ).toMatchObject({ sanctionEndsAt: silenceEnd });
    expect(tombstones.map((source) => source.sourceId).sort()).toEqual([
      "report-SILENCE_ACTIVATED",
      "report-TIMEOUT_ACTIVATED",
    ]);
    const stored = JSON.stringify(tombstones);
    expect(stored).not.toContain("Sanctioned");
    expect(stored).not.toContain("example.com");
    expect(stored).not.toContain("google-123");
    // The original reports are removed with the account, as before.
    expect(await (await getTestDatabase()).query.userReport.findMany()).toHaveLength(0);
  });

  it("records nothing and skips Clerk for an account without a running sanction", async () => {
    await insertUsers([{ userId: SANCTIONED }]);
    await addSanction(SANCTIONED, "BAN_ACTIVATED", new Date(Date.now() - DAY));
    const getUser = stubClerk({});

    await deleteUser(await getTestDatabase(), SANCTIONED);

    expect(await tombstonesOf(SANCTIONED)).toHaveLength(0);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("keeps hashes from the native identity step once the Clerk user is gone", async () => {
    await insertUsers([{ userId: SANCTIONED, isBanned: true }]);
    await addSanction(SANCTIONED, "BAN_ACTIVATED", new Date(Date.now() + 7 * DAY));
    const clerkUsers: Record<string, SanctionIdentity> = {
      [SANCTIONED]: identity("native@example.com"),
    };
    stubClerk(clerkUsers);

    await removeAccountIdentity(SANCTIONED);
    delete clerkUsers[SANCTIONED];
    await deleteUser(await getTestDatabase(), SANCTIONED);

    expect(await tombstonesOf(SANCTIONED)).toMatchObject([
      {
        sanction: "BAN",
        emailHash: hashSanctionIdentifier("email", "native@example.com"),
      },
    ]);
  });

  it("re-applies the remaining sanction to the same Clerk id after a web deletion", async () => {
    const banEnd = new Date(Date.now() + 10 * DAY);
    await insertUsers([{ userId: SANCTIONED, isBanned: true }]);
    await addSanction(SANCTIONED, "BAN_ACTIVATED", banEnd, "original-ban");
    stubClerk({ [SANCTIONED]: identity("web@example.com") });
    await deleteUser(await getTestDatabase(), SANCTIONED);

    expect(await register(SANCTIONED)).toMatchObject({ success: true });

    const database = await getTestDatabase();
    const [user, reports, logs] = await Promise.all([
      database.query.userData.findFirst({ where: eq(userData.userId, SANCTIONED) }),
      database.query.userReport.findMany({
        where: eq(userReport.reportedUserId, SANCTIONED),
      }),
      database.query.actionLog.findMany({ where: eq(actionLog.userId, SANCTIONED) }),
    ]);
    expect(user).toMatchObject({ isBanned: true, isSilenced: false });
    expect(reports).toMatchObject([
      {
        status: "BAN_ACTIVATED",
        banEnd,
        system: "sanction_carryover",
        adminResolved: true,
      },
    ]);
    expect(reports[0]?.reason).not.toContain("original-ban");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      tableName: "userReport",
      relatedId: reports[0]?.id,
    });
    expect(logs[0]?.changes).toContain("Original reports: original-ban");
    expect(logs[0]?.changes).toContain("Matched by: clerkId, email");
  });

  it.each([
    ["clear", false],
    ["silence", false],
    ["ban", false],
    ["unchanged", false],
    ["clear", true],
    ["silence", true],
    ["ban", true],
    ["unchanged", true],
  ] as const)(
    "guards %s decisions before capture during Clerk lookup with independent cases: %p",
    async (decision, hasIndependentCases) => {
      const database = await getTestDatabase();
      const originalEnd = new Date(Date.now() + 10 * DAY);
      const shorterEnd = new Date(Date.now() + 3 * DAY);
      const silenceEnd = new Date(Date.now() + 20 * DAY);
      await insertUsers([{ userId: SANCTIONED }, { userId: "staff", role: "OWNER" }]);
      await addSanction(SANCTIONED, "BAN_ACTIVATED", originalEnd, "original-case");
      if (hasIndependentCases) {
        await addSanction(SANCTIONED, "BAN_ACTIVATED", shorterEnd, "shorter-case");
        await addSanction(SANCTIONED, "SILENCE_ACTIVATED", silenceEnd, "silence-case");
      }
      const clerkIdentity = identity("capture@example.com", [
        { provider: "oauth_google", providerUserId: "capture-subject" },
      ]);
      const getUser = stubClerk({ [SANCTIONED]: clerkIdentity });
      let enter!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      getUser.mockImplementationOnce(async () => {
        enter();
        await gate;
        return clerkIdentity;
      });
      vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue();
      const deleting = deleteUser(database, SANCTIONED);
      await entered;
      try {
        expect(await tombstonesOf(SANCTIONED)).toHaveLength(0);
        expect(await database.query.storeUserIdAlias.findFirst()).toMatchObject({
          oldUserId: SANCTIONED,
          newUserId: expect.stringContaining(DELETED_STORE_USER_PREFIX),
        });
        if (decision !== "unchanged") {
          const before = await Promise.all([
            database.query.userReport.findMany(),
            database.query.userData.findMany(),
            database.query.userReportComment.findMany(),
          ]);
          expect(
            await (await callerFor(reportsRouter, "staff"))[decision]({
              object_id: "original-case",
              comment: "Appeal accepted",
              banTime: 1,
              banTimeUnit: "days",
            }),
          ).toMatchObject({ success: decision === "clear" });
          if (decision !== "clear")
            expect(
              await Promise.all([
                database.query.userReport.findMany(),
                database.query.userData.findMany(),
                database.query.userReportComment.findMany(),
              ]),
            ).toEqual(before);
        }
        const revised = await database.query.userReport.findFirst({
          where: eq(userReport.id, "original-case"),
        });
        expect(revised).toMatchObject({
          status: decision === "clear" ? "REPORT_CLEARED" : "BAN_ACTIVATED",
          banEnd: originalEnd,
        });
      } finally {
        release();
        await deleting;
      }
      expect(
        await database.query.userData.findFirst({
          where: eq(userData.userId, SANCTIONED),
        }),
      ).toBeUndefined();
      expect(await database.query.userReport.findMany()).toHaveLength(0);
      const sources = await tombstonesOf(SANCTIONED);
      expect(sources).toHaveLength(
        (decision === "clear" ? 0 : 1) + (hasIndependentCases ? 2 : 0),
      );
      const original = sources.find((source) => source.sourceId === "original-case");
      if (decision === "clear") expect(original).toBeUndefined();
      else
        expect(original).toMatchObject({
          sanction: "BAN",
          sanctionEndsAt: originalEnd,
        });
      for (const source of sources) {
        expect(source).toMatchObject({
          emailHash: hashSanctionIdentifier("email", "capture@example.com"),
          accountHashes: [hashSanctionIdentifier("oauth", "google:capture-subject")],
          carryoverReportIds: [],
        });
      }
      if (hasIndependentCases)
        expect(sources).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              sourceId: "shorter-case",
              sanction: "BAN",
              sanctionEndsAt: shorterEnd,
            }),
            expect.objectContaining({
              sourceId: "silence-case",
              sanction: "SILENCE",
              sanctionEndsAt: silenceEnd,
            }),
          ]),
        );
      expect(await register(SANCTIONED)).toMatchObject({ success: true });
      const reports = await database.query.userReport.findMany({
        where: eq(userReport.reportedUserId, SANCTIONED),
      });
      const banEnd =
        decision === "clear" ? (hasIndependentCases ? shorterEnd : null) : originalEnd;
      const expectedSilenceEnd = hasIndependentCases ? silenceEnd : null;
      const expected = [
        ...(banEnd ? [{ status: "BAN_ACTIVATED", banEnd }] : []),
        ...(expectedSilenceEnd
          ? [{ status: "SILENCE_ACTIVATED", banEnd: expectedSilenceEnd }]
          : []),
      ];
      expect(reports).toHaveLength(expected.length);
      expect(reports).toEqual(
        expect.arrayContaining(
          expected.map((report) => expect.objectContaining(report)),
        ),
      );
      expect(
        await database.query.userData.findFirst({
          columns: { isBanned: true, isSilenced: true },
          where: eq(userData.userId, SANCTIONED),
        }),
      ).toEqual({ isBanned: !!banEnd, isSilenced: !!expectedSilenceEnd });
    },
  );

  it("refreshes a captured decision without replacing its carryover links or creation time", async () => {
    const database = await getTestDatabase();
    await insertUsers([{ userId: SANCTIONED }, { userId: "staff", role: "OWNER" }]);
    await addSanction(
      SANCTIONED,
      "BAN_ACTIVATED",
      new Date(Date.now() + 10 * DAY),
      "original-case",
    );
    const capturedIdentity = identity("capture@example.com");
    stubClerk({ [SANCTIONED]: capturedIdentity });
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue();
    await sanctions.recordSanctionTombstone(database, SANCTIONED);
    await database.update(sanctionTombstone).set({
      carryoverReportIds: ["inherited-case"],
    });
    const before = (await tombstonesOf(SANCTIONED))[0]!;
    expect(
      await (await callerFor(reportsRouter, "staff")).silence({
        object_id: "original-case",
        comment: "Appeal accepted",
        banTime: 1,
        banTimeUnit: "days",
      }),
    ).toMatchObject({ success: true });
    const revised = await database.query.userReport.findFirst({
      where: eq(userReport.id, "original-case"),
    });
    // A cleanup retry may still find the original report and must preserve existing links.
    await sanctions.recordSanctionTombstone(database, SANCTIONED, capturedIdentity);
    await deleteUser(database, SANCTIONED);
    expect(await tombstonesOf(SANCTIONED)).toEqual([
      {
        ...before,
        sanction: "SILENCE",
        sanctionEndsAt: revised!.banEnd!,
      },
    ]);
    await sanctions.recordSanctionTombstone(database, SANCTIONED);
    expect(await tombstonesOf(SANCTIONED)).toEqual([
      {
        ...before,
        sanction: "SILENCE",
        sanctionEndsAt: revised!.banEnd!,
      },
    ]);
  });

  it("revises every source across repeated web deletions and an identity change", async () => {
    const database = await getTestDatabase();
    await insertUsers([{ userId: SANCTIONED }, { userId: "staff", role: "OWNER" }]);
    await addSanction(
      SANCTIONED,
      "BAN_ACTIVATED",
      new Date(Date.now() + 10 * DAY),
      "first-ban",
    );
    await addSanction(
      SANCTIONED,
      "BAN_ACTIVATED",
      new Date(Date.now() + 3 * DAY),
      "second-ban",
    );
    await addSanction(
      SANCTIONED,
      "SILENCE_ACTIVATED",
      new Date(Date.now() + 20 * DAY),
      "separate-silence",
    );
    const clerkUsers = { [SANCTIONED]: identity("first-web@example.com") };
    stubClerk(clerkUsers);
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue();
    await deleteUser(database, SANCTIONED);
    expect(await register(SANCTIONED)).toMatchObject({ success: true });
    const inherited = await database.query.userReport.findMany({
      where: eq(userReport.reportedUserId, SANCTIONED),
    });
    expect(inherited).toHaveLength(2);
    const grouped = inherited.find((report) => report.status === "BAN_ACTIVATED")!;
    const separate = inherited.find((report) => report.status === "SILENCE_ACTIVATED")!;
    const staff = await callerFor(reportsRouter, "staff");
    const input = {
      comment: "Revise inherited cases",
      banTime: 1,
      banTimeUnit: "days" as const,
    };
    expect(await staff.silence({ ...input, object_id: grouped.id })).toMatchObject({
      success: true,
    });
    expect(await staff.clear({ ...input, object_id: separate.id })).toMatchObject({
      success: true,
    });
    const revised = await database.query.userReport.findFirst({
      where: eq(userReport.id, grouped.id),
    });
    const originalSources = await tombstonesOf(SANCTIONED);
    expect(originalSources).toHaveLength(2);
    expect(
      originalSources.every(
        (source) =>
          source.sanction === "SILENCE" &&
          source.sanctionEndsAt.getTime() === revised!.banEnd!.getTime(),
      ),
    ).toBe(true);
    clerkUsers[SANCTIONED] = identity("changed-web@example.com");
    await deleteUser(database, SANCTIONED);
    expect(await tombstonesOf(SANCTIONED)).toEqual(
      expect.arrayContaining(originalSources),
    );
    expect(await tombstonesOf(SANCTIONED)).toHaveLength(3);
    expect(await register(SANCTIONED)).toMatchObject({ success: true });
    const returned = await database.query.userReport.findMany({
      where: eq(userReport.reportedUserId, SANCTIONED),
    });
    expect(returned).toMatchObject([
      { status: "SILENCE_ACTIVATED", banEnd: revised!.banEnd },
    ]);
    expect(
      await database.query.actionLog.findFirst({
        where: eq(actionLog.relatedId, returned[0]!.id),
      }),
    ).toMatchObject({
      changes: expect.arrayContaining([
        expect.stringContaining("first-ban"),
        expect.stringContaining("second-ban"),
      ]),
    });
    expect(await staff.clear({ ...input, object_id: returned[0]!.id })).toMatchObject({
      success: true,
    });
    expect(await tombstonesOf(SANCTIONED)).toHaveLength(0);
    await deleteUser(database, SANCTIONED);
    expect(await register(SANCTIONED)).toMatchObject({ success: true });
    expect(
      await database.query.userReport.findMany({
        where: eq(userReport.reportedUserId, SANCTIONED),
      }),
    ).toHaveLength(0);
  });

  it("matches a new Clerk id by a differently spelled email after a native deletion", async () => {
    const silenceEnd = new Date(Date.now() + 3 * DAY);
    await getTestDatabase().then((database) =>
      database.insert(sanctionTombstone).values({
        userId: "user_deleted",
        sourceId: "original-silence",
        sanction: "SILENCE",
        sanctionEndsAt: silenceEnd,
        emailHash: hashSanctionIdentifier("email", "returner@gmail.com"),
        accountHashes: [],
      }),
    );
    stubClerk({ user_returning: identity("R.e.t.u.r.n.e.r+2@GoogleMail.com") });

    expect(await register("user_returning")).toMatchObject({ success: true });

    const database = await getTestDatabase();
    expect(
      await database.query.userData.findFirst({
        where: eq(userData.userId, "user_returning"),
        columns: { isBanned: true, isSilenced: true },
      }),
    ).toEqual({ isBanned: false, isSilenced: true });
    expect(
      await database.query.userReport.findFirst({
        where: and(
          eq(userReport.reportedUserId, "user_returning"),
          eq(userReport.status, "SILENCE_ACTIVATED"),
        ),
      }),
    ).toMatchObject({ banEnd: silenceEnd });
    const [log] = await database.query.actionLog.findMany({
      where: eq(actionLog.userId, "user_returning"),
    });
    expect(log?.changes).toContain("Matched by: email");
  });

  it("ignores an expired tombstone and the cleaner removes it", async () => {
    const database = await getTestDatabase();
    await database.insert(sanctionTombstone).values({
      userId: SANCTIONED,
      sourceId: "expired-ban",
      sanction: "BAN",
      sanctionEndsAt: new Date(Date.now() - 1000),
      emailHash: null,
      accountHashes: [],
    });
    const getUser = stubClerk({});

    expect(await register(SANCTIONED)).toMatchObject({ success: true });

    expect(getUser).not.toHaveBeenCalled();
    expect(
      (
        await database.query.userData.findFirst({
          where: eq(userData.userId, SANCTIONED),
        })
      )?.isBanned,
    ).toBe(false);
    expect(await database.query.userReport.findMany()).toHaveLength(0);
    await removeExpiredSanctionTombstones(database);
    expect(await tombstonesOf(SANCTIONED)).toHaveLength(0);
  });

  it("lets a silenced player delete through the web flow", async () => {
    await insertUsers([{ userId: SANCTIONED, isSilenced: true }]);
    await addSanction(SANCTIONED, "SILENCE_ACTIVATED", new Date(Date.now() + DAY));
    stubClerk({ [SANCTIONED]: identity("silenced@example.com") });
    const caller = await callerFor(profileRouter, SANCTIONED);

    expect(await caller.toggleDeletionTimer({ userId: SANCTIONED, confirmation: CHARACTER_DELETION_CONFIRMATION })).toMatchObject({
      success: true,
    });
    const database = await getTestDatabase();
    await database
      .update(userData)
      .set({ deletionAt: new Date(Date.now() - 1000) })
      .where(eq(userData.userId, SANCTIONED));
    expect(await caller.confirmDeletion({ userId: SANCTIONED, confirmation: CHARACTER_DELETION_CONFIRMATION })).toMatchObject({
      success: true,
    });

    expect(
      await database.query.userData.findFirst({
        where: eq(userData.userId, SANCTIONED),
      }),
    ).toBeUndefined();
    expect(await tombstonesOf(SANCTIONED)).toMatchObject([{ sanction: "SILENCE" }]);
  });

  it("does not retain an unverified primary email or sanction its verified owner", async () => {
    await insertUsers([{ userId: SANCTIONED, isBanned: true }]);
    await addSanction(SANCTIONED, "BAN_ACTIVATED", new Date(Date.now() + DAY));
    const unverified = identity("another-owner@example.com");
    unverified.emailAddresses[0]!.verification = { status: "unverified" };
    stubClerk({
      [SANCTIONED]: unverified,
      user_owner: identity("another-owner@example.com"),
    });

    await deleteUser(await getTestDatabase(), SANCTIONED);
    expect(await tombstonesOf(SANCTIONED)).toMatchObject([{ emailHash: null }]);
    expect(await register("user_owner")).toMatchObject({ success: true });
    expect(
      (
        await (
          await getTestDatabase()
        ).query.userData.findFirst({
          where: eq(userData.userId, "user_owner"),
        })
      )?.isBanned,
    ).toBe(false);
  });

  it("matches linked OAuth identities after an email change", async () => {
    await insertUsers([{ userId: SANCTIONED, isBanned: true }]);
    await addSanction(SANCTIONED, "BAN_ACTIVATED", new Date(Date.now() + DAY));
    stubClerk({
      [SANCTIONED]: identity("old@example.com", [
        { provider: "oauth_google", providerUserId: "same-subject" },
      ]),
      user_oauth: identity("new@example.com", [
        { provider: "google", providerUserId: "same-subject" },
      ]),
    });
    await deleteUser(await getTestDatabase(), SANCTIONED);

    expect(await register("user_oauth")).toMatchObject({ success: true });
    expect(
      (
        await (
          await getTestDatabase()
        ).query.userData.findFirst({
          where: eq(userData.userId, "user_oauth"),
        })
      )?.isBanned,
    ).toBe(true);
  });

  it("keeps a sanctioned character invisible until its reports are durable", async () => {
    await insertUsers([{ userId: SANCTIONED, isBanned: true }]);
    await addSanction(SANCTIONED, "BAN_ACTIVATED", new Date(Date.now() + DAY));
    stubClerk({ [SANCTIONED]: identity("atomic@example.com") });
    const database = await getTestDatabase();
    await deleteUser(database, SANCTIONED);
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    let release!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reapply = sanctions.reapplySanctions;
    vi.spyOn(sanctions, "reapplySanctions").mockImplementation(async (...args) => {
      const guard = await reapply(...args);
      enter();
      await paused;
      return guard;
    });
    const registration = register(SANCTIONED);
    await entered;
    try {
      expect(
        await database.query.userData.findFirst({
          where: eq(userData.userId, SANCTIONED),
        }),
      ).toBeUndefined();
    } finally {
      release();
      await registration;
    }
    expect(await (await callerFor(reportsRouter, SANCTIONED)).getBan()).toMatchObject({
      status: "BAN_ACTIVATED",
    });
  });

  it("leaves no character or partial carryover if a supporting record cannot be saved", async () => {
    await insertUsers([{ userId: SANCTIONED, isBanned: true }]);
    await addSanction(SANCTIONED, "BAN_ACTIVATED", new Date(Date.now() + DAY));
    stubClerk({ [SANCTIONED]: identity("partial@example.com") });
    const database = await getTestDatabase();
    await deleteUser(database, SANCTIONED);
    const failingDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "execute")
          return async (query: Parameters<DrizzleClient["execute"]>[0]) => {
            const statement =
              typeof query === "string"
                ? query
                : new MySqlDialect().sqlToQuery(query.getSQL()).sql;
            if (statement.includes("INSERT INTO `ActionLog`"))
              throw new Error("Failed to save supporting record");
            return target.execute(query);
          };
        return Reflect.get(target, property, receiver);
      },
    });
    await expect(register(SANCTIONED, failingDatabase)).rejects.toThrow(
      "Failed to save supporting record",
    );
    expect(
      await database.query.userData.findFirst({
        where: eq(userData.userId, SANCTIONED),
      }),
    ).toBeUndefined();
    expect(await tombstonesOf(SANCTIONED)).toMatchObject([{ carryoverReportIds: [] }]);
    expect(await database.query.userReportComment.findMany()).toHaveLength(0);
  });

  it("does not resurrect a carryover sanction after staff clear it and the player deletes again", async () => {
    await insertUsers([{ userId: SANCTIONED, isBanned: true }]);
    await addSanction(SANCTIONED, "BAN_ACTIVATED", new Date(Date.now() + DAY));
    stubClerk({
      [SANCTIONED]: identity("cleared@example.com"),
      user_cleared: identity("cleared@example.com"),
    });
    const database = await getTestDatabase();
    await deleteUser(database, SANCTIONED);
    await register("user_cleared");
    await insertUsers([{ userId: "staff", role: "OWNER" }]);
    const report = await database.query.userReport.findFirst({
      where: eq(userReport.reportedUserId, "user_cleared"),
    });

    expect(
      await (await callerFor(reportsRouter, "staff")).clear({
        object_id: report!.id,
        comment: "Sanction lifted",
        banTime: 1,
        banTimeUnit: "days",
      }),
    ).toMatchObject({ success: true });
    expect(await tombstonesOf(SANCTIONED)).toHaveLength(0);
    await deleteUser(database, "user_cleared");
    expect(await register("user_cleared")).toMatchObject({ success: true });
    expect(
      (
        await database.query.userData.findFirst({
          where: eq(userData.userId, "user_cleared"),
        })
      )?.isBanned,
    ).toBe(false);
  });

  it.each([
    ["BAN_ACTIVATED", "warn"],
    ["SILENCE_ACTIVATED", "warn"],
    ["BAN_ACTIVATED", "tradeBan"],
    ["SILENCE_ACTIVATED", "tradeBan"],
  ] as const)(
    "does not restore a carryover %s replaced by staff %s after another deletion",
    async (status, decision) => {
      const database = await getTestDatabase();
      await insertUsers([{ userId: SANCTIONED }]);
      await addSanction(SANCTIONED, status, new Date(Date.now() + DAY));
      stubClerk({
        [SANCTIONED]: identity("replaced@example.com"),
        user_replaced: identity("replaced@example.com"),
      });
      vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue();
      await deleteUser(database, SANCTIONED);
      expect(await register("user_replaced")).toMatchObject({ success: true });
      await deleteUser(database, "user_replaced");
      expect(await register("user_replaced")).toMatchObject({ success: true });
      expect(await database.query.sanctionTombstone.findMany()).toHaveLength(2);
      const report = await database.query.userReport.findFirst({
        where: eq(userReport.reportedUserId, "user_replaced"),
      });
      expect(report).toMatchObject({ status, system: "sanction_carryover" });
      await insertUsers([{ userId: "staff", role: "OWNER" }]);

      expect(
        await (await callerFor(reportsRouter, "staff"))[decision]({
          object_id: report!.id,
          comment: "Replace the inherited sanction",
          banTime: 1,
          banTimeUnit: "days",
        }),
      ).toMatchObject({ success: true });
      expect(
        await database.query.userReport.findFirst({
          where: eq(userReport.id, report!.id),
        }),
      ).toMatchObject({
        status: decision === "warn" ? "OFFICIAL_WARNING" : "TRADE_BAN_ACTIVATED",
      });
      expect(await database.query.sanctionTombstone.findMany()).toHaveLength(0);
      await (await callerFor(reportsRouter, "user_replaced")).getBan();
      await deleteUser(database, "user_replaced");
      expect(await register("user_replaced")).toMatchObject({ success: true });
      expect(
        await database.query.userData.findFirst({
          where: eq(userData.userId, "user_replaced"),
        }),
      ).toMatchObject({ isBanned: false, isSilenced: false });
    },
  );

  it.each(["warn", "tradeBan"] as const)(
    "retains an independent ban when staff %s replaces a silence revised into a ban",
    async (decision) => {
      const database = await getTestDatabase();
      const independentEnd = new Date(Date.now() + 20 * DAY);
      await insertUsers([{ userId: SANCTIONED }]);
      await addSanction(
        SANCTIONED,
        "SILENCE_ACTIVATED",
        new Date(Date.now() + 10 * DAY),
        "original-silence",
      );
      await addSanction(SANCTIONED, "BAN_ACTIVATED", independentEnd, "original-ban");
      stubClerk({
        [SANCTIONED]: identity("independent@example.com"),
        user_revised: identity("independent@example.com"),
      });
      vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue();
      await deleteUser(database, SANCTIONED);
      expect(await register("user_revised")).toMatchObject({ success: true });
      await insertUsers([{ userId: "staff", role: "OWNER" }]);
      const staff = await callerFor(reportsRouter, "staff");
      const report = await database.query.userReport.findFirst({
        where: and(
          eq(userReport.reportedUserId, "user_revised"),
          eq(userReport.status, "SILENCE_ACTIVATED"),
        ),
      });
      const input = {
        object_id: report!.id,
        comment: "Revise the inherited sanction",
        banTime: 1,
        banTimeUnit: "days" as const,
      };
      expect(await staff.ban(input)).toMatchObject({ success: true });
      expect(await staff[decision](input)).toMatchObject({ success: true });
      expect(await tombstonesOf(SANCTIONED)).toMatchObject([
        {
          sourceId: "original-ban",
          sanction: "BAN",
          sanctionEndsAt: independentEnd,
        },
      ]);
      await deleteUser(database, "user_revised");
      expect(await register("user_revised")).toMatchObject({ success: true });
      expect(
        await database.query.userReport.findMany({
          where: eq(userReport.reportedUserId, "user_revised"),
        }),
      ).toMatchObject([{ status: "BAN_ACTIVATED", banEnd: independentEnd }]);
      expect(
        await database.query.userData.findFirst({
          where: eq(userData.userId, "user_revised"),
        }),
      ).toMatchObject({ isBanned: true, isSilenced: false });
    },
  );

  it("retains other active sanctions when staff clear a carryover ban", async () => {
    await insertUsers([{ userId: SANCTIONED, isBanned: true, isSilenced: true }]);
    await addSanction(SANCTIONED, "BAN_ACTIVATED", new Date(Date.now() + DAY));
    await addSanction(SANCTIONED, "SILENCE_ACTIVATED", new Date(Date.now() + DAY));
    stubClerk({
      [SANCTIONED]: identity("multiple@example.com"),
      user_multiple: identity("multiple@example.com"),
    });
    const database = await getTestDatabase();
    await deleteUser(database, SANCTIONED);
    await register("user_multiple");
    await insertUsers([{ userId: "staff", role: "OWNER" }]);
    await addSanction(
      "user_multiple",
      "BAN_ACTIVATED",
      new Date(Date.now() + 2 * DAY),
      "another-ban",
    );
    const report = await database.query.userReport.findFirst({
      where: and(
        eq(userReport.reportedUserId, "user_multiple"),
        eq(userReport.status, "BAN_ACTIVATED"),
        eq(userReport.system, "sanction_carryover"),
      ),
    });

    expect(
      await (await callerFor(reportsRouter, "staff")).clear({
        object_id: report!.id,
        comment: "Lift inherited ban only",
        banTime: 1,
        banTimeUnit: "days",
      }),
    ).toMatchObject({ success: true });
    expect(await tombstonesOf(SANCTIONED)).toMatchObject([{ sanction: "SILENCE" }]);
    expect(
      await database.query.userData.findFirst({
        where: eq(userData.userId, "user_multiple"),
      }),
    ).toMatchObject({ isBanned: true, isSilenced: true });
    expect(
      await database.query.userReport.findFirst({
        where: eq(userReport.id, "another-ban"),
      }),
    ).toMatchObject({ status: "BAN_ACTIVATED" });
  });

  it.each(["ban", "silence"] as const)(
    "preserves a staff-revised %s through the deleted identity and another deletion",
    async (decision) => {
      const database = await getTestDatabase();
      const status = decision === "ban" ? "BAN_ACTIVATED" : "SILENCE_ACTIVATED";
      const sanction = decision === "ban" ? "BAN" : "SILENCE";
      const originalEnd = new Date(Date.now() + 10 * DAY);
      await insertUsers([{ userId: SANCTIONED }]);
      await addSanction(SANCTIONED, status, originalEnd, "original-sanction");
      const clerkUsers: Record<string, SanctionIdentity> = {
        [SANCTIONED]: identity("appeal@example.com"),
        user_appealed: identity("appeal@example.com"),
        user_old_email: identity("appeal@example.com"),
      };
      stubClerk(clerkUsers);
      await removeAccountIdentity(SANCTIONED);
      delete clerkUsers[SANCTIONED];
      await deleteUser(database, SANCTIONED);
      expect(await register("user_appealed")).toMatchObject({ success: true });
      clerkUsers.user_appealed = identity("changed@example.com");
      await insertUsers([{ userId: "staff", role: "OWNER" }]);
      const report = await database.query.userReport.findFirst({
        where: eq(userReport.reportedUserId, "user_appealed"),
      });
      const staff = await callerFor(reportsRouter, "staff");
      const input = { object_id: report!.id, comment: "Reduce sanction after appeal" };
      expect(
        await staff[decision]({ ...input, banTime: 1, banTimeUnit: "days" }),
      ).toMatchObject({ success: true });
      const revised = await database.query.userReport.findFirst({
        where: eq(userReport.id, report!.id),
      });
      expect(revised!.banEnd!.getTime()).toBeLessThan(originalEnd.getTime());
      expect(await tombstonesOf(SANCTIONED)).toMatchObject([
        {
          sanction,
          emailHash: hashSanctionIdentifier("email", "appeal@example.com"),
        },
      ]);
      expect((await tombstonesOf(SANCTIONED))[0]!.sanctionEndsAt).toEqual(
        revised!.banEnd!,
      );
      // The deleted identity still enforces the revised sanction after an email change.
      expect(await register("user_old_email")).toMatchObject({ success: true });
      const oldEmailReport = await database.query.userReport.findFirst({
        where: eq(userReport.reportedUserId, "user_old_email"),
      });
      expect(oldEmailReport).toMatchObject({ status });
      expect(oldEmailReport!.banEnd).toEqual(revised!.banEnd);
      await deleteUser(database, "user_appealed");
      expect(await register("user_appealed")).toMatchObject({ success: true });
      const returnedReport = await database.query.userReport.findFirst({
        where: eq(userReport.reportedUserId, "user_appealed"),
      });
      expect(returnedReport).toMatchObject({ status });
      expect(returnedReport!.banEnd).toEqual(revised!.banEnd);
    },
  );

  it("clears every ancestor of an inherited ban while retaining an independent silence", async () => {
    const database = await getTestDatabase();
    const banEnd = new Date(Date.now() + 10 * DAY);
    const silenceEnd = new Date(Date.now() + 20 * DAY);
    await insertUsers([{ userId: SANCTIONED }]);
    await addSanction(SANCTIONED, "BAN_ACTIVATED", banEnd, "original-ban");
    await addSanction(SANCTIONED, "SILENCE_ACTIVATED", silenceEnd, "original-silence");
    const clerkUsers: Record<string, SanctionIdentity> = {
      [SANCTIONED]: identity("original@example.com"),
    };
    stubClerk(clerkUsers);
    let previousUserId = SANCTIONED;
    for (const [userId, email] of [
      ["user_second", "original@example.com"],
      ["user_third", "changed@example.com"],
      ["user_fourth", "changed-again@example.com"],
    ] as const) {
      clerkUsers[previousUserId] = identity(email);
      clerkUsers[userId] = identity(email);
      await removeAccountIdentity(previousUserId);
      delete clerkUsers[previousUserId];
      await deleteUser(database, previousUserId);
      expect(await register(userId)).toMatchObject({ success: true });
      previousUserId = userId;
    }
    const report = await database.query.userReport.findFirst({
      where: and(
        eq(userReport.reportedUserId, previousUserId),
        eq(userReport.status, "BAN_ACTIVATED"),
      ),
    });
    expect(
      await database.query.actionLog.findFirst({
        where: eq(actionLog.relatedId, report!.id),
      }),
    ).toMatchObject({
      changes: expect.arrayContaining([expect.stringContaining("original-ban")]),
    });
    await insertUsers([{ userId: "staff", role: "OWNER" }]);
    expect(
      await (await callerFor(reportsRouter, "staff")).clear({
        object_id: report!.id,
        comment: "Lift inherited ban",
        banTime: 1,
        banTimeUnit: "days",
      }),
    ).toMatchObject({ success: true });
    const retained = await database.query.sanctionTombstone.findMany();
    expect(retained).toMatchObject([
      { sanction: "SILENCE", sanctionEndsAt: silenceEnd },
      { sanction: "SILENCE", sanctionEndsAt: silenceEnd },
      { sanction: "SILENCE", sanctionEndsAt: silenceEnd },
    ]);
    expect(retained.map((source) => source.sanctionEndsAt)).toEqual([
      silenceEnd, silenceEnd, silenceEnd,
    ]);
    clerkUsers[previousUserId] = identity("original@example.com");
    await deleteUser(database, previousUserId);
    expect(await register(previousUserId)).toMatchObject({ success: true });
    expect(
      await database.query.userData.findFirst({
        where: eq(userData.userId, previousUserId),
      }),
    ).toMatchObject({ isBanned: false, isSilenced: true });
    expect(
      await database.query.userReport.findMany({
        where: eq(userReport.reportedUserId, previousUserId),
      }),
    ).toMatchObject([{ status: "SILENCE_ACTIVATED", banEnd: silenceEnd }]);
  });

  it.each(["ban", "silence"] as const)(
    "preserves a sanction revised into a %s when staff clear a separate longer sanction",
    async (decision) => {
      const database = await getTestDatabase();
      const status = decision === "ban" ? "BAN_ACTIVATED" : "SILENCE_ACTIVATED";
      const originalStatus = decision === "ban" ? "SILENCE_ACTIVATED" : "BAN_ACTIVATED";
      await insertUsers([{ userId: SANCTIONED }]);
      await addSanction(SANCTIONED, originalStatus, new Date(Date.now() + 10 * DAY));
      await addSanction(SANCTIONED, status, new Date(Date.now() + 20 * DAY));
      const clerkUsers: Record<string, SanctionIdentity> = {
        [SANCTIONED]: identity("conversion@example.com"),
        user_converted: identity("conversion@example.com"),
        user_old_identity: identity("conversion@example.com"),
      };
      stubClerk(clerkUsers);
      await removeAccountIdentity(SANCTIONED);
      delete clerkUsers[SANCTIONED];
      await deleteUser(database, SANCTIONED);
      await register("user_converted");
      clerkUsers.user_converted = identity("new-conversion@example.com");
      await insertUsers([{ userId: "staff", role: "OWNER" }]);
      const staff = await callerFor(reportsRouter, "staff");
      const reports = await database.query.userReport.findMany({
        where: eq(userReport.reportedUserId, "user_converted"),
      });
      const original = reports.find((report) => report.status === originalStatus)!;
      const separate = reports.find((report) => report.status === status)!;
      expect(
        await staff[decision]({
          object_id: original.id,
          comment: "Revise the inherited sanction",
          banTime: 1,
          banTimeUnit: "days",
        }),
      ).toMatchObject({ success: true });
      const revised = await database.query.userReport.findFirst({
        where: eq(userReport.id, original.id),
      });
      const sources = await tombstonesOf(SANCTIONED);
      const sanction = decision === "ban" ? "BAN" : "SILENCE";
      expect(sources).toHaveLength(2);
      expect(sources.every((source) => source.sanction === sanction)).toBe(true);
      expect(
        sources.find((source) => source.sourceId === `report-${status}`)!
          .sanctionEndsAt,
      ).toEqual(separate.banEnd!);
      expect(
        await staff.clear({
          object_id: separate.id,
          comment: "Lift the separate sanction",
          banTime: 1,
          banTimeUnit: "days",
        }),
      ).toMatchObject({ success: true });
      expect(await register("user_old_identity")).toMatchObject({ success: true });
      const inherited = await database.query.userReport.findMany({
        where: eq(userReport.reportedUserId, "user_old_identity"),
      });
      expect(inherited).toHaveLength(1);
      expect(inherited[0]!.status).toBe(status);
      expect(inherited[0]!.banEnd).toEqual(revised!.banEnd);
      await deleteUser(database, "user_converted");
      expect(await register("user_converted")).toMatchObject({ success: true });
      const returned = await database.query.userReport.findMany({
        where: eq(userReport.reportedUserId, "user_converted"),
      });
      expect(returned).toHaveLength(1);
      expect(returned[0]!.status).toBe(status);
      expect(returned[0]!.banEnd).toEqual(revised!.banEnd);
    },
  );

  describe("moderation during web deletion", () => {
    const input = {
      object_id: "original",
      comment: "Revise a case while its character is being deleted",
      banTime: 2,
      banTimeUnit: "days" as const,
    };
    beforeEach(async () => {
      await insertUsers([
        { userId: SANCTIONED, isBanned: true, deletionAt: new Date(Date.now() - DAY) },
        { userId: "staff", role: "OWNER" },
      ]);
      await addSanction(
        SANCTIONED,
        "BAN_ACTIVATED",
        new Date(Date.now() + 10 * DAY),
        "original",
      );
      stubClerk({ [SANCTIONED]: identity("web-cleanup@example.com") });
      vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue();
    });

    it.each([
      ["warn", "ban"],
      ["warn", "silence"],
      ["tradeBan", "ban"],
      ["tradeBan", "silence"],
    ] as const)(
      "rejects reactivation from %s to %s during web deletion",
      async (retiring, decision) => {
        const database = await getTestDatabase();
        const { deleting, release } = await pauseWebDeletion();
        try {
          expect(await tombstonesOf(SANCTIONED)).toHaveLength(1);
          expect(await database.query.accountDeletion.findMany()).toHaveLength(0);
          const staff = await callerFor(reportsRouter, "staff");
          expect(await staff[retiring](input)).toMatchObject({ success: true });
          expect(await tombstonesOf(SANCTIONED)).toHaveLength(0);
          const before = await Promise.all([
            database.query.userReport.findMany(),
            database.query.userData.findMany(),
            database.query.userReportComment.findMany(),
          ]);
          expect(await staff[decision](input)).toEqual({
            success: false,
            message:
              "Report or account is no longer available for this decision. Please refresh.",
          });
          expect(
            await Promise.all([
              database.query.userReport.findMany(),
              database.query.userData.findMany(),
              database.query.userReportComment.findMany(),
            ]),
          ).toEqual(before);
          expect(await database.query.storeUserIdAlias.findFirst()).toMatchObject({
            oldUserId: SANCTIONED,
            newUserId: expect.stringContaining(DELETED_STORE_USER_PREFIX),
          });
        } finally {
          release();
          await deleting;
        }
        expect(await deleting).toMatchObject({ success: true });
        expect(await database.query.userReport.findMany()).toHaveLength(0);
        expect(await tombstonesOf(SANCTIONED)).toHaveLength(0);
        expect(await register(SANCTIONED)).toMatchObject({ success: true });
        expect(await (await callerFor(reportsRouter, SANCTIONED)).getBan()).toBeNull();
        expect(
          await database.query.userData.findFirst({
            where: eq(userData.userId, SANCTIONED),
          }),
        ).toMatchObject({
          isBanned: false,
          isSilenced: false,
        });
      },
    );

    it.each(["ban", "silence"] as const)(
      "retains an accepted %s revision after capture",
      async (decision) => {
        const database = await getTestDatabase();
        const { deleting, release } = await pauseWebDeletion();
        let revised;
        try {
          expect(
            await (await callerFor(reportsRouter, "staff"))[decision](input),
          ).toMatchObject({ success: true });
          revised = await database.query.userReport.findFirst({
            where: eq(userReport.id, "original"),
          });
          expect(await tombstonesOf(SANCTIONED)).toMatchObject([
            {
              sourceId: "original",
              sanction: decision === "ban" ? "BAN" : "SILENCE",
              sanctionEndsAt: revised!.banEnd,
            },
          ]);
        } finally {
          release();
          await deleting;
        }
        expect(await deleting).toMatchObject({ success: true });
        expect(await register(SANCTIONED)).toMatchObject({ success: true });
        expect(await database.query.userReport.findMany()).toMatchObject([
          {
            status: revised!.status,
            banEnd: revised!.banEnd,
          },
        ]);
        expect(
          await database.query.userData.findFirst({
            where: eq(userData.userId, SANCTIONED),
          }),
        ).toMatchObject({
          isBanned: decision === "ban",
          isSilenced: decision === "silence",
        });
      },
    );

    it.each([
      null,
      "renamed-user",
      "__tnrXdeletedXstoreXuser__:lookalike",
      "__TNR_DELETED_STORE_USER__:lookalike",
    ])(
      "allows ordinary moderation with alias %p without retaining identifiers",
      async (newUserId) => {
        const database = await getTestDatabase();
        if (newUserId)
          await database
            .insert(storeUserIdAlias)
            .values({ oldUserId: SANCTIONED, newUserId });
        expect(
          await (await callerFor(reportsRouter, "staff")).ban(input),
        ).toMatchObject({ success: true });
        expect(await tombstonesOf(SANCTIONED)).toHaveLength(0);
      },
    );

    it("verifies deletion ownership before capturing identifiers", async () => {
      const database = await getTestDatabase();
      await database
        .insert(storeUserIdAlias)
        .values({ oldUserId: SANCTIONED, newUserId: "renamed-user" });
      await expect(deleteUser(database, SANCTIONED)).rejects.toThrow(
        "is being renamed and cannot be deleted",
      );
      expect(await tombstonesOf(SANCTIONED)).toHaveLength(0);
      expect(await database.query.userReport.findMany()).toHaveLength(1);
      expect(
        await database.query.userData.findFirst({
          where: eq(userData.userId, SANCTIONED),
        }),
      ).toBeDefined();
    });
  });
});
