import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { useState } from "react";
import * as client from "@/app/_trpc/client";
import type { UserItemWithVariants } from "@/drizzle/schema";
import * as inventoryCache from "@/hooks/useInventoryCacheUpdate";
import { ItemVariantModal } from "@/layout/items/ItemVariantModal";
import * as toast from "@/libs/toast";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";
import { mockCosmetics } from "../../setup/cosmetics";
import { mockUserContextValue } from "../../setup/userContext";

type Options = {
  onMutate?: () => unknown;
  onSuccess: (result: unknown, variables: unknown, revision: number) => Promise<void>;
};
const captured: Record<string, Options> = {};
const onClose = vi.fn();
const updateInventory = vi.fn(async () => undefined);
const updateUser = vi.fn(async () => undefined);
const invalidate = { invalidate: vi.fn(async () => undefined) };
const userItem = {
  id: "row",
  equipped: "HEAD",
  activeVariantId: null,
  item: { id: "sword", name: "Sword", image: "/sword.webp", variants: [] },
} as unknown as UserItemWithVariants;

/** Mounts the modal the way the inspector does: only while an item is chosen. */
const Host = ({ item = userItem }: { item?: UserItemWithVariants }) => {
  const [chosen, setChosen] = useState(true);
  return chosen ? (
    <ItemVariantModal
      userItem={item}
      allUserItems={[]}
      onClose={() => {
        onClose();
        setChosen(false);
      }}
    />
  ) : (
    <p>Closed</p>
  );
};

beforeEach(() => {
  mockCosmetics();
  installBrowserGlobals({ resizeObserver: true });
  vi.clearAllMocks();
  for (const fn of [updateInventory, updateUser, invalidate.invalidate]) fn.mockClear();
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  mockUserContextValue({
    data: { userId: "viewer" },
    prepareUserUpdate: vi.fn(() => 3),
    updateUser,
  } as never);
  vi.spyOn(inventoryCache, "useInventoryCacheUpdate").mockImplementation(
    () =>
      ({
        prepareInventoryUpdate: () => "inventory-snapshot",
        updateInventory,
      }) as never,
  );
  const capture = (name: string) => ({
    useMutation: (options: Options) => {
      captured[name] = options;
      return { mutate: vi.fn(), isPending: false };
    },
  });
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      item: {
        getUserUnlockedVariants: invalidate,
        getUserItemsWithVariants: invalidate,
      },
      profile: { getUser: invalidate },
      travel: { getSectorData: invalidate },
    }),
    item: {
      getAllNames: { useQuery: () => ({ data: [] }) },
      getUserUnlockedVariants: { useQuery: () => ({ data: [] }) },
      purchaseVariant: capture("purchaseVariant"),
      consumeVariantToken: capture("consumeVariantToken"),
      selectVariant: capture("selectVariant"),
    },
  });
});

afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

const mount = (item = userItem) =>
  render(
    <AppRouterContext.Provider value={{} as never}>
      <Host item={item} />
    </AppRouterContext.Provider>,
  );

it("closes through the parent when dismissed", () => {
  mount();
  expect(screen.getByRole("dialog")).toBeDefined();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Closed")).toBeDefined();
});

it.each(["consumeVariantToken", "selectVariant"])(
  "closes once after a successful %s",
  async (name) => {
    mount();
    await act(() =>
      captured[name]!.onSuccess({ success: false, message: "No" }, {}, 1),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeDefined();
    await act(() =>
      captured[name]!.onSuccess({ success: true, message: "Done" }, {}, 1),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Closed")).toBeDefined();
  },
);

it("patches the inventory and worn gear with the saved variant instead of reading them again", async () => {
  mount();
  const variant = { id: "gold" };
  await act(() =>
    captured.selectVariant!.onSuccess(
      { success: true, message: "Done", activeVariant: variant },
      { userItemId: "row", variantId: "gold" },
      { inventory: "inventory-snapshot", user: 3, isEquipped: true } as never,
    ),
  );
  expect(updateInventory).toHaveBeenCalledWith(
    expect.any(Function),
    "inventory-snapshot",
  );
  const [patch, options] = updateUser.mock.calls[0] as unknown as [
    (current: { items: unknown[] }) => unknown,
    unknown,
  ];
  expect(options).toEqual({ revision: 3 });
  expect(patch({ items: [{ id: "row", activeVariantId: null }] })).toEqual({
    items: [{ id: "row", activeVariantId: "gold" }],
  });
  expect(invalidate.invalidate).toHaveBeenCalledTimes(1);
});

it("reconciles missing worn gear using the equipment membership captured before selection", async () => {
  const view = mount();
  const snapshot = captured.selectVariant!.onMutate!();
  view.rerender(
    <AppRouterContext.Provider value={{} as never}>
      <Host item={{ ...userItem, equipped: "NONE" }} />
    </AppRouterContext.Provider>,
  );
  await act(() =>
    captured.selectVariant!.onSuccess(
      { success: true, message: "Done", activeVariant: { id: "gold" } },
      { userItemId: "row", variantId: "gold" },
      snapshot as never,
    ),
  );
  const [patch] = updateUser.mock.calls[0] as unknown as [
    (current: { items: unknown[] }) => unknown,
  ];
  expect(patch({ items: [] })).toBeUndefined();
});

it("reads the inventory and profile again when the saved variant is not reported", async () => {
  mount();
  await act(() =>
    captured.selectVariant!.onSuccess(
      { success: true, message: "Done" },
      { userItemId: "row", variantId: null },
      { inventory: "inventory-snapshot", user: 3 } as never,
    ),
  );
  expect(updateInventory).toHaveBeenCalledWith(undefined, "inventory-snapshot");
  expect(updateUser).toHaveBeenCalledWith(undefined, { revision: 3 });
});

it("keeps the modal open after a purchase", async () => {
  mount();
  await act(() =>
    captured.purchaseVariant!.onSuccess({ success: true, message: "Bought" }, {}, 1),
  );
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeDefined();
});
