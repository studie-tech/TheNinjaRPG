import { readFileSync } from "node:fs";
import { join } from "node:path";
import { waitFor } from "@testing-library/react";
import { MutationObserver, type MutationObserverOptions, QueryClient, QueryObserver, type QueryObserverOptions } from "@tanstack/react-query";
import { describe, expect, it, vi } from "bun:test";
import type { z } from "zod";
import { finishItemConsumeRequest, getItemConsumeErrorMessage } from "@/libs/itemConsumption";
import type { consumeItemInputSchema } from "@/validators/cooking";

const sourceRoot = join(import.meta.dirname, "../../src");
const read = (file: string) => readFileSync(join(sourceRoot, file), "utf8");
const provider = read("app/_trpc/Provider.tsx");
const staleTimeExpression = provider.match(/\bstaleTime:\s*([^,\n]+)/)?.[1];
if (!staleTimeExpression) throw new Error("Provider query staleTime was not found");
const staleTime = new Function(`return (${staleTimeExpression});`)() as number;

/**
 * Pages that list the player's inventory. Items are granted by flows that cannot all invalidate
 * the cache (quest rewards, battle loot, queued jobs, other players' trades), so each page must
 * re-read it when mounted. The options are taken from the source so dropping them fails here.
 */
const inventoryQueries = [
  { file: "app/[shell]/items/page.tsx", procedure: "getUserItemsWithVariants" },
  { file: "app/[shell]/auctionhouse/page.tsx", procedure: "getUserItems" },
  { file: "app/[shell]/auctionhouse/Offers.tsx", procedure: "getUserItems" },
];

const queryOptions = (file: string, procedure: string) => {
  const pattern = new RegExp(
    `api\\.item\\.${procedure}\\.useQuery\\(undefined,\\s*(\\{[\\s\\S]*?\\})\\)`,
  );
  const expression = read(file)
    .match(pattern)?.[1]
    ?.replace(/\/\/.*$/gm, "");
  if (!expression) throw new Error(`${procedure} query options were not found in ${file}`);
  return new Function("userData", `return (${expression});`)({ id: "user" }) as Omit<
    QueryObserverOptions<string[]>,
    "queryKey" | "queryFn"
  >;
};

describe("inventory pages", () => {
  it("refreshes a rejected meal's stale modal snapshot and clears pending state", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime, retry: false } } });
    let quantity = 3;
    let activeMeal = "old meal";
    const inventory = new QueryObserver(client, { queryKey: ["inventory"], queryFn: async () => quantity });
    const profile = new QueryObserver(client, { queryKey: ["profile"], queryFn: async () => activeMeal });
    const unsubscribeInventory = inventory.subscribe(() => {});
    const unsubscribeProfile = profile.subscribe(() => {});
    let isOpen = true;
    let selected: unknown = { item: { itemType: "MEAL" }, quantity: 3 };
    const toast = vi.fn();
    const backpack = read("app/[shell]/items/page.tsx").split("const Backpack:")[1]!;
    const settled = backpack.match(/const onSettled = (\(\) => \{[\s\S]*?\n  \});/)?.[1];
    const callbacks = backpack.match(/api\.item\.consume\.useMutation\((\{[\s\S]*?\n  \})\);/)?.[1];
    if (!settled || !callbacks) throw new Error("Backpack consume callbacks were not found");
    const onSettled = new Function("setIsOpen", "setUserItem", `return (${settled});`)(
      (value: boolean) => { isOpen = value; },
      (value: unknown) => { selected = value; },
    );
    const options = new Function("utils", "useritem", "showMutationToast", "showRewardToast", "onSettled", "finishItemConsumeRequest", "userData", "getItemConsumeErrorMessage", "prepareUserUpdate", "updateUser", `return (${callbacks});`)(
      {
        profile: { getUser: { invalidate: () => client.invalidateQueries({ queryKey: ["profile"] }) } },
        item: { getUserItemsWithVariants: { invalidate: () => client.invalidateQueries({ queryKey: ["inventory"] }) } },
      },
      selected,
      toast,
      vi.fn(),
      onSettled,
      finishItemConsumeRequest,
      { userId: "user" },
      getItemConsumeErrorMessage,
      () => 17, vi.fn(async () => undefined),
    ) as MutationObserverOptions<{ success: boolean; message: string }, Error, z.input<typeof consumeItemInputSchema>>;
    const consume = new MutationObserver(client, { ...options, mutationFn: async () => ({ success: false, message: "Your meal stack changed. Refresh your inventory and try again" }) });
    try {
      await waitFor(() => expect(inventory.getCurrentResult().data).toBe(3));
      await waitFor(() => expect(profile.getCurrentResult().data).toBe("old meal"));
      // Another tab consumes a meal while this modal still holds its earlier quantity.
      quantity = 2;
      activeMeal = "Rice Bowl";
      document.body.style.cursor = "wait";
      await consume.mutate({ userItemId: "meal-stack", expectedQuantity: 3 });

      expect(toast).toHaveBeenCalledWith({ success: false, message: "Your meal stack changed. Refresh your inventory and try again" });
      expect(inventory.getCurrentResult().data).toBe(2);
      expect(profile.getCurrentResult().data).toBe("Rice Bowl");
      expect(consume.getCurrentResult().isPending).toBe(false);
      expect(isOpen).toBe(false);
      expect(selected).toBeUndefined();
      expect(document.body.style.cursor).toBe("default");
    } finally {
      unsubscribeInventory();
      unsubscribeProfile();
      client.clear();
    }
  });

  for (const file of ["app/[shell]/items/page.tsx", "app/[shell]/travel/page.tsx"]) {
    it.each([
      { message: "Internal server error", cache: true, expected: undefined },
      { message: "Invalid input", cache: false, expected: undefined },
      { message: "Failed to fetch", cache: true, expected: "Could not confirm item use. Try Consume again to check the opening." },
      { message: "Failed to fetch", cache: false, expected: "Could not confirm item use. Refresh your inventory to check the result." },
      { message: "Failed to fetch", cache: false, pet: true, expected: "Could not confirm item use. Try Consume again to check the opening." },
    ])(`${file} handles $message for cache: $cache without duplicating global error feedback`, async ({ message, cache, expected, pet = false }) => {
      const source = read(file);
      const callbacks = source.match(/api\.item\.consume\.useMutation\((\{[\s\S]*?\n  \})\);/)?.[1];
      if (!callbacks) throw new Error("Consume callbacks were not found");
      const toast = vi.fn();
      let isOpen = true;
      let selected: unknown = { item: { itemType: cache || pet ? "CONSUMABLE" : "MEAL", effects: cache || pet ? [{ type: "noncombatconsumereward", rewardMode: cache ? "weightedCache" : "standard", reward_pets: pet ? ["fox"] : [] }] : [] } };
      const setIsOpen = (value: boolean) => { isOpen = value; };
      const setUserItem = (value: unknown) => { selected = value; };
      const settled = source.split("const Backpack:")[1]?.match(/const onSettled = (\(\) => \{[\s\S]*?\n  \});/)?.[1];
      const onSettled = settled ? new Function("setIsOpen", "setUserItem", `return (${settled});`)(setIsOpen, setUserItem) : undefined;
      const options = new Function("showMutationToast", "getItemConsumeErrorMessage", "useritem", "onSettled", "setIsOpen", "setUserItem", "prepareUserUpdate", "updateUser", `return (${callbacks});`)(
        toast, getItemConsumeErrorMessage, selected, onSettled, setIsOpen, setUserItem, () => 17, vi.fn(async () => undefined),
      ) as MutationObserverOptions<never, Error, z.input<typeof consumeItemInputSchema>>;
      const client = new QueryClient();
      const error = new Error(message);
      const consume = new MutationObserver(client, { ...options, mutationFn: async () => { throw error; } });
      try {
        await expect(consume.mutate({ userItemId: "selected-item" })).rejects.toBe(error);
        if (expected) {
          expect(toast).toHaveBeenCalledTimes(1);
          expect(toast).toHaveBeenCalledWith({ success: false, message: expected });
        } else expect(toast).not.toHaveBeenCalled();
        expect(consume.getCurrentResult().isPending).toBe(false);
        expect(isOpen).toBe(false);
        expect(selected).toBeUndefined();
      } finally {
        client.clear();
      }
    });
  }

  for (const file of ["app/[shell]/items/page.tsx", "app/[shell]/travel/page.tsx"]) {
    it(`${file} refreshes the companion collection and forwards its generation link after a pet reward`, async () => {
      const callbacks = read(file).match(/api\.item\.consume\.useMutation\((\{[\s\S]*?\n  \})\);/)?.[1];
      if (!callbacks) throw new Error("Consume callbacks were not found");
      const refreshPets = vi.fn(async () => undefined);
      const invalidate = { invalidate: vi.fn(async () => undefined) };
      const rewardToast = vi.fn();
      const utils = { profile: { getUser: invalidate },
        item: { getUserItems: invalidate, getUserItemsWithVariants: invalidate },
        bloodline: { getItemRolls: invalidate }, raids: { getUserRaidBuffs: invalidate },
        pets: { getPet: { invalidate: refreshPets } } };
      const options = new Function("utils", "showRewardToast", "showMutationToast", "finishItemConsumeRequest", "userData", "onSettled", "getItemConsumeErrorMessage", "prepareUserUpdate", "updateUser", `return (${callbacks});`)(
        utils, rewardToast, vi.fn(), vi.fn(), { userId: "recipient" }, vi.fn(), getItemConsumeErrorMessage, () => 17, vi.fn(async () => undefined),
      ) as { onSuccess: (data: unknown, variables: { userItemId: string }) => Promise<void> };
      const petRewards = [{ id: "new-pet", speciesId: "fox", name: "Nami" }];
      await options.onSuccess({ success: true, rewards: {}, message: "Used contract", notifications: [], cacheRewards: [], petRewards }, { userItemId: "contract" });
      expect(refreshPets).toHaveBeenCalledTimes(1);
      expect(rewardToast.mock.calls[0]?.[7]).toEqual(petRewards);
    });
  }

  for (const file of ["app/[shell]/items/page.tsx", "app/[shell]/travel/page.tsx"]) {
    it(`${file} applies confirmed user changes instead of invalidating the profile`, async () => {
      const callbacks = read(file).match(/api\.item\.consume\.useMutation\((\{[\s\S]*?\n  \})\);/)?.[1];
      if (!callbacks) throw new Error("Consume callbacks were not found");
      const invalidate = vi.fn(async () => undefined);
      const updateUser = vi.fn(async () => undefined);
      const prepareUserUpdate = vi.fn(() => 17);
      const invalidateProfile = vi.fn(async () => undefined);
      const leaf = { invalidate };
      const utils = { profile: { getUser: { invalidate: invalidateProfile } }, item: { getUserItems: leaf, getUserItemsWithVariants: leaf }, bloodline: { getItemRolls: leaf }, raids: { getUserRaidBuffs: leaf } };
      const options = new Function("utils", "showRewardToast", "showMutationToast", "finishItemConsumeRequest", "userData", "onSettled", "getItemConsumeErrorMessage", "prepareUserUpdate", "updateUser", `return (${callbacks});`)(
        utils, vi.fn(), vi.fn(), vi.fn(), { userId: "recipient" }, vi.fn(), getItemConsumeErrorMessage, prepareUserUpdate, updateUser,
      ) as { onMutate: () => number; onSuccess: (data: unknown, variables: { userItemId: string }, revision: number) => Promise<void> };
      const userPatch = { curHealth: 50 };
      const userDelta = {};
      await options.onSuccess({ success: true, message: "Healed", userPatch, userDelta }, { userItemId: "potion" }, options.onMutate());
      expect(updateUser).toHaveBeenCalledWith(userPatch, { revision: 17, delta: userDelta, achievementProgress: undefined });
      expect(prepareUserUpdate).toHaveBeenCalledTimes(1);
      expect(invalidate).toHaveBeenCalledTimes(3);
      expect(invalidateProfile).not.toHaveBeenCalled();
    });
  }

  for (const { file, procedure } of inventoryQueries) {
    it(`${file} shows items obtained since its last visit`, async () => {
      const client = new QueryClient({ defaultOptions: { queries: { staleTime, retry: false } } });
      let inventory = ["Kunai"];
      let reads = 0;
      const mount = () =>
        new QueryObserver<string[]>(client, {
          ...queryOptions(file, procedure),
          queryKey: [["item", procedure], { type: "query" }],
          queryFn: async () => {
            reads++;
            return [...inventory];
          },
        });
      let observer = mount();
      let unsubscribe = observer.subscribe(() => {});
      try {
        await waitFor(() => expect(observer.getCurrentResult().data).toEqual(["Kunai"]));
        unsubscribe();

        // A quest reward lands while the player is elsewhere, without touching this cache.
        inventory = ["Kunai", "Quest Reward Scroll"];

        observer = mount();
        unsubscribe = observer.subscribe(() => {});
        await waitFor(() =>
          expect(observer.getCurrentResult().data).toEqual(["Kunai", "Quest Reward Scroll"]),
        );
        expect(reads).toBe(2);
      } finally {
        unsubscribe();
        client.clear();
      }
    });
  }
});

describe("item-granting flows", () => {
  it.each([false, true])("location checks refresh observed inventory only when itemsChanged is %s", async (itemsChanged) => {
    const callbacks = read("layout/Sector.tsx").match(/api\.quests\.checkLocationQuest\.useMutation\((\{[\s\S]*?\n  \})\);/)?.[1];
    if (!callbacks) throw new Error("Location quest callbacks were not found");
    const client = new QueryClient({ defaultOptions: { queries: { staleTime, retry: false } } });
    const reads = [vi.fn(async () => ["Kunai"]), vi.fn(async () => ["Kunai variant"])];
    const observers = reads.map((queryFn, index) => new QueryObserver(client, { queryKey: ["inventory", index], queryFn }));
    const unsubscribe = observers.map((observer) => observer.subscribe(() => {}));
    const updateUser = vi.fn(async () => undefined);
    const options = new Function("utils", "updateUser", `return (${callbacks});`)(
      { item: {
        getUserItems: { invalidate: () => client.invalidateQueries({ queryKey: ["inventory", 0] }) },
        getUserItemsWithVariants: { invalidate: () => client.invalidateQueries({ queryKey: ["inventory", 1] }) },
      } },
      updateUser,
    ) as { onSuccess: (result: unknown) => Promise<void> };
    try {
      await waitFor(() => observers.forEach((observer) => expect(observer.getCurrentResult().data).toBeDefined()));
      const updateAt = new Date();
      await options.onSuccess({ success: true, itemsChanged, notifications: [], questData: [], updateAt });
      reads.forEach((read) => expect(read).toHaveBeenCalledTimes(itemsChanged ? 2 : 1));
      expect(updateUser).toHaveBeenCalledWith({ questData: [], updatedAt: updateAt });
    } finally {
      unsubscribe.forEach((stop) => stop());
      client.clear();
    }
  });

  const userItemCaches = ["getUserItems", "getUserItemsWithVariants"];
  const flows = [
    { file: "layout/Logbook.tsx", flow: "quests.checkRewards" },
    { file: "layout/RewardChoice.tsx", flow: "quests.claimRewardChoice" },
    { file: "layout/Sector.tsx", flow: "quests.checkLocationQuest" },
    { file: "layout/Combat.tsx", flow: "battle end" },
  ];
  for (const { file, flow } of flows) {
    it(`${flow} invalidates both user item caches`, () => {
      const source = read(file);
      for (const cache of userItemCaches) {
        expect(source).toContain(`utils.item.${cache}.invalidate()`);
      }
    });
  }
});
