import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import ManualMain from "@/app/[shell]/manual/page";
import * as ContentBox from "@/layout/ContentBox";
import * as ImageLinkGrid from "@/layout/ImageLinkGrid";
import * as UserContext from "@/utils/UserContext";

let hrefs: string[];

beforeEach(() => {
  hrefs = [];
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => <div>{children}</div>);
  vi.spyOn(ImageLinkGrid, "ImageLinkGrid").mockImplementation(({ entries }) => {
    hrefs = entries.map((entry) => entry.href);
    return null;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const manualCards = (role: string) => {
  vi.spyOn(UserContext, "useUserData").mockReturnValue({ data: { role } } as never);
  render(<ManualMain />);
  return hrefs;
};

it("lists the dungeon and hunting editors only for content staff", () => {
  expect(manualCards("USER")).not.toContain("/manual/dungeon");
  expect(manualCards("USER")).not.toContain("/manual/hunting");
  expect(manualCards("USER")).toContain("/manual/quest");
  expect(manualCards("CONTENT")).toContain("/manual/dungeon");
  expect(manualCards("CONTENT")).toContain("/manual/hunting");
});

const playerCards = [
  "activityStreak",
  "ai",
  "asset",
  "awards",
  "badge",
  "balance",
  "bloodline",
  "bloodright",
  "combat",
  "companions",
  "crafting_recipes",
  "damage_calcs",
  "item",
  "jutsu",
  "logs",
  "opinions",
  "polls",
  "pvp_rank",
  "quest",
  "sageMode",
  "skillTree",
  "staff",
  "title",
  "towerDefense",
];
const moderatorCards = ["recruitment", "review", "rewards"];
const contentCards = [
  "dungeon",
  "hunting",
  ...moderatorCards,
  "sprite_studio",
  "tournaments",
  "world",
];
const roleCards: Record<string, string[]> = {
  USER: [],
  OWNER: ["content_backups", ...contentCards],
  "CODING-ADMIN": ["content_backups", ...contentCards],
  "CONTENT-ADMIN": ["content_backups", ...contentCards],
  "EVENT-ADMIN": ["content_backups", ...contentCards],
  "MODERATOR-ADMIN": contentCards.filter((card) => card !== "tournaments"),
  HEAD_MODERATOR: moderatorCards,
  MODERATOR: moderatorCards,
  JR_MODERATOR: moderatorCards,
  HEAD_CONTENT: contentCards,
  HEAD_BALANCE: contentCards,
  CONTENT: contentCards,
  BALANCE: contentCards,
  HEAD_EVENT: contentCards,
  EVENT: contentCards,
  CODER: contentCards,
};

it("lists every card permitted to each role in alphabetical order", () => {
  for (const [role, extra] of Object.entries(roleCards)) {
    const expected = [...playerCards, ...extra]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => `/manual/${name}`);
    expect(manualCards(role)).toEqual(expected);
    cleanup();
  }
});
