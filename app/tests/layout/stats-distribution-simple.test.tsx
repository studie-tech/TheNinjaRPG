import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import {
  ELEMENTAL_MASTERY_CAP,
  getCombatStatCap,
  getUserCaps,
} from "@/drizzle/constants";
import * as tutorial from "@/hooks/tutorial";
import * as Modal from "@/layout/Modal";
import DistributeStatsForm from "@/layout/StatsDistributionForm";
import type { UserWithRelations } from "@/routers/profile";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

beforeEach(() => {
  installBrowserGlobals();
  vi.spyOn(tutorial, "useTutorialStep").mockReturnValue({
    currentStep: null,
    completeTutorialAction: vi.fn(async () => {}),
  } as unknown as ReturnType<typeof tutorial.useTutorialStep>);
  vi.spyOn(Modal, "default").mockImplementation(({ isOpen, onAccept, children }) =>
    isOpen ? (
      <div role="dialog">
        <button type="button" onClick={onAccept}>
          Proceed
        </button>
        {children}
      </div>
    ) : null,
  );
});

afterEach(() => {
  cleanup();
  restoreBrowserGlobals();
  vi.restoreAllMocks();
});

const caps = getUserCaps("JONIN");
const statCap = getCombatStatCap(caps, "offence");
const genCap = getCombatStatCap(caps, "strength");

const trainee = {
  rank: "JONIN",
  status: "AWAKE",
  earnedExperience: 1001,
  offence: statCap,
  defence: statCap,
  strength: genCap,
  speed: genCap,
  intelligence: genCap - 100,
  willpower: 10,
  ninjutsuMastery: 10,
  genjutsuMastery: 10,
  taijutsuMastery: 10,
  bukijutsuMastery: 10,
  bloodlineMastery: 10,
  sageMastery: 10,
  masteryRanks: {},
  primaryElement: "Fire",
  secondaryElement: null,
  elementalMastery: { Lightning: ELEMENTAL_MASTERY_CAP },
} as unknown as NonNullable<UserWithRelations>;

const mount = (onAccept = vi.fn(), userData = trainee, includeMasteries = false) => {
  const view = render(
    <DistributeStatsForm
      includeMasteries={includeMasteries}
      showWrapper={false}
      userData={userData}
      availableStats={userData.earnedExperience}
      onAccept={onAccept}
      isPending={false}
    />,
  );
  if (includeMasteries) fireEvent.click(view.getByRole("button", { name: "Simple" }));
  return view;
};
const preset = (view: ReturnType<typeof render>, name: string) =>
  view
    .getAllByRole("button")
    .find((button) => button.querySelector("p")?.textContent === name)!;

describe("simple experience presets", () => {
  it("disables a preset only when every one of its stats is capped", () => {
    const view = mount();
    expect(preset(view, "Body").getAttribute("aria-disabled")).toBe("true");
    expect(preset(view, "Body").textContent).toContain("Stats maxed");
    for (const name of ["Mind", "Resolve", "Tactics"]) {
      expect(preset(view, name).getAttribute("aria-disabled")).toBe("false");
      expect(preset(view, name).textContent).not.toContain("Stats maxed");
    }
  });

  it("previews capped stats and applies the spilled split on top of zero defaults", () => {
    const accept = vi.fn();
    const view = mount(accept);
    fireEvent.click(preset(view, "Mind"));
    const items = [...view.getByRole("dialog").querySelectorAll("li")];
    expect(items.map((item) => [item.textContent, item.className])).toEqual([
      ["Willpower (+901)", "capitalize "],
      ["Intelligence (+100)", "capitalize "],
      ["Offence (+0) (currently maxed)", "capitalize font-semibold text-red-500"],
      ["Defence (+0) (currently maxed)", "capitalize font-semibold text-red-500"],
    ]);
    fireEvent.click(view.getByRole("button", { name: "Proceed" }));
    expect(accept).toHaveBeenCalledTimes(1);
    expect(accept.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        offence: 0,
        defence: 0,
        strength: 0,
        speed: 0,
        intelligence: 100,
        willpower: 901,
      }),
    );
  });

  it("labels elemental presets that cannot take points", () => {
    const view = mount(vi.fn(), trainee, true);
    expect(preset(view, "Lightning Mastery").textContent).toContain("Fully mastered");
    expect(preset(view, "Lightning Mastery").getAttribute("aria-disabled")).toBe(
      "true",
    );
    expect(preset(view, "Water Mastery").getAttribute("aria-disabled")).toBe("false");
    cleanup();
    const asleep = mount(
      vi.fn(),
      { ...trainee, status: "BATTLE" } as typeof trainee,
      true,
    );
    expect(preset(asleep, "Water Mastery").textContent).toContain("Must be awake");
    expect(preset(asleep, "Mind").getAttribute("aria-disabled")).toBe("false");
  });
});
