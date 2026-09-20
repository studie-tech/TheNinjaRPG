"use client";

import React from "react";
import { api } from "@/app/_trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  RECRUITMENT_GOALS,
  type RecruitmentMetric,
  RecruitmentMetrics,
} from "@/drizzle/constants";
import { TUTORIAL_STEPS } from "@/hooks/tutorial";
import AbTestResults from "@/layout/AbTestResults";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import RecruitmentFiltering, {
  getFilter as getRecruitmentFilter,
  useFiltering as useRecruitmentFiltering,
} from "@/layout/RecruitmentFiltering";
import {
  DailyCountsBySourceChart,
  DailyMeanStdChart,
  GroupedLevelStats,
  QuestFunnelBar,
  RevenueBySourceBar,
} from "@/layout/UsageStatistics";
import VisitorFiltering, {
  getFilter as getVisitorFilter,
  useFiltering as useVisitorFiltering,
} from "@/layout/VisitorFiltering";
import {
  canViewRecruitmentAnalytics,
  canViewRevenueAnalytics,
} from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

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
  const [includeTutorialDisabled, setIncludeTutorialDisabled] = React.useState(false);
  const [includeTierTutorialDisabled, setIncludeTierTutorialDisabled] =
    React.useState(false);

  const { data: mainMetrics, isFetching: isFetchingMain } =
    api.data.getRecruitmentMainMetrics.useQuery(
      {
        ...getVisitorFilter(visitorFilterState),
        includeTutorialDisabled,
        includeTierTutorialDisabled,
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
    signupRate: RECRUITMENT_GOALS.SIGNUP_RATE_PERCENT,
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
    const goal = RECRUITMENT_GOALS.SIGNUP_VALUE_USD;
    if (valueUsd >= goal) return "text-green-600";
    if (valueUsd >= goal * 0.9) return "text-orange-500";
    return "text-red-600";
  };

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
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Card>
              <CardHeader className="pt-2 pb-0">
                <CardTitle className="font-medium text-sm">Signup Rate</CardTitle>
              </CardHeader>
              <CardContent className="py-1">
                {isFetchingMain ? (
                  <Loader explanation="Loading signup rate" />
                ) : (
                  <>
                    <div
                      className={`font-bold text-xl ${getColorClass((mainMetrics?.signupRate ?? 0) * 100, goals.signupRate)}`}
                    >
                      {((mainMetrics?.signupRate ?? 0) * 100).toFixed(1)}%
                    </div>
                    <div className="text-foreground-muted text-xs">
                      Goal: {goals.signupRate}%
                    </div>
                  </>
                )}
                {!isFetchingMain && mainMetrics && (
                  <div className="text-foreground-muted text-xs">
                    {mainMetrics.signups} / {mainMetrics.visitors}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pt-2 pb-0">
                <CardTitle className="font-medium text-sm">
                  Character Creation Rate
                </CardTitle>
              </CardHeader>
              <CardContent className="py-1">
                {isFetchingMain ? (
                  <Loader explanation="Loading character creation rate" />
                ) : (
                  <>
                    <div
                      className={`font-bold text-xl ${getColorClass((mainMetrics?.characterCreationRate ?? 0) * 100, goals.signupRate)}`}
                    >
                      {((mainMetrics?.characterCreationRate ?? 0) * 100).toFixed(1)}%
                    </div>
                    <div className="text-foreground-muted text-xs">
                      Goal: {goals.signupRate}%
                    </div>
                  </>
                )}
                {!isFetchingMain && mainMetrics && (
                  <>
                    <div className="text-foreground-muted text-xs">
                      {mainMetrics.characterCreations} / {mainMetrics.visitors}
                    </div>
                    {mainMetrics.characterCreationsByDevice &&
                      mainMetrics.visitorsByDevice && (
                        <div className="mt-1 text-foreground-muted text-xs">
                          📱{" "}
                          {mainMetrics.visitorsByDevice.mobile > 0
                            ? (
                                (mainMetrics.characterCreationsByDevice.mobile /
                                  mainMetrics.visitorsByDevice.mobile) *
                                100
                              ).toFixed(1)
                            : "0.0"}
                          % ({mainMetrics.characterCreationsByDevice.mobile}) | 💻{" "}
                          {mainMetrics.visitorsByDevice.desktop > 0
                            ? (
                                (mainMetrics.characterCreationsByDevice.desktop /
                                  mainMetrics.visitorsByDevice.desktop) *
                                100
                              ).toFixed(1)
                            : "0.0"}
                          % ({mainMetrics.characterCreationsByDevice.desktop}) | ❓{" "}
                          {mainMetrics.visitorsByDevice.unknown > 0
                            ? (
                                (mainMetrics.characterCreationsByDevice.unknown /
                                  mainMetrics.visitorsByDevice.unknown) *
                                100
                              ).toFixed(1)
                            : "0.0"}
                          % ({mainMetrics.characterCreationsByDevice.unknown})
                        </div>
                      )}
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pt-2 pb-0">
                <CardTitle className="font-medium text-sm">Finished Tutorial</CardTitle>
              </CardHeader>
              <CardContent className="py-1">
                {isFetchingMain ? (
                  <Loader explanation="Loading tutorial completion" />
                ) : (
                  <>
                    <div
                      className={`font-bold text-xl ${getColorClass((mainMetrics?.signups ?? 0) > 0 ? ((mainMetrics?.tutorialFinishedSignups ?? 0) / (mainMetrics?.signups ?? 1)) * 100 : 0, goals.tutorialRate)}`}
                    >
                      {((mainMetrics?.signups ?? 0) > 0
                        ? ((mainMetrics?.tutorialFinishedSignups ?? 0) /
                            (mainMetrics?.signups ?? 1)) *
                          100
                        : 0
                      ).toFixed(1)}
                      %
                    </div>
                    <div className="text-foreground-muted text-xs">
                      Goal: {goals.tutorialRate}%
                    </div>
                  </>
                )}
                {!isFetchingMain && mainMetrics && (
                  <>
                    <div className="text-foreground-muted text-xs">
                      {mainMetrics.tutorialFinishedSignups} / {mainMetrics.signups}
                    </div>
                    {mainMetrics.tutorialFinishedByDevice &&
                      mainMetrics.signupsByDevice && (
                        <div className="mt-1 text-foreground-muted text-xs">
                          📱{" "}
                          {mainMetrics.signupsByDevice.mobile > 0
                            ? (
                                (mainMetrics.tutorialFinishedByDevice.mobile /
                                  mainMetrics.signupsByDevice.mobile) *
                                100
                              ).toFixed(1)
                            : "0.0"}
                          % ({mainMetrics.tutorialFinishedByDevice.mobile}) | 💻{" "}
                          {mainMetrics.signupsByDevice.desktop > 0
                            ? (
                                (mainMetrics.tutorialFinishedByDevice.desktop /
                                  mainMetrics.signupsByDevice.desktop) *
                                100
                              ).toFixed(1)
                            : "0.0"}
                          % ({mainMetrics.tutorialFinishedByDevice.desktop}) | ❓{" "}
                          {mainMetrics.signupsByDevice.unknown > 0
                            ? (
                                (mainMetrics.tutorialFinishedByDevice.unknown /
                                  mainMetrics.signupsByDevice.unknown) *
                                100
                              ).toFixed(1)
                            : "0.0"}
                          % ({mainMetrics.tutorialFinishedByDevice.unknown})
                        </div>
                      )}
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pt-2 pb-0">
                <CardTitle className="font-medium text-sm">Did PvP Fight</CardTitle>
              </CardHeader>
              <CardContent className="py-1">
                {isFetchingMain ? (
                  <Loader explanation="Loading PvP signups" />
                ) : (
                  <>
                    <div
                      className={`font-bold text-xl ${getColorClass((mainMetrics?.signups ?? 0) > 0 ? ((mainMetrics?.pvpSignups ?? 0) / (mainMetrics?.signups ?? 1)) * 100 : 0, goals.pvpRate)}`}
                    >
                      {((mainMetrics?.signups ?? 0) > 0
                        ? ((mainMetrics?.pvpSignups ?? 0) /
                            (mainMetrics?.signups ?? 1)) *
                          100
                        : 0
                      ).toFixed(1)}
                      %
                    </div>
                    <div className="text-foreground-muted text-xs">
                      Goal: {goals.pvpRate}%
                    </div>
                  </>
                )}
                {!isFetchingMain && mainMetrics && (
                  <div className="text-foreground-muted text-xs">
                    {mainMetrics.pvpSignups} / {mainMetrics.signups}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pt-2 pb-0">
                <CardTitle className="font-medium text-sm">Student+</CardTitle>
              </CardHeader>
              <CardContent className="py-1">
                {isFetchingMain ? (
                  <Loader explanation="Loading student progress" />
                ) : (
                  <>
                    <div
                      className={`font-bold text-xl ${getColorClass((mainMetrics?.signups ?? 0) > 0 ? ((mainMetrics?.nonStudentSignups ?? 0) / (mainMetrics?.signups ?? 1)) * 100 : 0, goals.rankRate)}`}
                    >
                      {((mainMetrics?.signups ?? 0) > 0
                        ? ((mainMetrics?.nonStudentSignups ?? 0) /
                            (mainMetrics?.signups ?? 1)) *
                          100
                        : 0
                      ).toFixed(1)}
                      %
                    </div>
                    <div className="text-foreground-muted text-xs">
                      Goal: {goals.rankRate}%
                    </div>
                  </>
                )}
                {!isFetchingMain && mainMetrics && (
                  <div className="text-foreground-muted text-xs">
                    {mainMetrics.nonStudentSignups} / {mainMetrics.signups} signups
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pt-2 pb-0">
                <CardTitle className="font-medium text-sm">Genin+</CardTitle>
              </CardHeader>
              <CardContent className="py-1">
                {isFetchingMain ? (
                  <Loader explanation="Loading rank progress" />
                ) : (
                  <>
                    <div
                      className={`font-bold text-xl ${getColorClass((mainMetrics?.signups ?? 0) > 0 ? ((mainMetrics?.nonStudentGeninSignups ?? 0) / (mainMetrics?.signups ?? 1)) * 100 : 0, goals.rankRate)}`}
                    >
                      {((mainMetrics?.signups ?? 0) > 0
                        ? ((mainMetrics?.nonStudentGeninSignups ?? 0) /
                            (mainMetrics?.signups ?? 1)) *
                          100
                        : 0
                      ).toFixed(1)}
                      %
                    </div>
                    <div className="text-foreground-muted text-xs">
                      Goal: {goals.rankRate}%
                    </div>
                  </>
                )}
                {!isFetchingMain && mainMetrics && (
                  <div className="text-foreground-muted text-xs">
                    {mainMetrics.nonStudentGeninSignups} / {mainMetrics.signups} signups
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pt-2 pb-0">
                <CardTitle className="font-medium text-sm">
                  Signup Value (USD)
                </CardTitle>
              </CardHeader>
              <CardContent className="py-1">
                {isFetchingMain ? (
                  <Loader explanation="Loading click value" />
                ) : (
                  <div
                    className={`font-bold text-xl ${getClickValueColor(Number(mainMetrics?.signupValueUsd ?? 0))}`}
                  >
                    ${mainMetrics?.signupValueUsd?.toFixed(2) ?? "0.00"}
                  </div>
                )}
                <div className="text-foreground-muted text-xs">
                  Total revenue / Paid Signup (Goal: $
                  {RECRUITMENT_GOALS.SIGNUP_VALUE_USD.toFixed(2)})<br />
                  All-time (ignores time & device filters)
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pt-2 pb-0">
                <CardTitle className="font-medium text-sm">Total Revenue</CardTitle>
              </CardHeader>
              <CardContent className="py-1">
                {isFetchingMain ? (
                  <Loader explanation="Loading total revenue" />
                ) : (
                  <div className="font-bold text-green-600 text-xl">
                    ${mainMetrics?.totalRevenueUsd?.toFixed(2) ?? "0.00"}
                  </div>
                )}
                <div className="text-foreground-muted text-xs">
                  Total revenue from all transactions
                  <br />
                  All-time (ignores time & device filters)
                </div>
              </CardContent>
            </Card>

            {mainMetrics?.tutorialSteps && mainMetrics.tutorialSteps.length > 0 && (
              <div className="col-span-2">
                <QuestFunnelBar
                  stepsCompleted={mainMetrics.tutorialSteps}
                  title="Tutorial Steps Completion"
                  stepDescriptions={TUTORIAL_STEPS.map((step) =>
                    typeof step.description === "string"
                      ? step.description
                      : step.title,
                  )}
                  extraControls={
                    <div className="flex items-center gap-2">
                      <Switch
                        id="include-tutorial-disabled"
                        checked={includeTutorialDisabled}
                        onCheckedChange={setIncludeTutorialDisabled}
                      />
                      <Label
                        htmlFor="include-tutorial-disabled"
                        className="cursor-pointer text-xs"
                      >
                        Include disabled
                      </Label>
                    </div>
                  }
                />
              </div>
            )}

            {mainMetrics?.tierQuestCompletions &&
              mainMetrics.tierQuestCompletions.length > 0 && (
                <div className="col-span-2">
                  <QuestFunnelBar
                    stepsCompleted={mainMetrics.tierQuestCompletions.map((tc) => ({
                      steps: tc.completedTiers,
                      deviceType: tc.deviceType,
                      username: tc.username,
                    }))}
                    title="Tier Quest Completion (Tutorial Finished)"
                    stepDescriptions={[
                      "No tier quests completed",
                      ...mainMetrics.tierQuestDescriptions,
                    ]}
                    stepLabels={[
                      "None",
                      ...mainMetrics.tierQuestDescriptions.map(
                        (_, i) => `Tier ${i + 1}`,
                      ),
                    ]}
                    extraControls={
                      <div className="flex items-center gap-2">
                        <Switch
                          id="include-tier-tutorial-disabled"
                          checked={includeTierTutorialDisabled}
                          onCheckedChange={setIncludeTierTutorialDisabled}
                        />
                        <Label
                          htmlFor="include-tier-tutorial-disabled"
                          className="cursor-pointer text-xs"
                        >
                          Include disabled
                        </Label>
                      </div>
                    }
                  />
                </div>
              )}
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
                    {RecruitmentMetrics.map((m, i) => (
                      <SelectItem key={`${m}-${i}`} value={m}>
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
