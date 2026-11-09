import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as client from "@/app/_trpc/client";
import { StoreBundles } from "@/app/[shell]/points/StoreBundles";
import * as checkout from "@/app/[shell]/points/StoreCheckout";
import * as UserSearchSelect from "@/layout/UserSearchSelect";
import * as UserContext from "@/utils/UserContext";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

let purchaseCount: number;

beforeEach(() => {
  installBrowserGlobals();
  purchaseCount = 0;
  Object.assign(vi.spyOn(client, "api" as never), {
    paypal: {
      getStoreBundles: {
        useQuery: () => ({
          data: {
            bundles: [
              {
                id: "supplies",
                name: "Journey supplies",
                description: "Guaranteed contents.",
                priceCents: 100,
                isActive: true,
                purchaseLimit: 1,
                purchaseCount,
                contents: { reputationPoints: 0, money: 500, items: [] },
              },
            ],
            items: [],
          },
          isPending: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      saveStoreBundle: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  });
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({
    data: { userId: "buyer", role: "CONTENT-ADMIN" },
  } as never);
  vi.spyOn(UserSearchSelect, "default").mockImplementation(() => (
    <input aria-label="Recipient" />
  ));
  vi.spyOn(checkout, "StoreCheckout").mockImplementation(() => <p>Checkout</p>);
});

afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

it.each(["Escape", "Close"])(
  "returns focus to the bundle after delivery disables its opener (%s)",
  async (dismiss) => {
    const view = render(<StoreBundles />);
    const opener = view.getByRole("button", { name: "Select bundle" });
    const card = opener.closest("[tabindex='-1']");
    act(() => opener.focus());
    fireEvent.click(opener);
    const modal = await view.findByRole("dialog", {
      name: "Purchase Journey supplies",
    });
    purchaseCount = 1;
    view.rerender(<StoreBundles />);
    expect(opener.hasAttribute("disabled")).toBe(true);
    if (dismiss === "Escape")
      fireEvent.keyDown(within(modal).getByRole("textbox"), { key: "Escape" });
    else fireEvent.click(within(modal).getAllByRole("button", { name: "Close" })[0]!);
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(card));
    expect(card?.textContent).toContain("Journey supplies");
    expect(card?.textContent).toContain("1 purchased");
  },
);

it.each(["Escape", "Close"])(
  "returns focus to the enabled selection button on ordinary dismissal (%s)",
  async (dismiss) => {
    const view = render(<StoreBundles />);
    const opener = view.getByRole("button", { name: "Select bundle" });
    act(() => opener.focus());
    fireEvent.click(opener);
    const modal = await view.findByRole("dialog", {
      name: "Purchase Journey supplies",
    });
    if (dismiss === "Escape")
      fireEvent.keyDown(within(modal).getByRole("textbox"), { key: "Escape" });
    else fireEvent.click(within(modal).getAllByRole("button", { name: "Close" })[0]!);
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  },
);

it.each(["Create bundle", "Edit"])(
  "associates the limit instructions with the field in %s",
  async (action) => {
    const view = render(<StoreBundles />);
    const opener = view.getByRole("button", { name: action });
    act(() => opener.focus());
    fireEvent.click(opener);
    const modal = await view.findByRole("dialog");
    const limit = within(modal).getByRole("spinbutton", {
      name: "Purchase limit per account",
    });
    const help = document.getElementById(limit.getAttribute("aria-describedby")!);
    expect(help?.textContent).toBe(
      "0 means unlimited. 1 allows one lifetime purchase per buyer account, including gifts.",
    );
    fireEvent.keyDown(limit, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(opener));
  },
);
