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
  quest,
  questHistory,
  storeUserIdAlias,
  user2conversation,
  userData,
  userItem,
  userItemImbuement,
  userQueue,
  userVote,
} from "@/drizzle/schema";
import { rollFortify } from "@/libs/fortify";
import { Pusher } from "@/libs/pusher";
import { nextSnapshotSql } from "@/queries/concurrency";
import {
  acceptServiceRequest,
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
  refundCraftingService,
  retireCraftingServices as retireServices,
  settleCraftingServices,
} from "@/server/utils/craftingServices";
import { settleCraftingQueue } from "@/server/utils/userQueue";
import { getNextUserSnapshotAt } from "@/utils/time";
import { DamageTag } from "@/validators/combat";
import { AllObjectives, QuestTracker } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { withAfterTasks } from "../../../../setup/after";
import { deferred } from "../../../../setup/deferred";
import {
  insertItems,
  insertQuestHistory,
  insertQuests,
  insertUserItems,
  insertUsers,
  insertUserVotes,
} from "../../../../setup/factories";
import {
  barrier,
  beforeStatements,
  beforeTransaction,
  overrideQuery,
  withoutTransactions,
} from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
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
      questHistory,
      quest,
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

  const fortifyReceipt = async (succeeded = true) => {
    const db = await getTestDatabase();
    const state = { damage: { type: "damage" as const, level: 1, failures: 0 } };
    const fortify = rollFortify(
      state,
      DamageTag.parse({
        power: 20,
        fortifyId: "damage",
        fortifyEnabled: true,
      }),
      true,
      succeeded ? 0 : 0.99,
    );
    await db.insert(craftingServiceRequest).values({
      id: "service:fortify",
      requesterId: "requester",
      crafterId: "crafter",
      service: "FORTIFY",
      status: "ACTIVE",
      fee: 50,
      itemId: "recipe",
      itemName: "Service Sword",
      targetUserItemId: "sword",
      materials: [],
      fortify,
      finishesAt: new Date(1),
    });
    await db
      .update(userItem)
      .set({ userId: "service:fortify", fortification: state })
      .where(eq(userItem.id, "sword"));
    await db
      .update(userData)
      .set({ money: 20_000_000 - fortify.cost - 50 })
      .where(eq(userData.userId, "requester"));
    return receipt();
  };

  it.each([true, false])(
    "delivers the recorded Fortify roll (%s) with one equipment write and pays once",
    async (succeeded) => {
      const db = await getTestDatabase(),
        request = await fortifyReceipt(succeeded);
      const before = await requireUser("requester");
      const completion = await recordQueries(() =>
        completeCraftingService(db, request),
      );
      expect(
        completion.statements.filter((statement) =>
          /^update `UserItem`/i.test(statement),
        ),
      ).toHaveLength(1);
      const equipment = await db.query.userItem.findFirst({
        where: eq(userItem.id, "sword"),
      });
      expect(equipment).toMatchObject({
        userId: "requester",
        fortification: request.fortify!.state,
      });
      expect(completion.result).toEqual({
        updatedAt: equipment!.updatedAt,
        countedAt: expect.any(Number),
      });
      expect(await completeCraftingService(db, request)).toBe(false);
      expect((await requireUser("crafter")).money).toBe(150);
      expect((await requireUser("requester")).money).toBe(before.money);
      expect(await db.query.conversation.findMany()).toHaveLength(1);
    },
  );

  it.each(["revision", "owner"])(
    "keeps a Fortify receipt refundable when its escrow %s changes",
    async (change) => {
      const db = await getTestDatabase(),
        request = await fortifyReceipt();
      const observed = beforeTransaction(db, async () => {
        await db
          .update(userItem)
          .set(
            change === "owner"
              ? { userId: "another-receipt" }
              : { updatedAt: new Date(Date.now() + 1000) },
          )
          .where(eq(userItem.id, "sword"));
      });
      await expect(completeCraftingService(observed, request)).rejects.toThrow(
        "Equipment delivery changed",
      );
      expect((await receipt()).status).toBe("ACTIVE");
      expect((await requireUser("crafter")).money).toBe(100);
      expect(await db.query.conversation.findMany()).toHaveLength(0);
      const equipment = await db.query.userItem.findFirst({
        where: eq(userItem.id, "sword"),
      });
      expect(equipment?.fortification?.damage?.level).toBe(1);
      if (change === "owner")
        await db
          .update(userItem)
          .set({ userId: request.id })
          .where(eq(userItem.id, "sword"));
      expect(await withAfterTasks(refundCraftingService)(db, request)).toBe(true);
      expect(await withAfterTasks(refundCraftingService)(db, request)).toBe(false);
      expect((await requireUser("requester")).money).toBe(20_000_000);
      const restored = await db.query.userItem.findFirst({
        where: eq(userItem.id, "sword"),
      });
      expect(restored?.userId).toBe("requester");
      expect(restored?.fortification).toEqual(equipment?.fortification);
    },
  );

  it("reports a boolean when a due Fortify receipt settles", async () => {
    const db = await getTestDatabase(),
      request = await fortifyReceipt();
    expect(await withAfterTasks(settleCraftingServices)(db, [request])).toEqual({
      changed: true,
      failedRequestIds: [],
    });
  });

  it.each(["COMPLETED", "REFUNDED", "missing"] as const)(
    "reports a competing %s Fortify outcome without projecting stale state",
    async (outcome) => {
      const db = await getTestDatabase();
      await db
        .update(userData)
        .set({ money: 20_000_000 })
        .where(eq(userData.userId, "requester"));
      await db
        .update(item)
        .set({
          canBeEnhanced: true,
          effects: [
            DamageTag.parse({
              power: 20,
              fortifyId: "damage",
              fortifyEnabled: true,
            }),
          ],
        })
        .where(eq(item.id, "recipe"));
      await db.insert(craftingServicePrice).values({
        userId: "crafter",
        service: "FORTIFY",
        rarity: "COMMON",
        fee: 50,
      });
      const observed = beforeTransaction(db, async (call) => {
        if (call !== 2) return;
        const request = await receipt();
        if (outcome === "COMPLETED") await completeCraftingService(db, request);
        else {
          await withAfterTasks(refundCraftingService)(db, request);
          if (outcome === "missing")
            await db
              .delete(craftingServiceRequest)
              .where(eq(craftingServiceRequest.id, request.id));
        }
      });
      const result = await callerForDatabase(
        occupationRouter,
        "requester",
        observed,
      ).submitServiceRequest({
        crafterId: "crafter",
        service: "FORTIFY",
        userItemId: "sword",
        expectedFee: 50,
        fortifyTagId: "damage",
        expectedFortifyLevel: 0,
        expectedFortifyFailures: 0,
      });
      expect(result).toMatchObject({
        success: outcome === "COMPLETED",
        serviceUpdate: undefined,
      });
      expect(result.message).toContain(
        outcome === "COMPLETED"
          ? "Fortify succeeded"
          : outcome === "REFUNDED"
            ? "costs and item were returned"
            : "could not be confirmed",
      );
      expect((await requireUser("crafter")).money).toBe(
        outcome === "COMPLETED" ? 150 : 100,
      );
      expect((await requireUser("requester")).money).toBe(
        outcome === "COMPLETED" ? 18_999_950 : 20_000_000,
      );
      const equipment = await db.query.userItem.findFirst({
        where: eq(userItem.id, "sword"),
      });
      expect(equipment?.userId).toBe("requester");
      expect(equipment?.fortification?.damage?.level ?? 0).toBe(
        outcome === "COMPLETED" ? 1 : 0,
      );
    },
  );

  it("reserves recipe materials/fee and cancels once with a full refund", async () => {
    const submission = await recordQueries(() => submit());
    const submitted = submission.result;
    expect(
      submission.statements.some((statement) =>
        /from `Item` where `Item`\.`parentItemId` IS NOT NULL/i.test(statement),
      ),
    ).toBe(false);
    expect(submitted).toMatchObject({
      success: true,
      serviceUpdate: { requesterId: "requester", userDelta: { money: -50 } },
    });
    const db = await getTestDatabase(),
      request = await receipt();
    expect(
      submitted.success &&
        "serviceUpdate" in submitted &&
        submitted.serviceUpdate?.inventoryChanges[0]?.updatedAt,
    ).toEqual(request.createdAt);
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
  it("accepts from the hydrated receipt relations without rediscovering open receipts", async () => {
    await submit();
    const db = await getTestDatabase();
    const request = await receipt();
    const observed = overrideQuery(db, "craftingServiceRequest", {
      findMany: () => {
        throw new Error("Acceptance must use its account snapshot receipts");
      },
    });
    expect(
      await callerForDatabase(
        occupationRouter,
        "crafter",
        observed,
      ).respondToServiceRequest({ requestId: request.id, action: "ACCEPT" }),
    ).toMatchObject({ success: true });
    expect((await receipt()).status).toBe("ACTIVE");
  });
  it("rejects accepting a due receipt after a competing reader delivers it", async () => {
    await submit();
    await accept();
    const request = await due();
    const db = await getTestDatabase();
    const before = await requireUser("crafter");
    let delivered = false;
    const observed = overrideQuery(db, "userData", {
      findFirst: async (read, ...args) => {
        const row = await read(...args);
        if (!delivered && args[0]?.with?.queue) {
          delivered = true;
          expect(await completeCraftingService(db, request)).toBe(true);
        }
        return row;
      },
    });
    expect(
      await callerForDatabase(
        occupationRouter,
        "crafter",
        observed,
      ).respondToServiceRequest({ requestId: request.id, action: "ACCEPT" }),
    ).toMatchObject({
      success: false,
      message: "This request has already been handled",
    });
    expect(delivered).toBe(true);
    expect((await requireUser("crafter")).craftingExperience).toBe(
      before.craftingExperience,
    );
    expect((await requireUser("crafter")).money).toBe(150);
    expect(
      (
        await db.query.craftingServiceRequest.findFirst({
          where: eq(craftingServiceRequest.id, request.id),
        })
      )?.status,
    ).toBe("COMPLETED");
  });
  it("atomically claims both participants and progression once, rejecting stale identities and snapshots", async () => {
    await submit();
    const db = await getTestDatabase();
    const request = await receipt();
    const crafter = await requireUser("crafter");
    const requester = await requireUser("requester");
    const finishesAt = new Date(Date.now() + 60000);
    const questData = [
      { id: "service-progress", startAt: new Date().toISOString(), goals: [] },
    ];
    const claimedAt = getNextUserSnapshotAt(crafter.updatedAt);
    const claim = (user = crafter, row = request) =>
      acceptServiceRequest(
        db,
        row,
        user,
        7,
        { set: { questData }, claimedAt },
        finishesAt,
      );
    expect((await claim({ ...crafter, updatedAt: new Date(0) })).rowsAffected).toBe(0);
    expect(
      (await claim(crafter, { ...request, requesterId: "another" })).rowsAffected,
    ).toBe(0);
    for (const userId of ["requester", "crafter"]) {
      await db
        .insert(storeUserIdAlias)
        .values({ oldUserId: userId, newUserId: `deleted:${userId}` });
      expect((await claim()).rowsAffected).toBe(0);
      await db.delete(storeUserIdAlias);
    }
    await db
      .update(craftingServiceRequest)
      .set({ requesterId: "crafter" })
      .where(eq(craftingServiceRequest.id, request.id));
    expect(
      (await claim(crafter, { ...request, requesterId: "crafter" })).rowsAffected,
    ).toBe(0);
    await db
      .update(craftingServiceRequest)
      .set({ requesterId: "requester" })
      .where(eq(craftingServiceRequest.id, request.id));
    expect((await receipt()).status).toBe("PENDING");
    expect((await requireUser("requester")).updatedAt).toEqual(requester.updatedAt);
    expect((await requireUser("crafter")).craftingExperience).toBe(
      crafter.craftingExperience,
    );
    expect(
      (
        await acceptServiceRequest(
          db,
          request,
          crafter,
          7,
          {
            set: { questData },
            claimedAt,
            where: [eq(userData.questPartyId, "changed-party")],
          },
          finishesAt,
        )
      ).rowsAffected,
    ).toBe(0);
    expect((await claim()).rowsAffected).toBe(3);
    expect((await claim()).rowsAffected).toBe(0);
    expect((await receipt()).status).toBe("ACTIVE");
    expect((await requireUser("requester")).updatedAt.getTime()).toBeGreaterThan(
      requester.updatedAt.getTime(),
    );
    expect((await requireUser("crafter")).craftingExperience).toBe(
      crafter.craftingExperience + 7,
    );
    expect((await requireUser("crafter")).serviceCraftUntil).toEqual(finishesAt);
    expect((await requireUser("crafter")).questData).toEqual(questData);
    expect((await requireUser("crafter")).updatedAt).toEqual(claimedAt);
  });
  it.each(["CRAFT", "IMBUE", "REPAIR"] as const)(
    "rejects an awake banned requester before submitting %s escrow",
    async (service) => {
      const db = await getTestDatabase();
      await db
        .update(userData)
        .set({ isBanned: true })
        .where(eq(userData.userId, "requester"));
      expect(await submit(service)).toMatchObject({
        success: false,
        message: "You are banned",
      });
      expect((await requireUser("requester")).money).toBe(1000);
      expect(await db.query.craftingServiceRequest.findMany()).toHaveLength(0);
      expect(
        (await db.query.userItem.findFirst({ where: eq(userItem.id, "iron") }))
          ?.quantity,
      ).toBe(20);
      expect(
        (await db.query.userItem.findFirst({ where: eq(userItem.id, "sword") }))
          ?.userId,
      ).toBe("requester");
      expect(
        (await db.query.userItem.findFirst({ where: eq(userItem.id, "gem") }))
          ?.quantity,
      ).toBe(1);
    },
  );
  it("rejects an awake banned crafter before accepting work", async () => {
    await submit();
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ isBanned: true })
      .where(eq(userData.userId, "crafter"));
    expect(await accept()).toMatchObject({ success: false, message: "You are banned" });
    expect((await receipt()).status).toBe("PENDING");
    expect((await requireUser("crafter")).serviceCraftUntil).toBeNull();
    expect((await requireUser("crafter")).craftingExperience).toBe(
      CRAFTING_REQUIRED_EXP.MASTER,
    );
  });
  it("rejects a requester banned after the snapshot without a revision bump", async () => {
    const db = await getTestDatabase();
    let injected = false;
    const observed = beforeTransaction(db, async () => {
      injected = true;
      const before = await requireUser("requester");
      await db
        .update(userData)
        .set({ isBanned: true })
        .where(eq(userData.userId, "requester"));
      expect((await requireUser("requester")).updatedAt).toEqual(before.updatedAt);
    });
    expect(
      await callerForDatabase(
        occupationRouter,
        "requester",
        observed,
      ).submitServiceRequest({
        crafterId: "crafter",
        service: "IMBUE",
        userItemId: "sword",
        userCrystalItemId: "gem",
        expectedFee: 50,
      }),
    ).toMatchObject({ success: false });
    expect(injected).toBe(true);
    expect((await requireUser("requester")).money).toBe(1000);
    expect(await db.query.craftingServiceRequest.findMany()).toHaveLength(0);
    expect(
      (await db.query.userItem.findFirst({ where: eq(userItem.id, "sword") }))?.userId,
    ).toBe("requester");
    expect(
      (await db.query.userItem.findFirst({ where: eq(userItem.id, "gem") }))?.quantity,
    ).toBe(1);
  });
  it.each(["CANCEL", "DECLINE"] as const)(
    "allows a banned actor to %s pending escrow without account hydration",
    async (action) => {
      await submit("IMBUE");
      const db = await getTestDatabase();
      const request = await receipt();
      await db.update(userData).set({ isBanned: true });
      const actor = action === "CANCEL" ? "requester" : "crafter";
      const observed = overrideQuery(db, "userData", {
        findFirst: () => {
          throw new Error("Refunds must not hydrate the actor");
        },
      });
      expect(
        await callerForDatabase(
          occupationRouter,
          actor,
          observed,
        ).respondToServiceRequest({ requestId: request.id, action }),
      ).toMatchObject({ success: true });
      expect((await requireUser("requester")).money).toBe(1000);
      expect(
        (await db.query.userItem.findFirst({ where: eq(userItem.id, "sword") }))
          ?.userId,
      ).toBe("requester");
      expect(
        (
          await db.query.userItem.findMany({
            where: and(
              eq(userItem.userId, "requester"),
              eq(userItem.itemId, "crystal"),
            ),
          })
        ).reduce((sum, row) => sum + row.quantity, 0),
      ).toBe(1);
    },
  );
  it.each(["CANCEL", "DECLINE"] as const)(
    "%s defers unrelated due delivery until profile reconciliation",
    async (action) => {
      await submit();
      const db = await getTestDatabase();
      const request = await receipt();
      await db.insert(craftingServiceRequest).values({
        ...request,
        id: "due-neighbor",
        status: "ACTIVE",
        finishesAt: new Date(Date.now() - 1000),
        fee: 0,
        materials: [],
      });
      const actor = action === "CANCEL" ? "requester" : "crafter";
      expect(
        await (await callerFor(occupationRouter, actor)).respondToServiceRequest({
          requestId: request.id,
          action,
        }),
      ).toMatchObject({ success: true });
      expect((await receipt()).status).toBe("ACTIVE");
      expect((await requireUser("requester")).money).toBe(1000);
      await (await callerFor(profileRouter, actor)).getUser();
      expect(await findOpenServiceRequests(db, actor)).toHaveLength(0);
      expect(
        (
          await db.query.craftingServiceRequest.findFirst({
            where: eq(craftingServiceRequest.id, "due-neighbor"),
          })
        )?.status,
      ).toBe("COMPLETED");
    },
  );
  it.each(["ACCEPT", "DECLINE", "CANCEL"] as const)(
    "rejects %s from the wrong participant",
    async (action) => {
      await submit();
      const request = await receipt();
      const actor = action === "CANCEL" ? "crafter" : "requester";
      expect(
        await (await callerFor(occupationRouter, actor)).respondToServiceRequest({
          requestId: request.id,
          action,
        }),
      ).toMatchObject({ success: false, message: "You cannot manage this request" });
      expect((await receipt()).status).toBe("PENDING");
      expect((await requireUser("requester")).money).toBe(950);
    },
  );
  it("reports a missing accepting actor without claiming escrow", async () => {
    await submit();
    const request = await receipt();
    const db = await getTestDatabase();
    await db.delete(userData).where(eq(userData.userId, "crafter"));
    expect(
      await callerForDatabase(occupationRouter, "crafter", db).respondToServiceRequest({
        requestId: request.id,
        action: "ACCEPT",
      }),
    ).toMatchObject({ success: false, message: "User not found" });
    expect(
      await callerForDatabase(occupationRouter, "crafter", db).respondToServiceRequest({
        requestId: "missing-receipt",
        action: "ACCEPT",
      }),
    ).toMatchObject({
      success: false,
      message: "This request has already been handled",
    });
    expect((await receipt()).status).toBe("PENDING");
    expect((await requireUser("requester")).money).toBe(950);
  });
  it.each(["CANCEL", "DECLINE"] as const)(
    "%s rolls back escrow when the actor account is missing",
    async (action) => {
      await submit();
      const request = await receipt();
      const db = await getTestDatabase();
      const actor = action === "CANCEL" ? "requester" : "crafter";
      await db.delete(userData).where(eq(userData.userId, actor));
      await expect(
        callerForDatabase(occupationRouter, actor, db).respondToServiceRequest({
          requestId: request.id,
          action,
        }),
      ).rejects.toThrow("A service participant changed");
      expect((await receipt()).status).toBe("PENDING");
      expect(await db.query.conversationComment.findMany()).toHaveLength(1);
    },
  );
  it("settles existing escrow when both participants are banned", async () => {
    await submit("IMBUE");
    await accept();
    const request = await due();
    const db = await getTestDatabase();
    await db.update(userData).set({ isBanned: true });
    expect(await completeCraftingService(db, request)).toBe(true);
    expect((await requireUser("crafter")).money).toBe(150);
    expect(
      (await db.query.userItem.findFirst({ where: eq(userItem.id, "sword") }))?.userId,
    ).toBe("requester");
  });

  const seedCraftFollowup = async () => {
    const db = await getTestDatabase();
    await insertQuests([
      {
        id: "unloaded-achievement",
        questType: "achievement",
        content: {
          objectives: [
            AllObjectives.parse({
              id: "saved-counter",
              task: "ranked_wins",
              value: 100,
            }),
          ],
        },
      },
      {
        id: "craft-chain",
        questType: "mission",
        consecutiveObjectives: true,
        maxAttempts: 100,
        maxCompletes: 100,
        content: {
          objectives: [
            AllObjectives.parse({
              id: "craft-one",
              task: "items_crafted",
              value: 1,
              nextObjectiveId: "start-next",
            }),
            AllObjectives.parse({
              id: "start-next",
              task: "new_quest",
              newQuestIds: ["followup"],
            }),
          ],
        },
      },
      {
        id: "followup",
        questType: "story",
        content: {
          objectives: [
            AllObjectives.parse({ id: "later", task: "items_crafted", value: 5 }),
          ],
        },
      },
    ]);
    await insertQuestHistory([
      { userId: "crafter", questId: "craft-chain", questType: "mission" },
    ]);
    await db
      .update(userData)
      .set({
        questData: [
          QuestTracker.parse({
            id: "craft-chain",
            goals: [
              { id: "craft-one", value: 0, done: false },
              { id: "start-next", done: false },
            ],
          }),
          QuestTracker.parse({
            id: "unloaded-achievement",
            goals: [{ id: "saved-counter", value: 3, done: false }],
          }),
        ],
      })
      .where(eq(userData.userId, "crafter"));
  };
  it("starts a follow-up quest once after the atomic service claim and preserves sparse counters", async () => {
    await seedCraftFollowup();
    await submit();
    const request = await receipt();
    const db = await getTestDatabase();
    const arrive = barrier(2);
    const observed = beforeStatements(db, craftingServiceRequest, [arrive, arrive], {
      operations: ["execute"],
    });
    const caller = callerForDatabase(
      occupationRouter,
      "crafter",
      withoutTransactions(observed),
    );
    const results = await Promise.all([
      caller.respondToServiceRequest({ requestId: request.id, action: "ACCEPT" }),
      caller.respondToServiceRequest({ requestId: request.id, action: "ACCEPT" }),
    ]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    const persisted = (await requireUser("crafter")).questData;
    expect(persisted?.find((row) => row.id === "craft-chain")?.goals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "craft-one", value: 1, done: true }),
        expect.objectContaining({ id: "start-next", done: true }),
      ]),
    );
    expect(
      persisted?.find((row) => row.id === "unloaded-achievement")?.goals[0]?.value,
    ).toBe(3);
    const historyBefore = await db.query.questHistory.findMany({
      where: eq(questHistory.questId, "followup"),
    });
    expect(historyBefore).toHaveLength(1);
    const after = await requireUser("crafter");
    expect(
      await caller.respondToServiceRequest({ requestId: request.id, action: "ACCEPT" }),
    ).toMatchObject({ success: false });
    const profile = await callerFor(profileRouter, "crafter");
    await profile.getUser();
    await profile.getUser();
    expect(
      await db.query.questHistory.findMany({
        where: eq(questHistory.questId, "followup"),
      }),
    ).toEqual(historyBefore);
    expect((await requireUser("crafter")).craftingExperience).toBe(
      after.craftingExperience,
    );
  });
  it("persists quest resets supplied by the consequence handler in the acceptance claim", async () => {
    await seedCraftFollowup();
    const db = await getTestDatabase();
    await db
      .update(quest)
      .set({
        content: {
          objectives: [
            AllObjectives.parse({
              id: "craft-one",
              task: "items_crafted",
              value: 1,
              nextObjectiveId: "start-next",
            }),
            AllObjectives.parse({
              id: "start-next",
              task: "reset_quest",
              resetObjectiveId: "craft-one",
            }),
          ],
          reward: ObjectiveReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      })
      .where(eq(quest.id, "craft-chain"));
    await submit();
    expect(await accept()).toMatchObject({ success: true });
    const persisted = (await requireUser("crafter")).questData;
    expect(
      persisted
        ?.find((row) => row.id === "craft-chain")
        ?.goals.some((row) => row.id === "craft-one"),
    ).toBe(false);
    expect((await receipt()).status).toBe("ACTIVE");
    expect(
      await db.query.questHistory.findMany({
        where: eq(questHistory.questId, "followup"),
      }),
    ).toHaveLength(0);
  });
  it.each(["ban", "snapshot"] as const)(
    "publishes no quest effects when the service claim loses a %s race",
    async (race) => {
      await seedCraftFollowup();
      await submit();
      const request = await receipt();
      const db = await getTestDatabase();
      let injected = false;
      const before = await requireUser("crafter");
      const observed = beforeStatements(
        db,
        craftingServiceRequest,
        [
          async () => {
            injected = true;
            const actor = await requireUser("crafter");
            await db
              .update(userData)
              .set(
                race === "ban"
                  ? { isBanned: true }
                  : { updatedAt: nextSnapshotSql(userData.updatedAt) },
              )
              .where(eq(userData.userId, "crafter"));
            if (race === "ban")
              expect((await requireUser("crafter")).updatedAt).toEqual(actor.updatedAt);
          },
        ],
        { operations: ["execute"] },
      );
      const caller = callerForDatabase(
        occupationRouter,
        "crafter",
        withoutTransactions(observed),
      );
      expect(
        await caller.respondToServiceRequest({
          requestId: request.id,
          action: "ACCEPT",
        }),
      ).toMatchObject({ success: false });
      expect(injected).toBe(true);
      expect((await receipt()).status).toBe("PENDING");
      const after = await requireUser("crafter");
      expect(after.serviceCraftUntil).toBeNull();
      expect(after.craftingExperience).toBe(before.craftingExperience);
      expect(after.questData).toEqual(before.questData);
      expect(
        await db.query.questHistory.findMany({
          where: eq(questHistory.questId, "followup"),
        }),
      ).toHaveLength(0);
    },
  );
  it("commits opted-in crafter recovery together with the acceptance slot and progression", async () => {
    await submit();
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ status: "ASLEEP", autoWakeUp: true })
      .where(eq(userData.userId, "crafter"));
    expect(await accept()).toMatchObject({
      success: true,
      actionNotice: "This action woke you up.",
    });
    const crafter = await requireUser("crafter");
    expect(crafter.status).toBe("AWAKE");
    expect(crafter.serviceCraftUntil).toEqual((await receipt()).finishesAt);
    expect(crafter.craftingExperience).toBeGreaterThan(CRAFTING_REQUIRED_EXP.MASTER);
  });
  it("loads idle and pending service desks in one pair of independent reads", async () => {
    const caller = await callerFor(occupationRouter, "requester");
    const empty = await recordQueries(() => caller.getServiceRequests());
    expect(empty.statements).toHaveLength(2);
    expect(empty.roundTrips).toBe(1);
    await submit();
    const pending = await recordQueries(() => caller.getServiceRequests());
    expect(pending.result).toHaveLength(1);
    expect(pending.statements).toHaveLength(2);
    expect(pending.roundTrips).toBe(1);
  });
  it("rereads a due receipt when another reader already won its delivery claim", async () => {
    await submit();
    await accept();
    const request = await due();
    const db = await getTestDatabase();
    let delivered = false;
    const observed = overrideQuery(db, "craftingServiceRequest", {
      findMany: async (read, ...args) => {
        const rows = await read(...args);
        if (
          !delivered &&
          rows.some((row) => row.id === request.id && row.status === "ACTIVE")
        ) {
          delivered = true;
          await completeCraftingService(db, request);
        }
        return rows;
      },
    });
    const rows = await callerForDatabase(
      occupationRouter,
      "requester",
      observed,
    ).getServiceRequests();
    expect(rows.find((row) => row.id === request.id)).toMatchObject({
      status: "COMPLETED",
      settlementError: null,
    });
    expect((await requireUser("crafter")).money).toBe(150);
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
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toContain("completed");
    expect(messages[0]!.content).not.toContain("accept or decline");
    expect(await db.query.conversation.findMany()).toHaveLength(1);
    const recipients = await db.query.user2conversation.findMany();
    expect(recipients.map((row) => row.userId).sort()).toEqual([
      "crafter",
      "requester",
    ]);
    expect((await requireUser("crafter")).inboxNews).toBe(1);
    expect((await requireUser("requester")).inboxNews).toBe(1);
    // The normal comment reader must find a real author instead of dropping the notification.
    const read = await callerFor(commentsRouter, "requester");
    const message = messages.find((row) => row.content.includes("completed"))!;
    const page = await read.getConversationComments({
      convo_id: message.conversationId ?? undefined,
      limit: 20,
    });
    expect(page.data.some((row) => row.content.includes("completed"))).toBe(true);
  });
  it.each(["CRAFT", "IMBUE", "DISIMBUE"] as const)(
    "notifies the crafter to review %s and both participants on completion",
    async (service) => {
      const db = await getTestDatabase();
      if (service === "DISIMBUE")
        await db.insert(userItemImbuement).values({
          id: "imb",
          userItemId: "sword",
          imbuementItemId: "crystal",
          craftingFinishedAt: new Date(0),
        });
      expect(await submit(service)).toMatchObject({ success: true });
      const messages = await db.query.conversationComment.findMany();
      expect(messages).toHaveLength(1);
      expect(messages[0]!.content).toContain("Review the request to accept or decline");
      expect((await requireUser("crafter")).inboxNews).toBe(1);
      expect((await requireUser("requester")).inboxNews).toBe(0);
      expect(await accept()).toMatchObject({ success: true });
      await completeCraftingService(db, await due());
      expect(await db.query.conversationComment.findMany()).toHaveLength(2);
      expect((await requireUser("crafter")).inboxNews).toBe(2);
      expect((await requireUser("requester")).inboxNews).toBe(1);
    },
  );
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
      serviceUpdate: undefined,
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
