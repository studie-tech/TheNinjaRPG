import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import { NewAuctionListingDialog } from "@/app/[shell]/auctionhouse/page";

const row = (name: string, patch: object = {}) => ({
  id: name,
  quantity: 1,
  equipped: "NONE",
  isInAuction: false,
  craftingFinishedAt: null,
  imbuements: [],
  item: { name, canBeTraded: true },
  ...patch,
});

const browserGlobals = ["Event", "CustomEvent", "ResizeObserver"] as const;
const browserDescriptors = browserGlobals.map((key) =>
  Object.getOwnPropertyDescriptor(globalThis, key),
);
const scrollIntoView = window.HTMLElement.prototype.scrollIntoView;

beforeEach(() => {
  Object.defineProperties(globalThis, {
    Event: { configurable: true, value: window.Event },
    CustomEvent: { configurable: true, value: window.CustomEvent },
    ResizeObserver: {
      configurable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    },
  });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  Object.assign(vi.spyOn(client, "api" as never), {
    item: {
      getUserItems: {
        useQuery: () => ({
          data: [
            row("Available Sword"),
            row("Stored Sword", { storedAtHome: true }),
            row("Imbuing Sword", {
              imbuements: [{ craftingFinishedAt: new Date(Date.now() + 60_000) }],
            }),
            row("Imbued Sword", {
              imbuements: [{ craftingFinishedAt: new Date(Date.now() - 60_000) }],
            }),
          ],
        }),
      },
    },
    auction: {
      createAuctionListing: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    useUtils: () => ({ item: { getUserItems: { invalidate: vi.fn() } } }),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
  browserGlobals.forEach((key, index) => {
    const descriptor = browserDescriptors[index];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  });
});

it("leaves items still being imbued out of the listing picker", async () => {
  render(<NewAuctionListingDialog />);
  fireEvent.click(screen.getByRole("button", { name: "List item" }));
  await waitFor(() => expect(screen.getByText("Available Sword")).toBeTruthy());
  expect(screen.getByText("Stored Sword")).toBeTruthy();
  expect(screen.getByText("Imbued Sword (1 imbuement(s))")).toBeTruthy();
  expect(screen.queryByText("Imbuing Sword", { exact: false })).toBeNull();
});
