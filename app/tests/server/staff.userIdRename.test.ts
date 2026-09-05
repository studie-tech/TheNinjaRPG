// @vitest-environment node

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { beforeEach, expect, it } from "vitest";
import {
  bloodline,
  notification,
  storeEntitlementRevocation,
  storeEntitlementState,
  storePurchase,
  storePurchaseTransfer,
  storeUserIdAlias,
  userData,
  userDevice,
  userLiveActivity,
  userPushPreference,
  village,
} from "@/drizzle/schema";
import { STARTING_REPUTATION_POINTS } from "@/drizzle/constants";
import { registerRouter } from "@/server/api/routers/register";
import { deleteUser, staffRouter } from "@/server/api/routers/staff";
import { pushRouter } from "@/server/api/routers/push";
import {
  extendStoreSubscription,
  grantStorePurchase,
  reconcileFederalStatuses,
  transferStorePurchases,
} from "@/server/utils/purchases/grant";
import { insertUsers } from "../setup/factories";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  openTestDatabaseConnection,
  resetTables,
  runRawSql,
} from "../setup/testDatabase";

const STAFF = "rename-staff";
const OLD_USER_ID = "rename-old-user";
const NEW_USER_ID = "rename-new-user";
// These deliberately-overlapped real-MySQL tests may wait behind the store graph's
// production global mutex when Bun runs database files together. Keep the application's
// lock timeout authoritative instead of failing at Bun's much shorter unit-test default.
const REAL_DB_CONCURRENCY_TIMEOUT_MS = 30_000;

describeWithDatabase("staff user-id rename", () => {
  beforeEach(async () => {
    await resetTables(
      bloodline,
      notification,
      userLiveActivity,
      userPushPreference,
      userDevice,
      storeEntitlementRevocation,
      storeEntitlementState,
      storePurchaseTransfer,
      storeUserIdAlias,
      storePurchase,
      userData,
      village,
    );
    await insertUsers([
      { userId: STAFF, username: "Terriator", role: "CODING-ADMIN" },
      { userId: OLD_USER_ID, username: "rename-target", role: "USER" },
    ]);
  }, REAL_DB_CONCURRENCY_TIMEOUT_MS);

  it("reserves every retired alias against later reuse", async () => {
    const database = await getTestDatabase();
    await insertUsers([{ userId: "rename-other-user", username: "rename-other" }]);
    const caller = await callerFor(staffRouter, STAFF);
    await expect(
      caller.updateUserId({ userId: OLD_USER_ID, newUserId: NEW_USER_ID }),
    ).resolves.toMatchObject({ success: true });
    await database.insert(notification).values({
      userId: "rename-other-user",
      content: "must roll back",
    });
    await expect(
      caller.updateUserId({
        userId: "rename-other-user",
        newUserId: OLD_USER_ID,
      }),
    ).resolves.toEqual({
      success: false,
      message: "UserId was previously used and is reserved",
    });
    const [unchangedUser, unchangedNotification] = await Promise.all([
      database.query.userData.findFirst({
        where: eq(userData.userId, "rename-other-user"),
      }),
      database.query.notification.findFirst({
        where: eq(notification.userId, "rename-other-user"),
      }),
    ]);
    expect(unchangedUser).toBeDefined();
    expect(unchangedNotification?.userId).toBe("rename-other-user");
  });

  it("deletes push bearer state and tombstones the retained store ledger", async () => {
    const database = await getTestDatabase();
    await Promise.all([
      database.insert(userDevice).values({
        id: nanoid(),
        userId: OLD_USER_ID,
        platform: "ios",
        token: `push-${nanoid()}`,
        widgetToken: `widget-${nanoid()}`,
      }),
      database.insert(userPushPreference).values({
        id: nanoid(),
        userId: OLD_USER_ID,
        category: "system",
        enabled: true,
      }),
      database.insert(userLiveActivity).values({
        id: nanoid(),
        userId: OLD_USER_ID,
        activityId: nanoid(),
        kind: "training",
        pushToken: nanoid(),
        endsAt: new Date(Date.now() + 60_000),
      }),
      database.insert(storePurchase).values({
        id: nanoid(),
        userId: OLD_USER_ID,
        originalUserId: OLD_USER_ID,
        transactionId: "deleted-user-ledger",
        productId: "tnr_reps_tier1",
        store: "APPLE",
        reputationPoints: 8,
        federalStatus: null,
        isSandbox: false,
        acceptedAt: new Date(),
        grantedAt: new Date(),
        purchasedAt: new Date(),
        rawData: {},
      }),
    ]);

    await deleteUser(database, OLD_USER_ID);
    const [devices, preferences, activities, ledger, alias] = await Promise.all([
      database.query.userDevice.findMany({
        where: eq(userDevice.userId, OLD_USER_ID),
      }),
      database.query.userPushPreference.findMany({
        where: eq(userPushPreference.userId, OLD_USER_ID),
      }),
      database.query.userLiveActivity.findMany({
        where: eq(userLiveActivity.userId, OLD_USER_ID),
      }),
      database.query.storePurchase.findFirst({
        where: eq(storePurchase.transactionId, "deleted-user-ledger"),
      }),
      database.query.storeUserIdAlias.findFirst({
        where: eq(storeUserIdAlias.oldUserId, OLD_USER_ID),
      }),
    ]);
    expect(devices).toEqual([]);
    expect(preferences).toEqual([]);
    expect(activities).toEqual([]);
    expect(ledger).toBeDefined();
    expect(alias?.newUserId).toMatch(/^__tnr_deleted_store_user__:/);
    await expect(
      grantStorePurchase(database, {
        userId: OLD_USER_ID,
        transactionId: "deleted-user-retry",
        productId: "tnr_reps_tier1",
        store: "APPLE",
        isSandbox: false,
        purchasedAt: new Date(),
        raw: {},
      }),
    ).resolves.toEqual({ status: "ignored", reason: "Deleted user" });
    await expect(
      extendStoreSubscription(database, {
        userId: OLD_USER_ID,
        store: "APPLE",
        productId: "tnr_federal_gold",
        expirationAt: new Date(Date.now() + 86_400_000),
        transactionId: "delayed-deleted-extension",
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses device registration after the game account is deleted", async () => {
    const database = await getTestDatabase();
    await deleteUser(database, OLD_USER_ID);
    const caller = await callerFor(pushRouter, OLD_USER_ID);

    await expect(
      caller.registerDevice({ token: "a".repeat(64), platform: "ios" }),
    ).resolves.toEqual({
      success: false,
      message: "Character no longer exists",
      widgetToken: null,
    });
    expect(
      await database.query.userDevice.findMany({
        where: eq(userDevice.userId, OLD_USER_ID),
      }),
    ).toEqual([]);
  });

  it("refuses preference and Live Activity writes after account deletion", async () => {
    const database = await getTestDatabase();
    await deleteUser(database, OLD_USER_ID);
    const caller = await callerFor(pushRouter, OLD_USER_ID);

    await expect(
      caller.setPreference({ category: "system", enabled: false }),
    ).resolves.toEqual({ success: false, message: "Character no longer exists" });
    await expect(
      caller.registerActivity({
        activityId: "deleted-activity",
        kind: "training",
        pushToken: "c".repeat(64),
        endsAt: new Date(Date.now() + 60_000),
      }),
    ).resolves.toEqual({ success: false, message: "Character no longer exists" });
    await expect(
      caller.endActivity({ activityId: "deleted-activity" }),
    ).resolves.toEqual({ success: false, message: "Character no longer exists" });
    const [preferences, activities] = await Promise.all([
      database.query.userPushPreference.findMany({
        where: eq(userPushPreference.userId, OLD_USER_ID),
      }),
      database.query.userLiveActivity.findMany({
        where: eq(userLiveActivity.userId, OLD_USER_ID),
      }),
    ]);
    expect(preferences).toEqual([]);
    expect(activities).toEqual([]);
  });

  it("lets a deleted identity with no store history make another character", async () => {
    // The ordinary "delete my character and start over" flow. It leaves the player signed
    // into the same Clerk session, so a tombstone they can never clear would lock them out
    // of the game permanently, with no way back short of a new email address.
    const database = await getTestDatabase();
    await database.delete(storePurchase).where(eq(storePurchase.userId, OLD_USER_ID));
    await deleteUser(database, OLD_USER_ID);
    await Promise.all([
      database.insert(village).values({
        id: "reclaim-horizon",
        name: "Horizon",
        sector: 1,
        kageId: STAFF,
      }),
      database.insert(bloodline).values({
        id: "reclaim-bloodline",
        name: "Reclaim Bloodline",
        image: "/bloodline.png",
        description: "test",
        effects: [],
        rank: "D",
      }),
    ]);
    const caller = await callerFor(registerRouter, OLD_USER_ID);
    const created = await caller.createCharacter({
      username: "Restarted",
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
      recruiter_userid: null,
      utm_source: null,
      bloodlineId: "reclaim-bloodline",
    });
    expect(created.success).toBe(true);
    const reborn = await database.query.userData.findFirst({
      columns: { userId: true, earnedExperience: true },
      where: eq(userData.userId, OLD_USER_ID),
    });
    expect(reborn?.userId).toBe(OLD_USER_ID);
    // The column default, not the literal a raw insert would otherwise write.
    expect(reborn?.earnedExperience).toBe(2000);
  });

  it("lets a deleted identity with store history make another character, and its subscription follows", async () => {
    // Deleting a character forfeits what it was granted, but the identity is still the
    // subscriber's: receipts are kept, each is idempotent by transactionId, and the tier an
    // active subscription pays for belongs on whichever character the identity has now.
    const database = await getTestDatabase();
    const purchasedAt = new Date();
    await database.insert(storePurchase).values([
      {
        id: nanoid(),
        userId: OLD_USER_ID,
        originalUserId: OLD_USER_ID,
        transactionId: "reps-spent-before-deletion",
        productId: "tnr_reps_tier1",
        store: "APPLE",
        reputationPoints: 8,
        federalStatus: null,
        isSandbox: false,
        acceptedAt: purchasedAt,
        grantedAt: purchasedAt,
        purchasedAt,
        rawData: {},
      },
      {
        id: nanoid(),
        userId: OLD_USER_ID,
        originalUserId: OLD_USER_ID,
        transactionId: "gold-still-paid-for",
        productId: "tnr_federal_gold",
        store: "APPLE",
        federalStatus: "GOLD",
        isSandbox: false,
        acceptedAt: purchasedAt,
        grantedAt: purchasedAt,
        purchasedAt,
        expiresAt: new Date(purchasedAt.getTime() + 20 * 24 * 60 * 60 * 1000),
        rawData: {},
      },
    ]);
    await deleteUser(database, OLD_USER_ID);
    await Promise.all([
      database.insert(village).values({
        id: "registration-horizon",
        name: "Horizon",
        sector: 1,
        kageId: STAFF,
      }),
      database.insert(bloodline).values({
        id: "registration-bloodline",
        name: "Registration Bloodline",
        image: "/bloodline.png",
        description: "test",
        effects: [],
        rank: "D",
      }),
    ]);
    const caller = await callerFor(registerRouter, OLD_USER_ID);
    const created = await caller.createCharacter({
      username: "Reborn",
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
      recruiter_userid: null,
      utm_source: null,
      bloodlineId: "registration-bloodline",
    });
    expect(created.success).toBe(true);
    await reconcileFederalStatuses(database);
    const [reborn, alias] = await Promise.all([
      database.query.userData.findFirst({
        columns: { federalStatus: true, reputationPoints: true },
        where: eq(userData.userId, OLD_USER_ID),
      }),
      database.query.storeUserIdAlias.findFirst({
        where: eq(storeUserIdAlias.oldUserId, OLD_USER_ID),
      }),
    ]);
    expect(alias).toBeUndefined();
    expect(reborn?.federalStatus).toBe("GOLD");
    // The consumable went to the character that is gone; a new one starts from scratch.
    expect(reborn?.reputationPoints).toBe(STARTING_REPUTATION_POINTS);
  }, REAL_DB_CONCURRENCY_TIMEOUT_MS);

  it("purges a device registration that overlaps account retirement", async () => {
    const database = await getTestDatabase();
    const registerConnection = await openTestDatabaseConnection();
    const deleteConnection = await openTestDatabaseConnection();
    const barrierConnection = await openTestDatabaseConnection();
    const barrier = `delete_register_${nanoid()}`;
    const trigger = `pause_delete_register_${nanoid().replaceAll("-", "_")}`;
    await barrierConnection.query(`SELECT GET_LOCK('${barrier}', 10)`);
    await runRawSql(`
      CREATE TRIGGER ${trigger} BEFORE INSERT ON UserDevice FOR EACH ROW
      BEGIN
        IF NEW.userId = '${OLD_USER_ID}' THEN
          SET @delete_register_wait = GET_LOCK('${barrier}', 10);
          SET @delete_register_release = RELEASE_LOCK('${barrier}');
        END IF;
      END
    `);
    try {
      const caller = callerForDatabase(
        pushRouter,
        OLD_USER_ID,
        registerConnection.database,
      );
      const registration = caller.registerDevice({
        token: "b".repeat(64),
        platform: "ios",
      });
      await barrierConnection.waitForNamedLockWaiter(barrier);

      let deletionFinished = false;
      const deletion = deleteUser(deleteConnection.database, OLD_USER_ID).finally(() => {
        deletionFinished = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(deletionFinished).toBe(false);
      await barrierConnection.query(`SELECT RELEASE_LOCK('${barrier}')`);

      await expect(registration).resolves.toMatchObject({ success: true });
      await deletion;
      const [devices, alias] = await Promise.all([
        database.query.userDevice.findMany({
          where: eq(userDevice.userId, OLD_USER_ID),
        }),
        database.query.storeUserIdAlias.findFirst({
          where: eq(storeUserIdAlias.oldUserId, OLD_USER_ID),
        }),
      ]);
      expect(devices).toEqual([]);
      expect(alias?.newUserId).toMatch(/^__tnr_deleted_store_user__:/);
    } finally {
      await barrierConnection.query(`SELECT RELEASE_LOCK('${barrier}')`);
      await runRawSql(`DROP TRIGGER IF EXISTS ${trigger}`);
      await Promise.all([
        registerConnection.close(),
        deleteConnection.close(),
        barrierConnection.close(),
      ]);
    }
  }, REAL_DB_CONCURRENCY_TIMEOUT_MS);

  it("gives deletion durable ownership before cleanup and rejects a concurrent rename", async () => {
    const database = await getTestDatabase();
    const deleteConnection = await openTestDatabaseConnection();
    const renameConnection = await openTestDatabaseConnection();
    const barrierConnection = await openTestDatabaseConnection();
    const barrier = `delete_rename_${nanoid()}`;
    const trigger = `pause_delete_rename_${nanoid().replaceAll("-", "_")}`;
    await database.insert(notification).values({
      userId: OLD_USER_ID,
      content: "deletion barrier",
    });
    await barrierConnection.query(`SELECT GET_LOCK('${barrier}', 10)`);
    await runRawSql(`
      CREATE TRIGGER ${trigger} BEFORE DELETE ON Notification FOR EACH ROW
      BEGIN
        IF OLD.userId = '${OLD_USER_ID}' THEN
          SET @delete_rename_wait = GET_LOCK('${barrier}', 10);
          SET @delete_rename_release = RELEASE_LOCK('${barrier}');
        END IF;
      END
    `);
    try {
      const deletion = deleteUser(deleteConnection.database, OLD_USER_ID);
      await barrierConnection.waitForNamedLockWaiter(barrier);

      const markerDuringCleanup = await database.query.storeUserIdAlias.findFirst({
        where: eq(storeUserIdAlias.oldUserId, OLD_USER_ID),
      });
      expect(markerDuringCleanup?.newUserId).toMatch(
        /^__tnr_deleted_store_user__:/,
      );

      let renameFinished = false;
      const rename = callerForDatabase(
        staffRouter,
        STAFF,
        renameConnection.database,
      )
        .updateUserId({ userId: OLD_USER_ID, newUserId: NEW_USER_ID })
        .finally(() => {
          renameFinished = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(renameFinished).toBe(false);

      await barrierConnection.query(`SELECT RELEASE_LOCK('${barrier}')`);
      await expect(rename).resolves.toEqual({
        success: false,
        message: "UserId is being deleted and cannot be renamed",
      });
      await deletion;

      const [oldUser, renamedUser, marker] = await Promise.all([
        database.query.userData.findFirst({
          where: eq(userData.userId, OLD_USER_ID),
        }),
        database.query.userData.findFirst({
          where: eq(userData.userId, NEW_USER_ID),
        }),
        database.query.storeUserIdAlias.findFirst({
          where: eq(storeUserIdAlias.oldUserId, OLD_USER_ID),
        }),
      ]);
      expect(oldUser).toBeUndefined();
      expect(renamedUser).toBeUndefined();
      expect(marker?.newUserId).toMatch(/^__tnr_deleted_store_user__:/);
    } finally {
      await barrierConnection.query(`SELECT RELEASE_LOCK('${barrier}')`);
      await runRawSql(`DROP TRIGGER IF EXISTS ${trigger}`);
      await Promise.all([
        deleteConnection.close(),
        renameConnection.close(),
        barrierConnection.close(),
      ]);
    }
  }, REAL_DB_CONCURRENCY_TIMEOUT_MS);

  it.each([
    { kind: "preference", table: "UserPushPreference" },
    { kind: "activity", table: "UserLiveActivity" },
  ] as const)(
    "purges a $kind write that overlaps account retirement",
    async ({ kind, table }) => {
      const database = await getTestDatabase();
      const writeConnection = await openTestDatabaseConnection();
      const deleteConnection = await openTestDatabaseConnection();
      const barrierConnection = await openTestDatabaseConnection();
      const barrier = `delete_push_${kind}_${nanoid()}`;
      const trigger = `pause_delete_push_${kind}_${nanoid().replaceAll("-", "_")}`;
      await barrierConnection.query(`SELECT GET_LOCK('${barrier}', 10)`);
      await runRawSql(`
        CREATE TRIGGER ${trigger} BEFORE INSERT ON ${table} FOR EACH ROW
        BEGIN
          IF NEW.userId = '${OLD_USER_ID}' THEN
            SET @delete_push_wait = GET_LOCK('${barrier}', 10);
            SET @delete_push_release = RELEASE_LOCK('${barrier}');
          END IF;
        END
      `);
      try {
        const caller = callerForDatabase(pushRouter, OLD_USER_ID, writeConnection.database);
        const write =
          kind === "preference"
            ? caller.setPreference({ category: "system", enabled: false })
            : caller.registerActivity({
                activityId: "overlapping-activity",
                kind: "training",
                pushToken: "d".repeat(64),
                endsAt: new Date(Date.now() + 60_000),
              });
        await barrierConnection.waitForNamedLockWaiter(barrier);

        let deletionFinished = false;
        const deletion = deleteUser(deleteConnection.database, OLD_USER_ID).finally(() => {
          deletionFinished = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(deletionFinished).toBe(false);
        await barrierConnection.query(`SELECT RELEASE_LOCK('${barrier}')`);

        await expect(write).resolves.toMatchObject({ success: true });
        await deletion;
        const remaining =
          kind === "preference"
            ? await database.query.userPushPreference.findMany({
                where: eq(userPushPreference.userId, OLD_USER_ID),
              })
            : await database.query.userLiveActivity.findMany({
                where: eq(userLiveActivity.userId, OLD_USER_ID),
              });
        expect(remaining).toEqual([]);
      } finally {
        await barrierConnection.query(`SELECT RELEASE_LOCK('${barrier}')`);
        await runRawSql(`DROP TRIGGER IF EXISTS ${trigger}`);
        await Promise.all([
          writeConnection.close(),
          deleteConnection.close(),
          barrierConnection.close(),
        ]);
      }
    },
    REAL_DB_CONCURRENCY_TIMEOUT_MS,
  );

  it.each([
    { kind: "device", table: "UserDevice" },
    { kind: "preference", table: "UserPushPreference" },
    { kind: "activity", table: "UserLiveActivity" },
  ] as const)(
    "migrates a $kind write that overlaps user-id rename",
    async ({ kind, table }) => {
      const database = await getTestDatabase();
      const writeConnection = await openTestDatabaseConnection();
      const renameConnection = await openTestDatabaseConnection();
      const barrierConnection = await openTestDatabaseConnection();
      const barrier = `rename_push_${kind}_${nanoid()}`;
      const trigger = `pause_rename_push_${kind}_${nanoid().replaceAll("-", "_")}`;
      await barrierConnection.query(`SELECT GET_LOCK('${barrier}', 10)`);
      await runRawSql(`
        CREATE TRIGGER ${trigger} BEFORE INSERT ON ${table} FOR EACH ROW
        BEGIN
          IF NEW.userId = '${OLD_USER_ID}' THEN
            SET @rename_push_wait = GET_LOCK('${barrier}', 10);
            SET @rename_push_release = RELEASE_LOCK('${barrier}');
          END IF;
        END
      `);
      try {
        const pushCaller = callerForDatabase(
          pushRouter,
          OLD_USER_ID,
          writeConnection.database,
        );
        const write =
          kind === "device"
            ? pushCaller.registerDevice({ token: "e".repeat(64), platform: "ios" })
            : kind === "preference"
              ? pushCaller.setPreference({ category: "system", enabled: false })
              : pushCaller.registerActivity({
                  activityId: "rename-overlapping-activity",
                  kind: "training",
                  pushToken: "f".repeat(64),
                  endsAt: new Date(Date.now() + 60_000),
                });
        await barrierConnection.waitForNamedLockWaiter(barrier);

        let renameFinished = false;
        const rename = callerForDatabase(
          staffRouter,
          STAFF,
          renameConnection.database,
        )
          .updateUserId({ userId: OLD_USER_ID, newUserId: NEW_USER_ID })
          .finally(() => {
            renameFinished = true;
          });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(renameFinished).toBe(false);
        await barrierConnection.query(`SELECT RELEASE_LOCK('${barrier}')`);

        await expect(write).resolves.toMatchObject({ success: true });
        await expect(rename).resolves.toMatchObject({ success: true });
        const [oldRows, newRows] =
          kind === "device"
            ? await Promise.all([
                database.query.userDevice.findMany({
                  where: eq(userDevice.userId, OLD_USER_ID),
                }),
                database.query.userDevice.findMany({
                  where: eq(userDevice.userId, NEW_USER_ID),
                }),
              ])
            : kind === "preference"
              ? await Promise.all([
                  database.query.userPushPreference.findMany({
                    where: eq(userPushPreference.userId, OLD_USER_ID),
                  }),
                  database.query.userPushPreference.findMany({
                    where: eq(userPushPreference.userId, NEW_USER_ID),
                  }),
                ])
              : await Promise.all([
                  database.query.userLiveActivity.findMany({
                    where: eq(userLiveActivity.userId, OLD_USER_ID),
                  }),
                  database.query.userLiveActivity.findMany({
                    where: eq(userLiveActivity.userId, NEW_USER_ID),
                  }),
                ]);
        expect(oldRows).toEqual([]);
        expect(newRows).toHaveLength(1);
      } finally {
        await barrierConnection.query(`SELECT RELEASE_LOCK('${barrier}')`);
        await runRawSql(`DROP TRIGGER IF EXISTS ${trigger}`);
        await Promise.all([
          writeConnection.close(),
          renameConnection.close(),
          barrierConnection.close(),
        ]);
      }
    },
    REAL_DB_CONCURRENCY_TIMEOUT_MS,
  );

  it(
    "serializes an activity end that overlaps user-id rename",
    async () => {
      const activityId = "rename-ending-activity";
      const database = await getTestDatabase();
      await database.insert(userLiveActivity).values({
        id: nanoid(),
        userId: OLD_USER_ID,
        activityId,
        kind: "training",
        pushToken: "g".repeat(64),
        endsAt: new Date(Date.now() + 60_000),
      });
      const renameConnection = await openTestDatabaseConnection();
      const endConnection = await openTestDatabaseConnection();
      const barrierConnection = await openTestDatabaseConnection();
      const barrier = `rename_end_activity_${nanoid()}`;
      const trigger = `pause_rename_end_${nanoid().replaceAll("-", "_")}`;
      await barrierConnection.query(`SELECT GET_LOCK('${barrier}', 10)`);
      await runRawSql(`
        CREATE TRIGGER ${trigger} BEFORE UPDATE ON UserData FOR EACH ROW
        BEGIN
          IF OLD.userId = '${OLD_USER_ID}' AND NEW.userId = '${NEW_USER_ID}' THEN
            SET @rename_end_wait = GET_LOCK('${barrier}', 10);
            SET @rename_end_release = RELEASE_LOCK('${barrier}');
          END IF;
        END
      `);
      try {
        const rename = callerForDatabase(
          staffRouter,
          STAFF,
          renameConnection.database,
        ).updateUserId({ userId: OLD_USER_ID, newUserId: NEW_USER_ID });
        await barrierConnection.waitForNamedLockWaiter(barrier);

        let endFinished = false;
        const end = callerForDatabase(pushRouter, OLD_USER_ID, endConnection.database)
          .endActivity({ activityId })
          .finally(() => {
            endFinished = true;
          });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(endFinished).toBe(false);
        await barrierConnection.query(`SELECT RELEASE_LOCK('${barrier}')`);

        await expect(rename).resolves.toEqual({
          success: true,
          message: "UserId updated",
        });
        await expect(end).resolves.toEqual({
          success: false,
          message: "Character no longer exists",
        });
        const activities = await database.query.userLiveActivity.findMany({
          where: eq(userLiveActivity.userId, NEW_USER_ID),
        });
        expect(activities).toHaveLength(1);
        expect(activities[0]?.activityId).toBe(activityId);
      } finally {
        await barrierConnection.query(`SELECT RELEASE_LOCK('${barrier}')`);
        await runRawSql(`DROP TRIGGER IF EXISTS ${trigger}`);
        await Promise.all([
          renameConnection.close(),
          endConnection.close(),
          barrierConnection.close(),
        ]);
      }
    },
    REAL_DB_CONCURRENCY_TIMEOUT_MS,
  );

  it("rolls back helper and broad writes together when a late rename write fails", async () => {
    const database = await getTestDatabase();
    await Promise.all([
      database.insert(storeEntitlementState).values({
        id: nanoid(),
        userId: OLD_USER_ID,
        store: "APPLE",
        revokedThrough: new Date(),
      }),
      database.insert(storePurchaseTransfer).values({
        id: nanoid(),
        eventId: nanoid(),
        sourceUserId: OLD_USER_ID,
        destinationUserId: "some-owner",
        store: "APPLE",
        transferredAt: new Date(),
      }),
      database.insert(notification).values({ userId: OLD_USER_ID, content: "rename" }),
    ]);
    await runRawSql(
      `ALTER TABLE Notification ADD CONSTRAINT fail_staff_user_id_rename CHECK (userId <> '${NEW_USER_ID}')`,
    );
    try {
      const caller = await callerFor(staffRouter, STAFF);
      await expect(
        caller.updateUserId({ userId: OLD_USER_ID, newUserId: NEW_USER_ID }),
      ).rejects.toThrow();
    } finally {
      await runRawSql(
        "ALTER TABLE Notification DROP CHECK fail_staff_user_id_rename",
      );
    }

    const [oldUser, newUser, entitlement, transfer, alias, message] =
      await Promise.all([
      database.query.userData.findFirst({
        columns: { userId: true },
        where: eq(userData.userId, OLD_USER_ID),
      }),
      database.query.userData.findFirst({
        columns: { userId: true },
        where: eq(userData.userId, NEW_USER_ID),
      }),
      database.query.storeEntitlementState.findFirst({
        columns: { userId: true },
        where: and(
          eq(storeEntitlementState.userId, OLD_USER_ID),
          eq(storeEntitlementState.store, "APPLE"),
        ),
      }),
      database.query.storePurchaseTransfer.findFirst({
        columns: { sourceUserId: true },
        where: eq(storePurchaseTransfer.sourceUserId, OLD_USER_ID),
      }),
      database.query.storeUserIdAlias.findFirst({
        where: eq(storeUserIdAlias.oldUserId, OLD_USER_ID),
      }),
      database.query.notification.findFirst({
        columns: { userId: true },
        where: eq(notification.userId, OLD_USER_ID),
      }),
      ]);
    expect(oldUser?.userId).toBe(OLD_USER_ID);
    expect(newUser).toBeUndefined();
    expect(entitlement?.userId).toBe(OLD_USER_ID);
    expect(transfer?.sourceUserId).toBe(OLD_USER_ID);
    expect(alias).toBeUndefined();
    expect(message?.userId).toBe(OLD_USER_ID);
  });

  it("routes a delayed webhook carrying the retired id to the renamed user", async () => {
    const database = await getTestDatabase();
    const caller = await callerFor(staffRouter, STAFF);
    await expect(
      caller.updateUserId({ userId: OLD_USER_ID, newUserId: NEW_USER_ID }),
    ).resolves.toEqual({ success: true, message: "UserId updated" });

    await expect(
      grantStorePurchase(database, {
        userId: OLD_USER_ID,
        transactionId: nanoid(),
        productId: "tnr_reps_tier1",
        store: "APPLE",
        isSandbox: false,
        purchasedAt: new Date(),
        raw: {},
      }),
    ).resolves.toMatchObject({ status: "granted" });

    const [renamed, receipt] = await Promise.all([
      database.query.userData.findFirst({
        columns: { reputationPoints: true },
        where: eq(userData.userId, NEW_USER_ID),
      }),
      database.query.storePurchase.findFirst({
        columns: { userId: true, originalUserId: true },
      }),
    ]);
    expect(renamed?.reputationPoints).toBeGreaterThan(0);
    expect(receipt).toEqual({
      userId: NEW_USER_ID,
      originalUserId: NEW_USER_ID,
    });
  });

  it("repairs and grants a duplicate pending receipt left on the retired id", async () => {
    const database = await getTestDatabase();
    const caller = await callerFor(staffRouter, STAFF);
    await caller.updateUserId({ userId: OLD_USER_ID, newUserId: NEW_USER_ID });
    const renamedBefore = await database.query.userData.findFirst({
      columns: { reputationPoints: true },
      where: eq(userData.userId, NEW_USER_ID),
    });
    const transactionId = nanoid();
    const purchasedAt = new Date();
    await database.insert(storePurchase).values({
      id: nanoid(),
      userId: OLD_USER_ID,
      originalUserId: OLD_USER_ID,
      transactionId,
      productId: "tnr_reps_tier1",
      store: "APPLE",
      reputationPoints: 8,
      federalStatus: null,
      isSandbox: false,
      acceptedAt: new Date(),
      purchasedAt,
      rawData: {},
    });

    await expect(
      grantStorePurchase(database, {
        userId: OLD_USER_ID,
        transactionId,
        productId: "tnr_reps_tier1",
        store: "APPLE",
        isSandbox: false,
        purchasedAt,
        raw: {},
      }),
    ).resolves.toMatchObject({ status: "granted", reputationPoints: 8 });
    const [renamedAfter, receipt] = await Promise.all([
      database.query.userData.findFirst({
        columns: { reputationPoints: true },
        where: eq(userData.userId, NEW_USER_ID),
      }),
      database.query.storePurchase.findFirst({
        columns: { userId: true, originalUserId: true, grantedAt: true },
        where: eq(storePurchase.transactionId, transactionId),
      }),
    ]);
    expect(renamedAfter?.reputationPoints).toBe(
      (renamedBefore?.reputationPoints ?? 0) + 8,
    );
    expect(receipt).toMatchObject({
      userId: NEW_USER_ID,
      originalUserId: NEW_USER_ID,
    });
    expect(receipt?.grantedAt).toBeInstanceOf(Date);
  });

  it("serializes a grant already waiting behind the rename row lock", async () => {
    const database = await getTestDatabase();
    const before = await database.query.userData.findFirst({
      columns: { reputationPoints: true },
      where: eq(userData.userId, OLD_USER_ID),
    });
    const renameConnection = await openTestDatabaseConnection();
    const grantConnection = await openTestDatabaseConnection();
    const barrierConnection = await openTestDatabaseConnection();
    const barrier = `rename_grant_${nanoid()}`;
    const trigger = `pause_rename_grant_${nanoid().replaceAll("-", "_")}`;
    await barrierConnection.query(`SELECT GET_LOCK('${barrier}', 10)`);
    await runRawSql(`
      CREATE TRIGGER ${trigger} BEFORE UPDATE ON UserData FOR EACH ROW
      BEGIN
        IF OLD.userId = '${OLD_USER_ID}' AND NEW.userId = '${NEW_USER_ID}' THEN
          SET @rename_grant_wait = GET_LOCK('${barrier}', 10);
          SET @rename_grant_release = RELEASE_LOCK('${barrier}');
        END IF;
      END
    `);
    try {
      const caller = callerForDatabase(staffRouter, STAFF, renameConnection.database);
      const rename = caller.updateUserId({
        userId: OLD_USER_ID,
        newUserId: NEW_USER_ID,
      });
      await barrierConnection.waitForNamedLockWaiter(barrier);

      let grantFinished = false;
      const transactionId = nanoid();
      const grant = grantStorePurchase(grantConnection.database, {
        userId: OLD_USER_ID,
        transactionId,
        productId: "tnr_reps_tier1",
        store: "APPLE",
        isSandbox: false,
        purchasedAt: new Date(),
        raw: {},
      }).finally(() => {
        grantFinished = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(grantFinished).toBe(false);
      await barrierConnection.query(`SELECT RELEASE_LOCK('${barrier}')`);

      await expect(rename).resolves.toEqual({
        success: true,
        message: "UserId updated",
      });
      await expect(grant).resolves.toMatchObject({ status: "granted" });
      const [renamed, receipt] = await Promise.all([
        database.query.userData.findFirst({
          columns: { reputationPoints: true },
          where: eq(userData.userId, NEW_USER_ID),
        }),
        database.query.storePurchase.findFirst({
          columns: { userId: true, originalUserId: true, grantedAt: true },
          where: eq(storePurchase.transactionId, transactionId),
        }),
      ]);
      expect(renamed?.reputationPoints).toBe((before?.reputationPoints ?? 0) + 8);
      expect(receipt).toMatchObject({
        userId: NEW_USER_ID,
        originalUserId: NEW_USER_ID,
      });
      expect(receipt?.grantedAt).toBeInstanceOf(Date);
    } finally {
      await barrierConnection.query(`SELECT RELEASE_LOCK('${barrier}')`);
      await runRawSql(`DROP TRIGGER IF EXISTS ${trigger}`);
      await Promise.all([
        renameConnection.close(),
        grantConnection.close(),
        barrierConnection.close(),
      ]);
    }
  }, REAL_DB_CONCURRENCY_TIMEOUT_MS);

  it("serializes a transfer already waiting behind the rename row lock", async () => {
    const destinationUserId = "rename-transfer-destination";
    await insertUsers([
      { userId: destinationUserId, username: "rename-destination", role: "USER" },
    ]);
    const database = await getTestDatabase();
    const transactionId = nanoid();
    await grantStorePurchase(database, {
      userId: OLD_USER_ID,
      transactionId,
      productId: "tnr_federal_gold",
      store: "APPLE",
      isSandbox: false,
      purchasedAt: new Date(Date.now() - 60_000),
      raw: {},
    });

    const renameConnection = await openTestDatabaseConnection();
    const transferConnection = await openTestDatabaseConnection();
    const barrierConnection = await openTestDatabaseConnection();
    const barrier = `rename_transfer_${nanoid()}`;
    const trigger = `pause_rename_transfer_${nanoid().replaceAll("-", "_")}`;
    await barrierConnection.query(`SELECT GET_LOCK('${barrier}', 10)`);
    await runRawSql(`
      CREATE TRIGGER ${trigger} BEFORE UPDATE ON UserData FOR EACH ROW
      BEGIN
        IF OLD.userId = '${OLD_USER_ID}' AND NEW.userId = '${NEW_USER_ID}' THEN
          SET @rename_transfer_wait = GET_LOCK('${barrier}', 10);
          SET @rename_transfer_release = RELEASE_LOCK('${barrier}');
        END IF;
      END
    `);
    try {
      const caller = callerForDatabase(staffRouter, STAFF, renameConnection.database);
      const rename = caller.updateUserId({
        userId: OLD_USER_ID,
        newUserId: NEW_USER_ID,
      });
      await barrierConnection.waitForNamedLockWaiter(barrier);

      let transferFinished = false;
      const transfer = transferStorePurchases(transferConnection.database, {
        eventId: nanoid(),
        fromUserIds: [OLD_USER_ID],
        toUserIds: [destinationUserId],
        store: "APPLE",
        occurredAt: new Date(),
      }).finally(() => {
        transferFinished = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(transferFinished).toBe(false);
      await barrierConnection.query(`SELECT RELEASE_LOCK('${barrier}')`);

      await expect(rename).resolves.toEqual({
        success: true,
        message: "UserId updated",
      });
      await expect(transfer).resolves.toMatchObject({
        destinationUserId,
        rowsAffected: 1,
      });
      const [receipt, ownership, destination] = await Promise.all([
        database.query.storePurchase.findFirst({
          columns: { userId: true, originalUserId: true },
          where: eq(storePurchase.transactionId, transactionId),
        }),
        database.query.storePurchaseTransfer.findFirst({
          columns: { sourceUserId: true, destinationUserId: true },
        }),
        database.query.userData.findFirst({
          columns: { federalStatus: true },
          where: eq(userData.userId, destinationUserId),
        }),
      ]);
      expect(receipt).toEqual({
        userId: destinationUserId,
        originalUserId: NEW_USER_ID,
      });
      expect(ownership).toEqual({
        sourceUserId: NEW_USER_ID,
        destinationUserId,
      });
      expect(destination?.federalStatus).toBe("GOLD");
    } finally {
      await barrierConnection.query(`SELECT RELEASE_LOCK('${barrier}')`);
      await runRawSql(`DROP TRIGGER IF EXISTS ${trigger}`);
      await Promise.all([
        renameConnection.close(),
        transferConnection.close(),
        barrierConnection.close(),
      ]);
    }
  }, REAL_DB_CONCURRENCY_TIMEOUT_MS);
});
