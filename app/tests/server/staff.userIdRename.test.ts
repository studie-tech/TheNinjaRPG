// @vitest-environment node

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { beforeEach, expect, it } from "vitest";
import {
  bloodline,
  notification,
  paypalSubscription,
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
  canonicalStoreUserId,
  extendStoreSubscription,
  grantStorePurchase,
  reconcileFederalStatuses,
  revokeFederalStatus,
  transferStorePurchases,
} from "@/server/utils/purchases/grant";
import { insertUsers } from "../setup/factories";
import { beforeStatements, failStatements } from "../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../setup/testDatabase";

const STAFF = "rename-staff";
const OLD_USER_ID = "rename-old-user";
const NEW_USER_ID = "rename-new-user";
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
      paypalSubscription,
      userData,
      village,
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
    // Recorded, not delivered: the ledger keeps what the identity paid for while it has
    // no character, and a returning one derives its tier from it.
    const retryReceipt = await database.query.storePurchase.findFirst({
      columns: { userId: true, acceptedAt: true, grantedAt: true },
      where: eq(storePurchase.transactionId, "deleted-user-retry"),
    });
    expect(retryReceipt).toMatchObject({ userId: OLD_USER_ID, grantedAt: null });
    expect(retryReceipt?.acceptedAt).not.toBeNull();
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
    // Settled at registration, and the hourly reconcile agrees.
    expect(reborn?.federalStatus).toBe("GOLD");
    await reconcileFederalStatuses(database);
    const reconciled = await database.query.userData.findFirst({
      columns: { federalStatus: true },
      where: eq(userData.userId, OLD_USER_ID),
    });
    expect(reconciled?.federalStatus).toBe("GOLD");
    // The consumable went to the character that is gone; a new one starts from scratch.
    expect(reborn?.reputationPoints).toBe(STARTING_REPUTATION_POINTS);
  });

  const DAY = 86_400_000;

  const registerAgain = async (userId: string, tag: string, username: string) => {
    const database = await getTestDatabase();
    await Promise.all([
      database.insert(village).values({
        id: `${tag}-horizon`,
        name: "Horizon",
        sector: 1,
        kageId: STAFF,
      }),
      database.insert(bloodline).values({
        id: `${tag}-bloodline`,
        name: `${tag} bloodline`,
        image: "/bloodline.png",
        description: "test",
        effects: [],
        rank: "D",
      }),
    ]);
    const caller = await callerFor(registerRouter, userId);
    return await caller.createCharacter({
      username,
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
      bloodlineId: `${tag}-bloodline`,
    });
  };

  it("records a renewal that lands while the character is gone, and the new character inherits it", async () => {
    // The old period ends and the store bills the next one between the deletion and the
    // new character. Dropping that renewal would leave the returning subscriber with
    // nothing live until the period after, while still being billed.
    const database = await getTestDatabase();
    const now = Date.now();
    await database.insert(storePurchase).values({
      id: nanoid(),
      userId: OLD_USER_ID,
      originalUserId: OLD_USER_ID,
      transactionId: "period-before-deletion",
      productId: "tnr_federal_gold",
      store: "APPLE",
      federalStatus: "GOLD",
      isSandbox: false,
      acceptedAt: new Date(now - 20 * DAY),
      grantedAt: new Date(now - 20 * DAY),
      purchasedAt: new Date(now - 20 * DAY),
      expiresAt: new Date(now - 1),
      rawData: {},
    });
    await deleteUser(database, OLD_USER_ID);
    await expect(
      grantStorePurchase(database, {
        userId: OLD_USER_ID,
        transactionId: "renewal-in-window",
        productId: "tnr_federal_gold",
        store: "APPLE",
        isSandbox: false,
        purchasedAt: new Date(now),
        expiresAt: new Date(now + 30 * DAY),
        raw: {},
      }),
    ).resolves.toEqual({ status: "ignored", reason: "Deleted user" });
    // A billing extension for that period lands in the window as well, and so does a
    // consumable whose purchase the store completed late.
    await extendStoreSubscription(database, {
      userId: OLD_USER_ID,
      store: "APPLE",
      productId: "tnr_federal_gold",
      transactionId: "renewal-in-window",
      expirationAt: new Date(now + 46 * DAY),
    });
    await expect(
      grantStorePurchase(database, {
        userId: OLD_USER_ID,
        transactionId: "reps-in-window",
        productId: "tnr_reps_tier1",
        store: "APPLE",
        isSandbox: false,
        purchasedAt: new Date(now),
        raw: {},
      }),
    ).resolves.toEqual({ status: "ignored", reason: "Deleted user" });
    const created = await registerAgain(OLD_USER_ID, "renewal-window", "Renewed");
    expect(created.success).toBe(true);
    // Settled at registration: the tier is there before any reconcile runs, and the
    // consumable nobody received is delivered to the character that exists.
    const [reborn, renewal] = await Promise.all([
      database.query.userData.findFirst({
        columns: { federalStatus: true, reputationPoints: true },
        where: eq(userData.userId, OLD_USER_ID),
      }),
      database.query.storePurchase.findFirst({
        columns: { userId: true, grantedAt: true, expiresAt: true },
        where: eq(storePurchase.transactionId, "renewal-in-window"),
      }),
    ]);
    expect(reborn?.federalStatus).toBe("GOLD");
    expect(reborn?.reputationPoints).toBe(STARTING_REPUTATION_POINTS + 8);
    expect(renewal?.userId).toBe(OLD_USER_ID);
    expect(renewal?.grantedAt).not.toBeNull();
    expect(renewal?.expiresAt).toEqual(new Date(now + 46 * DAY));
  });

  it("keeps an expiry that lands while the character is gone from vouching for the new one", async () => {
    // The mirror image: a period the store ended in the window must stay ended, or the
    // returning character would be handed a tier that was cancelled or refunded.
    const database = await getTestDatabase();
    const now = Date.now();
    await database.insert(storePurchase).values({
      id: nanoid(),
      userId: OLD_USER_ID,
      originalUserId: OLD_USER_ID,
      transactionId: "ended-in-window",
      productId: "tnr_federal_gold",
      store: "APPLE",
      federalStatus: "GOLD",
      isSandbox: false,
      acceptedAt: new Date(now - 20 * DAY),
      grantedAt: new Date(now - 20 * DAY),
      purchasedAt: new Date(now - 20 * DAY),
      expiresAt: new Date(now + 10 * DAY),
      rawData: {},
    });
    await deleteUser(database, OLD_USER_ID);
    // No transaction id, the shape that used to land under the tombstone string.
    await revokeFederalStatus(database, OLD_USER_ID, {
      occurredAt: new Date(now),
      productId: "tnr_federal_gold",
      store: "APPLE",
    });
    const created = await registerAgain(OLD_USER_ID, "expiry-window", "Lapsed");
    expect(created.success).toBe(true);
    const [reborn, ended] = await Promise.all([
      database.query.userData.findFirst({
        columns: { federalStatus: true },
        where: eq(userData.userId, OLD_USER_ID),
      }),
      database.query.storePurchase.findFirst({
        columns: { revokedAt: true },
        where: eq(storePurchase.transactionId, "ended-in-window"),
      }),
    ]);
    expect(reborn?.federalStatus).toBe("NONE");
    expect(ended?.revokedAt).not.toBeNull();
  });

  it("still retries a purchase for an identity that has not registered yet", async () => {
    // The store SDK is signed in before the character exists, so a missing recipient
    // without a tombstone is "not yet", and RevenueCat's retry is what delivers it.
    const database = await getTestDatabase();
    await expect(
      grantStorePurchase(database, {
        userId: "not-yet-registered",
        transactionId: nanoid(),
        productId: "tnr_reps_tier1",
        store: "APPLE",
        isSandbox: false,
        purchasedAt: new Date(),
        raw: {},
      }),
    ).rejects.toThrow(/No user not-yet-registered/);
  });

  it("moves a transfer to an identity that deleted its character, and the receipts wait for it", async () => {
    const database = await getTestDatabase();
    const now = Date.now();
    await insertUsers([{ userId: "transfer-source", username: "transfer-src" }]);
    await Promise.all([
      database.insert(storePurchase).values({
        id: nanoid(),
        userId: "transfer-source",
        originalUserId: "transfer-source",
        transactionId: "moves-to-deleted",
        productId: "tnr_federal_gold",
        store: "APPLE",
        federalStatus: "GOLD",
        isSandbox: false,
        acceptedAt: new Date(now - 5 * DAY),
        grantedAt: new Date(now - 5 * DAY),
        purchasedAt: new Date(now - 5 * DAY),
        expiresAt: new Date(now + 25 * DAY),
        rawData: {},
      }),
      database
        .update(userData)
        .set({ federalStatus: "GOLD" })
        .where(eq(userData.userId, "transfer-source")),
    ]);
    await deleteUser(database, OLD_USER_ID);
    await transferStorePurchases(database, {
      eventId: "transfer-to-deleted",
      fromUserIds: ["transfer-source"],
      toUserIds: [OLD_USER_ID],
      store: "APPLE",
      isSandbox: false,
      occurredAt: new Date(now),
    });
    const [moved, source] = await Promise.all([
      database.query.storePurchase.findFirst({
        columns: { userId: true },
        where: eq(storePurchase.transactionId, "moves-to-deleted"),
      }),
      database.query.userData.findFirst({
        columns: { federalStatus: true },
        where: eq(userData.userId, "transfer-source"),
      }),
    ]);
    // The source stops vouching now; the receipt is under the identity that owns it.
    expect(moved?.userId).toBe(OLD_USER_ID);
    expect(source?.federalStatus).toBe("NONE");
    const created = await registerAgain(OLD_USER_ID, "transfer-window", "Received");
    expect(created.success).toBe(true);
    const reborn = await database.query.userData.findFirst({
      columns: { federalStatus: true },
      where: eq(userData.userId, OLD_USER_ID),
    });
    expect(reborn?.federalStatus).toBe("GOLD");
  });

  it("resolves a renamed id to the deleted identity rather than its tombstone", async () => {
    // A receipt or a delayed webhook naming the old id still belongs to the identity the
    // rename moved it to, deleted or not, and registration takes only the tombstone.
    const database = await getTestDatabase();
    await database.insert(storeUserIdAlias).values({
      oldUserId: "old-clerk-id",
      newUserId: OLD_USER_ID,
      updatedAt: new Date(),
    });
    await deleteUser(database, OLD_USER_ID);
    await expect(canonicalStoreUserId(database, "old-clerk-id")).resolves.toBe(
      OLD_USER_ID,
    );
    await expect(canonicalStoreUserId(database, OLD_USER_ID)).resolves.toBe(
      OLD_USER_ID,
    );
    const created = await registerAgain(OLD_USER_ID, "renamed-window", "Rerouted");
    expect(created.success).toBe(true);
    const [rename, tombstone] = await Promise.all([
      database.query.storeUserIdAlias.findFirst({
        columns: { newUserId: true },
        where: eq(storeUserIdAlias.oldUserId, "old-clerk-id"),
      }),
      database.query.storeUserIdAlias.findFirst({
        where: eq(storeUserIdAlias.oldUserId, OLD_USER_ID),
      }),
    ]);
    expect(rename?.newUserId).toBe(OLD_USER_ID);
    expect(tombstone).toBeUndefined();
  });

  it("settles on a retry that finds the tombstone already gone", async () => {
    // The first attempt died between removing the tombstone and settling. Store history
    // is what triggers settlement, so the retry still delivers and re-derives.
    const database = await getTestDatabase();
    const now = Date.now();
    await database.insert(storePurchase).values([
      {
        id: nanoid(),
        userId: OLD_USER_ID,
        originalUserId: OLD_USER_ID,
        transactionId: "gold-across-retry",
        productId: "tnr_federal_gold",
        store: "APPLE",
        federalStatus: "GOLD",
        isSandbox: false,
        acceptedAt: new Date(now - DAY),
        grantedAt: new Date(now - DAY),
        purchasedAt: new Date(now - DAY),
        expiresAt: new Date(now + 29 * DAY),
        rawData: {},
      },
      {
        id: nanoid(),
        userId: OLD_USER_ID,
        originalUserId: OLD_USER_ID,
        transactionId: "reps-across-retry",
        productId: "tnr_reps_tier1",
        store: "APPLE",
        reputationPoints: 8,
        federalStatus: null,
        isSandbox: false,
        acceptedAt: new Date(now),
        purchasedAt: new Date(now),
        rawData: {},
      },
    ]);
    await deleteUser(database, OLD_USER_ID);
    await database
      .delete(storeUserIdAlias)
      .where(eq(storeUserIdAlias.oldUserId, OLD_USER_ID));
    const created = await registerAgain(OLD_USER_ID, "retry-window", "Retried");
    expect(created.success).toBe(true);
    const reborn = await database.query.userData.findFirst({
      columns: { federalStatus: true, reputationPoints: true },
      where: eq(userData.userId, OLD_USER_ID),
    });
    expect(reborn?.federalStatus).toBe("GOLD");
    expect(reborn?.reputationPoints).toBe(STARTING_REPUTATION_POINTS + 8);
  });

  it("settles pending receipts when a retry finds the character already created", async () => {
    const database = await getTestDatabase();
    const before = await database.query.userData.findFirst({
      columns: { reputationPoints: true },
      where: eq(userData.userId, OLD_USER_ID),
    });
    await database.insert(storePurchase).values({
      id: nanoid(),
      userId: OLD_USER_ID,
      originalUserId: OLD_USER_ID,
      transactionId: "reps-pending-on-retry",
      productId: "tnr_reps_tier1",
      store: "APPLE",
      reputationPoints: 8,
      federalStatus: null,
      isSandbox: false,
      acceptedAt: new Date(),
      purchasedAt: new Date(),
      rawData: {},
    });
    await expect(
      registerAgain(OLD_USER_ID, "retry-existing", "Existing"),
    ).resolves.toEqual({
      success: false,
      message: "Character already created for this account",
    });
    const after = await database.query.userData.findFirst({
      columns: { reputationPoints: true },
      where: eq(userData.userId, OLD_USER_ID),
    });
    expect(after?.reputationPoints).toBe((before?.reputationPoints ?? 0) + 8);
  });

  it("lets a deleted PayPal subscriber's tier follow onto the new character", async () => {
    // PayPal rows survive deletion just as store receipts do, so the same settlement
    // derives the tier from them; main waited for the cron here.
    const database = await getTestDatabase();
    await database.insert(paypalSubscription).values({
      id: nanoid(),
      createdById: OLD_USER_ID,
      affectedUserId: OLD_USER_ID,
      subscriptionId: nanoid(),
      federalStatus: "SILVER",
      status: "ACTIVE",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await deleteUser(database, OLD_USER_ID);
    const created = await registerAgain(OLD_USER_ID, "paypal-window", "Paypaler");
    expect(created.success).toBe(true);
    const reborn = await database.query.userData.findFirst({
      columns: { federalStatus: true },
      where: eq(userData.userId, OLD_USER_ID),
    });
    expect(reborn?.federalStatus).toBe("SILVER");
    await database
      .delete(paypalSubscription)
      .where(eq(paypalSubscription.affectedUserId, OLD_USER_ID));
  });

  it("gives deletion durable ownership before cleanup and refuses a concurrent rename", async () => {
    const database = await getTestDatabase();
    await database.insert(notification).values({
      userId: OLD_USER_ID,
      content: "deletion barrier",
    });
    // Mid-cleanup, the tombstone is already down, so a rename refuses at once.
    const deleting = beforeStatements(database, notification, [
      async () => {
        const marker = await database.query.storeUserIdAlias.findFirst({
          where: eq(storeUserIdAlias.oldUserId, OLD_USER_ID),
        });
        expect(marker?.newUserId).toMatch(/^__tnr_deleted_store_user__:/);
        await expect(
          callerForDatabase(staffRouter, STAFF, database).updateUserId({
            userId: OLD_USER_ID,
            newUserId: NEW_USER_ID,
          }),
        ).resolves.toEqual({
          success: false,
          message: "UserId is being deleted and cannot be renamed",
        });
      },
    ]);
    await deleteUser(deleting, OLD_USER_ID);
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
  });

  it("refuses to move an identity that a deletion claimed between its check and its write", async () => {
    const database = await getTestDatabase();
    // The rename has passed its check; the deletion lands whole before its alias write
    // and keeps the row.
    const renaming = beforeStatements(database, storeUserIdAlias, [
      () => deleteUser(database, OLD_USER_ID),
    ]);
    await expect(
      callerForDatabase(staffRouter, STAFF, renaming).updateUserId({
        userId: OLD_USER_ID,
        newUserId: NEW_USER_ID,
      }),
    ).resolves.toEqual({
      success: false,
      message: "UserId is being deleted and cannot be renamed",
    });
    const [alias, moved] = await Promise.all([
      database.query.storeUserIdAlias.findFirst({
        where: eq(storeUserIdAlias.oldUserId, OLD_USER_ID),
      }),
      database.query.userData.findFirst({
        where: eq(userData.userId, NEW_USER_ID),
      }),
    ]);
    expect(alias?.newUserId).toMatch(/^__tnr_deleted_store_user__:/);
    expect(moved).toBeUndefined();
  });

  it("refuses to delete an identity that a rename has already claimed", async () => {
    const database = await getTestDatabase();
    // The rename's first statement has landed; whatever else it has moved so far, the
    // identity is its to finish.
    await database.insert(storeUserIdAlias).values({
      oldUserId: OLD_USER_ID,
      newUserId: NEW_USER_ID,
      updatedAt: new Date(),
    });
    await expect(deleteUser(database, OLD_USER_ID)).rejects.toThrow(
      /is being renamed and cannot be deleted/,
    );
    const [alias, user] = await Promise.all([
      database.query.storeUserIdAlias.findFirst({
        where: eq(storeUserIdAlias.oldUserId, OLD_USER_ID),
      }),
      database.query.userData.findFirst({
        columns: { userId: true },
        where: eq(userData.userId, OLD_USER_ID),
      }),
    ]);
    expect(alias?.newUserId).toBe(NEW_USER_ID);
    expect(user?.userId).toBe(OLD_USER_ID);
  });

  it("leaves its intent behind when a write fails, and finishes when run again", async () => {
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
    const caller = await callerFor(staffRouter, STAFF);
    await expect(
      callerForDatabase(
        staffRouter,
        STAFF,
        failStatements(database, notification),
      ).updateUserId({ userId: OLD_USER_ID, newUserId: NEW_USER_ID }),
    ).rejects.toThrow();
    // The alias is the durable intent; whatever else moved or did not, the second run
    // picks the rename up from there.
    const intent = await database.query.storeUserIdAlias.findFirst({
      where: eq(storeUserIdAlias.oldUserId, OLD_USER_ID),
    });
    expect(intent?.newUserId).toBe(NEW_USER_ID);
    await expect(
      caller.updateUserId({ userId: OLD_USER_ID, newUserId: NEW_USER_ID }),
    ).resolves.toEqual({ success: true, message: "UserId updated" });
    const [oldUser, newUser, entitlement, transfer, message] = await Promise.all([
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
        where: eq(storeEntitlementState.store, "APPLE"),
      }),
      database.query.storePurchaseTransfer.findFirst({
        columns: { sourceUserId: true },
        where: eq(storePurchaseTransfer.destinationUserId, "some-owner"),
      }),
      database.query.notification.findFirst({
        columns: { userId: true },
        where: eq(notification.content, "rename"),
      }),
    ]);
    expect(oldUser).toBeUndefined();
    expect(newUser?.userId).toBe(NEW_USER_ID);
    expect(entitlement?.userId).toBe(NEW_USER_ID);
    expect(transfer?.sourceUserId).toBe(NEW_USER_ID);
    expect(message?.userId).toBe(NEW_USER_ID);
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

});
