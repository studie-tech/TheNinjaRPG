import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as client from "@/app/_trpc/client";
import RankedManualPage from "@/app/[shell]/manual/pvp_rank/page";
import {
  RANKED_DIVISIONS,
  RANKED_LOADOUT_MAX_CONSUMABLES,
  RANKED_LOSS_PROTECTION_FACTOR,
  RANKED_LOSS_PROTECTION_RANK_GAP,
  RANKED_MIN_LP_GAIN,
  RANKED_STREAK_BONUS,
  RANKED_UPSET_BONUS_PER_RANK,
} from "@/drizzle/constants";
import * as LocalStorage from "@/hooks/localstorage";
import * as ContentBox from "@/layout/ContentBox";
import * as QueueLengthHistogram from "@/layout/QueueLengthHistogram";
import * as RankedLoadoutFiltering from "@/layout/RankedLoadoutFiltering";
import * as RankedRankDistributionHistogram from "@/layout/RankedRankDistributionHistogram";
import * as SeasonManager from "@/layout/SeasonManager";
import * as Table from "@/layout/Table";
import * as UnclaimedSeasonRewards from "@/layout/UnclaimedSeasonRewards";

beforeEach(() => {
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  vi.spyOn(SeasonManager, "SeasonManager").mockImplementation(() => <></>);
  vi.spyOn(UnclaimedSeasonRewards, "UnclaimedSeasonRewards").mockImplementation(
    () => <></>,
  );
  vi.spyOn(QueueLengthHistogram, "QueueLengthHistogram").mockImplementation(() => null);
  vi.spyOn(
    RankedRankDistributionHistogram,
    "RankedRankDistributionHistogram",
  ).mockImplementation(() => null);
  vi.spyOn(RankedLoadoutFiltering, "default").mockImplementation(() => null);
  vi.spyOn(Table, "default").mockImplementation(() => <></>);
  vi.spyOn(RankedLoadoutFiltering, "useFiltering").mockReturnValue({} as never);
  vi.spyOn(RankedLoadoutFiltering, "getFilter").mockReturnValue({} as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    misc: {
      getJutsuEquipLimits: {
        useQuery: () => ({ data: [], isError: false, refetch: vi.fn() }),
      },
    },
    data: {
      getRankedLoadoutStatistics: {
        useQuery: () => ({ data: [], isPending: false }),
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderTab = (tab: string) => {
  vi.spyOn(LocalStorage, "useLocalStorage").mockReturnValue([tab, vi.fn()] as never);
  return render(<RankedManualPage />);
};

it("states the LP rules from the ranked constants", () => {
  const text = renderTab("rewards").container.textContent ?? "";
  for (const division of RANKED_DIVISIONS.filter((d) => Number.isFinite(d.rankedLp))) {
    expect(text).toContain(
      `${division.name} (${division.rankedLp}+ LP): ${division.kFactor} LP`,
    );
  }
  expect(text).not.toContain("Sannin (");
  expect(text).toContain(
    `adds ${RANKED_UPSET_BONUS_PER_RANK} LP per rank between you`,
  );
  expect(text).toContain(`adds ${RANKED_STREAK_BONUS} LP for every win`);
  expect(text).toContain(`Every win gains at least ${RANKED_MIN_LP_GAIN} LP`);
  expect(text).toContain(
    `at least ${RANKED_LOSS_PROTECTION_RANK_GAP} ranks above you costs ${Math.round(
      RANKED_LOSS_PROTECTION_FACTOR * 100,
    )}% of the usual LP`,
  );
});

it("states the consumable limit from the ranked constants", () => {
  const text = renderTab("loadouts").container.textContent ?? "";
  expect(text).toContain(`Choose up to ${RANKED_LOADOUT_MAX_CONSUMABLES} consumables`);
});
