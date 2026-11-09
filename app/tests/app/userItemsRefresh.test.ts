import { describe, expect, it, vi } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MutationObserver,
  type MutationObserverOptions,
  QueryClient,
  QueryObserver,
  type QueryObserverOptions,
} from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import type { RouterInputs } from "@/app/_trpc/client";
import { getConsumedRaidBuffs, getInventoryQuantities } from "@/deltas/item";
import {
  finishItemConsumeRequest,
  getItemConsumeErrorMessage,
} from "@/libs/itemConsumption";
import { prepareQueryUpdate, updateQueryCache } from "@/utils/queryCache";

const sourceRoot = join(import.meta.dirname, "../../src");
const read = (file: string) => readFileSync(join(sourceRoot, file), "utf8");
/** Execute the production effect controller while callback tests supply their observed-query seams. */
const consumptionController = (utils: any) => {
  const transpiler = new (require("bun").Transpiler)({ loader: "ts" }) as {
    transformSync(source: string): string;
  };
  const source = transpiler.transformSync(
    read("hooks/useItemConsumptionCacheUpdate.ts"),
  );
  const start = source.indexOf("const updateConsumption =");
  const end = source.indexOf("return {", source.indexOf("  };", start) + 4);
  if (start < 0 || end < 0) throw new Error("Consumption controller was not found");
  return new Function(
    "utils",
    "inventory",
    "buffs",
    "getInventoryQuantities",
    "getConsumedRaidBuffs",
    `${source.slice(start, end)}; return updateConsumption;`,
  )(
    utils,
    {
      updateInventory: () =>
        Promise.all([
          utils.item?.getUserItems?.invalidate(),
          utils.item?.getUserItemsWithVariants?.invalidate(),
        ]),
    },
    { updateCache: () => utils.raids?.getUserRaidBuffs?.invalidate() },
    getInventoryQuantities,
    getConsumedRaidBuffs,
  );
};
/** Provide callback snapshots for the controller's observed-query test bindings. */
const prepareConsumptionUpdate = () => ({ inventory: {}, buffs: {} });

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
  { file: "app/[shell]/auctionhouse/NewListingDialog.tsx", procedure: "getUserItems" },
  { file: "app/[shell]/auctionhouse/Offers.tsx", procedure: "getUserItems" },
];

const queryOptions = (file: string, procedure: string) => {
  const pattern = new RegExp(
    `api\\.item\\.${procedure}\\.useQuery\\(undefined,\\s*(\\{[\\s\\S]*?\\})\\)`,
  );
  const expression = read(file)
    .match(pattern)?.[1]
    ?.replace(/\/\/.*$/gm, "");
  if (!expression)
    throw new Error(`${procedure} query options were not found in ${file}`);
  return new Function("userData", `return (${expression});`)({ id: "user" }) as Omit<
    QueryObserverOptions<string[]>,
    "queryKey" | "queryFn"
  >;
};

describe("inventory pages", () => {
  it("refreshes a rejected meal's stale modal snapshot and clears pending state", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime, retry: false } },
    });
    let quantity = 3;
    let activeMeal = "old meal";
    const inventory = new QueryObserver(client, {
      queryKey: ["inventory"],
      queryFn: async () => quantity,
    });
    const profile = new QueryObserver(client, {
      queryKey: ["profile"],
      queryFn: async () => activeMeal,
    });
    const unsubscribeInventory = inventory.subscribe(() => {});
    const unsubscribeProfile = profile.subscribe(() => {});
    let isOpen = true;
    let selected: unknown = { item: { itemType: "MEAL" }, quantity: 3 };
    const toast = vi.fn();
    const backpack = read("hooks/useItemActions.ts");
    const settled = backpack.match(
      /const onSettled = (\(\) => \{[\s\S]*?\n  \});/,
    )?.[1];
    const callbacks = backpack.match(
      /api\.item\.consume\.useMutation\((\{[\s\S]*?\n  \})\);/,
    )?.[1];
    if (!settled || !callbacks)
      throw new Error("Item action consume callbacks were not found");
    const onSettled = new Function("onDone", `return (${settled});`)(() => {
      isOpen = false;
      selected = undefined;
    });
    const options = new Function(
      "utils",
      "useritem",
      "showMutationToast",
      "showRewardToast",
      "onSettled",
      "finishItemConsumeRequest",
      "userId",
      "getItemConsumeErrorMessage",
      "prepareUserUpdate",
      "updateUser",
      "prepareConsumptionUpdate",
      "updateConsumption",
      "inventoryQuery",
      `return (${callbacks});`,
    )(
      {
        profile: {
          getUser: {
            invalidate: () => client.invalidateQueries({ queryKey: ["profile"] }),
          },
        },
        item: {
          getUserItemsWithVariants: {
            invalidate: () => client.invalidateQueries({ queryKey: ["inventory"] }),
          },
        },
      },
      selected,
      toast,
      vi.fn(),
      onSettled,
      finishItemConsumeRequest,
      "user",
      getItemConsumeErrorMessage,
      () => 17,
      vi.fn(async () => undefined),
      prepareConsumptionUpdate,
      vi.fn(async () => undefined),
      "getUserItemsWithVariants",
    ) as MutationObserverOptions<
      { success: boolean; message: string },
      Error,
      RouterInputs["item"]["consume"]
    >;
    const consume = new MutationObserver(client, {
      ...options,
      mutationFn: async () => ({
        success: false,
        message: "Your meal stack changed. Refresh your inventory and try again",
      }),
    });
    try {
      await waitFor(() => expect(inventory.getCurrentResult().data).toBe(3));
      await waitFor(() => expect(profile.getCurrentResult().data).toBe("old meal"));
      // Another tab consumes a meal while this modal still holds its earlier quantity.
      quantity = 2;
      activeMeal = "Rice Bowl";
      await consume.mutate({ userItemId: "meal-stack", expectedQuantity: 3 });

      expect(toast).toHaveBeenCalledWith({
        success: false,
        message: "Your meal stack changed. Refresh your inventory and try again",
      });
      expect(inventory.getCurrentResult().data).toBe(2);
      expect(profile.getCurrentResult().data).toBe("Rice Bowl");
      expect(consume.getCurrentResult().isPending).toBe(false);
      expect(isOpen).toBe(false);
      expect(selected).toBeUndefined();
    } finally {
      unsubscribeInventory();
      unsubscribeProfile();
      client.clear();
    }
  });

  for (const file of ["hooks/useItemActions.ts"]) {
    it.each([
      { message: "Internal server error", cache: true, expected: undefined },
      { message: "Invalid input", cache: false, expected: undefined },
      {
        message: "Failed to fetch",
        cache: true,
        expected: "Could not confirm item use. Try Consume again to check the opening.",
      },
      {
        message: "Failed to fetch",
        cache: false,
        expected:
          "Could not confirm item use. Refresh your inventory to check the result.",
      },
      {
        message: "Failed to fetch",
        cache: false,
        pet: true,
        expected: "Could not confirm item use. Try Consume again to check the opening.",
      },
    ])(
      `${file} handles $message for cache: $cache without duplicating global error feedback`,
      async ({ message, cache, expected, pet = false }) => {
        const source = read(file);
        const callbacks = source.match(
          /api\.item\.consume\.useMutation\((\{[\s\S]*?\n  \})\);/,
        )?.[1];
        if (!callbacks) throw new Error("Consume callbacks were not found");
        const toast = vi.fn();
        let isOpen = true;
        let selected: unknown = {
          item: {
            itemType: cache || pet ? "CONSUMABLE" : "MEAL",
            effects:
              cache || pet
                ? [
                    {
                      type: "noncombatconsumereward",
                      rewardMode: cache ? "weightedCache" : "standard",
                      reward_pets: pet ? ["fox"] : [],
                    },
                  ]
                : [],
          },
        };
        const setIsOpen = (value: boolean) => {
          isOpen = value;
        };
        const setUserItem = (value: unknown) => {
          selected = value;
        };
        const settled = source.match(
          /const onSettled = (\(\) => \{[\s\S]*?\n  \});/,
        )?.[1];
        const onDone = () => {
          setIsOpen(false);
          setUserItem(undefined);
        };
        const onSettled = settled
          ? new Function("setIsOpen", "setUserItem", "onDone", `return (${settled});`)(
              setIsOpen,
              setUserItem,
              onDone,
            )
          : undefined;
        const options = new Function(
          "showMutationToast",
          "getItemConsumeErrorMessage",
          "useritem",
          "onSettled",
          "setIsOpen",
          "setUserItem",
          "prepareUserUpdate",
          "updateUser",
          "prepareConsumptionUpdate",
          "updateConsumption",
          `return (${callbacks});`,
        )(
          toast,
          getItemConsumeErrorMessage,
          selected,
          onSettled,
          setIsOpen,
          setUserItem,
          () => 17,
          vi.fn(async () => undefined),
          prepareConsumptionUpdate,
          vi.fn(async () => undefined),
        ) as MutationObserverOptions<never, Error, RouterInputs["item"]["consume"]>;
        const client = new QueryClient();
        const error = new Error(message);
        const consume = new MutationObserver(client, {
          ...options,
          mutationFn: async () => {
            throw error;
          },
        });
        try {
          await expect(consume.mutate({ userItemId: "selected-item" })).rejects.toBe(
            error,
          );
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
      },
    );
  }

  for (const file of ["hooks/useItemActions.ts"]) {
    it(`${file} refreshes the companion collection and forwards its generation link after a pet reward`, async () => {
      const callbacks = read(file).match(
        /api\.item\.consume\.useMutation\((\{[\s\S]*?\n  \})\);/,
      )?.[1];
      if (!callbacks) throw new Error("Consume callbacks were not found");
      const refreshPets = vi.fn(async () => undefined);
      const invalidate = { invalidate: vi.fn(async () => undefined) };
      const rewardToast = vi.fn();
      const utils = {
        profile: { getUser: invalidate },
        item: { getUserItems: invalidate, getUserItemsWithVariants: invalidate },
        bloodline: { getItemRolls: invalidate },
        raids: { getUserRaidBuffs: invalidate },
        pets: { getPet: { invalidate: refreshPets } },
      };
      const options = new Function(
        "utils",
        "showRewardToast",
        "showMutationToast",
        "finishItemConsumeRequest",
        "userId",
        "onSettled",
        "getItemConsumeErrorMessage",
        "prepareUserUpdate",
        "updateUser",
        "prepareConsumptionUpdate",
        "updateConsumption",
        `return (${callbacks});`,
      )(
        utils,
        rewardToast,
        vi.fn(),
        vi.fn(),
        "recipient",
        vi.fn(),
        getItemConsumeErrorMessage,
        () => 17,
        vi.fn(async () => undefined),
        prepareConsumptionUpdate,
        consumptionController(utils),
      ) as {
        onMutate: () => unknown;
        onSuccess: (
          data: unknown,
          variables: { userItemId: string },
          context: unknown,
        ) => Promise<void>;
      };
      const petRewards = [{ id: "new-pet", speciesId: "fox", name: "Nami" }];
      await options.onSuccess(
        {
          success: true,
          rewards: {},
          message: "Used contract",
          notifications: [],
          cacheRewards: [],
          petRewards,
        },
        { userItemId: "contract" },
        options.onMutate(),
      );
      await waitFor(() => expect(refreshPets).toHaveBeenCalledTimes(1));
      expect(refreshPets).toHaveBeenCalledTimes(1);
      expect(rewardToast.mock.calls[0]?.[7]).toEqual(petRewards);
    });
  }

  for (const file of ["hooks/useItemActions.ts"]) {
    it(`${file} applies confirmed user changes instead of invalidating the profile`, async () => {
      const callbacks = read(file).match(
        /api\.item\.consume\.useMutation\((\{[\s\S]*?\n  \})\);/,
      )?.[1];
      if (!callbacks) throw new Error("Consume callbacks were not found");
      const invalidate = vi.fn(async () => undefined);
      const updateUser = vi.fn(async () => undefined);
      const prepareUserUpdate = vi.fn(() => 17);
      const invalidateProfile = vi.fn(async () => undefined);
      const leaf = { invalidate };
      const utils = {
        profile: { getUser: { invalidate: invalidateProfile } },
        item: { getUserItems: leaf, getUserItemsWithVariants: leaf },
        bloodline: { getItemRolls: leaf },
        raids: { getUserRaidBuffs: leaf },
      };
      const options = new Function(
        "utils",
        "showRewardToast",
        "showMutationToast",
        "finishItemConsumeRequest",
        "userId",
        "onSettled",
        "getItemConsumeErrorMessage",
        "prepareUserUpdate",
        "updateUser",
        "prepareConsumptionUpdate",
        "updateConsumption",
        `return (${callbacks});`,
      )(
        utils,
        vi.fn(),
        vi.fn(),
        vi.fn(),
        "recipient",
        vi.fn(),
        getItemConsumeErrorMessage,
        prepareUserUpdate,
        updateUser,
        prepareConsumptionUpdate,
        consumptionController(utils),
      ) as {
        onMutate: () => number;
        onSuccess: (
          data: unknown,
          variables: { userItemId: string },
          revision: number,
        ) => Promise<void>;
      };
      const userPatch = { curHealth: 50 };
      const userDelta = {};
      await options.onSuccess(
        { success: true, message: "Healed", userPatch, userDelta },
        { userItemId: "potion" },
        options.onMutate(),
      );
      expect(updateUser).toHaveBeenCalledWith(
        { success: true, message: "Healed", userPatch, userDelta },
        { revision: 17 },
      );
      expect(prepareUserUpdate).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(4));
      expect(invalidateProfile).not.toHaveBeenCalled();
    });
  }

  for (const { file, procedure } of inventoryQueries) {
    it(`${file} shows items obtained since its last visit`, async () => {
      const client = new QueryClient({
        defaultOptions: { queries: { staleTime, retry: false } },
      });
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
        await waitFor(() =>
          expect(observer.getCurrentResult().data).toEqual(["Kunai"]),
        );
        unsubscribe();

        // A quest reward lands while the player is elsewhere, without touching this cache.
        inventory = ["Kunai", "Quest Reward Scroll"];

        observer = mount();
        unsubscribe = observer.subscribe(() => {});
        await waitFor(() =>
          expect(observer.getCurrentResult().data).toEqual([
            "Kunai",
            "Quest Reward Scroll",
          ]),
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
  it.each([false, true])(
    "location checks refresh observed inventory only when itemsChanged is %s",
    async (itemsChanged) => {
      const callbacks = read("layout/Sector.tsx").match(
        /api\.quests\.checkLocationQuest\.useMutation\((\{[\s\S]*?\n  \})\);/,
      )?.[1];
      if (!callbacks) throw new Error("Location quest callbacks were not found");
      const client = new QueryClient({
        defaultOptions: { queries: { staleTime, retry: false } },
      });
      const reads = [
        vi.fn(async () => ["Kunai"]),
        vi.fn(async () => ["Kunai variant"]),
      ];
      const observers = reads.map(
        (queryFn, index) =>
          new QueryObserver(client, { queryKey: ["inventory", index], queryFn }),
      );
      const unsubscribe = observers.map((observer) => observer.subscribe(() => {}));
      const updateUser = vi.fn(async () => undefined);
      const options = new Function(
        "utils",
        "updateUser",
        "prepareInventoryUpdate",
        "updateInventory",
        "getInventoryQuantities",
        "prepareUserUpdate",
        `return (${callbacks});`,
      )(
        {
          item: {
            getUserItems: {
              invalidate: () =>
                client.invalidateQueries({ queryKey: ["inventory", 0] }),
            },
            getUserItemsWithVariants: {
              invalidate: () =>
                client.invalidateQueries({ queryKey: ["inventory", 1] }),
            },
          },
        },
        updateUser,
        () =>
          [0, 1].map((index) => ({
            key: ["inventory", index],
            revision: prepareQueryUpdate(client, ["inventory", index]),
          })),
        (update: any, snapshots: any[]) =>
          Promise.all(
            snapshots.map((snapshot) =>
              updateQueryCache(client, snapshot.key, update, {
                revision: snapshot.revision,
              }),
            ),
          ),
        getInventoryQuantities,
        () => 17,
      ) as {
        onMutate: () => unknown;
        onSuccess: (
          result: unknown,
          input: undefined,
          context: unknown,
        ) => Promise<void>;
      };
      try {
        await waitFor(() =>
          observers.forEach((observer) =>
            expect(observer.getCurrentResult().data).toBeDefined(),
          ),
        );
        const updateAt = new Date();
        await options.onSuccess(
          { success: true, itemsChanged, notifications: [], questData: [], updateAt },
          undefined,
          options.onMutate(),
        );
        reads.forEach((read) =>
          expect(read).toHaveBeenCalledTimes(itemsChanged ? 2 : 1),
        );
        expect(updateUser).toHaveBeenCalledWith(
          { questData: [], updatedAt: updateAt },
          { revision: 17 },
        );
      } finally {
        unsubscribe.forEach((stop) => stop());
        client.clear();
      }
    },
  );

  const userItemCaches = ["getUserItems", "getUserItemsWithVariants"];
  const flows = [{ file: "layout/RewardChoice.tsx", flow: "quests.claimRewardChoice" }];
  for (const { file, flow } of flows) {
    it(`${flow} invalidates both user item caches`, () => {
      const source = read(file);
      for (const cache of userItemCaches) {
        expect(source).toContain(`utils.item.${cache}.invalidate()`);
      }
    });
  }
});
