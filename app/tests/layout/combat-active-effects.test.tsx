import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { VisualizeEffects, VisualizeGroundEffects } from "@/layout/VisualizeEffects";
import { getEffectMagnitude, getEffectPower } from "@/libs/combat/power";
import { invertPower } from "@/libs/combat/tags";
import type { GroundEffect } from "@/libs/combat/types";
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
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
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
});
