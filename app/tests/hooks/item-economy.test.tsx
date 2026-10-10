import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as client from "@/app/_trpc/client";
import type { Item } from "@/drizzle/schema";
import { useItemEditForm } from "@/hooks/item";
import { ItemValidator } from "@/validators/combat";
import { ensureDom } from "../setup-dom.mjs";

ensureDom();
const validItem = ItemValidator.parse({
  name: "Shop item",
  image: "item.webp",
  description: "Shop item",
  battleDescription: "",
  stackSize: 10,
  chakraCost: 0,
  healthCost: 0,
  staminaCost: 0,
  healthCostReducePerLvl: 0,
  chakraCostReducePerLvl: 0,
  staminaCostReducePerLvl: 0,
  actionCostPerc: 100,
  maxImbueNumber: 1,
  maxDurability: 100,
  hidden: false,
  cooldown: 0,
  cost: 1,
  repsCost: 0,
  seichiSilverCost: 0,
  range: 0,
  maxEquips: 0,
  method: "SINGLE",
  target: "SELF",
  itemType: "MATERIAL",
  weaponType: "NONE",
  rarity: "COMMON",
  slot: "NONE",
  expireFromStoreAt: null,
  effects: [],
  farmYieldItemId: null,
  farmExtractSeedItemId: null,
  crystalTargetTypes: null,
  bloodlineId: null,
});
const data = {
  ...validItem,
  id: "shop-item",
  createdAt: new Date(),
  updatedAt: new Date(),
  craftingRequirements: [],
} as Item & { craftingRequirements: [] };

beforeEach(() => {
  Object.assign(vi.spyOn(client, "api" as never), {
    item: {
      getAllNames: { useQuery: () => ({ data: [] }) },
      update: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
    bloodline: { getAllNames: { useQuery: () => ({ data: [] }) } },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("staff item economy editor", () => {
  it("starts unrestricted and places fields beside shop/trading settings", () => {
    const { result } = renderHook(() => useItemEditForm(data, async () => undefined));
    expect(result.current.form.getValues("purchaseLimitPeriod")).toBe("NONE");
    expect(result.current.form.getValues("purchaseLimit")).toBeNull();
    expect(result.current.form.getValues("auctionMinPrice")).toBeNull();
    expect(result.current.form.getValues("auctionMaxPrice")).toBeNull();
    const ids = result.current.formData.map((field) => field.id);
    expect(ids.slice(ids.indexOf("inShop"), ids.indexOf("inShop") + 3)).toEqual([
      "inShop",
      "purchaseLimitPeriod",
      "purchaseLimit",
    ]);
    expect(
      ids.slice(ids.indexOf("canBeTraded"), ids.indexOf("canBeTraded") + 3),
    ).toEqual(["canBeTraded", "auctionMinPrice", "auctionMaxPrice"]);
  });
  it("requires quantity for a limited period and allows clearing bounds", async () => {
    const { result } = renderHook(() => useItemEditForm(data, async () => undefined));
    await act(async () => {
      result.current.form.setValue("purchaseLimitPeriod", "DAILY");
      await result.current.form.trigger("purchaseLimit");
    });
    expect(result.current.form.getFieldState("purchaseLimit").error?.message).toContain(
      "requires a quantity",
    );
    await act(async () => {
      result.current.form.setValue("purchaseLimit", 5);
      result.current.form.setValue("auctionMinPrice", "");
      result.current.form.setValue("auctionMaxPrice", "");
      await result.current.form.trigger();
    });
    expect(result.current.form.getFieldState("purchaseLimit").error).toBeUndefined();
    expect(result.current.form.getFieldState("auctionMinPrice").error).toBeUndefined();
    expect(result.current.form.getFieldState("auctionMaxPrice").error).toBeUndefined();
  });
});
