import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as contentImage from "@/layout/ContentImage";
import { ActionSelector } from "@/layout/CombatActions";
import { battleActionGrid } from "@/libs/combat/actionGrid";
import * as userContext from "@/utils/UserContext";

const browserGlobals = ["Event", "CustomEvent"] as const;
const saved = browserGlobals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));

beforeEach(() => {
  // Radix dispatches jsdom events, which must come from the jsdom window.
  for (const key of browserGlobals)
    Object.defineProperty(globalThis, key, { configurable: true, value: window[key] });
  vi.spyOn(userContext, "useUserData").mockReturnValue({ data: undefined } as never);
  vi.spyOn(contentImage, "default").mockImplementation(({ alt, onClick }) => <img alt={`${alt} art`} onClick={onClick} />);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  browserGlobals.forEach((key, index) => {
    const descriptor = saved[index];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  });
});

const fireball = {
  id: "fireball",
  name: "Fireball",
  image: "/fireball.webp",
  type: "jutsu",
  target: "OTHER_USER",
  range: 4,
  actionCostPerc: 60,
};

const renderActions = (combatMode: boolean, small = true, item = fireball, userActionPoints?: number) => {
  const layout = battleActionGrid({ focus: true, small });
  const onClick = vi.fn();
  const view = render(
    <ActionSelector
      items={[item] as never}
      showBgColor={false}
      showLabels={layout.labels}
      gridClassNameOverwrite={layout.grid}
      aspectRatioClass={layout.aspect}
      combatMode={combatMode}
      currentRound={2}
      userActionPoints={userActionPoints}
      onClick={onClick}
    />,
  );
  return { ...view, onClick };
};

it.each([false, true])("shows battle focus names unless small icons are enabled (%s)", (small) => {
  renderActions(true, small);
  expect(screen.queryByText("Fireball") !== null).toBe(!small);
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("focuses a native battle action and describes its target, range and cost", async () => {
  renderActions(true);
  const action = screen.getByRole("button", { name: "Fireball" });
  expect(action.tagName).toBe("BUTTON");
  expect(action.getAttribute("type")).toBe("button");
  expect(action.tabIndex).toBe(0);
  act(() => action.focus());
  expect(document.activeElement).toBe(action);
  const card = await screen.findByRole("tooltip");
  expect(card.textContent).toBe("FireballTarget: other user · Range 4 · 60 AP");
});

it("selects once when the artwork or native battle control is activated", () => {
  const { onClick } = renderActions(true);
  fireEvent.click(screen.getByRole("img", { name: "Fireball art" }));
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(onClick).toHaveBeenLastCalledWith("fireball");
  fireEvent.click(screen.getByRole("button", { name: "Fireball" }));
  expect(onClick).toHaveBeenCalledTimes(2);
});

it.each(["AP", "cooldown"])("keeps an action unavailable for %s focusable without selecting it", async (reason) => {
  const item = reason === "cooldown" ? { ...fireball, cooldown: 3, lastUsedRound: 1 } : fireball;
  const { onClick } = renderActions(true, true, item, reason === "AP" ? 0 : 100);
  const action = screen.getByRole("button", { name: "Fireball" });
  expect(action.getAttribute("aria-disabled")).toBe("true");
  act(() => action.focus());
  expect(document.activeElement).toBe(action);
  expect((await screen.findByRole("tooltip")).textContent).toContain("Target: other user");
  fireEvent.click(action);
  expect(onClick).not.toHaveBeenCalled();
});

it("keeps loadout pickers outside battle free of hover cards", () => {
  const { onClick } = renderActions(false);
  const art = screen.getByRole("img", { name: "Fireball art" });
  expect(art.closest("[data-state]")).toBeNull();
  fireEvent.click(art);
  expect(onClick).toHaveBeenCalledTimes(1);
});
