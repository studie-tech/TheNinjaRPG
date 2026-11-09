import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { useState } from "react";
import * as client from "@/app/_trpc/client";
import type { UserItemWithVariants } from "@/drizzle/schema";
import { ItemVariantModal } from "@/layout/items/ItemVariantModal";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

type Options = {
  onSuccess: (result: unknown, variables: unknown, revision: number) => Promise<void>;
};
const captured: Record<string, Options> = {};
const onClose = vi.fn();
const userItem = {
  id: "row",
  activeVariantId: null,
  item: { id: "sword", name: "Sword", image: "/sword.webp", variants: [] },
} as unknown as UserItemWithVariants;

/** Mounts the modal the way the inspector does: only while an item is chosen. */
const Host = () => {
  const [chosen, setChosen] = useState(true);
  return chosen ? (
    <ItemVariantModal
      userItem={userItem}
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
  installBrowserGlobals({ resizeObserver: true });
  vi.clearAllMocks();
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({
    data: { userId: "viewer" },
    prepareUserUpdate: vi.fn(),
    updateUser: vi.fn(async () => undefined),
  } as never);
  const capture = (name: string) => ({
    useMutation: (options: Options) => {
      captured[name] = options;
      return { mutate: vi.fn(), isPending: false };
    },
  });
  const invalidate = { invalidate: vi.fn(async () => undefined) };
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

const mount = () =>
  render(
    <AppRouterContext.Provider value={{} as never}>
      <Host />
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

it("keeps the modal open after a purchase", async () => {
  mount();
  await act(() =>
    captured.purchaseVariant!.onSuccess({ success: true, message: "Bought" }, {}, 1),
  );
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeDefined();
});
