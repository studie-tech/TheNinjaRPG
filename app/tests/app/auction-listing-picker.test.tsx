import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import { NewAuctionListingDialog } from "@/app/[shell]/auctionhouse/NewListingDialog";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

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

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true, scrollIntoView: true });
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
  restoreBrowserGlobals();
});

it("leaves items still being imbued out of the listing picker", async () => {
  render(<NewAuctionListingDialog />);
  fireEvent.click(screen.getByRole("button", { name: "List item" }));
  await waitFor(() => expect(screen.getByText("Available Sword")).toBeTruthy());
  expect(screen.getByText("Stored Sword")).toBeTruthy();
  expect(screen.getByText("Imbued Sword (1 imbuement(s))")).toBeTruthy();
  expect(screen.queryByText("Imbuing Sword", { exact: false })).toBeNull();
});

it("clears the picked item and search when the listing is cancelled", async () => {
  render(<NewAuctionListingDialog />);
  fireEvent.click(screen.getByRole("button", { name: "List item" }));
  await waitFor(() => expect(screen.getByText("Available Sword")).toBeTruthy());
  fireEvent.click(screen.getByText("Available Sword"));
  const picker = () => document.getElementById("user-item-search") as HTMLInputElement;
  await waitFor(() => expect(picker().value).toBe("Available Sword"));
  expect(picker().getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  fireEvent.click(screen.getByRole("button", { name: "List item" }));
  await waitFor(() => expect(screen.getByText("Available Sword")).toBeTruthy());
  expect(picker().value).toBe("");
  expect(picker().getAttribute("aria-expanded")).toBe("true");
  expect(
    (screen.getAllByPlaceholderText("Search your items...")[1] as HTMLInputElement)
      .value,
  ).toBe("");
});
