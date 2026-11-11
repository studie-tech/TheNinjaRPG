import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import ManualMain from "@/app/[shell]/manual/page";
import * as ContentBox from "@/layout/ContentBox";
import * as ImageLinkGrid from "@/layout/ImageLinkGrid";
import * as UserContext from "@/utils/UserContext";

type Tile = { href: string; label?: string };
let grids: Tile[][];

beforeEach(() => {
  grids = [];
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  vi.spyOn(ImageLinkGrid, "ImageLinkGrid").mockImplementation(({ entries }) => {
    grids.push(entries);
    return null;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Player tiles and staff tiles rendered for the role, in display order. */
const manualGrids = (role: string) => {
  grids = [];
  vi.spyOn(UserContext, "useUserData").mockReturnValue({ data: { role } } as never);
  render(<ManualMain />);
  const [player = [], staff = []] = grids;
  return { player, staff };
};
const manualCards = (role: string) => {
  const { player, staff } = manualGrids(role);
  return [...player, ...staff].map((tile) => tile.href);
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

it("lists player pages, then the staff tools permitted to each role, by caption", () => {
  const byHref = (names: string[]) => names.map((name) => `/manual/${name}`).sort();
  for (const [role, extra] of Object.entries(roleCards)) {
    const { player, staff } = manualGrids(role);
    expect(player.map((tile) => tile.href).sort()).toEqual(byHref(playerCards));
    expect(staff.map((tile) => tile.href).sort()).toEqual(byHref(extra));
    for (const tiles of [player, staff]) {
      const labels = tiles.map((tile) => tile.label ?? "");
      expect(labels.every(Boolean)).toBe(true);
      expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
    }
    cleanup();
  }
});

it("captions tiles with readable names instead of route slugs", () => {
  const { player } = manualGrids("USER");
  const label = (href: string) => player.find((tile) => tile.href === href)?.label;
  expect(label("/manual/damage_calcs")).toBe("Damage Calculator");
  expect(label("/manual/pvp_rank")).toBe("Ranked PvP");
  expect(label("/manual/crafting_recipes")).toBe("Crafting Recipes");
});
