import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import * as UserSearchSelect from "@/layout/UserSearchSelect";
import { StoreBundles } from "@/screens/points/StoreBundles";
import * as checkout from "@/screens/points/StoreCheckout";
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
    if (dismiss === "Escape") fireEvent.keyDown(modal, { key: "Escape" });
    else fireEvent.click(within(modal).getAllByRole("button", { name: "Close" })[0]!);
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(card));
    expect(card?.textContent).toContain("Journey supplies");
    expect(card?.textContent).toContain("1 received");
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
    if (dismiss === "Escape") fireEvent.keyDown(modal, { key: "Escape" });
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
      "0 means unlimited. 1 allows one lifetime bundle per recipient account, including gifts received.",
    );
    fireEvent.keyDown(limit, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(opener));
  },
);

it("keeps gifting available after the account has received its limited bundle", async () => {
  purchaseCount = 1;
  const view = render(<StoreBundles />);
  expect(
    view
      .getByRole("button", { name: "Purchase limit reached" })
      .hasAttribute("disabled"),
  ).toBe(true);
  const gift = view.getByRole("button", { name: "Gift bundle" });
  expect(gift.hasAttribute("disabled")).toBe(false);
  fireEvent.click(gift);
  const dialog = await view.findByRole("dialog", { name: "Gift Journey supplies" });
  expect(within(dialog).getByRole("textbox", { name: "Recipient" })).toBeTruthy();
  expect(within(dialog).getByText("Checkout")).toBeTruthy();
});
