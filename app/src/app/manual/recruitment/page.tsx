"use client";

import React from "react";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { api } from "@/app/_trpc/client";
import { useUserData } from "@/utils/UserContext";
import {
  canViewRecruitmentAnalytics,
  canViewRevenueAnalytics,
} from "@/utils/permissions";

import {
  GroupedLevelStats,
  DailyMeanStdChart,
  DailyCountsBySourceChart,
} from "@/layout/UsageStatistics";
import { RevenueBySourceBar } from "@/layout/UsageStatistics";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RecruitmentMetrics,
  RECRUITMENT_GOALS,
  type RecruitmentMetric,
} from "@/drizzle/constants";
import RecruitmentFiltering, {
  useFiltering as useRecruitmentFiltering,
  getFilter as getRecruitmentFilter,
} from "@/layout/RecruitmentFiltering";
import VisitorFiltering, {
  useFiltering as useVisitorFiltering,
  getFilter as getVisitorFilter,
} from "@/layout/VisitorFiltering";
import { TUTORIAL_GENIN_EXAM_QUEST_ID } from "@/drizzle/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AbTestResults from "@/layout/AbTestResults";
import { QuestFunnelBar } from "@/layout/UsageStatistics";

export default function ManualRecruitment() {
  const { data: currentUser } = useUserData();
  const allowed = canViewRecruitmentAnalytics(currentUser?.role ?? "USER");
  const filterState = useRecruitmentFiltering();
  const filter = getRecruitmentFilter(filterState) as {
    sources?: string[];
    startDate?: string;
    endDate?: string;
    metric?: RecruitmentMetric;
  };

  const visitorFilterState = useVisitorFiltering();

  const { data: mainMetrics, isFetching: isFetchingMain } =
    api.data.getRecruitmentMainMetrics.useQuery(
      {
        ...getVisitorFilter(visitorFilterState),
        questFunnels: [TUTORIAL_GENIN_EXAM_QUEST_ID],
      },
      {
        staleTime: 1000 * 60,
        enabled: allowed,
      },
    );

  const [metric, setMetric] = React.useState<RecruitmentMetric>("level");
  const metricLabel =
    metric === "completedQuests"
      ? "Completed Quests"
      : metric === "level"
        ? "User Level"
        : metric;

  const { data, isFetching } = api.data.getRecruitmentLevelDistribution.useQuery(
    { ...filter, metric },
    { staleTime: 1000 * 60, enabled: allowed },
  );

  const { data: daily, isFetching: isFetchingDaily } =
    api.data.getRecruitmentDailyLevelStats.useQuery(filter, {
      staleTime: 1000 * 60,
      enabled: allowed,
    });

  const { data: dailyBySource, isFetching: isFetchingDailyBySource } =
    api.data.getRecruitmentDailyCountsBySource.useQuery(filter, {
      staleTime: 1000 * 60,
      enabled: allowed,
    });

  const canSeeRevenue = canViewRevenueAnalytics(currentUser?.role ?? "USER");
  const { data: revenueBySource, isFetching: isFetchingRevenue } =
    api.data.getRevenueByReferralSource.useQuery(
      {},
      { enabled: allowed && canSeeRevenue },
    );

  const goals = {
    ctr: RECRUITMENT_GOALS.CTR_PERCENT,
    signupRate: RECRUITMENT_GOALS.SIGNUP_RATE_PERCENT,
    levelRate: RECRUITMENT_GOALS.LEVEL_RATE_PERCENT,
    rankRate: RECRUITMENT_GOALS.RANK_RATE_PERCENT,
    pvpRate: RECRUITMENT_GOALS.PVP_RATE_PERCENT,
    tutorialRate: RECRUITMENT_GOALS.TUTORIAL_RATE_PERCENT,
  } as const;

  const getColorClass = (valuePct: number, goalPct: number) => {
    if (valuePct >= goalPct) return "text-green-600";
    if (valuePct >= goalPct * 0.9) return "text-orange-500";
    return "text-red-600";
  };

  const getClickValueColor = (valueUsd: number) => {
    const goal = RECRUITMENT_GOALS.CLICK_VALUE_USD;
    if (valueUsd >= goal) return "text-green-600";
    if (valueUsd >= goal * 0.9) return "text-orange-500";
    return "text-red-600";
  };
  const questFunnel = mainMetrics?.questFunnels?.[TUTORIAL_GENIN_EXAM_QUEST_ID];
  console.log(questFunnel);

  return (
    <>
      <ContentBox
        title="Recruitment"
        subtitle="Overview of recruitment statistics"
        defaultBackHref="/manual"
        topRightContent={allowed && <VisitorFiltering state={visitorFilterState} />}
      >
        {!allowed && <p>You do not have permission to view this page.</p>}
        {allowed && (
          <p>
            This page shows recruitment insights, which are used to track user adoption
            and optimize game experience.
          </p>
        )}

        {allowed && (
          <div className="grid grid-cols-2 gap-2 mt-3">
            <Card>
              <CardHeader className="pb-0 pt-2">
                <CardTitle className="text-sm font-medium">
                  Click-Through Rate
                </CardTitle>
              </CardHeader>
              <CardContent className="py-1">
                {isFetchingMain ? (
                  <Loader explanation="Loading CTR" />
                ) : (
                  <>
                    <div
                      className={`text-xl font-bold ${getColorClass(
                        (mainMetrics?.ctr ?? 0) * 100,
                        goals.ctr,
                      )}`}
                    >
                      {((mainMetrics?.ctr ?? 0) * 100).toFixed(3)}%
                    </div>
                    <div className="text-xs text-foreground-muted">
                      Goal: {goals.ctr}%
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-0 pt-2">
                <CardTitle className="text-sm font-medium">Signup Rate</CardTitle>
              </CardHeader>
              <CardContent className="py-1">
                {isFetchingMain ? (
                  <Loader explanation="Loading signup rate" />
                ) : (
                  <>
                    <div
                      className={`text-xl font-bold ${getColorClass(
                        (mainMetrics?.signupRate ?? 0) * 100,
                        goals.signupRate,
                      )}`}
                    >
                      {((mainMetrics?.signupRate ?? 0) * 100).toFixed(1)}%
                    </div>
                    <div className="text-xs text-foreground-muted">
                      Goal: {goals.signupRate}%
                    </div>
                  </>
                )}
                {!isFetchingMain && mainMetrics && (
                  <div className="text-xs text-foreground-muted">
                    {mainMetrics.signups} / {mainMetrics.visitors}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-0 pt-2">
                <CardTitle className="text-sm font-medium">
                  Character Creation Rate
                </CardTitle>
              </CardHeader>
              <CardContent className="py-1">
                {isFetchingMain ? (
                  <Loader explanation="Loading character creation rate" />
                ) : (
                  <>
                    <div
                      className={`text-xl font-bold ${getColorClass(
                        (mainMetrics?.characterCreationRate ?? 0) * 100,
                        goals.signupRate,
                      )}`}
                    >
                      {((mainMetrics?.characterCreationRate ?? 0) * 100).toFixed(1)}%
                    </div>
                    <div className="text-xs text-foreground-muted">
                      Goal: {goals.signupRate}%
                    </div>
                  </>
                )}
                {!isFetchingMain && mainMetrics && (
                  <div className="text-xs text-foreground-muted">
                    {mainMetrics.characterCreations} / {mainMetrics.visitors}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-0 pt-2">
                <CardTitle className="text-sm font-medium">Finished Tutorial</CardTitle>
              </CardHeader>
              <CardContent className="py-1">
                {isFetchingMain ? (
                  <Loader explanation="Loading tutorial completion" />
                ) : (
                  <>
                    <div
                      className={`text-xl font-bold ${getColorClass(
                        (mainMetrics?.signups ?? 0) > 0
                          ? ((mainMetrics?.tutorialFinishedSignups ?? 0) /
                              (mainMetrics?.signups ?? 1)) *
                              100
                          : 0,
                        goals.tutorialRate,
                      )}`}
                    >
                      {((mainMetrics?.signups ?? 0) > 0
                        ? ((mainMetrics?.tutorialFinishedSignups ?? 0) /
                            (mainMetrics?.signups ?? 1)) *
                          100
                        : 0
                      ).toFixed(1)}
                      %
                    </div>
                    <div className="text-xs text-foreground-muted">
                      Goal: {goals.tutorialRate}%
                    </div>
                  </>
                )}
                {!isFetchingMain && mainMetrics && (
                  <div className="text-xs text-foreground-muted">
                    {mainMetrics.tutorialFinishedSignups} / {mainMetrics.signups}
                  </div>
                )}
              </CardContent>
            </Card>
            {questFunnel && (
              <div className="col-span-2">
                <QuestFunnelBar
                  stepsCompleted={questFunnel}
                  title="Start Quest Funnel"
                />
              </div>
            )}

            <Card>
              <CardHeader className="pb-0 pt-2">
                <CardTitle className="text-sm font-medium">Leveled Beyond 1</CardTitle>
              </CardHeader>
              <CardContent className="py-1">
                {isFetchingMain ? (
                  <Loader explanation="Loading leveled signups" />
                ) : (
                  <>
                    <div
                      className={`text-xl font-bold ${getColorClass(
                        (mainMetrics?.signups ?? 0) > 0
                          ? ((mainMetrics?.leveledBeyond1 ?? 0) /
                              (mainMetrics?.signups ?? 1)) *
                              100
                          : 0,
                        goals.levelRate,
                      )}`}
                    >
                      {((mainMetrics?.signups ?? 0) > 0
                        ? ((mainMetrics?.leveledBeyond1 ?? 0) /
                            (mainMetrics?.signups ?? 1)) *
                          100
                        : 0
                      ).toFixed(1)}
                      %
                    </div>
                    <div className="text-xs text-foreground-muted">
                      Goal: {goals.levelRate}%
                    </div>
                  </>
                )}
                {!isFetchingMain && mainMetrics && (
                  <div className="text-xs text-foreground-muted">
                    out of {mainMetrics.signups} signups
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-0 pt-2">
                <CardTitle className="text-sm font-medium">
                  Beyond Student Rank
                </CardTitle>
              </CardHeader>
              <CardContent className="py-1">
                {isFetchingMain ? (
                  <Loader explanation="Loading rank progress" />
                ) : (
                  <>
                    <div
                      className={`text-xl font-bold ${getColorClass(
                        (mainMetrics?.signups ?? 0) > 0
                          ? ((mainMetrics?.nonStudentSignups ?? 0) /
                              (mainMetrics?.signups ?? 1)) *
                              100
                          : 0,
                        goals.rankRate,
                      )}`}
                    >
                      {((mainMetrics?.signups ?? 0) > 0
                        ? ((mainMetrics?.nonStudentSignups ?? 0) /
                            (mainMetrics?.signups ?? 1)) *
                          100
                        : 0
                      ).toFixed(1)}
                      %
                    </div>
                    <div className="text-xs text-foreground-muted">
                      Goal: {goals.rankRate}%
                    </div>
                  </>
                )}
                {!isFetchingMain && mainMetrics && (
                  <div className="text-xs text-foreground-muted">
                    out of {mainMetrics.signups} signups
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-0 pt-2">
                <CardTitle className="text-sm font-medium">Did PvP Fight</CardTitle>
              </CardHeader>
              <CardContent className="py-1">
                {isFetchingMain ? (
                  <Loader explanation="Loading PvP signups" />
                ) : (
                  <>
                    <div
                      className={`text-xl font-bold ${getColorClass(
                        (mainMetrics?.signups ?? 0) > 0
                          ? ((mainMetrics?.pvpSignups ?? 0) /
                              (mainMetrics?.signups ?? 1)) *
                              100
                          : 0,
                        goals.pvpRate,
                      )}`}
                    >
                      {((mainMetrics?.signups ?? 0) > 0
                        ? ((mainMetrics?.pvpSignups ?? 0) /
                            (mainMetrics?.signups ?? 1)) *
                          100
                        : 0
                      ).toFixed(1)}
                      %
                    </div>
                    <div className="text-xs text-foreground-muted">
                      Goal: {goals.pvpRate}%
                    </div>
                  </>
                )}
                {!isFetchingMain && mainMetrics && (
                  <div className="text-xs text-foreground-muted">
                    {mainMetrics.pvpSignups} / {mainMetrics.signups}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-0 pt-2">
                <CardTitle className="text-sm font-medium">Click Value (USD)</CardTitle>
              </CardHeader>
              <CardContent className="py-1">
                {isFetchingMain ? (
                  <Loader explanation="Loading click value" />
                ) : (
                  <div
                    className={`text-xl font-bold ${getClickValueColor(
                      Number(mainMetrics?.clickValueUsd ?? 0),
                    )}`}
                  >
                    ${mainMetrics?.clickValueUsd?.toFixed(2) ?? "0.00"}
                  </div>
                )}
                <div className="text-xs text-foreground-muted">
                  Total revenue / Paid Clicks (Goal: $
                  {RECRUITMENT_GOALS.CLICK_VALUE_USD.toFixed(2)})
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </ContentBox>

      {allowed && <AbTestResults />}

      {allowed && (
        <ContentBox
          title="Stats Distribution"
          subtitle="Grouped by recruitment source"
          initialBreak
          topRightContent={
            <div className="flex items-center gap-2">
              <div>
                <Select
                  value={metric}
                  onValueChange={(v) => setMetric(v as typeof metric)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Metric" />
                  </SelectTrigger>
                  <SelectContent>
                    {RecruitmentMetrics.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m === "level"
                          ? "Level"
                          : m === "completedQuests"
                            ? "Completed Quests"
                            : m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <RecruitmentFiltering state={filterState} />
            </div>
          }
        >
          {isFetching && <Loader explanation="Loading level distributions" />}
          {!isFetching && data && data.length > 0 && (
            <GroupedLevelStats
              datasets={data}
              title={`#Users vs. ${metricLabel}`}
              xaxis={metricLabel}
            />
          )}
          {!isFetching && (!data || data.length === 0) && (
            <p>No data found for filters.</p>
          )}
        </ContentBox>
      )}

      {allowed && (
        <ContentBox
          title="Daily Level (Mean ± Std)"
          subtitle="Current level vs. recruitment date"
          initialBreak={true}
          topRightContent={<RecruitmentFiltering state={filterState} />}
        >
          {isFetchingDaily && <Loader explanation="Loading daily level stats" />}
          {!isFetchingDaily && daily && daily.length > 0 && (
            <DailyMeanStdChart
              data={daily}
              title="Avg Level per Day"
              yaxis="User Level"
            />
          )}
          {!isFetchingDaily && (!daily || daily.length === 0) && (
            <p>No data found for filters.</p>
          )}
        </ContentBox>
      )}

      {allowed && (
        <ContentBox
          title="Daily Recruits by Source"
          subtitle="# of recruited users per day (by source)"
          initialBreak={true}
          topRightContent={<RecruitmentFiltering state={filterState} />}
        >
          {isFetchingDailyBySource && (
            <Loader explanation="Loading daily recruits by source" />
          )}
          {!isFetchingDailyBySource && dailyBySource && dailyBySource.length > 0 && (
            <DailyCountsBySourceChart
              datasets={dailyBySource}
              title="Recruits per Day"
            />
          )}
          {!isFetchingDailyBySource &&
            (!dailyBySource || dailyBySource.length === 0) && (
              <p>No data found for filters.</p>
            )}
        </ContentBox>
      )}

      {allowed && canSeeRevenue && (
        <ContentBox
          title="Revenue by Referral Source"
          subtitle="Sum of USD transactions grouped by referral source"
          initialBreak={true}
        >
          {isFetchingRevenue && <Loader explanation="Loading revenue by source" />}
          {revenueBySource && revenueBySource.length > 0 && (
            <RevenueBySourceBar data={revenueBySource} title="Total USD" />
          )}
          {revenueBySource && revenueBySource.length === 0 && (
            <p>No revenue data found.</p>
          )}
        </ContentBox>
      )}
    </>
  );
}
