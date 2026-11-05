import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as client from "@/app/_trpc/client";
import BlackMarket from "@/app/[shell]/blackmarket/page";
import * as bloodline from "@/layout/Bloodline";
import * as ContentBox from "@/layout/ContentBox";
import * as LinkModule from "@/layout/Link";
import * as ShopModule from "@/layout/Shop";
import * as Table from "@/layout/Table";
import * as UserContext from "@/utils/UserContext";

let rolls: unknown[] = [];

const browserGlobals = ["Event", "CustomEvent", "StorageEvent"] as const;
const browserDescriptors = browserGlobals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));

beforeEach(() => {
  for (const key of browserGlobals) {
    if (key in window) Object.defineProperty(globalThis, key, { configurable: true, value: window[key as keyof Window] });
  }
  localStorage.clear();
  rolls = [];
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({
    data: { userId: "player", reputationPoints: 11, seichiSilver: 0, money: 100_000_000, bloodlineId: null },
    prepareUserUpdate: vi.fn(),
    updateUser: vi.fn(),
  } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ bloodline: { getItemRolls: { invalidate: vi.fn() } } }),
    bloodline: {
      getItemRolls: { useQuery: () => ({ data: rolls, isPending: false }) },
      getAll: { useQuery: () => ({ data: { data: [] }, isPending: false }) },
      pityRoll: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  });
  vi.spyOn(ContentBox, "default").mockImplementation(({ title, children }) => (
    <section aria-label={String(title)}>{children}</section>
  ));
  vi.spyOn(LinkModule, "default").mockImplementation((({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>) as never);
  vi.spyOn(ShopModule, "default").mockImplementation((({ title }: { title: string }) => <p>{title}</p>) as never);
  vi.spyOn(bloodline, "PurchaseBloodline").mockImplementation(() => <p>Buy a bloodline</p>);
  vi.spyOn(Table, "default").mockImplementation(() => <p>Roll table</p>);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  browserGlobals.forEach((key, index) => {
    const descriptor = browserDescriptors[index];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  });
});

it("opens on Items with the player's balances and a way to get reputation", () => {
  const view = render(<BlackMarket />);
  expect(view.getByRole("tab", { name: "Items" }).getAttribute("aria-selected")).toBe("true");
  expect(view.getByText("Reputation Shop")).toBeTruthy();
  expect(view.getByText("11 rep")).toBeTruthy();
  expect(view.getByText("100,000,000 ryo")).toBeTruthy();
  expect(view.getByRole("link", { name: "Get reputation" }).getAttribute("href")).toBe("/points");
});

it("keeps free rolls on Bloodlines, hidden until the player has rolled", () => {
  const view = render(<BlackMarket />);
  fireEvent.mouseDown(view.getByRole("tab", { name: "Bloodlines" }), { button: 0, ctrlKey: false });
  expect(view.getByText("Buy a bloodline")).toBeTruthy();
  expect(view.queryByRole("region", { name: "Bloodline Rolls" })).toBeNull();
  cleanup();
  rolls = [{ goal: "A", used: 37, pityRolls: 0, updatedAt: new Date() }];
  const again = render(<BlackMarket />);
  expect(again.getByRole("tab", { name: "Bloodlines" }).getAttribute("aria-selected")).toBe("true");
  expect(again.getByRole("region", { name: "Bloodline Rolls" })).toBeTruthy();
  expect(again.queryByText("Reputation Shop")).toBeNull();
});

it("moves between sections with the arrow keys and labels each panel", async () => {
  const view = render(<BlackMarket />);
  const items = view.getByRole("tab", { name: "Items" });
  const panel = view.getByRole("tabpanel", { name: "Items" });
  expect(items.getAttribute("aria-controls")).toBe(panel.id);
  act(() => items.focus());
  fireEvent.keyDown(items, { key: "ArrowRight" });
  await waitFor(() =>
    expect(view.getByRole("tab", { name: "Bloodlines" }).getAttribute("aria-selected")).toBe("true"),
  );
  expect(view.getByText("Buy a bloodline")).toBeTruthy();
});
