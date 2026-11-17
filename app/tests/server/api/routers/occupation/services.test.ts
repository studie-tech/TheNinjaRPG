import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as Sentry from "@sentry/nextjs";
import { and, eq } from "drizzle-orm";
import { CRAFTING_REQUIRED_EXP } from "@/drizzle/constants";
import {
  conversation,
  conversationComment,
  craftingRequirement,
  craftingServicePrice,
  craftingServiceRequest,
  item,
  storeUserIdAlias,
  user2conversation,
  userData,
  userItem,
  userItemImbuement,
  userQueue,
  userVote,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { nextSnapshotSql } from "@/queries/concurrency";
import {
  claimServiceOffer,
  findOpenServiceRequests,
  findServicePrices,
  renameCraftingServices,
} from "@/queries/craftingServices";
import { commentsRouter } from "@/server/api/routers/comments";
import { occupationRouter } from "@/server/api/routers/occupation";
import { profileRouter } from "@/server/api/routers/profile";
import { cleanupOrphanRows } from "@/server/utils/cleaner";
import {
  completeCraftingService as completeService,
  retireCraftingServices as retireServices,
} from "@/server/utils/craftingServices";
import { settleCraftingQueue } from "@/server/utils/userQueue";
import { withAfterTasks } from "../../../../setup/after";
import { deferred } from "../../../../setup/deferred";
import {
  insertItems,
  insertUserItems,
  insertUsers,
  insertUserVotes,
} from "../../../../setup/factories";
import { overrideQuery } from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";
import { requireUser } from "../../../../setup/userReads";

const completeCraftingService = withAfterTasks(completeService);
const retireCraftingServices = withAfterTasks(retireServices);

describeWithDatabase("crafting services escrow and delivery", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    vi.spyOn(Sentry, "captureException").mockReturnValue("service-test-event");
    await resetTables(
      craftingServicePrice,
      craftingServiceRequest,
      craftingRequirement,
      userItemImbuement,
      userItem,
      item,
      userQueue,
      user2conversation,
      conversationComment,
      conversation,
      storeUserIdAlias,
      userData,
      userVote,
    );
    await insertUsers([
      {
        userId: "requester",
        username: "Requester",
        money: 1000,
        status: "AWAKE",
        level: 50,
        rank: "JONIN",
        regenAt: new Date(),
      },
      {
        userId: "crafter",
        username: "Crafter",
        money: 100,
        status: "AWAKE",
        level: 50,
        rank: "JONIN",
        occupation: "CRAFTING",
        craftingExperience: CRAFTING_REQUIRED_EXP.MASTER,
        regenAt: new Date(),
      },
    ]);
    await insertUserVotes([{ userId: "requester" }, { userId: "crafter" }]);
    await insertItems([
      { id: "material", name: "Iron", canStack: true, stackSize: 100 },
      {
        id: "recipe",
        name: "Service Sword",
        canBeCrafted: true,
        craftingExperience: 10,
        craftingOutputQuantity: 1,
        rarity: "COMMON",
        itemType: "WEAPON",
        maxDurability: 100,
        canBeImbued: true,
        maxImbueNumber: 3,
      },
      {
        id: "crystal",
        name: "Service Crystal",
        itemType: "CRYSTAL",
        craftingExperience: 6,
        rarity: "COMMON",
      },
    ]);
    await insertUserItems([
      { id: "iron", userId: "requester", itemId: "material", quantity: 20 },
      { id: "sword", userId: "requester", itemId: "recipe", durability: 50 },
      { id: "gem", userId: "requester", itemId: "crystal", quantity: 1 },
    ]);
    const db = await getTestDatabase();
    await db.insert(craftingRequirement).values({
      id: "requirement",
      craftItemId: "recipe",
      requirementItemId: "material",
      quantity: 2,
    });
    await db.insert(craftingServicePrice).values(
      ["CRAFT", "IMBUE", "DISIMBUE", "REPAIR"].map((service) => ({
        userId: "crafter",
        service: service as "CRAFT" | "IMBUE" | "DISIMBUE" | "REPAIR",
        rarity: "COMMON" as const,
        fee: 50,
      })),
    );
  });
  const submit = async (
    service: "CRAFT" | "IMBUE" | "DISIMBUE" | "REPAIR" = "CRAFT",
  ) => {
    const caller = await callerFor(occupationRouter, "requester");
    return caller.submitServiceRequest({
      crafterId: "crafter",
      service,
      expectedFee: 50,
      ...(service === "CRAFT" ? { itemId: "recipe" } : { userItemId: "sword" }),
      ...(service === "IMBUE" ? { userCrystalItemId: "gem" } : {}),
      ...(service === "DISIMBUE" ? { imbuementId: "imb" } : {}),
    });
  };
  const receipt = async () => {
    const rows = await findOpenServiceRequests(await getTestDatabase(), "requester");
    expect(rows).toHaveLength(1);
    return rows[0]!;
  };
  const accept = async () => {
    const request = await receipt();
    const caller = await callerFor(occupationRouter, "crafter");
    return caller.respondToServiceRequest({ requestId: request.id, action: "ACCEPT" });
  };
  const due = async () => {
    const db = await getTestDatabase();
    await db
      .update(craftingServiceRequest)
      .set({ finishesAt: new Date(Date.now() - 1000) })
      .where(eq(craftingServiceRequest.status, "ACTIVE"));
    await db
      .update(userData)
      .set({ serviceCraftUntil: new Date(Date.now() - 1000) })
      .where(eq(userData.userId, "crafter"));
    return receipt();
  };

  it("reserves recipe materials/fee and cancels once with a full refund", async () => {
    expect(await submit()).toMatchObject({ success: true });
    const db = await getTestDatabase(),
      request = await receipt();
    expect((await requireUser("requester")).money).toBe(950);
    expect(
      (await db.query.userItem.findFirst({ where: eq(userItem.id, "iron") }))?.quantity,
    ).toBe(18);
    const caller = await callerFor(occupationRouter, "requester");
    const results = await Promise.all([
      caller.respondToServiceRequest({ requestId: request.id, action: "CANCEL" }),
      caller.respondToServiceRequest({ requestId: request.id, action: "CANCEL" }),
    ]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect((await requireUser("requester")).money).toBe(1000);
    expect(
      (await db.query.userItem.findFirst({ where: eq(userItem.id, "iron") }))?.quantity,
    ).toBe(20);
  });
  it("accepts once, awards XP, occupies the slot and delivers/pays once under duplicate settlement", async () => {
    expect(await submit()).toMatchObject({ success: true });
    expect(await accept()).toMatchObject({ success: true });
    expect((await requireUser("crafter")).craftingExperience).toBeGreaterThan(
      CRAFTING_REQUIRED_EXP.MASTER,
    );
    const caller = await callerFor(occupationRouter, "crafter");
    expect(await caller.craftItem({ itemId: "recipe", quantity: 1 })).toMatchObject({
      success: false,
      message: "Your crafting slot is occupied by a service request",
    });
    const request = await due(),
      db = await getTestDatabase();
    const results = await Promise.all([
      completeCraftingService(db, request),
      completeCraftingService(db, request),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await requireUser("crafter")).money).toBe(150);
    expect(
      await db.query.userItem.findMany({
        where: and(eq(userItem.userId, "requester"), eq(userItem.itemId, "recipe")),
      }),
    ).toHaveLength(2);
  });
  it("repairs instantly above maximum and sends readable inbox notifications", async () => {
    expect(await submit("REPAIR")).toMatchObject({ success: true });
    const db = await getTestDatabase();
    expect(
      (await db.query.userItem.findFirst({ where: eq(userItem.id, "sword") }))
        ?.durability,
    ).toBe(115);
    expect((await requireUser("crafter")).money).toBe(150);
    const messages = await db.query.conversationComment.findMany();
    expect(messages.length).toBeGreaterThan(0);
    // The normal comment reader must find a real author instead of dropping the notification.
    const read = await callerFor(commentsRouter, "requester");
    const message = messages.find((row) => row.content.includes("completed"))!;
    const page = await read.getConversationComments({
      convo_id: message.conversationId ?? undefined,
      limit: 20,
    });
    expect(page.data.some((row) => row.content.includes("completed"))).toBe(true);
  });
  it("escrows equipment/crystal and returns the exact copy and crystal on decline", async () => {
    expect(await submit("IMBUE")).toMatchObject({ success: true });
    const request = await receipt(),
      db = await getTestDatabase();
    expect(
      (await db.query.userItem.findFirst({ where: eq(userItem.id, "sword") }))?.userId,
    ).toBe(request.id);
    expect(
      (await db.query.userItem.findFirst({ where: eq(userItem.id, "gem") }))?.quantity,
    ).toBe(0);
    expect(await submit("IMBUE")).toMatchObject({ success: false });
    const crafter = await callerFor(occupationRouter, "crafter");
    expect(
      await crafter.respondToServiceRequest({
        requestId: request.id,
        action: "DECLINE",
      }),
    ).toMatchObject({ success: true });
    expect(
      (await db.query.userItem.findFirst({ where: eq(userItem.id, "sword") }))?.userId,
    ).toBe("requester");
    expect(
      (
        await db.query.userItem.findMany({
          where: and(eq(userItem.userId, "requester"), eq(userItem.itemId, "crystal")),
        })
      ).reduce((sum, row) => sum + row.quantity, 0),
    ).toBe(1);
  });
  it("keeps pending equipment cancellable after daily orphan cleanup", async () => {
    expect(await submit("IMBUE")).toMatchObject({ success: true });
    const request = await receipt();
    const db = await getTestDatabase();
    await insertUserItems([{ id: "orphan", userId: "missing", itemId: "recipe" }]);
    await cleanupOrphanRows(db);
    expect(
      (await db.query.userItem.findFirst({ where: eq(userItem.id, "sword") }))?.userId,
    ).toBe(request.id);
    expect(
      await db.query.userItem.findFirst({ where: eq(userItem.id, "orphan") }),
    ).toBeUndefined();
    const caller = await callerFor(occupationRouter, "requester");
    expect(
      await caller.respondToServiceRequest({ requestId: request.id, action: "CANCEL" }),
    ).toMatchObject({ success: true });
    expect((await requireUser("requester")).money).toBe(1000);
    expect(
      (await db.query.userItem.findFirst({ where: eq(userItem.id, "sword") }))?.userId,
    ).toBe("requester");
    expect(
      (
        await db.query.userItem.findMany({
          where: and(eq(userItem.userId, "requester"), eq(userItem.itemId, "crystal")),
        })
      ).reduce((sum, row) => sum + row.quantity, 0),
    ).toBe(1);
  });
  it("delivers active escrow exactly once after daily orphan cleanup", async () => {
    expect(await submit("IMBUE")).toMatchObject({ success: true });
    expect(await accept()).toMatchObject({ success: true });
    const db = await getTestDatabase();
    const request = await receipt();
    await cleanupOrphanRows(db);
    expect(
      (await db.query.userItem.findFirst({ where: eq(userItem.id, "sword") }))?.userId,
    ).toBe(request.id);
    await due();
    const caller = await callerFor(profileRouter, "requester");
    await caller.getUser();
    expect(
      (await db.query.userItem.findFirst({ where: eq(userItem.id, "sword") }))?.userId,
    ).toBe("requester");
    expect(await db.query.userItemImbuement.findMany()).toHaveLength(1);
    await caller.getUser();
    expect((await requireUser("crafter")).money).toBe(150);
  });
  it("returns a disimbued crystal to the requester", async () => {
    const db = await getTestDatabase();
    await db.insert(userItemImbuement).values({
      id: "imb",
      userItemId: "sword",
      imbuementItemId: "crystal",
      craftingFinishedAt: new Date(0),
    });
    expect(await submit("DISIMBUE")).toMatchObject({ success: true });
    expect(await accept()).toMatchObject({ success: true });
    const request = await due();
    await completeCraftingService(db, request);
    expect(await db.query.userItemImbuement.findMany()).toHaveLength(0);
    expect(
      await db.query.userItem.findMany({
        where: and(eq(userItem.userId, "requester"), eq(userItem.itemId, "crystal")),
      }),
    ).toHaveLength(2);
  });
  it("rejects stale pricing, missing materials and unauthorized acceptance without debiting", async () => {
    const caller = await callerFor(occupationRouter, "requester");
    expect(
      await caller.submitServiceRequest({
        crafterId: "crafter",
        service: "CRAFT",
        itemId: "recipe",
        expectedFee: 51,
      }),
    ).toMatchObject({ success: false });
    const db = await getTestDatabase();
    await db.update(userItem).set({ quantity: 0 }).where(eq(userItem.id, "iron"));
    expect(await submit()).toMatchObject({ success: false });
    expect((await requireUser("requester")).money).toBe(1000);
    await db.update(userItem).set({ quantity: 20 }).where(eq(userItem.id, "iron"));
    await submit();
    const request = await receipt();
    expect(
      await caller.respondToServiceRequest({ requestId: request.id, action: "ACCEPT" }),
    ).toMatchObject({ success: false });
  });
  it("rejects write-time disabled offers and retiring identities", async () => {
    const db = await getTestDatabase(),
      price = (await findServicePrices(db, "crafter"))[0]!;
    await db
      .update(craftingServicePrice)
      .set({ enabled: false })
      .where(eq(craftingServicePrice.service, price.service));
    expect((await claimServiceOffer(db, price)).rowsAffected).toBe(0);
    await db.update(craftingServicePrice).set({ enabled: true });
    await db
      .insert(storeUserIdAlias)
      .values({ oldUserId: "crafter", newUserId: "deleted:service-test" });
    expect(await submit()).toMatchObject({ success: false });
    expect((await requireUser("requester")).money).toBe(1000);
  });
  it("refunds escrow before account retirement and follows staff identity renames", async () => {
    await submit("IMBUE");
    const db = await getTestDatabase();
    await renameCraftingServices(db, "crafter", "renamed");
    await db
      .update(userData)
      .set({ userId: "renamed" })
      .where(eq(userData.userId, "crafter"));
    expect((await receipt()).crafterId).toBe("renamed");
    await retireCraftingServices(db, "renamed");
    expect((await requireUser("requester")).money).toBe(1000);
    expect(
      (await db.query.userItem.findFirst({ where: eq(userItem.id, "sword") }))?.userId,
    ).toBe("requester");
    expect(await findOpenServiceRequests(db, "requester")).toHaveLength(0);
  });
  it("starts service timers at acceptance and delays late queued crafts behind the service", async () => {
    await submit();
    const db = await getTestDatabase(),
      request = await receipt();
    await db
      .update(craftingServiceRequest)
      .set({ createdAt: new Date(Date.now() - 86400000) })
      .where(eq(craftingServiceRequest.id, request.id));
    expect(await accept()).toMatchObject({ success: true });
    const active = await receipt();
    expect(active.startedAt!.getTime()).toBeGreaterThan(Date.now() - 60000);
    const timers = await (await callerFor(profileRouter, "crafter")).getSidebarTimers();
    expect(new Date(timers.crafting!.craftingStartedAt!).getTime()).toBe(
      active.startedAt!.getTime(),
    );
    await db.insert(userQueue).values({
      id: "late",
      userId: "crafter",
      kind: "CRAFT",
      position: 1,
      itemId: "recipe",
      quantity: 1,
      materials: [],
      durationSeconds: 60,
      startsAt: new Date(Date.now() - 10000),
      finishesAt: new Date(Date.now() + 50000),
    });
    expect(await settleCraftingQueue(db, "crafter")).toBe(0);
    const waiting = await db.query.userQueue.findFirst({
      where: eq(userQueue.id, "late"),
    });
    expect(waiting!.startsAt!.getTime()).toBe(active.finishesAt!.getTime());
  });
  it("permits overflow delivery and keeps pending receipts visible beyond terminal history", async () => {
    await submit();
    const db = await getTestDatabase(),
      pending = await receipt();
    await db.insert(craftingServiceRequest).values(
      Array.from({ length: 101 }, (_, i) => ({
        ...pending,
        id: `old-${i}`,
        status: "COMPLETED" as const,
        createdAt: new Date(Date.now() + i + 1),
      })),
    );
    const rows = await (
      await callerFor(occupationRouter, "crafter")
    ).getServiceRequests();
    expect(rows.some((row) => row.id === pending.id && row.status === "PENDING")).toBe(
      true,
    );
    expect(await accept()).toMatchObject({ success: true });
    await insertUserItems(
      Array.from({ length: 150 }, (_, i) => ({
        id: `full-${i}`,
        userId: "requester",
        itemId: "recipe",
      })),
    );
    await completeCraftingService(db, await due());
    expect(
      await db.query.userItem.findMany({
        where: and(eq(userItem.userId, "requester"), eq(userItem.itemId, "recipe")),
      }),
    ).toHaveLength(152);
  });
  it("wakes an opted-in requester and leaves cancelled requests usable while asleep", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ status: "ASLEEP", autoWakeUp: true })
      .where(eq(userData.userId, "requester"));
    expect(await submit()).toMatchObject({
      success: true,
      actionNotice: "This action woke you up.",
    });
    expect((await requireUser("requester")).status).toBe("AWAKE");
    const request = await receipt();
    await db
      .update(userData)
      .set({ status: "ASLEEP", autoWakeUp: false })
      .where(eq(userData.userId, "requester"));
    expect(
      await (await callerFor(occupationRouter, "requester")).respondToServiceRequest({
        requestId: request.id,
        action: "CANCEL",
      }),
    ).toMatchObject({ success: true });
    expect((await requireUser("requester")).status).toBe("ASLEEP");
  });
  it("rejects acceptance when personal crafting starts after its account snapshot", async () => {
    await submit();
    const db = await getTestDatabase(),
      request = await receipt(),
      before = await requireUser("crafter");
    let inventoryStarted = false;
    let injected = false;
    const committed = deferred<void>();
    const observed = overrideQuery(
      overrideQuery(db, "userItem", {
        findMany: async (read, ...args) => {
          inventoryStarted = true;
          const rows = await read(...args);
          if (!injected) {
            injected = true;
            await db.transaction(async (tx) => {
              await tx.insert(userItem).values({
                id: "concurrent-craft",
                userId: "crafter",
                itemId: "recipe",
                craftingFinishedAt: new Date(Date.now() + 60000),
              });
              await tx
                .update(userData)
                .set({ updatedAt: nextSnapshotSql(userData.updatedAt) })
                .where(eq(userData.userId, "crafter"));
            });
            committed.resolve();
          }
          return rows;
        },
      }),
      "userData",
      {
        findFirst: async (read, ...args) => {
          if (args[0]?.with?.queue) {
            await Promise.resolve();
            if (inventoryStarted) await committed.promise;
          }
          return read(...args);
        },
      },
    );
    const caller = callerForDatabase(occupationRouter, "crafter", observed);
    expect(
      await caller.respondToServiceRequest({ requestId: request.id, action: "ACCEPT" }),
    ).toMatchObject({ success: false });
    expect((await receipt()).status).toBe("PENDING");
    const after = await requireUser("crafter");
    expect(after.serviceCraftUntil).toBeNull();
    expect(after.craftingExperience).toBe(before.craftingExperience);
    expect(
      await db.query.userItem.findFirst({ where: eq(userItem.id, "concurrent-craft") }),
    ).toBeTruthy();
  });
  it("keeps profiles and healthy deliveries usable beside a failed escrow receipt", async () => {
    await submit();
    await accept();
    const db = await getTestDatabase(),
      good = await due();
    const bad = {
      ...good,
      id: "service:0-bad",
      service: "IMBUE" as const,
      targetUserItemId: "missing-equipment",
      crystalItemId: "crystal",
      fee: 0,
    };
    await db.insert(craftingServiceRequest).values(bad);
    const profile = await (await callerFor(profileRouter, "requester")).getUser();
    expect(profile.userData?.userId).toBe("requester");
    expect(
      (
        await db.query.craftingServiceRequest.findFirst({
          where: eq(craftingServiceRequest.id, good.id),
        })
      )?.status,
    ).toBe("COMPLETED");
    expect(
      (
        await db.query.craftingServiceRequest.findFirst({
          where: eq(craftingServiceRequest.id, bad.id),
        })
      )?.status,
    ).toBe("ACTIVE");
    const rows = await (
      await callerFor(occupationRouter, "requester")
    ).getServiceRequests();
    expect(rows.find((row) => row.id === bad.id)?.settlementError).toContain(
      "Delivery is delayed",
    );
    expect(rows.find((row) => row.id === good.id)?.settlementError).toBeNull();
    expect((await requireUser("crafter")).money).toBe(150);
    expect(Sentry.captureException).toHaveBeenCalled();
  });
  it("does not report awakening or consume a crystal when an imbue transaction rolls back", async () => {
    const db = await getTestDatabase();
    await db
      .update(userItem)
      .set({ userId: "crafter" })
      .where(eq(userItem.userId, "requester"));
    await db
      .update(userItem)
      .set({ storedAtHome: true })
      .where(eq(userItem.id, "sword"));
    await db
      .update(userData)
      .set({ status: "ASLEEP", autoWakeUp: true })
      .where(eq(userData.userId, "crafter"));
    const result = await (await callerFor(occupationRouter, "crafter")).imbueItem({
      userItemId: "sword",
      userCrystalItemId: "gem",
    });
    expect(result.success).toBe(false);
    expect("actionNotice" in result).toBe(false);
    expect("userRecovery" in result).toBe(false);
    expect((await requireUser("crafter")).status).toBe("ASLEEP");
    expect(
      (await db.query.userItem.findFirst({ where: eq(userItem.id, "gem") }))?.quantity,
    ).toBe(1);
    expect(await db.query.userItemImbuement.findMany()).toHaveLength(0);
  });
});
