// @vitest-environment node

import { eq, inArray } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import {
  actionLog,
  anbuSquad,
  questHistory,
  rankedUserRewards,
  userAttribute,
  userData,
  userItem,
  userItemImbuement,
  userJutsu,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { staffRouter } from "@/server/api/routers/staff";
import { insertUsers } from "../setup/factories";
import { failStatements } from "../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../setup/testDatabase";

const STAFF = "clone-debug-staff";
const SOURCE = "clone-debug-source";
const OTHER_SOURCE = "clone-debug-source-two";
const ORDINARY = "clone-debug-ordinary";
const STAFF_TARGET = "clone-debug-staff-target";

const seedCloneRelations = async () => {
  const database = await getTestDatabase();
  await database.insert(anbuSquad).values({
    id: "clone-debug-anbu",
    name: "Clone debug ANBU",
    image: "/anbu.png",
    villageId: "village-source",
    leaderId: SOURCE,
    memberCount: 1,
    kageOrderId: "clone-debug-kage-order",
    leaderOrderId: "clone-debug-leader-order",
  });
  await database.insert(userItem).values([
    {
      id: "clone-source-item",
      userId: SOURCE,
      itemId: "catalog-item",
      quantity: 3,
      level: 8,
      experience: 82,
      equipped: "NONE",
    },
    {
      id: "clone-staff-old-item",
      userId: STAFF,
      itemId: "old-catalog-item",
      quantity: 1,
      equipped: "NONE",
    },
  ]);
  await database.insert(userItemImbuement).values([
    {
      id: "clone-source-imbuement",
      userItemId: "clone-source-item",
      imbuementItemId: "imbuement-item",
      craftingFinishedAt: new Date("2026-09-10T12:00:00Z"),
    },
    {
      id: "clone-staff-old-imbuement",
      userItemId: "clone-staff-old-item",
      imbuementItemId: "old-imbuement-item",
      craftingFinishedAt: new Date("2026-09-10T13:00:00Z"),
    },
  ]);
  await database.insert(userJutsu).values([
    {
      id: "clone-source-jutsu",
      userId: SOURCE,
      jutsuId: "catalog-jutsu",
      level: 9,
      experience: 820,
      equipped: true,
    },
    {
      id: "clone-staff-old-jutsu",
      userId: STAFF,
      jutsuId: "old-catalog-jutsu",
      level: 1,
      equipped: false,
    },
  ]);
  await database.insert(questHistory).values({
    id: "clone-source-quest",
    userId: SOURCE,
    questId: "catalog-quest",
    questType: "daily",
    completed: 3,
  });
  await database.insert(rankedUserRewards).values({
    id: "clone-source-ranked-reward",
    userId: SOURCE,
    seasonId: "season-one",
    division: "Adept",
    claimed: false,
  });
  await database.insert(userAttribute).values([
    { id: "clone-source-attribute", userId: SOURCE, attribute: "Hair" },
    { id: "clone-staff-old-attribute", userId: STAFF, attribute: "Eyes" },
  ]);
};

describeWithDatabase("staff.cloneUserForDebug", () => {
  beforeEach(async () => {
    await resetTables(
      actionLog,
      userItemImbuement,
      userItem,
      userJutsu,
      questHistory,
      rankedUserRewards,
      userAttribute,
      anbuSquad,
      userData,
    );
    await insertUsers([
      {
        userId: STAFF,
        username: "CloneDebugStaff",
        role: "CODING-ADMIN",
        customTitle: "preserved identity",
        money: 111,
        maxHealth: 500,
      },
      {
        userId: SOURCE,
        username: "CloneDebugSource",
        role: "USER",
        money: 827001,
        bank: 827002,
        maxHealth: 8270,
        curHealth: 8123,
        level: 37,
        location: "source location",
        anbuId: "clone-debug-anbu",
      },
      {
        userId: OTHER_SOURCE,
        username: "CloneDebugSourceTwo",
        role: "USER",
        money: 828001,
        maxHealth: 8280,
        location: "second source location",
      },
      { userId: ORDINARY, username: "CloneDebugOrdinary", role: "USER" },
      {
        userId: STAFF_TARGET,
        username: "CloneDebugStaffTarget",
        role: "CONTENT-ADMIN",
      },
    ]);
    await seedCloneRelations();
  });

  it("atomically replaces the intended gameplay data and remaps item children", async () => {
    const database = await getTestDatabase();
    const caller = await callerFor(staffRouter, STAFF);

    await expect(
      caller.cloneUserForDebug({
        userId: SOURCE,
        expectedUsername: "CloneDebugSource",
      }),
    ).resolves.toEqual({
      success: true,
      message: "Copied CloneDebugSource into your debug account",
      userId: STAFF,
      sourceUserId: SOURCE,
    });

    const [staff, source, staffItems, sourceItems, staffImbuements, oldImbuement] =
      await Promise.all([
        database.query.userData.findFirst({ where: eq(userData.userId, STAFF) }),
        database.query.userData.findFirst({ where: eq(userData.userId, SOURCE) }),
        database.query.userItem.findMany({ where: eq(userItem.userId, STAFF) }),
        database.query.userItem.findMany({ where: eq(userItem.userId, SOURCE) }),
        database.query.userItemImbuement.findMany({
          where: inArray(
            userItemImbuement.userItemId,
            (
              await database.query.userItem.findMany({
                columns: { id: true },
                where: eq(userItem.userId, STAFF),
              })
            ).map((entry) => entry.id),
          ),
        }),
        database.query.userItemImbuement.findFirst({
          where: eq(userItemImbuement.id, "clone-staff-old-imbuement"),
        }),
      ]);
    expect(staff).toMatchObject({
      username: "CloneDebugStaff",
      role: "CODING-ADMIN",
      customTitle: "preserved identity",
      money: 827001,
      bank: 827002,
      maxHealth: 8270,
      curHealth: 8123,
      level: 37,
      location: "source location",
      anbuId: "clone-debug-anbu",
    });
    expect(source).toMatchObject({
      username: "CloneDebugSource",
      money: 827001,
      location: "source location",
    });
    expect(staffItems).toHaveLength(1);
    expect(sourceItems).toHaveLength(1);
    expect(staffItems[0]).toMatchObject({
      itemId: sourceItems[0]?.itemId,
      quantity: sourceItems[0]?.quantity,
      level: sourceItems[0]?.level,
      experience: sourceItems[0]?.experience,
    });
    expect(staffItems[0]?.id).not.toBe(sourceItems[0]?.id);
    expect(staffImbuements).toHaveLength(1);
    expect(staffImbuements[0]).toMatchObject({
      userItemId: staffItems[0]?.id,
      imbuementItemId: "imbuement-item",
    });
    expect(oldImbuement).toBeUndefined();
    await expect(
      database.query.anbuSquad.findFirst({
        columns: { memberCount: true },
        where: eq(anbuSquad.id, "clone-debug-anbu"),
      }),
    ).resolves.toMatchObject({ memberCount: 2 });
    await expect(
      database.query.actionLog.findFirst({
        where: eq(actionLog.userId, STAFF),
      }),
    ).resolves.toMatchObject({
      relatedId: SOURCE,
      relatedMsg: "Clone user for debugging",
    });
  });

  it("rolls every replacement write back when the final audit write fails", async () => {
    const database = await getTestDatabase();
    const failingDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return <T>(callback: (tx: DrizzleClient) => Promise<T>) =>
            target.transaction((tx) =>
              callback(failStatements(tx as unknown as DrizzleClient, actionLog)),
            );
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as DrizzleClient;

    await expect(
      callerForDatabase(staffRouter, STAFF, failingDatabase).cloneUserForDebug({
        userId: SOURCE,
        expectedUsername: "CloneDebugSource",
      }),
    ).rejects.toThrow("Statement failed on purpose");

    const [staff, staffItems, oldImbuement, anbu, logs] = await Promise.all([
      database.query.userData.findFirst({ where: eq(userData.userId, STAFF) }),
      database.query.userItem.findMany({ where: eq(userItem.userId, STAFF) }),
      database.query.userItemImbuement.findFirst({
        where: eq(userItemImbuement.id, "clone-staff-old-imbuement"),
      }),
      database.query.anbuSquad.findFirst({
        where: eq(anbuSquad.id, "clone-debug-anbu"),
      }),
      database.query.actionLog.findMany({ where: eq(actionLog.userId, STAFF) }),
    ]);
    expect(staff).toMatchObject({ money: 111, maxHealth: 500, anbuId: null });
    expect(staffItems).toHaveLength(1);
    expect(staffItems[0]?.id).toBe("clone-staff-old-item");
    expect(oldImbuement).toBeDefined();
    expect(anbu?.memberCount).toBe(1);
    expect(logs).toEqual([]);
  });

  it("enforces caller, target, and source-snapshot guards before replacement", async () => {
    await expect(
      (await callerFor(staffRouter, ORDINARY)).cloneUserForDebug({
        userId: SOURCE,
        expectedUsername: "CloneDebugSource",
      }),
    ).resolves.toEqual({
      success: false,
      message: "You are not allowed to clone users",
    });
    await expect(
      (await callerFor(staffRouter, STAFF)).cloneUserForDebug({
        userId: STAFF_TARGET,
        expectedUsername: "CloneDebugStaffTarget",
      }),
    ).resolves.toEqual({
      success: false,
      message: "Cannot copy people able to clone",
    });
    await expect(
      (await callerFor(staffRouter, STAFF)).cloneUserForDebug({
        userId: SOURCE,
        expectedUsername: "StaleSourceName",
      }),
    ).resolves.toEqual({
      success: false,
      message: "The selected user's name changed. Refresh and try again",
    });

    const database = await getTestDatabase();
    await database
      .update(userData)
      .set({ isBanned: true })
      .where(eq(userData.userId, STAFF));
    await expect(
      (await callerFor(staffRouter, STAFF)).cloneUserForDebug({
        userId: SOURCE,
        expectedUsername: "CloneDebugSource",
      }),
    ).resolves.toEqual({
      success: false,
      message: "Banned users cannot clone users",
    });
  });

  it("serializes concurrent clones so the final account is one complete snapshot", async () => {
    const database = await getTestDatabase();
    const caller = await callerFor(staffRouter, STAFF);
    const outcomes = await Promise.all([
      caller.cloneUserForDebug({
        userId: SOURCE,
        expectedUsername: "CloneDebugSource",
      }),
      caller.cloneUserForDebug({
        userId: OTHER_SOURCE,
        expectedUsername: "CloneDebugSourceTwo",
      }),
    ]);
    expect(outcomes.every((outcome) => outcome.success)).toBe(true);

    const [staff, items, attributes, anbu] = await Promise.all([
      database.query.userData.findFirst({ where: eq(userData.userId, STAFF) }),
      database.query.userItem.findMany({ where: eq(userItem.userId, STAFF) }),
      database.query.userAttribute.findMany({
        where: eq(userAttribute.userId, STAFF),
      }),
      database.query.anbuSquad.findFirst({
        where: eq(anbuSquad.id, "clone-debug-anbu"),
      }),
    ]);
    const sourceOneWon = staff?.money === 827001;
    const sourceTwoWon = staff?.money === 828001;
    expect(sourceOneWon || sourceTwoWon).toBe(true);
    if (sourceOneWon) {
      expect(staff).toMatchObject({
        location: "source location",
        anbuId: "clone-debug-anbu",
      });
      expect(items).toHaveLength(1);
      expect(attributes).toHaveLength(1);
      expect(anbu?.memberCount).toBe(2);
    } else {
      expect(staff).toMatchObject({
        location: "second source location",
        anbuId: null,
      });
      expect(items).toEqual([]);
      expect(attributes).toEqual([]);
      expect(anbu?.memberCount).toBe(1);
    }
  });
});
