import { describe, expect, it } from "bun:test";
import type { UserData, UserItemWithRelations } from "@/drizzle/schema";
import { getInventoryBucketCapacity } from "@/libs/item";
import {
  homeStorageBlockReason,
  homeStorageMoveBlockReason,
  homeStorageMoveMessage,
  planHomeStorageMove,
} from "@/libs/itemsPage";

const row = (
  id: string,
  overrides: Partial<UserItemWithRelations> = {},
  item: Partial<UserItemWithRelations["item"]> = {},
) =>
  ({
    id,
    quantity: 1,
    equipped: "NONE",
    storedAtHome: false,
    isInAuction: false,
    ...overrides,
    item: { name: id, itemType: "WEAPON", isEventItem: false, ...item },
  }) as unknown as UserItemWithRelations;

const user = {
  federalStatus: "NONE",
  extraItemSlots: 0,
  anbuId: null,
} as unknown as UserData;

describe("homeStorageBlockReason", () => {
  const atHome = { sector: 7, status: "AWAKE", village: { sector: 7 } } as const;

  it("lets a player awake or asleep in their own village use home storage", () => {
    expect(homeStorageBlockReason(atHome)).toBeNull();
    expect(homeStorageBlockReason({ ...atHome, status: "ASLEEP" })).toBeNull();
  });

  it("sends a player elsewhere back to their village", () => {
    const message = "Return to your own village to use your home storage";
    expect(homeStorageBlockReason({ ...atHome, sector: 8 })).toBe(message);
    expect(homeStorageBlockReason({ ...atHome, village: null })).toBe(message);
  });

  it("refuses while travelling, fighting, queued or in hospital", () => {
    for (const status of ["TRAVEL", "BATTLE", "QUEUED", "HOSPITALIZED"] as const) {
      expect(homeStorageBlockReason({ ...atHome, status })).toBe(
        "You cannot use your home storage right now",
      );
    }
  });
});

describe("planHomeStorageMove", () => {
  it("names the backpack slots held by listings when a withdrawal does not fit", () => {
    const capacity = getInventoryBucketCapacity("normal", user);
    const rows = [
      ...Array.from({ length: capacity }, (_, index) =>
        row(`carried-${index}`, { isInAuction: index < 2 }),
      ),
      row("stored", { storedAtHome: true }),
    ];
    const plan = planHomeStorageMove({
      rows,
      userItemIds: ["stored"],
      toHome: false,
      user,
      homeStorage: 12,
    });
    expect(plan.refused).toEqual([
      {
        userItemId: "stored",
        name: "stored",
        reason:
          "does not fit: Inventory is full (2 slots are held by auction listings or trade offers)",
      },
    ]);
  });

  it("names the backpack slots held by unfinished crafts when a withdrawal does not fit", () => {
    const capacity = getInventoryBucketCapacity("normal", user);
    const rows = [
      ...Array.from({ length: capacity }, (_, index) =>
        row(`carried-${index}`, {
          craftingFinishedAt: index < 1 ? new Date(Date.now() + 3_600_000) : null,
        }),
      ),
      row("stored", { storedAtHome: true }),
    ];
    const plan = planHomeStorageMove({
      rows,
      userItemIds: ["stored"],
      toHome: false,
      user,
      homeStorage: 12,
    });
    expect(plan.refused[0]?.reason).toBe(
      "does not fit: Inventory is full (1 slot is held by an unfinished craft)",
    );
  });

  it("stores carried stacks until their home bucket is full, in request order", () => {
    // A 12-slot home holds 12 items and 2 materials.
    const rows = [
      row("ore-stored", { storedAtHome: true }, { itemType: "MATERIAL" }),
      row("ore-a", {}, { itemType: "MATERIAL" }),
      row("ore-b", {}, { itemType: "MATERIAL" }),
      row("sword"),
    ];
    const plan = planHomeStorageMove({
      rows,
      userItemIds: ["ore-a", "ore-b", "sword"],
      toHome: true,
      user,
      homeStorage: 12,
    });
    expect(plan.moving.map((ui) => ui.id)).toEqual(["ore-a", "sword"]);
    expect(plan.refused).toEqual([
      {
        userItemId: "ore-b",
        name: "ore-b",
        reason: "does not fit: Your home materials storage is full",
      },
    ]);
  });

  it("takes stored stacks out until their backpack bucket is full", () => {
    const max = getInventoryBucketCapacity("normal", user);
    const carried = Array.from({ length: max - 1 }, (_, index) =>
      row(`carried-${index}`),
    );
    const rows = [
      ...carried,
      row("a", { storedAtHome: true }),
      row("b", { storedAtHome: true }),
    ];
    const plan = planHomeStorageMove({
      rows,
      userItemIds: ["a", "b"],
      toHome: false,
      user,
      homeStorage: 12,
    });
    expect(plan.moving.map((ui) => ui.id)).toEqual(["a"]);
    expect(plan.refused).toEqual([
      { userItemId: "b", name: "b", reason: "does not fit: Inventory is full" },
    ]);
  });

  it.each([
    [{ isInAuction: true }, "an auction listing or trade offer"],
    [{ craftingFinishedAt: new Date(Date.now() + 3_600_000) }, "an unfinished craft"],
  ] as const)("counts a held stack withdrawn earlier in the batch (%j)", (held, by) => {
    const capacity = getInventoryBucketCapacity("normal", user);
    const rows = [
      ...Array.from({ length: capacity - 1 }, (_, index) => row(`carried-${index}`)),
      row("held", { storedAtHome: true, ...held }),
      row("stored", { storedAtHome: true }),
    ];
    const plan = planHomeStorageMove({
      rows,
      userItemIds: ["held", "stored"],
      toHome: false,
      user,
      homeStorage: 12,
    });
    expect(plan.moving.map((ui) => ui.id)).toEqual(["held"]);
    expect(plan.refused[0]?.reason).toBe(
      `does not fit: Inventory is full (1 slot is held by ${by})`,
    );
    expect(rows.find((ui) => ui.id === "held")?.storedAtHome).toBe(true);
  });

  it("refuses stacks that cannot move and names why", () => {
    const rows = [
      row("worn", { equipped: "HAND_1" }),
      row("listed", { isInAuction: true }),
      row("chair", {}, { itemType: "FURNITURE" }),
      row("kept", { storedAtHome: true }),
    ];
    const plan = planHomeStorageMove({
      rows,
      userItemIds: ["worn", "listed", "chair", "kept", "gone"],
      toHome: true,
      user,
      homeStorage: 12,
    });
    expect(plan.moving).toEqual([]);
    expect(plan.refused.map(({ userItemId, reason }) => [userItemId, reason])).toEqual([
      ["worn", "is equipped"],
      ["listed", "is reserved in an auction or trade offer"],
      ["chair", "is furniture; manage it from your home"],
      ["kept", "is already in your home storage"],
      ["gone", "is not in your inventory"],
    ]);
  });

  it("lets a reserved stack be taken out", () => {
    const plan = planHomeStorageMove({
      rows: [row("listed", { isInAuction: true, storedAtHome: true })],
      userItemIds: ["listed"],
      toHome: false,
      user,
      homeStorage: 12,
    });
    expect(plan.moving.map((ui) => ui.id)).toEqual(["listed"]);
  });
});

describe("homeStorageMoveMessage", () => {
  it("counts what moved and names what stayed", () => {
    expect(homeStorageMoveMessage(3, true, [])).toBe("Stored 3 items in your home.");
    expect(homeStorageMoveMessage(1, false, [])).toBe("Took 1 item out of your home.");
    expect(
      homeStorageMoveMessage(0, true, [{ name: "Ore", reason: "is equipped" }]),
    ).toBe("Nothing was moved. 1 stayed: Ore is equipped.");
  });
});

describe("homeStorageMoveBlockReason", () => {
  it("names why one stack cannot move as a sentence, keeping the message's casing", () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      row(`kept-${index}`, { storedAtHome: true }),
    );
    const input = { rows: [...rows, row("sword")], user, homeStorage: 12 };
    expect(
      homeStorageMoveBlockReason({ ...input, userItemId: "sword", toHome: true }),
    ).toBe("Does not fit: Your home storage is full");
    expect(
      homeStorageMoveBlockReason({ ...input, userItemId: "kept-0", toHome: false }),
    ).toBeNull();
  });
});
