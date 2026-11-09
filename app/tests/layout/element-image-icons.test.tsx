import { afterEach, beforeEach, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  AdjustableBasicActions,
  CombatStatTypes,
  ElementNames,
  GeneralTypes,
  MasteryTypes,
  PoolTypes,
  StatTypes,
} from "@/drizzle/constants";
import ElementImage from "@/layout/ElementImage";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

beforeEach(() => {
  installBrowserGlobals();
});

afterEach(() => {
  cleanup();
  restoreBrowserGlobals();
});

type Element = Parameters<typeof ElementImage>[0]["element"];

const describeIcon = (element: Element) => {
  const { container } = render(<ElementImage element={element} className="h-6 w-6" />);
  const root = container.firstElementChild;
  const svg = container.querySelector("svg");
  const img = container.querySelector("img");
  const label = container.querySelector(".sr-only")?.textContent;
  cleanup();
  const icon = svg
    ? `${svg.getAttribute("class")} stroke=${svg.getAttribute("stroke-width")}`
    : img
      ? `img ${img.getAttribute("alt")} ${img.getAttribute("class")}`
      : "none";
  return `${root?.tagName === "svg" ? "bare" : "wrapped"} ${icon} label=${label ?? "-"}`;
};

const EXPECTED: Record<string, string> = {
  basicAttack:
    "wrapped lucide lucide-swords rounded-full p-1 text-white h-6 w-6 bg-blue-600 stroke=3 label=basicAttack",
  offensiveStance:
    "wrapped lucide lucide-biceps-flexed rounded-full p-1 text-white h-6 w-6 bg-red-600 stroke=3 label=offensiveStance",
  defensiveStance:
    "wrapped lucide lucide-brain-cog rounded-full p-1 text-white h-6 w-6 bg-blue-600 stroke=3 label=defensiveStance",
  basicHeal:
    "wrapped lucide lucide-heart-pulse rounded-full p-1 text-white h-6 w-6 bg-green-600 stroke=3 label=basicHeal",
  meditate:
    "wrapped lucide lucide-brain rounded-full p-1 text-white h-6 w-6 bg-purple-600 stroke=3 label=meditate",
  clear:
    "wrapped lucide lucide-eraser rounded-full p-1 text-white h-6 w-6 bg-stone-500 stroke=3 label=clear",
  cleanse:
    "wrapped lucide lucide-sparkles lucide-stars rounded-full p-1 text-white h-6 w-6 bg-yellow-400 stroke=3 label=cleanse",
  flee: "wrapped none label=flee",
  move: "wrapped lucide lucide-footprints rounded-full p-1 text-white h-6 w-6 bg-cyan-600 stroke=3 label=move",
  replacementTechnique:
    "wrapped lucide lucide-loader-pinwheel rounded-full p-1 text-white h-6 w-6 bg-orange-500 stroke=3 label=replacementTechnique",
  Highest:
    "bare lucide lucide-square-plus lucide-plus-square rounded-full p-1 text-white h-6 w-6 bg-stone-500 stroke=3 label=-",
  Taijutsu:
    "wrapped lucide lucide-hand-grab lucide-grab rounded-full p-1 text-white h-6 w-6 bg-green-600 stroke=3 label=Taijutsu",
  Ninjutsu:
    "wrapped lucide lucide-zap rounded-full p-1 text-white h-6 w-6 bg-amber-500 stroke=3 label=Ninjutsu",
  Genjutsu:
    "wrapped lucide lucide-brain-cog rounded-full p-1 text-white h-6 w-6 bg-purple-600 stroke=3 label=Genjutsu",
  Bukijutsu:
    "wrapped lucide lucide-sword rounded-full p-1 text-white h-6 w-6 bg-red-600 stroke=3 label=Bukijutsu",
  Offence:
    "wrapped lucide lucide-swords rounded-full p-1 text-white h-6 w-6 bg-red-700 stroke=3 label=Offence",
  Defence:
    "wrapped lucide lucide-shield rounded-full p-1 text-white h-6 w-6 bg-sky-700 stroke=3 label=Defence",
  Bloodline:
    "wrapped lucide lucide-heart rounded-full p-1 text-white h-6 w-6 bg-rose-600 stroke=3 label=Bloodline",
  Sage: "wrapped lucide lucide-sparkles lucide-stars rounded-full p-1 text-white h-6 w-6 bg-emerald-600 stroke=3 label=Sage",
  Strength:
    "wrapped lucide lucide-biceps-flexed rounded-full p-1 text-white h-6 w-6 bg-blue-800 stroke=3 label=Strength",
  Intelligence:
    "wrapped lucide lucide-brain rounded-full p-1 text-white h-6 w-6 bg-teal-600 stroke=3 label=Intelligence",
  Speed:
    "wrapped lucide lucide-footprints rounded-full p-1 text-white h-6 w-6 bg-cyan-600 stroke=3 label=Speed",
  Willpower:
    "wrapped lucide lucide-flame rounded-full p-1 text-white h-6 w-6 bg-orange-600 stroke=3 label=Willpower",
  Health:
    "wrapped lucide lucide-heart rounded-full p-1 text-white h-6 w-6 bg-red-600 stroke=3 label=Health",
  Chakra:
    "wrapped lucide lucide-atom rounded-full p-1 text-white h-6 w-6 bg-blue-600 stroke=3 label=Chakra",
  Stamina:
    "wrapped lucide lucide-battery-medium rounded-full p-1 text-white h-6 w-6 bg-green-600 stroke=3 label=Stamina",
  All: "wrapped lucide lucide-loader-pinwheel h-6 w-6 rounded-full bg-gray-600 p-1 text-white stroke=2 label=All",
};

it("renders every element, stat, pool and action with its own icon", () => {
  const values = [
    ...new Set<string>([
      ...ElementNames,
      ...StatTypes,
      ...CombatStatTypes,
      ...MasteryTypes,
      ...GeneralTypes,
      ...PoolTypes,
      ...AdjustableBasicActions,
      ...Object.keys(EXPECTED),
      "None",
    ]),
  ];
  const rendered = Object.fromEntries(
    values.map((value) => [value, describeIcon(value as Element)]),
  );
  for (const name of ElementNames) {
    expect(rendered[name]).toStartWith(`wrapped img ${name} h-6 w-6`);
  }
  for (const value of values) {
    if (!(value in EXPECTED) && !ElementNames.includes(value as never)) {
      expect(rendered[value]).toBe(`wrapped none label=${value}`);
    }
  }
  expect(
    Object.fromEntries(Object.keys(EXPECTED).map((key) => [key, rendered[key]])),
  ).toEqual(EXPECTED);
});
