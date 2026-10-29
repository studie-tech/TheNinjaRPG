import { CHARACTER_DELETION_CONFIRMATION } from "@/drizzle/constants";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as clerk from "@clerk/nextjs/server";
import { eq, sql } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import {
  accountDeletion,
  actionLog,
  bloodline,
  bloodlineRolls,
  forumPost,
  forumBoard,
  forumSection,
  forumThread,
  questHistory,
  sanctionTombstone,
  storeUserIdAlias,
  userAttribute,
  userData,
  userItem,
  userReport,
  userReportComment,
  type UserReportComment,
  village,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { commentsRouter } from "@/server/api/routers/comments";
import { registerRouter } from "@/server/api/routers/register";
import { profileRouter } from "@/server/api/routers/profile";
import { reportsRouter } from "@/server/api/routers/reports";
import type { DrizzleClient } from "@/server/db";
import * as sanctions from "@/server/utils/sanctionTombstone";
import { hashSanctionIdentifier, type SanctionIdentity } from "@/server/utils/sanctionTombstone";
import * as sanctionQueries from "@/queries/reports";
import { processAccountDeletions } from "@/server/utils/accountDeletion/process";
import { DELETED_STORE_USER_PREFIX } from "@/server/utils/purchases/grant";

import { insertUsers } from "../../setup/factories";
import {
  callerFor,
  callerForDatabase,
  recordQueries,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const DAY = 86_400_000;
const EMAIL = "registration-appeal@example.com";
const identity = (email: string): SanctionIdentity => ({
  primaryEmailAddressId: "primary",
  emailAddresses: [
    { id: "primary", emailAddress: email, verification: { status: "verified" } },
  ],
  externalAccounts: [],
});
let owners: Map<string, SanctionIdentity>;
let gatedId: string | undefined;
let enterLookup: (() => void) | undefined;
let lookupGate: Promise<void> | undefined;

const claimIdentity = (userId: string, email = EMAIL) => {
  expect(
    [...owners.values()].some((owner) =>
      owner.emailAddresses.some((address) => address.emailAddress === email),
    ),
  ).toBe(false);
  owners.set(userId, identity(email));
};

const register = async (userId: string, database?: DrizzleClient, userIp?: string) =>
  registerRouter.createCaller({
    drizzle: database ?? (await getTestDatabase()),
    userId,
    userIp,
  } as never).createCharacter({
    username: userId,
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
    bloodlineId: "registration-bloodline",
  });

const reportsOf = async (userId: string) =>
  (await getTestDatabase()).query.userReport.findMany({
    where: eq(userReport.reportedUserId, userId),
  });

const deleteAccount = async (userId: string) => {
  const database = await getTestDatabase();
  await database.insert(accountDeletion).values({ userId });
  expect(await processAccountDeletions(userId)).toEqual({ processed: 1, failed: 0 });
  expect(owners.has(userId)).toBe(false);
  await database
    .update(accountDeletion)
    .set({ nextAttemptAt: new Date(Date.now() - 1) })
    .where(eq(accountDeletion.userId, userId));
  expect(await processAccountDeletions(userId)).toEqual({ processed: 1, failed: 0 });
  expect(
    await database.query.accountDeletion.findFirst({
      where: eq(accountDeletion.userId, userId),
    }),
  ).toMatchObject({ phase: "COMPLETE" });
  expect(
    await database.query.userData.findFirst({ where: eq(userData.userId, userId) }),
  ).toBeUndefined();
  expect(await reportsOf(userId)).toHaveLength(0);
};

const startRegistration = async () => {
  claimIdentity("Concurrent");
  gatedId = "Concurrent";
  const entered = new Promise<void>((resolve) => {
    enterLookup = resolve;
  });
  let release!: () => void;
  lookupGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = register("Concurrent");
  await entered;
  expect(
    await (await getTestDatabase()).query.userData.findFirst({
      where: eq(userData.userId, "Concurrent"),
    }),
  ).toBeUndefined();
  expect(await reportsOf("Concurrent")).toHaveLength(0);
  return { pending, release };
};

const expectUnpublished = async (
  existingComments: UserReportComment[] = [],
  userId = "Concurrent",
) => {
  const database = await getTestDatabase();
  expect(
    await database.query.userData.findFirst({
      where: eq(userData.userId, userId),
    }),
  ).toBeUndefined();
  expect(await reportsOf(userId)).toHaveLength(0);
  expect(await database.query.userReportComment.findMany()).toEqual(existingComments);
  for (const table of [actionLog, userAttribute, bloodlineRolls, questHistory, userItem]) {
    expect(
      await database.select().from(table).where(eq(table.userId, userId)),
    ).toHaveLength(0);
  }
};

/** Pause after durable cases, before the character is published. */
const prepareAndPause = () => {
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  let release!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reapply = sanctions.reapplySanctions;
  let first = true;
  vi.spyOn(sanctions, "reapplySanctions").mockImplementation(async (...args) => {
    const guard = await reapply(...args);
    if (first) {
      first = false;
      enter();
      await paused;
    }
    return guard;
  });
  return { entered, release };
};

const addSilenceSource = async () => {
  const database = await getTestDatabase();
  const source = (await database.query.sanctionTombstone.findFirst())!;
  await database.insert(sanctionTombstone).values({
    ...source,
    sourceId: "silence-case",
    sanction: "SILENCE",
    sanctionEndsAt: new Date(Date.now() + 3 * DAY),
  });
};

describeWithDatabase("registration claims current sanction sources", () => {
  beforeEach(async () => {
    await resetTables(
      accountDeletion,
      actionLog,
      bloodline,
      bloodlineRolls,
      forumPost,
      forumThread,
      forumBoard,
      forumSection,
      questHistory,
      sanctionTombstone,
      storeUserIdAlias,
      userAttribute,
      userData,
      userItem,
      userReport,
      userReportComment,
      village,
    );
    owners = new Map();
    claimIdentity("Original");
    gatedId = undefined;
    enterLookup = undefined;
    lookupGate = undefined;
    vi.spyOn(clerk, "clerkClient").mockResolvedValue({
      users: {
        getUser: vi.fn(async (userId: string) => {
          if (userId === gatedId) {
            enterLookup?.();
            await lookupGate;
          }
          const owner = owners.get(userId);
          if (!owner) throw Object.assign(new Error("not found"), { status: 404 });
          return owner;
        }),
        deleteUser: vi.fn(async (userId: string) => {
          owners.delete(userId);
        }),
      },
    } as never);
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue();
    const database = await getTestDatabase();
    await Promise.all([
      insertUsers([{ userId: "staff", role: "OWNER" }, { userId: "Original" }]),
      database.insert(village).values({
        id: "registration-horizon",
        name: "Horizon",
        sector: 1,
        kageId: "kage",
      }),
      database.insert(bloodline).values({
        id: "registration-bloodline",
        name: "Test bloodline",
        image: "/bloodline.png",
        description: "test",
        effects: [],
        rank: "D",
      }),
      database.insert(userReport).values({
        id: "original-case",
        reporterUserId: "staff",
        reportedUserId: "Original",
        system: "tavern_comment",
        infraction: {},
        reason: "Spam",
        aiInterpretation: "",
        status: "BAN_ACTIVATED",
        banEnd: new Date(Date.now() + 10 * DAY),
      }),
    ]);
    await deleteAccount("Original");
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    // Registration in other suites must not meet this suite's unexpired tombstones.
    await resetTables(sanctionTombstone);
  });

  it.each(["appears", "changes"] as const)(
    "refuses publication when an IP source %s after the snapshot, then retries current decisions",
    async (change) => {
      const database = await getTestDatabase();
      const ipHashes = [hashSanctionIdentifier("ip", "192.0.2.1")];
      if (change === "changes")
        await database.update(sanctionTombstone).set({ ipHashes });
      claimIdentity("Concurrent", "different@example.com");
      const { entered, release } = prepareAndPause();
      const pending = register("Concurrent", database, "192.0.2.1");
      await entered;
      try {
        await database
          .update(sanctionTombstone)
          .set({ ipHashes: change === "appears" ? ipHashes : [] });
      } finally {
        release();
      }
      expect(await pending).toMatchObject({ success: false });
      await expectUnpublished();
      expect(await register("Concurrent", database, "192.0.2.1")).toMatchObject({
        success: true,
      });
      expect(
        await database.query.userData.findFirst({
          where: eq(userData.userId, "Concurrent"),
        }),
      ).toMatchObject({ isBanned: change === "appears" });
    },
  );

  it.each(["ban", "silence"] as const)(
    "clears an inherited %s when only expired or inactive cases remain",
    async (decision) => {
      const database = await getTestDatabase();
      if (decision === "silence")
        await database.update(sanctionTombstone).set({ sanction: "SILENCE" });
      claimIdentity("Concurrent");
      expect(await register("Concurrent")).toMatchObject({ success: true });
      const inherited = (await reportsOf("Concurrent"))[0]!;
      await database.insert(userReport).values(
        [
          {
            id: "expired-case",
            status: inherited.status,
            banEnd: new Date(Date.now() - DAY),
          },
          { id: "undated-case", status: inherited.status, banEnd: null },
          {
            id: "inactive-case",
            status: "REPORT_CLEARED" as const,
            banEnd: new Date(Date.now() + DAY),
          },
        ].map((report) => ({
          ...report,
          reporterUserId: "staff",
          reportedUserId: "Concurrent",
          system: "tavern_comment",
          infraction: {},
          reason: "Spam",
          aiInterpretation: "",
        })),
      );
      expect(
        await (await callerFor(reportsRouter, "staff")).clear({
          object_id: inherited.id,
          comment: "Appeal accepted",
          banTime: 1,
          banTimeUnit: "days",
        }),
      ).toMatchObject({ success: true });
      expect(
        await database.query.userData.findFirst({
          where: eq(userData.userId, "Concurrent"),
        }),
      ).toMatchObject({ isBanned: false, isSilenced: false });
      expect(await (await callerFor(reportsRouter, "Concurrent")).getBan()).toBeNull();
    },
  );

  it.each(["ban", "silence"] as const)(
    "keeps a recreated character's independent %s when an old clear resumes",
    async (decision) => {
      const database = await getTestDatabase();
      if (decision === "silence")
        await database.update(sanctionTombstone).set({ sanction: "SILENCE" });
      claimIdentity("Concurrent", "unrelated@example.com");
      expect(await register("Concurrent")).toMatchObject({ success: true });
      expect(await reportsOf("Concurrent")).toHaveLength(0);
      await database.insert(userReport).values({
        id: "current-case",
        reporterUserId: "staff",
        reportedUserId: "Concurrent",
        system: "tavern_comment",
        infraction: {},
        reason: "Spam",
        aiInterpretation: "",
        status: "UNVIEWED",
      });
      const input = {
        object_id: "current-case",
        comment: "Resolve the current character's case",
        banTime: 2,
        banTimeUnit: "days" as const,
      };
      expect(
        await (await callerFor(reportsRouter, "staff"))[decision](input),
      ).toMatchObject({ success: true });
      // The previous Clerk owner released this verified address during deletion.
      owners.set("Concurrent", identity(EMAIL));
      await database
        .update(userData)
        .set({ deletionAt: new Date(Date.now() - DAY) })
        .where(eq(userData.userId, "Concurrent"));

      let enter!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      let release!: () => void;
      const paused = new Promise<void>((resolve) => {
        release = resolve;
      });
      let reads = 0;
      const delayed = new Proxy(database, {
        get(target, property, receiver) {
          if (property === "query")
            return {
              ...target.query,
              userReport: {
                ...target.query.userReport,
                findFirst: target.query.userReport.findFirst.bind(
                  target.query.userReport,
                ),
                findMany: async (
                  ...args: Parameters<typeof database.query.userReport.findMany>
                ) => {
                  const reports = await target.query.userReport.findMany(...args);
                  expect(reports).toHaveLength(0);
                  if (++reads === 3) enter();
                  await paused;
                  return reports;
                },
              },
            };
          return Reflect.get(target, property, receiver);
        },
      });
      const clearing = callerForDatabase(reportsRouter, "staff", delayed).clear(input);
      const flag = decision === "ban" ? "isBanned" : "isSilenced";
      const message = "You cannot remove this post";
      const protectedAction = () =>
        callerForDatabase(commentsRouter, "Concurrent", database).deleteForumComment({
          id: "replacement-post",
        });
      await entered;
      try {
        expect(
          await callerForDatabase(
            profileRouter,
            "Concurrent",
            database,
          ).confirmDeletion({ userId: "Concurrent", confirmation: CHARACTER_DELETION_CONFIRMATION }),
        ).toMatchObject({ success: true });
        expect(await register("Concurrent")).toMatchObject({ success: true });
        await database.insert(forumSection).values({ id: "section", name: "General", summary: "", policy: {} });
        await database.insert(forumBoard).values({ id: "board", name: "Discussion", summary: "", sectionId: "section" });
        await database.insert(forumThread).values({ id: "thread", boardId: "board", title: "Discussion", userId: "Concurrent" });
        await database
          .insert(forumPost)
          .values({
            id: "replacement-post",
            threadId: "thread",
            userId: "Concurrent",
            authorId: "Concurrent",
            content: "Example post",
          });
        expect(
          await database.query.userData.findFirst({
            where: eq(userData.userId, "Concurrent"),
          }),
        ).toMatchObject({ [flag]: true });
        expect(await protectedAction()).toMatchObject({ success: false, message });
      } finally {
        release();
      }
      expect(await clearing).toMatchObject({ success: true });
      expect(await reportsOf("Concurrent")).toMatchObject([
        { status: decision === "ban" ? "BAN_ACTIVATED" : "SILENCE_ACTIVATED" },
      ]);
      const current = await database.query.userData.findFirst({
        where: eq(userData.userId, "Concurrent"),
      });
      const action = await protectedAction();
      expect(current).toMatchObject({ [flag]: true });
      expect(action).toMatchObject({ success: false, message });
      expect(
        await database.query.forumPost.findFirst({
          where: eq(forumPost.id, "replacement-post"),
        }),
      ).toBeDefined();
    },
  );

  it.each(["web", "native"] as const)(
    "rejects an empty snapshot overtaken by completed %s deletion and honors the retry",
    async (mode) => {
      const database = await getTestDatabase();
      await resetTables(sanctionTombstone);
      claimIdentity("LateOriginal");
      await insertUsers([
        {
          userId: "LateOriginal",
          username: "LateOriginal",
          isBanned: true,
          deletionAt: new Date(Date.now() - DAY),
        },
      ]);
      await database.insert(userReport).values({
        id: "late-case",
        reporterUserId: "staff",
        reportedUserId: "LateOriginal",
        system: "tavern_comment",
        infraction: {},
        reason: "Spam",
        aiInterpretation: "",
        status: "BAN_ACTIVATED",
        banEnd: new Date(Date.now() + DAY),
      });
      const userId = mode === "web" ? "LateOriginal" : "Concurrent";
      if (mode === "native") claimIdentity(userId, "unrelated@example.com");
      let enter!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const delayed = new Proxy(database, {
        get(target, property, receiver) {
          if (property === "query")
            return {
              ...target.query,
              userData: {
                ...target.query.userData,
                findFirst: async (
                  ...args: Parameters<typeof target.query.userData.findFirst>
                ) => {
                  await gate;
                  return target.query.userData.findFirst(...args);
                },
              },
              sanctionTombstone: {
                ...target.query.sanctionTombstone,
                findMany: async (
                  ...args: Parameters<typeof target.query.sanctionTombstone.findMany>
                ) => {
                  const result = await target.query.sanctionTombstone.findMany(...args);
                  expect(result).toHaveLength(0);
                  enter();
                  return result;
                },
              },
            };
          return Reflect.get(target, property, receiver);
        },
      });
      const pending = register(userId, delayed);
      await entered;
      try {
        if (mode === "web")
          expect(
            await callerForDatabase(
              profileRouter,
              "LateOriginal",
              database,
            ).confirmDeletion({ userId: "LateOriginal", confirmation: CHARACTER_DELETION_CONFIRMATION }),
          ).toMatchObject({ success: true });
        else {
          await deleteAccount("LateOriginal");
          owners.delete(userId);
          claimIdentity(userId);
        }
        expect(await database.query.sanctionTombstone.findMany()).toHaveLength(1);
      } finally {
        release();
      }
      expect(await pending).toEqual({
        success: false,
        message: "Account sanctions changed, please try again",
      });
      await expectUnpublished([], userId);
      expect(await register(userId)).toMatchObject({ success: true });
      expect(
        await database.query.userData.findFirst({ where: eq(userData.userId, userId) }),
      ).toMatchObject({ isBanned: true });
      expect(await reportsOf(userId)).toMatchObject([{ status: "BAN_ACTIVATED" }]);
    },
  );

  it.each(
    (["lookup", "prepared"] as const).flatMap((phase) =>
      (
        [
          "clerkId",
          "email",
          "secondary",
          "oauth",
          "unverified",
          "unrelated",
          "expired",
        ] as const
      ).map((kind) => [phase, kind] as const),
    ),
  )("checks a new %s source matching %s before publication", async (phase, kind) => {
    const database = await getTestDatabase();
    claimIdentity("Concurrent");
    owners.set("Concurrent", {
      ...owners.get("Concurrent")!,
      emailAddresses: [
        ...owners.get("Concurrent")!.emailAddresses,
        {
          id: "secondary",
          emailAddress: "Late.Match+return@GoogleMail.com",
          verification: { status: kind === "unverified" ? "unverified" : "verified" },
        },
      ],
      externalAccounts: [{ provider: "oauth_GitHub", providerUserId: "late-provider" }],
    });
    let release!: () => void;
    let entered: Promise<void>;
    if (phase === "lookup") {
      gatedId = "Concurrent";
      entered = new Promise<void>((resolve) => {
        enterLookup = resolve;
      });
      lookupGate = new Promise<void>((resolve) => {
        release = resolve;
      });
    } else ({ entered, release } = prepareAndPause());
    const pending = register("Concurrent");
    await entered;
    try {
      await database.insert(sanctionTombstone).values({
        userId: kind === "clerkId" ? "Concurrent" : "LateOriginal",
        sourceId: "late-case",
        sanction: phase === "lookup" ? "BAN" : "SILENCE",
        sanctionEndsAt: new Date(Date.now() + (kind === "expired" ? -DAY : DAY)),
        emailHash: hashSanctionIdentifier(
          "email",
          kind === "secondary" || kind === "unverified"
            ? "latematch@gmail.com"
            : kind === "email" || kind === "expired"
              ? EMAIL
              : "unrelated@example.com",
        ),
        accountHashes:
          kind === "oauth"
            ? [hashSanctionIdentifier("oauth", "github:late-provider")]
            : [],
      });
    } finally {
      release();
    }
    const matches = !["unverified", "unrelated", "expired"].includes(kind);
    expect((await pending).success).toBe(!matches);
    if (matches) {
      await expectUnpublished();
      expect(await register("Concurrent")).toMatchObject({ success: true });
    }
    expect(
      await database.query.userData.findFirst({
        where: eq(userData.userId, "Concurrent"),
      }),
    ).toMatchObject({ isBanned: true, isSilenced: matches && phase === "prepared" });
    const reports = await reportsOf("Concurrent");
    expect(reports).toHaveLength(matches && phase === "prepared" ? 2 : 1);
    expect(
      (await database.query.sanctionTombstone.findMany()).find(
        (source) => source.sourceId === "late-case",
      )!.carryoverReportIds,
    ).toHaveLength(matches ? 1 : 0);
  });

  it.each(["clear", "silence", "ban", "unchanged"] as const)(
    "honors a completed %s decision during Clerk lookup, including later native recreation",
    async (decision) => {
      const database = await getTestDatabase();
      claimIdentity("Replacement");
      expect(await register("Replacement")).toMatchObject({ success: true });
      const inherited = (await reportsOf("Replacement"))[0]!;
      owners.set("Replacement", identity("changed-appeal@example.com"));
      // A retry must retain the store ledger's deletion marker until a character exists.
      const alias = {
        oldUserId: "Concurrent",
        newUserId: `${DELETED_STORE_USER_PREFIX}Concurrent`,
      };
      await database.insert(storeUserIdAlias).values(alias);
      const { pending, release } = await startRegistration();
      let saved = await database.query.sanctionTombstone.findMany();
      let savedComments = await database.query.userReportComment.findMany();
      try {
        if (decision !== "unchanged") {
          expect(
            await (await callerFor(reportsRouter, "staff"))[decision]({
              object_id: inherited.id,
              comment: "Appeal accepted",
              banTime: 1,
              banTimeUnit: "days",
            }),
          ).toMatchObject({ success: true });
        }
        saved = await database.query.sanctionTombstone.findMany();
        savedComments = await database.query.userReportComment.findMany();
      } finally {
        release();
      }
      const result = await pending;
      if (decision !== "unchanged") {
        expect(result).toEqual({
          success: false,
          message: "Account sanctions changed, please try again",
        });
        await expectUnpublished(savedComments);
        expect(await database.query.sanctionTombstone.findMany()).toEqual(saved);
        expect(
          await database.query.storeUserIdAlias.findFirst({
            where: eq(storeUserIdAlias.oldUserId, "Concurrent"),
          }),
        ).toMatchObject(alias);
        expect(await register("Concurrent")).toMatchObject({ success: true });
      } else expect(result).toMatchObject({ success: true });
      const expected =
        decision === "clear"
          ? []
          : [
              expect.objectContaining({
                status: decision === "silence" ? "SILENCE_ACTIVATED" : "BAN_ACTIVATED",
                banEnd: saved[0]!.sanctionEndsAt,
              }),
            ];
      expect(await reportsOf("Concurrent")).toEqual(expected);
      expect(
        await database.query.storeUserIdAlias.findFirst({
          where: eq(storeUserIdAlias.oldUserId, "Concurrent"),
        }),
      ).toBeUndefined();
      await deleteAccount("Concurrent");
      claimIdentity("LaterReturn");
      expect(await register("LaterReturn")).toMatchObject({ success: true });
      expect(await reportsOf("LaterReturn")).toEqual(expected);
      const active = await (await callerFor(reportsRouter, "LaterReturn")).getBan();
      expect(active?.status === "BAN_ACTIVATED").toBe(
        decision === "ban" || decision === "unchanged",
      );
    },
  );

  it.each(["matched", "ancestor", "other-type"] as const)(
    "discards every unpublished report and link when one %s source changes",
    async (changed) => {
      const database = await getTestDatabase();
      const source = (await database.query.sanctionTombstone.findFirst())!;
      await database.insert(sanctionTombstone).values([
        {
          ...source,
          userId: "second-source",
          sourceId: "second-case",
          sanctionEndsAt: new Date(Date.now() + 3 * DAY),
        },
        {
          ...source,
          userId: "ancestor-source",
          sourceId: "ancestor-case",
          emailHash: hashSanctionIdentifier("email", "ancestor@example.com"),
          carryoverReportIds: ["original-case"],
        },
        {
          ...source,
          userId: "silence-source",
          sourceId: "silence-case",
          sanction: "SILENCE",
        },
      ]);
      const changedId =
        changed === "matched"
          ? "second-case"
          : changed === "ancestor"
            ? "ancestor-case"
            : "silence-case";
      const { pending, release } = await startRegistration();
      try {
        await database
          .delete(sanctionTombstone)
          .where(eq(sanctionTombstone.sourceId, changedId));
      } finally {
        release();
      }
      expect(await pending).toMatchObject({ success: false });
      await expectUnpublished();
      const saved = await database.query.sanctionTombstone.findMany();
      expect(saved).toHaveLength(3);
      expect(
        saved.every(
          (row) =>
            row.carryoverReportIds.length ===
            (row.sourceId === "ancestor-case" ? 1 : 0),
        ),
      ).toBe(true);
      expect(await register("Concurrent")).toMatchObject({ success: true });
      const reports = await reportsOf("Concurrent");
      expect(reports).toHaveLength(changed === "other-type" ? 1 : 2);
      expect(
        reports.find((report) => report.status === "BAN_ACTIVATED")!.banEnd,
      ).toEqual(source.sanctionEndsAt);
    },
  );

  it.each(["email", "oauth", "expired", "links"] as const)(
    "validates %s changes without rejecting another registration's appended link",
    async (change) => {
      const database = await getTestDatabase();
      const { pending, release } = await startRegistration();
      try {
        await database.update(sanctionTombstone).set(
          change === "email"
            ? { emailHash: hashSanctionIdentifier("email", "different@example.com") }
            : change === "oauth"
              ? { accountHashes: ["changed-oauth-hash"] }
              : change === "expired"
                ? { sanctionEndsAt: new Date(Date.now() - 1) }
                : {
                    carryoverReportIds: sql`JSON_ARRAY_APPEND(${sanctionTombstone.carryoverReportIds}, '$', 'other-registration')`,
                  },
        );
      } finally {
        release();
      }
      expect(await pending).toMatchObject({ success: change === "links" });
      if (change === "links") {
        expect(
          (await database.query.sanctionTombstone.findFirst())!.carryoverReportIds,
        ).toEqual(["other-registration", (await reportsOf("Concurrent"))[0]!.id]);
      } else {
        await expectUnpublished();
        expect(
          (await database.query.sanctionTombstone.findFirst())!.carryoverReportIds,
        ).toEqual([]);
        expect(await register("Concurrent")).toMatchObject({ success: true });
        expect(await reportsOf("Concurrent")).toHaveLength(change === "oauth" ? 1 : 0);
      }
    },
  );

  it.each(["type", "deadline", "clear"] as const)(
    "rejects a %s change after records and source links are prepared",
    async (change) => {
      const database = await getTestDatabase();
      await addSilenceSource();
      claimIdentity("Concurrent");
      const { entered, release } = prepareAndPause();
      const pending = register("Concurrent");
      await entered;
      expect(await reportsOf("Concurrent")).toHaveLength(2);
      try {
        if (change === "clear")
          await database
            .delete(sanctionTombstone)
            .where(eq(sanctionTombstone.sourceId, "original-case"));
        else
          await database
            .update(sanctionTombstone)
            .set(
              change === "type"
                ? { sanction: "SILENCE" }
                : { sanctionEndsAt: new Date(Date.now() + DAY) },
            )
            .where(eq(sanctionTombstone.sourceId, "original-case"));
      } finally {
        release();
      }
      expect(await pending).toEqual({
        success: false,
        message: "Account sanctions changed, please try again",
      });
      await expectUnpublished();
      expect(
        (await database.query.sanctionTombstone.findMany()).every(
          (source) => source.carryoverReportIds.length === 0,
        ),
      ).toBe(true);
      expect(await register("Concurrent")).toMatchObject({ success: true });
      expect(
        (
          await database.query.userData.findFirst({
            where: eq(userData.userId, "Concurrent"),
          })
        )?.isBanned,
      ).toBe(change === "deadline");
      expect(
        (await reportsOf("Concurrent")).map((report) => report.status).sort(),
      ).toEqual(
        change === "deadline"
          ? ["BAN_ACTIVATED", "SILENCE_ACTIVATED"]
          : ["SILENCE_ACTIVATED"],
      );
    },
  );

  it("shares prepared cases across identical retries without duplicate links or transactions", async () => {
    const database = await getTestDatabase();
    await addSilenceSource();
    claimIdentity("Concurrent");
    const source = (await database.query.sanctionTombstone.findFirst())!;
    await database
      .insert(sanctionTombstone)
      .values({ ...source, userId: "second-source", sourceId: "second-case" });
    const { entered, release } = prepareAndPause();
    const pending = register("Concurrent");
    await entered;
    const prepared = await reportsOf("Concurrent");
    const fetch = sanctionQueries.fetchActiveSanctionTombstones;
    vi.spyOn(sanctionQueries, "fetchActiveSanctionTombstones").mockImplementation(
      (...args) =>
        Promise.resolve(fetch(...args)).then((sources) => sources.reverse()) as never,
    );
    try {
      const recorded = await recordQueries(() => register("Concurrent"));
      expect(recorded.result).toMatchObject({ success: true });
      expect(
        recorded.statements.some((statement) =>
          /^(?:begin|start transaction|commit|rollback)\b/i.test(statement.trim()),
        ),
      ).toBe(false);
    } finally {
      release();
    }
    expect(await pending).toMatchObject({
      success: false,
      message: "Character already created for this account",
    });
    expect(await reportsOf("Concurrent")).toEqual(prepared);
    expect(await database.query.userReportComment.findMany()).toHaveLength(2);
    expect(await database.query.actionLog.findMany()).toHaveLength(2);
    expect(
      (await database.query.sanctionTombstone.findMany()).every(
        (source) => source.carryoverReportIds.length === 1,
      ),
    ).toBe(true);
    expect(
      await database.query.userData.findFirst({
        where: eq(userData.userId, "Concurrent"),
      }),
    ).toMatchObject({ isBanned: true, isSilenced: true });
  });

  it("lets a retry replace an in-flight abandoned decision without deleting the winner's records", async () => {
    const database = await getTestDatabase();
    claimIdentity("Concurrent");
    const { entered, release } = prepareAndPause();
    const pending = register("Concurrent");
    await entered;
    const stale = (await reportsOf("Concurrent"))[0]!;
    await database
      .update(sanctionTombstone)
      .set({ sanction: "SILENCE", sanctionEndsAt: new Date(Date.now() + DAY) });
    try {
      expect(await register("Concurrent")).toMatchObject({ success: true });
    } finally {
      release();
    }
    expect(await pending).toMatchObject({ success: false });
    const active = await reportsOf("Concurrent");
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ status: "SILENCE_ACTIVATED" });
    expect(active[0]!.id).not.toBe(stale.id);
    expect(await database.query.userReportComment.findMany()).toHaveLength(1);
    expect(await database.query.actionLog.findMany()).toHaveLength(1);
    expect(
      (await database.query.sanctionTombstone.findFirst())!.carryoverReportIds,
    ).toEqual([active[0]!.id]);
    expect(
      await database.query.userData.findFirst({
        where: eq(userData.userId, "Concurrent"),
      }),
    ).toMatchObject({ isBanned: false, isSilenced: true });
  });

  it("repairs failed creation and interrupted cleanup after staff clear the source", async () => {
    const database = await getTestDatabase();
    claimIdentity("Replacement");
    expect(await register("Replacement")).toMatchObject({ success: true });
    const inherited = (await reportsOf("Replacement"))[0]!;
    owners.set("Replacement", identity("different-owner@example.com"));
    claimIdentity("Concurrent");
    const failingDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "execute")
          return async (query: Parameters<DrizzleClient["execute"]>[0]) => {
            const statement =
              typeof query === "string"
                ? query
                : new MySqlDialect().sqlToQuery(query.getSQL()).sql;
            if (
              statement.includes("INSERT INTO `UserData`") ||
              statement.includes("DELETE `UserReport`")
            )
              throw new Error("Database unavailable");
            return target.execute(query);
          };
        return Reflect.get(target, property, receiver);
      },
    });
    await expect(register("Concurrent", failingDatabase)).rejects.toThrow(
      "Database unavailable",
    );
    expect(await reportsOf("Concurrent")).toHaveLength(1);
    expect(
      await database.query.userData.findFirst({
        where: eq(userData.userId, "Concurrent"),
      }),
    ).toBeUndefined();
    expect(
      await (await callerFor(reportsRouter, "staff")).clear({
        object_id: inherited.id,
        comment: "Appeal accepted",
        banTime: 1,
        banTimeUnit: "days",
      }),
    ).toMatchObject({ success: true });
    expect(await database.query.sanctionTombstone.findMany()).toHaveLength(0);
    expect(await register("Concurrent")).toMatchObject({ success: true });
    expect(await reportsOf("Concurrent")).toHaveLength(0);
    expect(
      (await database.query.actionLog.findMany()).filter(
        (log) => log.userId === "Concurrent",
      ),
    ).toHaveLength(0);
    expect(await (await callerFor(reportsRouter, "Concurrent")).getBan()).toBeNull();
    expect(
      await database.query.userData.findFirst({
        where: eq(userData.userId, "Concurrent"),
      }),
    ).toMatchObject({ isBanned: false, isSilenced: false });
    await deleteAccount("Concurrent");
    claimIdentity("LaterReturn");
    expect(await register("LaterReturn")).toMatchObject({ success: true });
    expect(await reportsOf("LaterReturn")).toHaveLength(0);
  });

  it.each(["empty", "prepared"] as const)(
    "returns a complete report when getBan reads %s records during registration",
    async (records) => {
      const database = await getTestDatabase();
      await addSilenceSource();
      claimIdentity("Concurrent");
      const preparation = records === "prepared" ? prepareAndPause() : null;
      const registration = preparation ? register("Concurrent") : null;
      if (preparation) await preparation.entered;
      let enter!: () => void;
      const readReports = new Promise<void>((resolve) => {
        enter = resolve;
      });
      let release!: () => void;
      const paused = new Promise<void>((resolve) => {
        release = resolve;
      });
      const getBanDatabase = new Proxy(database, {
        get(target, property, receiver) {
          if (property === "query")
            return {
              ...target.query,
              userData: {
                ...target.query.userData,
                findFirst: async (
                  ...args: Parameters<typeof database.query.userData.findFirst>
                ) => {
                  await paused;
                  return target.query.userData.findFirst(...args);
                },
              },
              userReport: {
                ...target.query.userReport,
                findMany: async (
                  ...args: Parameters<typeof database.query.userReport.findMany>
                ) => {
                  const reports = await target.query.userReport.findMany(...args);
                  enter();
                  return reports;
                },
              },
            };
          return Reflect.get(target, property, receiver);
        },
      });
      const lookup = callerForDatabase(
        reportsRouter,
        "Concurrent",
        getBanDatabase,
      ).getBan();
      await readReports;
      try {
        preparation?.release();
        expect(await (registration ?? register("Concurrent"))).toMatchObject({
          success: true,
        });
      } finally {
        release();
      }
      expect(await lookup).toMatchObject({
        status: "BAN_ACTIVATED",
        reportedUser: { userId: "Concurrent", username: "Concurrent" },
      });
      expect(
        await database.query.userData.findFirst({
          where: eq(userData.userId, "Concurrent"),
        }),
      ).toMatchObject({ isBanned: true, isSilenced: true });
      expect(
        await (await callerFor(reportsRouter, "Concurrent")).getBan(),
      ).toMatchObject({ status: "BAN_ACTIVATED" });
    },
  );

  it("keeps distinct original cases after repeatedly deleting and recreating the same account", async () => {
    const database = await getTestDatabase();
    await addSilenceSource();
    claimIdentity("Concurrent");
    expect(await register("Concurrent")).toMatchObject({ success: true });
    const first = await reportsOf("Concurrent");
    await deleteAccount("Concurrent");
    claimIdentity("Concurrent");
    expect(await register("Concurrent")).toMatchObject({ success: true });
    const second = await reportsOf("Concurrent");
    expect(second).toHaveLength(2);
    expect(
      second.every((report) => first.every((previous) => previous.id !== report.id)),
    ).toBe(true);
    for (const previous of first)
      expect(
        second.find((report) => report.status === previous.status)!.banEnd,
      ).toEqual(previous.banEnd);
    expect(await database.query.sanctionTombstone.findMany()).toHaveLength(4);
  });

  it("rejects a source that expires while publication is paused", async () => {
    const database = await getTestDatabase();
    await addSilenceSource();
    const endsAt = new Date(Date.now() + 750);
    await database
      .update(sanctionTombstone)
      .set({ sanctionEndsAt: endsAt })
      .where(eq(sanctionTombstone.sourceId, "original-case"));
    claimIdentity("Concurrent");
    const { entered, release } = prepareAndPause();
    const pending = register("Concurrent");
    await entered;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, endsAt.getTime() - Date.now()) + 30),
    );
    release();
    expect(await pending).toMatchObject({ success: false });
    await expectUnpublished();
    expect(await register("Concurrent")).toMatchObject({ success: true });
    expect(await reportsOf("Concurrent")).toMatchObject([
      { status: "SILENCE_ACTIVATED" },
    ]);
    expect(
      await database.query.userData.findFirst({
        where: eq(userData.userId, "Concurrent"),
      }),
    ).toMatchObject({ isBanned: false, isSilenced: true });
  });

  it("creates one character and one case per type for simultaneous attempts", async () => {
    const database = await getTestDatabase();
    await addSilenceSource();
    claimIdentity("Concurrent");
    const results = await Promise.all(
      Array.from({ length: 4 }, () => register("Concurrent")),
    );
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(await reportsOf("Concurrent")).toHaveLength(2);
    expect(await database.query.userReportComment.findMany()).toHaveLength(2);
    expect(await database.query.actionLog.findMany()).toHaveLength(2);
    expect(
      (await database.query.sanctionTombstone.findMany()).every(
        (source) => source.carryoverReportIds.length === 1,
      ),
    ).toBe(true);
    expect(await database.query.bloodlineRolls.findMany()).toHaveLength(1);
    const furniture = await database.query.userItem.findMany({
      where: eq(userItem.userId, "Concurrent"),
    });
    expect(furniture.map((item) => item.itemId).sort()).toEqual([
      "home-armory",
      "home-bed",
      "home-garden",
      "home-kitchen",
    ]);
    expect(new Set(furniture.map((item) => item.id)).size).toBe(4);
    expect(furniture.every((item) => item.storedAtHome)).toBe(true);
  });

  it("keeps a concurrent winner when a failed attempt resumes cleanup", async () => {
    const database = await getTestDatabase();
    await addSilenceSource();
    claimIdentity("Concurrent");
    let enter!: () => void;
    const reachedInsert = new Promise<void>((resolve) => {
      enter = resolve;
    });
    let release!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const failingDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "execute")
          return async (query: Parameters<DrizzleClient["execute"]>[0]) => {
            const statement =
              typeof query === "string"
                ? query
                : new MySqlDialect().sqlToQuery(query.getSQL()).sql;
            if (statement.includes("INSERT INTO `UserData`")) {
              enter();
              await paused;
              throw new Error("Character insert failed");
            }
            return target.execute(query);
          };
        return Reflect.get(target, property, receiver);
      },
    });
    const failing = register("Concurrent", failingDatabase);
    await reachedInsert;
    try {
      expect(await register("Concurrent")).toMatchObject({ success: true });
    } finally {
      release();
    }
    await expect(failing).rejects.toThrow("Character insert failed");
    expect(await reportsOf("Concurrent")).toHaveLength(2);
    expect(await database.query.userReportComment.findMany()).toHaveLength(2);
    expect(await database.query.actionLog.findMany()).toHaveLength(2);
    expect(
      (await database.query.sanctionTombstone.findMany()).every(
        (source) => source.carryoverReportIds.length === 1,
      ),
    ).toBe(true);
    expect(
      await database.query.userData.findFirst({
        where: eq(userData.userId, "Concurrent"),
      }),
    ).toMatchObject({ isBanned: true, isSilenced: true });
  });
});
