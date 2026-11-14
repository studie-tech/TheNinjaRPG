import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import type { ItemWithEffectsProps } from "@/layout/ItemWithEffects";
import ItemWithEffects from "@/layout/ItemWithEffects";
import * as UserContext from "@/utils/UserContext";

const names = { useQuery: () => ({ data: [] }) };

const content = (overrides: Record<string, unknown>) =>
  ({
    id: "content",
    name: "Content",
    description: "Some content.",
    effects: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as unknown as ItemWithEffectsProps["item"];

beforeEach(() => {
  Object.assign(vi.spyOn(client, "api" as never), {
    bloodline: { getAllNames: names },
    sageMode: { getAllNames: names },
    skillTree: { getAllNames: names },
    item: { getAllNames: names, getEvolutions: names },
    jutsu: { getEvolutions: names },
  });
  vi.spyOn(UserContext, "useUserDataSelector").mockImplementation(
    (select) => ({ data: select({ role: "USER" } as never) }) as never,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const rowText = (view: ReturnType<typeof render>, label: string) =>
  view.queryByText(label)?.parentElement?.textContent ?? null;

it("lists only the content flags that are set, each as yes", () => {
  const flags = {
    canBeHunted: "Can be Hunted",
    canBeGathered: "Can be Gathered",
    canBeTraded: "Can be Traded",
    canBeCrafted: "Can be Crafted",
    onInitialBattleField: "On battlefield",
  };
  const set = render(
    <ItemWithEffects
      item={content(Object.fromEntries(Object.keys(flags).map((key) => [key, true])))}
      hideImage
    />,
  );
  for (const label of Object.values(flags)) {
    expect(rowText(set, label)).toBe(`${label}: yes`);
  }
  cleanup();
  const unset = render(
    <ItemWithEffects
      item={content(Object.fromEntries(Object.keys(flags).map((key) => [key, false])))}
      hideImage
    />,
  );
  for (const label of Object.values(flags)) expect(rowText(unset, label)).toBeNull();
});

it("highlights each required rank except NONE", () => {
  const view = render(
    <ItemWithEffects
      item={content({
        medicalRank: "CHUNIN",
        huntingRank: "NONE",
        gatheringRank: "GENIN",
        requiredSageRank: null,
      })}
      hideImage
    />,
  );
  const medical = view.getByText("Medical Rank Requirement").closest("div");
  expect(medical?.className).toBe("my-2 rounded-lg bg-poppopover p-2");
  expect(medical?.textContent).toBe("Medical Rank Requirement: CHUNIN");
  expect(rowText(view, "Gathering Rank Requirement")).toBe(
    "Gathering Rank Requirement: GENIN",
  );
  expect(view.queryByText("Hunting Rank Requirement")).toBeNull();
  expect(view.queryByText("Sage Rank Requirement")).toBeNull();
  cleanup();
  const sage = render(
    <ItemWithEffects item={content({ requiredSageRank: "S" })} hideImage />,
  );
  expect(rowText(sage, "Sage Rank Requirement")).toBe("Sage Rank Requirement: S");
});

it("shows the hidden flag to content staff only and names targets in plain words", () => {
  const item = content({ hidden: false, target: "OTHER_USER", method: "SINGLE" });
  const player = render(<ItemWithEffects item={item} hideImage />);
  expect(player.queryByText("Hidden")).toBeNull();
  expect(rowText(player, "Target")).toBe("Target: Other player");
  expect(rowText(player, "Method")).toBe("Method: Single target");
  cleanup();
  vi.spyOn(UserContext, "useUserDataSelector").mockImplementation(
    (select) => ({ data: select({ role: "CONTENT-ADMIN" } as never) }) as never,
  );
  const staff = render(<ItemWithEffects item={item} hideImage />);
  expect(rowText(staff, "Hidden")).toBe("Hidden: no");
});
