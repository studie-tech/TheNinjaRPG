import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import * as activityStreaks from "@/hooks/useActivityStreaks";
import * as bankInterest from "@/hooks/useBankInterest";
import * as sectorVillage from "@/hooks/useSectorVillage";
import * as LevelUpBtn from "@/layout/LevelUpBtn";
import * as Logbook from "@/layout/Logbook";
import ProfileDashboard from "@/layout/ProfileDashboard";
import * as RewardChoice from "@/layout/RewardChoice";
import * as userContext from "@/utils/UserContext";

const now = Date.now();
const user = {
  userId: "player",
  username: "Player",
  status: "AWAKE",
  level: 10,
  experience: 0,
  earnedExperience: 0,
  rank: "GENIN",
  sector: 1,
  village: null,
  villageId: null,
  isOutlaw: false,
  occupation: "CRAFTING",
  activeRaids: [],
  userQuests: [],
  dashboardContentPriority: null,
};
const query = (data: unknown) => ({
  data,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
});

beforeEach(() => {
  vi.spyOn(userContext, "useRequiredUserData").mockReturnValue({
    data: user,
    timeDiff: 0,
  } as never);
  vi.spyOn(sectorVillage, "useSectorVillage").mockReturnValue({
    sectorVillage: undefined,
    isLoading: false,
  } as never);
  vi.spyOn(activityStreaks, "useActivityStreaks").mockReturnValue(
    query({ streaks: [] }) as never,
  );
  vi.spyOn(activityStreaks, "useClaimStreakDay").mockReturnValue({} as never);
  vi.spyOn(bankInterest, "usePendingBankInterest").mockReturnValue(
    query({ totalPending: 0, records: [] }) as never,
  );
  vi.spyOn(bankInterest, "useClaimBankInterest").mockReturnValue({} as never);
  vi.spyOn(LevelUpBtn, "default").mockImplementation(() => null);
  vi.spyOn(RewardChoice, "PendingRewardChoices").mockImplementation(() => null);
  vi.spyOn(Logbook, "LogbookActive").mockImplementation(() => null);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    profile: {
      getDashboard: { useQuery: () => query({ candidates: [], raidRewards: [] }) },
      getSidebarTimers: {
        useQuery: () =>
          query({
            imbuement: {
              imbuedName: "Flame Seal",
              targetName: "Kunai",
              craftingStartedAt: new Date(now - 60_000),
              craftingFinishedAt: new Date(now + 60_000),
            },
          }),
      },
    },
    hunting: { getSession: { useQuery: () => query(undefined) } },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("links an in-progress imbuement to the occupation page where imbuing runs", () => {
  render(<ProfileDashboard />);
  const row = screen.getByText("Imbuing").closest("div")!.parentElement!;
  const link = within(row.parentElement!).getByRole("link", { name: /View/ });
  expect(link.getAttribute("href")).toBe("/occupation");
});
