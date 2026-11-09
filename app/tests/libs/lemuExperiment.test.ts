import { afterEach, describe, expect, it, vi } from "bun:test";
import { IMG_URL_ASSISTANT } from "@/drizzle/constants";
import { getExperimentAssignments } from "@/libs/experimentAnalytics";
import {
  drawLemuVariant,
  getLemuImage,
  LEMU_EXPERIMENT,
  normalizeLemuVariant,
} from "@/libs/lemuExperiment";

afterEach(() => vi.restoreAllMocks());

describe("Lemu experiment", () => {
  it("records the current experiment id and uses IMG_URL_ASSISTANT as the control portrait", () => {
    expect(getLemuImage("control")).toBe(IMG_URL_ASSISTANT);
    expect(IMG_URL_ASSISTANT).toBe(
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJIG7HmDxfOewksxBoS1HQCihpL7c42Ky9uUFv.webp",
    );
    expect(getExperimentAssignments({ abLemuReplacementVariant: "control" })).toEqual([
      { experiment: "ab_lemu_replacement_3", variant: "control" },
    ]);
    expect(LEMU_EXPERIMENT).toBe("ab_lemu_replacement_3");
  });

  it.each(["treatment", "treatment_7", "unknown", "", null, undefined])(
    "rejects unknown assignment %s",
    (value) => {
      expect(normalizeLemuVariant(value)).toBeUndefined();
      expect(getExperimentAssignments({ abLemuReplacementVariant: value })).toEqual([]);
      expect(getLemuImage(value ?? undefined)).toBe(IMG_URL_ASSISTANT);
    },
  );

  it.each([
    ["treatment_1", "https://ui0arpl8sm.ufs.sh/f/content-jlYDeVvWQIv0UDYJndtBn.webp"],
    ["treatment_2", "https://ui0arpl8sm.ufs.sh/f/content-6jMP1VF5X1Zu2wppt4vec.webp"],
    ["treatment_3", "https://ui0arpl8sm.ufs.sh/f/content-NBVEXpYD8aRhwFof6jq45.webp"],
    ["treatment_4", "https://ui0arpl8sm.ufs.sh/f/content-2bwqugh_JdcS55ALvzfhV.webp"],
    ["treatment_5", "https://ui0arpl8sm.ufs.sh/f/content-r6_prvN1P_dntlkbOEJSL.webp"],
    ["treatment_6", "https://ui0arpl8sm.ufs.sh/f/content-jMcyVJrtGlAclqlBlbJFR.webp"],
  ])("uses the selected portrait for %s and records the same arm", (variant, url) => {
    expect(getLemuImage(variant)).toBe<typeof url>(url);
    expect(normalizeLemuVariant(variant)).toBe<typeof variant>(variant);
    expect(getExperimentAssignments({ abLemuReplacementVariant: variant })).toEqual([
      { experiment: LEMU_EXPERIMENT, variant },
    ]);
  });

  it.each([
    [0, "control"],
    [1 / 7 - 0.00001, "control"],
    [1 / 7, "treatment_1"],
    [2 / 7 - 0.00001, "treatment_1"],
    [2 / 7, "treatment_2"],
    [3 / 7 - 0.00001, "treatment_2"],
    [3 / 7, "treatment_3"],
    [4 / 7 - 0.00001, "treatment_3"],
    [4 / 7, "treatment_4"],
    [5 / 7 - 0.00001, "treatment_4"],
    [5 / 7, "treatment_5"],
    [6 / 7 - 0.00001, "treatment_5"],
    [6 / 7, "treatment_6"],
    [0.99999, "treatment_6"],
  ] as const)("allocates random draw %s to %s", (draw, variant) => {
    vi.spyOn(Math, "random").mockReturnValue(draw);
    expect(drawLemuVariant()).toBe(variant);
  });
});
