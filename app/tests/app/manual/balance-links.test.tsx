import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import * as client from "@/app/_trpc/client";
import ManualBalance from "@/app/[shell]/manual/balance/page";
import ManualBackupPage from "@/app/[shell]/manual/content_backups/page";
import * as ContentBox from "@/layout/ContentBox";
import * as UserContext from "@/utils/UserContext";

beforeEach(() => {
  vi.spyOn(ContentBox, "default").mockImplementation(
    ({ children, topRightContent }) => (
      <div>
        {topRightContent}
        {children}
      </div>
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("links each balance data source from its content row and column", () => {
  const view = render(
    <AppRouterContext.Provider value={{} as never}>
      <ManualBalance />
    </AppRouterContext.Provider>,
  );
  const rows = view.getAllByRole("row").slice(1);
  const cells = rows.map((row) =>
    within(row)
      .getAllByRole("cell")
      .map((cell) => {
        const link = cell.querySelector("a");
        return link ? link.getAttribute("href") : cell.textContent;
      }),
  );
  expect(cells).toEqual([
    [
      "Bloodlines",
      "/manual/bloodline/balance#Usage",
      "/manual/bloodline/balance#Power",
      "/manual/bloodline/completeness#Incomplete",
      "/manual/bloodline/completeness#Diversity",
      "",
    ],
    [
      "Jutsus",
      "/manual/jutsu/balance#Usage",
      "/manual/jutsu/balance#Power",
      "/manual/jutsu/completeness#Incomplete",
      "/manual/jutsu/completeness#Diversity",
      "",
    ],
    [
      "Items",
      "/manual/item/balance#Usage",
      "/manual/item/balance#Power",
      "/manual/item/completeness#Incomplete",
      "/manual/item/completeness#Diversity",
      "",
    ],
    [
      "AI",
      "/manual/ai/balance#Usage",
      "/manual/ai/balance#Power",
      "/manual/ai/completeness",
      "",
      "",
    ],
    [
      "Skill Trees",
      "/manual/skillTree/balance#Usage",
      "/manual/skillTree/balance#Power",
      "",
      "",
      "",
    ],
    [
      "Ranked PvP",
      "/manual/pvp_rank#loadouts",
      "",
      "",
      "/manual/pvp_rank#rewards",
      "/manual/pvp_rank#matchmaking",
    ],
    ["Combat", "", "", "", "", "/manual/combat"],
  ]);
  for (const link of view.getAllByRole("link")) {
    expect(link.querySelector("svg")?.getAttribute("class")).toContain("h-4 w-4");
  }
});

it("creates a backup of the content type named on each button", () => {
  const createBackup = vi.fn();
  vi.spyOn(UserContext, "useUserData").mockReturnValue({
    data: { role: "OWNER" },
  } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    staff: {
      getBackups: { useQuery: () => ({ data: [] }) },
      createBackup: { useMutation: () => ({ mutate: createBackup, isPending: false }) },
      pushBackupToDev: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  });
  const view = render(
    <AppRouterContext.Provider value={{} as never}>
      <ManualBackupPage />
    </AppRouterContext.Provider>,
  );
  const labels = ["Bloodlines", "Jutsu", "Items", "AI"];
  expect(
    view
      .getAllByRole("button")
      .map((button) => button.textContent?.trim())
      .filter((label) => labels.includes(label ?? "")),
  ).toEqual(labels);
  for (const label of labels) {
    fireEvent.click(view.getByRole("button", { name: label }));
  }
  expect(createBackup.mock.calls).toEqual([
    [{ type: "bloodline" }],
    [{ type: "jutsu" }],
    [{ type: "item" }],
    [{ type: "ai" }],
  ]);
});
