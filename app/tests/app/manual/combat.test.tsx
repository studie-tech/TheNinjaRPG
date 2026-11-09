import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import ManualCombat from "@/app/[shell]/manual/combat/page";
import * as BattleLengthHistogram from "@/layout/BattleLengthHistogram";
import * as ContentBox from "@/layout/ContentBox";
import * as Link from "@/layout/Link";
import {
  INITIATIVE_LEVEL_BONUS,
  INITIATIVE_PVP_STREAK_BONUSES,
  INITIATIVE_TERRITORY_BONUS,
} from "@/libs/combat/constants";
import * as UserContext from "@/utils/UserContext";

beforeEach(() => {
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  vi.spyOn(Link, "default").mockImplementation(({ children }) => <span>{children}</span>);
  vi.spyOn(BattleLengthHistogram, "BattleLengthHistogram").mockImplementation(
    () => null,
  );
  vi.spyOn(UserContext, "useUserData").mockReturnValue({ data: undefined } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const percent = (fraction: number) => `${Number((fraction * 100).toFixed(2))}%`;

it("states the initiative modifiers from the combat constants", () => {
  const text = (render(<ManualCombat />).container.textContent ?? "").replace(
    /\s+/g,
    " ",
  );
  expect(text).toContain(
    `For each level above the opponents' average level, a bonus of ${percent(INITIATIVE_LEVEL_BONUS)} is added`,
  );
  expect(text).toContain(
    `If in own territory, a bonus of ${percent(INITIATIVE_TERRITORY_BONUS)} is added`,
  );
  expect(text).toContain(
    `If outside own territory, initiative is reduced by ${percent(INITIATIVE_TERRITORY_BONUS)}`,
  );
  const steps = INITIATIVE_PVP_STREAK_BONUSES.slice(0, -1);
  const tail = INITIATIVE_PVP_STREAK_BONUSES[INITIATIVE_PVP_STREAK_BONUSES.length - 1] ?? 0;
  expect(text).toContain(
    `the streak adds ${steps.map(percent).join(", ")} for the first ${steps.length} kills, then ${percent(tail)} for each further kill`,
  );
});
