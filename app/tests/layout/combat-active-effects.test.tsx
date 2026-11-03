import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { VisualizeEffects } from "@/layout/MenuBoxProfile";
import { makeEffect } from "../libs/combat/helpers/battleScenario";
import { ensureDom } from "../setup/dom.mjs";

const userId = "holder";
const runtime = { targetId: userId, creatorId: userId, fromType: "jutsu" as const };
const storedCurse = (rounds = 2) =>
  makeEffect("curse", { power: 50, rounds }, {
    ...runtime,
    curseState: { storedHealing: 125, activatedRound: 1, ready: true },
  });

beforeEach(() => {
  ensureDom();
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

  it.each(["parry", "curse"] as const)("caps scaled %s power at its applied percentage", (type) => {
    const effect = makeEffect(type, { power: 120, powerPerLevel: 0.3, rounds: 3 }, { ...runtime, level: 100 });
    const view = render(<VisualizeEffects effects={[effect]} userId={userId} />);
    const label = type === "parry" ? "Parry" : "Curse";
    expect(view.getByText(`${label} +100% ↻ 3`)).toBeTruthy();
  });

  it("preserves the displayed power of other statuses", () => {
    const effect = makeEffect("reflect", { power: 120, powerPerLevel: 0.3, rounds: 3, calculation: "percentage" }, { ...runtime, level: 100 });
    const view = render(<VisualizeEffects effects={[effect]} userId={userId} />);
    expect(view.getByText("Reflect +150% ↻ 3")).toBeTruthy();
  });

  it("hides stored Curse healing with its filtered source", () => {
    window.localStorage.setItem("ve_include_jutsu", "false");
    const view = render(<VisualizeEffects effects={[storedCurse()]} userId={userId} />);
    expect(view.queryByText(/^Curse \+/)).toBeNull();
    expect(view.queryByText("Curse Healing")).toBeNull();
    expect(view.queryByText(/125\.00 HP stored/)).toBeNull();
  });

  it.each([1, 2])("labels stored Curse healing with %s remaining rounds", (rounds) => {
    const view = render(<VisualizeEffects effects={[storedCurse(rounds)]} userId={userId} />);
    expect(view.getByText(`125.00 HP stored · ${rounds} ${rounds === 1 ? "round" : "rounds"} remaining`)).toBeTruthy();
  });
});
