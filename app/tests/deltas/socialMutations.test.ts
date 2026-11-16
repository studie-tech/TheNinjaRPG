import { describe, expect, it } from "bun:test";
import type { RouterOutputs } from "@/app/_trpc/client";
import {
  getBidAuctionListing,
  getBidAuctionListings,
  getPlaceBidUserUpdate,
  getPlacedBid,
} from "@/deltas/auction";
import {
  getCraftedInventory,
  getCraftedVariantInventory,
  getCraftItemCacheUpdate,
  getCraftingTimers,
  getQueuedCrafts,
} from "@/deltas/occupation";
import { getFeedPetUserUpdate, getPetOwnerProgress } from "@/deltas/pets";
import {
  getPurchasedFolderStats,
  getPurchasedSkill,
  getPurchasedUserSkills,
} from "@/deltas/skillTree";
import type { Item, UserItem } from "@/drizzle/schema";
import { toCraftingQueueEntry } from "@/libs/crafting";

const at = new Date("2026-11-16T12:00:00.000Z");

describe("auction bid reconciliation", () => {
  const bidder = { userId: "viewer", username: "Viewer", avatar: null };
  const placed = getPlacedBid({
    auction: { id: "lot", currentPrice: 100 },
    existingBid: undefined,
    bidId: "bid-new",
    bidder,
    amount: 250,
    updatedAt: at,
  });
  const detail = {
    id: "lot",
    status: "ACTIVE",
    currentPrice: 100,
    updatedAt: new Date(0),
    bids: [
      {
        id: "bid-old",
        auctionId: "lot",
        bidderId: "rival",
        amount: 100,
        status: "ACTIVE",
        createdAt: new Date(0),
        bidder: { userId: "rival", username: "Rival", avatar: null },
      },
    ],
  } as unknown as NonNullable<RouterOutputs["auction"]["getAuctionListing"]>;
  const pages = (row: object) => ({
    pageParams: [0, 1],
    pages: [
      {
        data: [{ id: "other", status: "ACTIVE", currentPrice: 5, bids: [] }],
        nextCursor: 1,
      },
      { data: [row], nextCursor: null },
    ],
  });
  const listed = { id: "lot", status: "ACTIVE", currentPrice: 100, bids: [] };

  it("debits the raise from the listing's currency", () => {
    expect(
      getPlaceBidUserUpdate({ currencyType: "MONEY", amountToDeduct: 40 }),
    ).toEqual({
      userDelta: { bank: -40 },
    });
    expect(
      getPlaceBidUserUpdate({ currencyType: "REPUTATION", amountToDeduct: 40 }),
    ).toEqual({ userDelta: { reputationPoints: -40 } });
  });

  it("adds a first bid as the newest one and raises an existing bid in place", () => {
    const updated = getBidAuctionListing(detail, placed);
    expect(updated?.currentPrice).toBe(250);
    expect(updated?.updatedAt).toBe(at);
    expect(updated?.bids.map((bid) => [bid.id, bid.amount])).toEqual([
      ["bid-new", 250],
      ["bid-old", 100],
    ]);
    expect(updated?.bids[0]).toEqual({
      ...placed.bid,
      createdAt: at,
      bidder,
    } as never);
    const raise = getPlacedBid({
      auction: { id: "lot", currentPrice: 100 },
      existingBid: detail!.bids[0] as never,
      bidId: "bid-old",
      bidder,
      amount: 300,
      updatedAt: at,
    });
    expect(raise.bid.createdAt).toEqual(new Date(0));
    expect(
      getBidAuctionListing(detail, raise)?.bids.map((bid) => [bid.id, bid.amount]),
    ).toEqual([["bid-old", 300]]);
  });

  it("reads the listing again when its price, status or identity changed", () => {
    expect(
      getBidAuctionListing({ ...detail!, currentPrice: 120 }, placed),
    ).toBeUndefined();
    expect(
      getBidAuctionListing({ ...detail!, status: "SOLD" }, placed),
    ).toBeUndefined();
    expect(getBidAuctionListing({ ...detail!, id: "else" }, placed)).toBeUndefined();
    expect(getBidAuctionListing(null, placed)).toBeUndefined();
    expect(getBidAuctionListing(detail, undefined)).toBeUndefined();
  });

  it("patches the listing on any loaded page and leaves other rows untouched", () => {
    const current = pages(listed) as never;
    const updated = getBidAuctionListings(current, placed, {});
    expect(updated?.pages[1]?.data[0]).toEqual({
      ...listed,
      currentPrice: 250,
      updatedAt: at,
      bids: [placed.bid],
    } as never);
    expect(updated?.pages[0]).toEqual(
      (current as ReturnType<typeof pages>).pages[0] as never,
    );
    // A listing outside the loaded pages has nothing to patch.
    const unrelated = pages({ ...listed, id: "absent" }) as never;
    expect(getBidAuctionListings(unrelated, placed, {})).toEqual(unrelated);
  });

  it("reads the search again for a stale row or a price outside its range", () => {
    expect(
      getBidAuctionListings(
        pages({ ...listed, currentPrice: 150 }) as never,
        placed,
        {},
      ),
    ).toBeUndefined();
    expect(
      getBidAuctionListings(pages(listed) as never, placed, { maxPrice: 200 }),
    ).toBeUndefined();
    expect(
      getBidAuctionListings(pages(listed) as never, placed, { minPrice: 300 }),
    ).toBeUndefined();
    expect(
      getBidAuctionListings(pages(listed) as never, placed, {
        minPrice: 50,
        maxPrice: 300,
      }),
    ).toBeDefined();
    expect(
      getBidAuctionListings(pages(listed) as never, undefined, {}),
    ).toBeUndefined();
  });
});

describe("craft reconciliation", () => {
  const item = { id: "kit", name: "Repair Kit", image: "kit.webp" } as Item;
  const material = { id: "ore", itemId: "copper", quantity: 10 };
  const crafted = {
    id: "made",
    itemId: "kit",
    quantity: 1,
    createdAt: at,
    craftingFinishedAt: new Date(at.getTime() + 60_000),
  } as UserItem;
  const settled = { craftingItemsChanged: false, startedQueuedJobs: 0 };
  const build = (
    overrides: Partial<Parameters<typeof getCraftItemCacheUpdate>[0]> = {},
  ) =>
    getCraftItemCacheUpdate({
      updatedUser: settled,
      restoredStaleClaims: false,
      useritems: [material],
      allConsumptions: [{ userItemId: "ore", newQuantity: 6 }],
      craftedItems: [crafted],
      item,
      ...overrides,
    });
  const inventory = [
    { ...material, item: { name: "Copper" } },
    { id: "spare", itemId: "copper", quantity: 4, item: { name: "Copper" } },
  ] as unknown as RouterOutputs["item"]["getUserItems"];

  it("withholds the projection when the request settled queued crafts or restored claims", () => {
    expect(build()).toBeDefined();
    expect(
      build({ updatedUser: { craftingItemsChanged: true, startedQueuedJobs: 0 } }),
    ).toBeUndefined();
    expect(
      build({ updatedUser: { craftingItemsChanged: false, startedQueuedJobs: 1 } }),
    ).toBeUndefined();
    expect(build({ restoredStaleClaims: true })).toBeUndefined();
  });

  it("takes the materials and adds the started stack with its inventory relations", () => {
    const update = build();
    const updated = getCraftedInventory(inventory, update);
    expect(updated?.map((row) => [row.id, row.quantity])).toEqual([
      ["ore", 6],
      ["spare", 4],
      ["made", 1],
    ]);
    expect(updated?.[2]).toEqual({
      ...crafted,
      item,
      activeVariant: null,
      imbuements: [],
    } as never);
    // An emptied stack leaves the inventory.
    const emptied = build({ allConsumptions: [{ userItemId: "ore", newQuantity: 0 }] });
    expect(getCraftedInventory(inventory, emptied)?.map((row) => row.id)).toEqual([
      "spare",
      "made",
    ]);
    // A stack that changed since the craft read it requires a read.
    const changed = [{ ...inventory[0]!, quantity: 9 }, inventory[1]!];
    expect(getCraftedInventory(changed, update)).toBeUndefined();
    expect(getCraftedInventory(inventory, undefined)).toBeUndefined();
  });

  it("updates the variant view only when no stack started", () => {
    const variants =
      inventory as unknown as RouterOutputs["item"]["getUserItemsWithVariants"];
    expect(getCraftedVariantInventory(variants, build())).toBeUndefined();
    expect(
      getCraftedVariantInventory(variants, build({ craftedItems: [] }))?.map((row) => [
        row.id,
        row.quantity,
      ]),
    ).toEqual([
      ["ore", 6],
      ["spare", 4],
    ]);
  });

  it("appends a waiting craft and leaves the queue alone for a started one", () => {
    const entry = toCraftingQueueEntry({
      id: "queued",
      itemId: "kit",
      quantity: 2,
      durationSeconds: 60,
      startsAt: at,
      finishesAt: new Date(at.getTime() + 60_000),
      materials: [
        {
          userItemId: "ore",
          itemId: "copper",
          name: "Copper",
          quantity: 3,
          storedAtHome: false,
        },
        {
          userItemId: "spare",
          itemId: "copper",
          name: "Copper",
          quantity: 1,
          storedAtHome: false,
        },
      ],
      item,
    });
    expect(entry.materials).toEqual([{ name: "Copper", quantity: 4 }]);
    const queue = { capacity: 2, waiting: [] };
    const queued = build({ craftedItems: [], queuedCraft: entry });
    expect(getQueuedCrafts(queue, queued)).toEqual({ capacity: 2, waiting: [entry] });
    expect(getQueuedCrafts({ capacity: 2, waiting: [entry] }, queued)).toBeUndefined();
    expect(getQueuedCrafts(queue, build())).toBe(queue);
    expect(getQueuedCrafts(queue, undefined)).toBeUndefined();
  });

  it("shows a started craft as the running timer", () => {
    const timers = {
      jutsuTraining: null,
      jutsuQueue: { count: 0, next: null },
      crafting: null,
      imbuement: null,
    } as unknown as RouterOutputs["profile"]["getSidebarTimers"];
    expect(getCraftingTimers(timers, build())?.crafting).toEqual({
      itemName: "Repair Kit",
      craftingStartedAt: at,
      craftingFinishedAt: crafted.craftingFinishedAt!,
    });
    const queued = build({
      craftedItems: [],
      queuedCraft: { id: "queued" } as never,
    });
    expect(getCraftingTimers(timers, queued)).toBe(timers);
    expect(getCraftingTimers(timers, undefined)).toBeUndefined();
  });
});

describe("skill purchase reconciliation", () => {
  const skill = { id: "s1", folderId: "f1", costSkillPoints: 3 } as never;
  const owned = {
    skills: [],
    activatedSkillIds: [],
    activatedSkillCount: 0,
    usedSkillPoints: 2,
  } as RouterOutputs["skillTree"]["getUserSkills"];
  const purchase = getPurchasedSkill({
    existingUserSkill: undefined,
    skill,
    userSkillId: "row",
    userId: "u",
    purchasedAt: at,
  });

  it("adds a purchased skill and counts its points", () => {
    expect(purchase).toEqual({
      id: "row",
      userId: "u",
      skillId: "s1",
      purchasedAt: at,
      activated: true,
      skill,
    });
    expect(getPurchasedUserSkills(owned, purchase)).toEqual({
      skills: [purchase],
      activatedSkillIds: ["s1"],
      activatedSkillCount: 1,
      usedSkillPoints: 5,
    });
  });

  it("activates an unlocked skill in place and reads an already active one again", () => {
    const unlocked = { ...purchase, id: "kept", activated: false };
    const activation = getPurchasedSkill({
      existingUserSkill: unlocked,
      skill,
      userSkillId: "unused",
      userId: "u",
      purchasedAt: at,
    });
    expect(activation).toEqual({ ...unlocked, activated: true });
    const withUnlocked = { ...owned, skills: [unlocked] };
    expect(getPurchasedUserSkills(withUnlocked, activation)?.skills).toEqual([
      activation,
    ]);
    expect(
      getPurchasedUserSkills({ ...owned, activatedSkillIds: ["s1"] }, purchase),
    ).toBeUndefined();
    expect(getPurchasedUserSkills(owned, undefined)).toBeUndefined();
  });

  it("counts the activation in its folder and reads an unlisted folder again", () => {
    const stats = [
      {
        folderId: "f1",
        folderName: "One",
        folderImage: "",
        totalSkills: 4,
        ownedSkills: 1,
      },
      {
        folderId: "f2",
        folderName: "Two",
        folderImage: "",
        totalSkills: 2,
        ownedSkills: 0,
      },
    ];
    expect(
      getPurchasedFolderStats(stats, purchase)?.map((row) => row.ownedSkills),
    ).toEqual([2, 0]);
    const loose = { ...purchase, skill: { ...purchase.skill, folderId: null } };
    expect(getPurchasedFolderStats(stats, loose)).toBeUndefined();
    expect(
      getPurchasedFolderStats(
        [...stats, { ...stats[0]!, folderId: "", ownedSkills: 0 }],
        loose,
      )?.at(-1)?.ownedSkills,
    ).toBe(1);
  });
});

describe("pet feeding reconciliation", () => {
  it("takes the eaten meal from its guarded stack", () => {
    const update = getFeedPetUserUpdate({
      userUpdatedAt: new Date(at.getTime() - 1000),
      now: at,
      isActive: true,
      experience: 500,
      meal: { id: "meal", itemId: "rice", quantity: 2 },
    });
    expect(update.inventoryChanges).toEqual([
      { id: "meal", itemId: "rice", beforeQuantity: 2, quantity: 1 },
    ]);
    expect(update.userDelta).toEqual({ petExperience: 500 });
  });

  it("projects the owner progress a pet mutation leaves in the profile cache", () => {
    const current: Parameters<typeof getPetOwnerProgress>[0] = [1, 10, 20, 30];
    expect(
      getPetOwnerProgress(current, {
        userPatch: { updatedAt: new Date(5) },
        userDelta: { petExperience: 500 },
      }),
    ).toEqual([5, 10, 20, 530]);
    expect(
      getPetOwnerProgress(current, { userPatch: { petExperience: 7, experience: 11 } }),
    ).toEqual([1, 11, 20, 7]);
    expect(
      getPetOwnerProgress([1, 10, 20, undefined], { userDelta: { petExperience: 3 } }),
    ).toEqual([1, 10, 20, undefined]);
  });
});
