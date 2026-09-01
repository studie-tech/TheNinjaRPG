// @vitest-environment node

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { beforeEach, expect, it } from "vitest";
import {
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
} from "@/drizzle/schema";
import { deleteUser, staffRouter } from "@/server/api/routers/staff";
import {
  grantStorePurchase,
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

describeWithDatabase("staff user-id rename", () => {
  beforeEach(async () => {
    await resetTables(
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
    );
    await insertUsers([
      { userId: STAFF, username: "Terriator", role: "CODING-ADMIN" },
      { userId: OLD_USER_ID, username: "rename-target", role: "USER" },
    ]);
  });

  it("reserves every retired alias against later reuse", async () => {
    const database = await getTestDatabase();
    await insertUsers([{ userId: "rename-other-user", username: "rename-other" }]);
    const caller = await callerFor(staffRouter, STAFF);
    await expect(
      caller.updateUserId({ userId: OLD_USER_ID, newUserId: NEW_USER_ID }),
    ).resolves.toMatchObject({ success: true });
    await expect(
      caller.updateUserId({
        userId: "rename-other-user",
        newUserId: OLD_USER_ID,
      }),
    ).resolves.toEqual({
      success: false,
      message: "UserId was previously used and is reserved",
    });
    expect(
      await database.query.userData.findFirst({
        where: eq(userData.userId, "rename-other-user"),
      }),
    ).toBeDefined();
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
  });

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
  });

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
  });
});
