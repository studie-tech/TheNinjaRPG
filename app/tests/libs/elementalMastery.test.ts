import { describe, expect, it } from "bun:test";
import { type BasicElement, ELEMENTAL_MASTERY_CAP } from "@/drizzle/constants";
import {
  activeTrainedElement,
  elementalGainRoom,
  type ElementalMasterySource,
  providedElements,
  getUserElements,
} from "@/libs/elementalMastery";
import { AllTags } from "@/validators/combat";

// A mastered innate element becomes active only when a bloodline replaces its slot.
const trainee = {
  primaryElement: "Fire",
  secondaryElement: "Water",
  elementalMastery: { Fire: ELEMENTAL_MASTERY_CAP },
  activeTrainedElement: "Fire",
} satisfies ElementalMasterySource;
/** Creates a beneficial elemental grant for bloodline override scenarios. */
const bloodline = (elements: BasicElement[]) => ({
  effects: [AllTags.parse({ type: "increasedamagegiven", elements, power: 40 })],
});

describe("bloodline element overrides", () => {
  it.each([
    ["Wind"], ["Wind", "Earth"], ["Water"], ["Wind", "Wind"],
  ] satisfies BasicElement[][])("replaces both innate slots with %j", (...elements: BasicElement[]) => {
    const user = { ...trainee, bloodline: bloodline(elements) };
    const provided = Array.from(new Set(elements));
    expect(providedElements(user)).toEqual(provided);
    expect(elementalGainRoom(user, "Water")).toBe(
      elements.includes("Water") ? 0 : ELEMENTAL_MASTERY_CAP,
    );
    expect(activeTrainedElement(user)).toBe("Fire");
    expect(getUserElements(user as never)).toEqual([...provided, "Fire", "None"]);
    for (const element of elements) expect(elementalGainRoom(user, element)).toBe(0);
  });

  it("restores innate eligibility rules when a bloodline is removed or has no elements", () => {
    for (const line of [null, { effects: [] }, {
      effects: [AllTags.parse({ type: "increasedamagetaken", elements: ["Wind"] })],
    }]) {
      const user = { ...trainee, bloodline: line };
      expect(providedElements(user)).toEqual(["Fire", "Water"]);
      expect(elementalGainRoom(user, "Water")).toBe(0);
      expect(elementalGainRoom(user, "Wind")).toBe(ELEMENTAL_MASTERY_CAP);
      expect(activeTrainedElement(user)).toBeNull();
      expect(user.elementalMastery.Fire).toBe(ELEMENTAL_MASTERY_CAP);
      expect(getUserElements(user as never)).toEqual(["Fire", "Water", "None"]);
    }
  });

  it("suppresses a mastered element when a swapped bloodline provides it", () => {
    const user = { ...trainee, bloodline: bloodline(["Fire"]) };
    expect(activeTrainedElement(user)).toBeNull();
    expect(elementalGainRoom(user, "Fire")).toBe(0);
    expect(getUserElements(user as never)).toEqual(["Fire", "None"]);
    expect(user.elementalMastery.Fire).toBe(ELEMENTAL_MASTERY_CAP);
  });
});
