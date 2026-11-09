import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { ActionSelector } from "@/layout/CombatActions";
import * as contentImage from "@/layout/ContentImage";
import { battleActionGrid } from "@/libs/combat/actionGrid";
import type { CombatAction } from "@/libs/combat/types";
import * as userContext from "@/utils/UserContext";
import { DamageTag } from "@/validators/combat";
import { coordinateTargetingSchema } from "@/validators/coordinateTargeting";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

beforeEach(() => {
  installBrowserGlobals();
  vi.spyOn(userContext, "useUserData").mockReturnValue({ data: undefined } as never);
  vi.spyOn(contentImage, "default").mockImplementation(({ alt, onClick }) => (
    <img alt={`${alt} art`} onClick={onClick} />
  ));
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

const fireball = {
  id: "fireball",
  name: "Fireball",
  image: "/fireball.webp",
  type: "jutsu",
  target: "OTHER_USER",
  method: "SINGLE",
  range: 4,
  actionCostPerc: 60,
} satisfies Partial<CombatAction>;

const renderActions = (
  combatMode: boolean,
  small = true,
  item: Partial<CombatAction> = fireball,
  userActionPoints?: number,
) => {
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

it.each([false, true])(
  "shows battle focus names unless small icons are enabled (%s)",
  (small) => {
    renderActions(true, small);
    expect(screen.queryByText("Fireball") !== null).toBe(!small);
    expect(screen.queryByRole("tooltip")).toBeNull();
  },
);

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

it("exposes selection and deselection on the battle action", () => {
  const Actions = () => {
    const [selectedId, setSelectedId] = useState<string>();
    return (
      <ActionSelector
        items={[fireball] as never}
        showLabels={false}
        combatMode
        selectedId={selectedId}
        onClick={(id) => setSelectedId(selectedId === id ? undefined : id)}
      />
    );
  };
  render(<Actions />);
  const action = screen.getByRole("button", { name: "Fireball" });
  expect(action.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(action);
  expect(action.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(action);
  expect(action.getAttribute("aria-pressed")).toBe("false");
});

it.each(["AP", "cooldown"])(
  "keeps an action unavailable for %s focusable without selecting it",
  async (reason) => {
    const item =
      reason === "cooldown" ? { ...fireball, cooldown: 3, lastUsedRound: 1 } : fireball;
    const { onClick } = renderActions(true, true, item, reason === "AP" ? 0 : 100);
    const action = screen.getByRole("button", { name: "Fireball" });
    expect(action.getAttribute("aria-disabled")).toBe("true");
    act(() => action.focus());
    expect(document.activeElement).toBe(action);
    const summary = (await screen.findByRole("tooltip")).textContent;
    expect(summary).toContain("Target: other user · Range 4 · 60 AP");
    expect(summary).toContain(reason === "AP" ? "Not enough AP" : "On cooldown");
    fireEvent.click(action);
    expect(onClick).not.toHaveBeenCalled();
  },
);

const targetPattern = coordinateTargetingSchema.parse({
  origin: "TARGET",
  coordinates: [{ longitude: 0, latitude: 0 }],
});
const casterPattern = { ...targetPattern, origin: "CASTER" as const };

it.each([
  ["CHARACTER", "SINGLE", undefined, [], true],
  ["CHARACTER", "AOE_CIRCLE_SHOOT", undefined, [], true],
  ["CHARACTER", "ALL", undefined, [], false],
  ["CHARACTER", "COORDINATES", targetPattern, [], true],
  ["CHARACTER", "COORDINATES", casterPattern, [], false],
  ["OTHER_USER", "ALL", undefined, [], false],
  ["GROUND", "COORDINATES", undefined, [], false],
  [
    "CHARACTER",
    "ALL",
    undefined,
    [DamageTag.parse({ target: "COORDINATES", coordinateTargeting: targetPattern })],
    true,
  ],
  [
    "CHARACTER",
    "ALL",
    undefined,
    [DamageTag.parse({ target: "COORDINATES", coordinateTargeting: casterPattern })],
    false,
  ],
  ["SELF", "SINGLE", undefined, [], false],
] as const)(
  "describes range only when target %s and method %s constrain selection",
  async (target, method, coordinateTargeting, effects, hasRange) => {
    renderActions(true, true, {
      ...fireball,
      target,
      method,
      coordinateTargeting,
      effects: [...effects],
    });
    act(() => screen.getByRole("button", { name: "Fireball" }).focus());
    const summary = (await screen.findByRole("tooltip")).textContent;
    expect(summary?.includes("Range 4")).toBe(hasRange);
    expect(summary).toContain(`Target: ${target.toLowerCase().replaceAll("_", " ")}`);
    expect(summary).toContain("60 AP");
  },
);

it("keeps loadout pickers outside battle free of hover cards", () => {
  const { onClick } = renderActions(false);
  const art = screen.getByRole("img", { name: "Fireball art" });
  expect(art.closest("[data-state]")).toBeNull();
  fireEvent.click(art);
  expect(onClick).toHaveBeenCalledTimes(1);
});
