import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as contentImage from "@/layout/ContentImage";
import { ActionSelector } from "@/layout/CombatActions";
import * as userContext from "@/utils/UserContext";

const browserGlobals = ["Event", "CustomEvent"] as const;
const saved = browserGlobals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));

beforeEach(() => {
  // Radix dispatches jsdom events, which must come from the jsdom window.
  for (const key of browserGlobals)
    Object.defineProperty(globalThis, key, { configurable: true, value: window[key] });
  vi.spyOn(userContext, "useUserData").mockReturnValue({ data: undefined } as never);
  vi.spyOn(contentImage, "default").mockImplementation(({ alt }) => <span>{alt} art</span>);
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

const renderActions = (combatMode: boolean) =>
  render(
    <ActionSelector
      items={[fireball] as never}
      showBgColor={false}
      showLabels={false}
      combatMode={combatMode}
      onClick={vi.fn()}
    />,
  );

it("names a battle action, its target, range and cost on hover", async () => {
  renderActions(true);
  fireEvent.focus(screen.getByText("Fireball art").closest("[data-state]")!);
  const card = await screen.findByRole("tooltip");
  expect(card.textContent).toBe("FireballTarget: other user · Range 4 · 60 AP");
});

it("keeps loadout pickers outside battle free of hover cards", () => {
  renderActions(false);
  expect(screen.getByText("Fireball art").closest("[data-state]")).toBeNull();
});
