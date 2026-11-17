import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { VisualizeEffects, VisualizeGroundEffects } from "@/layout/VisualizeEffects";
import { getEffectMagnitude, getEffectPower } from "@/libs/combat/power";
import { invertPower } from "@/libs/combat/tags";
import type { GroundEffect } from "@/libs/combat/types";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";
import { makeEffect } from "../setup/combat";

const userId = "holder";
const runtime = { targetId: userId, creatorId: userId, fromType: "jutsu" as const };
const storedCurse = (rounds = 2, damageBonusPercent = 70) =>
  makeEffect(
    "curse",
    { power: 50, rounds, damageBonusPercent },
    {
      ...runtime,
      curseState: { storedHealing: 125, activatedRound: 1, ready: true },
    },
  );

beforeEach(() => {
  installBrowserGlobals();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  restoreBrowserGlobals();
});

describe("combat active effects", () => {
  it("caps stacked Parry at its effective maximum", () => {
    const effects = [60, 70].map((power) =>
      makeEffect("parry", { power, rounds: 3 }, { ...runtime, id: `parry-${power}` }),
    );
    const view = render(<VisualizeEffects effects={effects} userId={userId} />);
    expect(view.getByText("Parry +100% ↻ 3")).toBeTruthy();
  });

  it.each(["parry", "curse"] as const)(
    "caps scaled %s power at its applied percentage",
    (type) => {
      const effect = makeEffect(
        type,
        { power: 120, powerPerLevel: 0.3, rounds: 3 },
        { ...runtime, level: 100 },
      );
      const view = render(<VisualizeEffects effects={[effect]} userId={userId} />);
      const label = type === "parry" ? "Parry" : "Curse healing power";
      expect(view.getByText(`${label} +100% ↻ 3`)).toBeTruthy();
    },
  );

  it("shows other statuses at their applied percentage", () => {
    const effect = makeEffect(
      "reflect",
      { power: 120, powerPerLevel: 0.3, rounds: 3, calculation: "percentage" },
      { ...runtime, level: 100 },
    );
    const view = render(<VisualizeEffects effects={[effect]} userId={userId} />);
    expect(view.getByText("Reflect +100% ↻ 3")).toBeTruthy();
  });

  it("shows ground effects at their applied percentage", () => {
    const effect = makeEffect(
      "reflect",
      { power: 120, powerPerLevel: 0.3, rounds: 3, calculation: "percentage" },
      { ...runtime, level: 100 },
    );
    const view = render(
      <VisualizeGroundEffects effects={[effect as unknown as GroundEffect]} />,
    );
    expect(view.getByText(/100%/)).toBeTruthy();
    expect(view.queryByText(/150%/)).toBeNull();
  });

  it("keeps static power uncapped and caps inverted percentage decreases at -100", () => {
    const tag = { power: 120, powerPerLevel: 0.3, rounds: 3 };
    const flat = makeEffect(
      "reflect",
      { ...tag, calculation: "static" },
      { ...runtime, level: 100 },
    );
    const flatDecrease = invertPower(
      makeEffect(
        "decreasedamagegiven",
        { ...tag, calculation: "static" },
        { ...runtime, level: 100 },
      ),
    );
    const decrease = invertPower(
      makeEffect(
        "decreasedamagegiven",
        { ...tag, calculation: "percentage" },
        { ...runtime, level: 100 },
      ),
    );
    expect(getEffectMagnitude(flat)).toBe(150);
    expect(getEffectPower(flatDecrease)).toBe(-150);
    expect(getEffectPower(decrease)).toBe(-100);
    expect(getEffectMagnitude(decrease)).toBe(100);
  });

  it("hides stored Curse healing with its filtered source", () => {
    window.localStorage.setItem("ve_include_jutsu", "false");
    const view = render(<VisualizeEffects effects={[storedCurse()]} userId={userId} />);
    expect(view.queryByText(/^Curse healing power \+/)).toBeNull();
    expect(view.queryByText("Curse Healing")).toBeNull();
    expect(view.queryByText(/125\.00 HP stored/)).toBeNull();
    expect(view.queryByText(/Configured damage bonus:/)).toBeNull();
  });

  it.each([1, 2])("labels stored Curse healing with %s remaining rounds", (rounds) => {
    const view = render(
      <VisualizeEffects effects={[storedCurse(rounds)]} userId={userId} />,
    );
    expect(
      view.getByText(
        `125.00 HP stored · ${rounds} ${rounds === 1 ? "round" : "rounds"} remaining`,
      ),
    ).toBeTruthy();
  });

  it("distinguishes Curse healing power from its configured damage bonus", () => {
    const view = render(<VisualizeEffects effects={[storedCurse()]} userId={userId} />);
    expect(view.getByText("Curse healing power +50% ↻ 2")).toBeTruthy();
    expect(view.getByText("Configured damage bonus: +70%")).toBeTruthy();
  });

  it("keeps stacked Curse bonuses separate rather than displaying an additive total", () => {
    const second = { ...storedCurse(3, 20), id: "second-curse", creatorId: "ally" };
    const view = render(
      <VisualizeEffects effects={[storedCurse(), second]} userId={userId} />,
    );
    expect(view.getByText("Configured damage bonus: +70%")).toBeTruthy();
    expect(view.getByText("Configured damage bonus: +20%")).toBeTruthy();
    expect(view.queryByText("Configured damage bonus: +90%")).toBeNull();
  });

  it("shows the configured bonus when a Seal disables the Curse", () => {
    window.localStorage.setItem("ve_include_item", "false");
    const curse = { ...storedCurse(), fromType: "bloodline" as const };
    const seal = makeEffect(
      "seal",
      { rounds: 2 },
      { ...runtime, fromType: "item", isNew: false },
    );
    const view = render(<VisualizeEffects effects={[curse, seal]} userId={userId} />);
    expect(view.getByText("Configured damage bonus: +70%").className).not.toContain(
      "line-through",
    );
  });

  it("hides damage bonuses for expired and settled Curses", () => {
    const expired = { ...storedCurse(), rounds: 0 };
    const settled = {
      ...storedCurse(),
      id: "settled",
      curseState: { storedHealing: 125, activatedRound: 1, ready: true, settled: true },
    };
    const view = render(
      <VisualizeEffects effects={[expired, settled]} userId={userId} />,
    );
    expect(view.queryByText(/Configured damage bonus:/)).toBeNull();
  });

  // Kyrenjin, 16 Nov: a 40% Reflect jutsu over 8% Reflect from gear.
  const gearReflect = () =>
    makeEffect(
      "reflect",
      { power: 8, rounds: 3, calculation: "percentage" },
      { ...runtime, id: "gear-reflect", fromType: "accessory", isNew: false },
    );
  const jutsuReflect = () =>
    makeEffect(
      "reflect",
      { power: 30, powerPerLevel: 0.4, rounds: 2, calculation: "percentage" },
      { ...runtime, id: "jutsu-reflect", level: 25 },
    );

  it("adds an active Reflect jutsu to Reflect from gear", () => {
    const view = render(
      <VisualizeEffects effects={[gearReflect(), jutsuReflect()]} userId={userId} />,
    );
    expect(view.getByText("Reflect +48% ↻ 3")).toBeTruthy();
  });

  it("says which effects the source filter hides and can show them again", () => {
    window.localStorage.setItem("ve_include_jutsu", "false");
    const view = render(
      <VisualizeEffects effects={[gearReflect(), jutsuReflect()]} userId={userId} />,
    );
    expect(view.getByText("Reflect +8% ↻ 3")).toBeTruthy();
    expect(view.getByText(/1 effect hidden by the Jutsu filter/)).toBeTruthy();
    fireEvent.click(view.getByText("Show all"));
    expect(view.getByText("Reflect +48% ↻ 3")).toBeTruthy();
    expect(view.queryByText(/hidden by the/)).toBeNull();
  });

  it("lists active effects that have no dedicated section", () => {
    const effects = [
      makeEffect(
        "increasepotency",
        { power: 20, rounds: 2, affectedTag: "reflect" },
        { ...runtime, id: "potency" },
      ),
      makeEffect(
        "decreasepoolcost",
        { power: 10, calculation: "percentage" },
        { ...runtime, id: "poolcost", fromType: "bloodline" },
      ),
      makeEffect("visual", { rounds: 2 }, { ...runtime, id: "visual" }),
    ];
    const view = render(<VisualizeEffects effects={effects} userId={userId} />);
    expect(view.getByText("Other Effects")).toBeTruthy();
    expect(view.getByText("Potency (Reflect) +20 ↻ 2")).toBeTruthy();
    expect(view.getByText(/^Pool Cost -10%/)).toBeTruthy();
    expect(view.queryByText(/^Visual/)).toBeNull();
  });

  it("keeps percentage heal modifiers under Heal Given only", () => {
    const effect = makeEffect(
      "increaseheal",
      { power: 20, rounds: 2, calculation: "percentage" },
      { ...runtime, id: "heal-mod" },
    );
    const view = render(<VisualizeEffects effects={[effect]} userId={userId} />);
    expect(view.getByText("Heal Given")).toBeTruthy();
    expect(view.queryByText("Other Effects")).toBeNull();
  });

  it("keeps potency for different element selections on separate rows", () => {
    const potency = (id: string, power: number, affectedElements: string[]) =>
      makeEffect(
        "increasepotency",
        { power, rounds: 2, affectedTag: "reflect", affectedElements } as never,
        { ...runtime, id },
      );
    const view = render(
      <VisualizeEffects
        effects={[potency("fire", 20, ["Fire"]), potency("water", 30, ["Water"])]}
        userId={userId}
      />,
    );
    expect(view.getByText("Potency (Reflect, Fire) +20 ↻ 2")).toBeTruthy();
    expect(view.getByText("Potency (Reflect, Water) +30 ↻ 2")).toBeTruthy();
    expect(view.queryByText(/\+50/)).toBeNull();
  });
});
