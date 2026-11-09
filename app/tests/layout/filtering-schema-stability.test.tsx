import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useFiltering as useAiBalanceFiltering } from "@/layout/AiBalanceFiltering";
import { useApplicationsFiltering } from "@/layout/ApplicationsFiltering";
import { useFiltering as useBattleLengthFiltering } from "@/layout/BattleLengthFiltering";
import { useFiltering as useBloodlineBalanceFiltering } from "@/layout/BloodlineBalanceFiltering";
import { useFiltering as useItemBalanceFiltering } from "@/layout/ItemBalanceFiltering";
import { useFiltering as useJutsuBalanceFiltering } from "@/layout/JutsuBalanceFiltering";
import { useFiltering as useQuestFiltering } from "@/layout/QuestFiltering";
import { useFiltering as useQuestRewardBalanceFiltering } from "@/layout/QuestRewardBalanceFiltering";
import { useFiltering as useQueueLengthFiltering } from "@/layout/QueueLengthFiltering";
import { useFiltering as useRankedLoadoutFiltering } from "@/layout/RankedLoadoutFiltering";
import { useFiltering as useRankedRankDistributionFiltering } from "@/layout/RankedRankDistributionFiltering";
import { useFiltering as useSageModeFiltering } from "@/layout/SageModeFiltering";
import { useFiltering as useSkillTreeFiltering } from "@/layout/SkillTreeFiltering";
import {
  getFilter as getStatisticsFilter,
  useFiltering as useStatisticsFiltering,
} from "@/layout/StatisticsFiltering";
import { useFiltering as useUserFiltering } from "@/layout/UserFiltering";
import { getLocalDateStringMonthsAgo } from "@/utils/time";

afterEach(() => {
  cleanup();
  setSystemTime();
});

type Setter = (value: unknown) => void;
type FilteringHook = () => {
  cf: { values: Record<string, unknown>; setters: Record<string, Setter> };
};

const hooks: Record<string, FilteringHook> = {
  AiBalance: useAiBalanceFiltering,
  Applications: useApplicationsFiltering,
  BattleLength: useBattleLengthFiltering,
  BloodlineBalance: useBloodlineBalanceFiltering,
  ItemBalance: useItemBalanceFiltering,
  JutsuBalance: useJutsuBalanceFiltering,
  Quest: useQuestFiltering,
  QuestRewardBalance: useQuestRewardBalanceFiltering,
  QueueLength: useQueueLengthFiltering,
  RankedLoadout: useRankedLoadoutFiltering,
  RankedRankDistribution: useRankedRankDistributionFiltering,
  SageMode: useSageModeFiltering,
  SkillTree: useSkillTreeFiltering,
  User: useUserFiltering,
} as unknown as Record<string, FilteringHook>;

describe("filtering hooks without compiler memoization", () => {
  it.each(Object.keys(hooks))("%s keeps a chosen filter across rerenders", (name) => {
    const { result, rerender } = renderHook(() => hooks[name]!());
    const [field] = Object.keys(result.current.cf.setters);
    if (!field) throw new Error(`${name} has no filter fields`);
    const chosen = { marker: name };
    act(() => result.current.cf.setters[field]!(chosen));
    rerender();
    rerender();
    expect(result.current.cf.values[field]).toBe(chosen);
  });
});

describe("statistics default dates", () => {
  it("default to a month before the day the filters mount, not the day the module loaded", () => {
    setSystemTime(new Date("2031-03-15T12:00:00"));
    const { result } = renderHook(() => useStatisticsFiltering());
    expect(result.current.startDate).toBe(getLocalDateStringMonthsAgo(1));
    expect(getStatisticsFilter(result.current)).toEqual({
      startDate: getLocalDateStringMonthsAgo(1),
    });
  });
});
