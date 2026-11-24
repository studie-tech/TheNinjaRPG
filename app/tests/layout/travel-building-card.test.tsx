import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { VillageStructure } from "@/drizzle/schema";
import { TravelBuildingCard } from "@/layout/TravelBuildingCard";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";

beforeEach(() => installBrowserGlobals({ resizeObserver: true }));
afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  restoreBrowserGlobals();
});
const shop = {
  id: "shop",
  name: "Item shop",
  route: "/itemshop",
} as VillageStructure;

it("offers walking for locations without pages and entry for colocated services", () => {
  const onGoTo = vi.fn();
  const props = {
    structure: shop,
    getBounds: () => new DOMRect(100, 100, 100, 100),
    boundary: document.body,
    onGoTo,
    onEnter: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(<TravelBuildingCard {...props} services={[]} />);
  const goHere = view.getByRole("button", { name: "Go to Item shop" });
  expect(goHere.textContent).toBe("Go here");
  fireEvent.click(goHere);
  expect(onGoTo).toHaveBeenCalledTimes(1);
  view.rerender(
    <TravelBuildingCard
      {...props}
      services={[shop, { ...shop, id: "bank", name: "Bank", route: "/bank" }]}
    />,
  );
  expect(view.queryByRole("button", { name: /Go to/ })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Enter Item shop" }));
  expect(props.onEnter).toHaveBeenLastCalledWith(shop);
  fireEvent.click(view.getByRole("button", { name: "Enter Bank" }));
  expect(props.onEnter.mock.lastCall?.[0].route).toBe("/bank");
});

it("offers Enter immediately, names the destination once and blocks duplicate entry while opening", () => {
  const view = render(
    <TravelBuildingCard
      structure={shop}
      services={[shop]}
      getBounds={() => new DOMRect(100, 100, 100, 100)}
      boundary={document.body}
      onGoTo={vi.fn()}
      onEnter={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  expect(view.getByRole("dialog", { name: "Item shop" })).toBeTruthy();
  expect(view.getByRole("heading", { name: "Item shop" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Enter Item shop" }).textContent).toBe(
    "Enter",
  );
  const onEnter = vi.fn();
  view.rerender(
    <TravelBuildingCard
      structure={shop}
      services={[shop]}
      openingServiceId={shop.id}
      getBounds={() => new DOMRect(100, 100, 100, 100)}
      boundary={document.body}
      onGoTo={vi.fn()}
      onEnter={onEnter}
      onClose={vi.fn()}
    />,
  );
  const enter = view.getByRole("button", { name: "Enter Item shop" });
  expect(enter.hasAttribute("disabled")).toBe(true);
  expect(enter.getAttribute("aria-busy")).toBe("true");
  fireEvent.click(enter);
  expect(onEnter).not.toHaveBeenCalled();
});

it("offers a named close button for touch users", () => {
  const onClose = vi.fn();
  const view = render(
    <TravelBuildingCard
      structure={shop}
      services={[]}
      getBounds={() => new DOMRect(100, 100, 100, 100)}
      boundary={document.body}
      onGoTo={vi.fn()}
      onEnter={vi.fn()}
      onClose={onClose}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Close building actions" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("keeps focus on the map when hovered and allows Escape to dismiss the actions", () => {
  const onClose = vi.fn();
  const view = render(
    <TravelBuildingCard
      structure={shop}
      services={[]}
      getBounds={() => new DOMRect(100, 100, 100, 100)}
      boundary={document.body}
      onGoTo={vi.fn()}
      onEnter={vi.fn()}
      onClose={onClose}
    />,
  );
  expect(view.getByRole("dialog").contains(document.activeElement)).toBe(false);
  fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});
