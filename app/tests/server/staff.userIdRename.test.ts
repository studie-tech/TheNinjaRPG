// @vitest-environment node

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { beforeEach, expect, it } from "vitest";
import {
  notification,
  storeEntitlementState,
  storePurchase,
  storePurchaseTransfer,
  storeUserIdAlias,
  userData,
} from "@/drizzle/schema";
import { staffRouter } from "@/server/api/routers/staff";
import { grantStorePurchase } from "@/server/utils/purchases/grant";
import { insertUsers } from "../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
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
});
