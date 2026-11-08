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
import { TUTORIAL_STEPS } from "@/libs/tutorialSteps";
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
            <RateCard
              title="Signup Rate"
              explanation="Loading signup rate"
              isFetching={isFetchingMain}
              ratePct={(mainMetrics?.signupRate ?? 0) * 100}
              goalPct={RECRUITMENT_GOALS.SIGNUP_RATE_PERCENT}
              counts={mainMetrics && `${mainMetrics.signups} / ${mainMetrics.visitors}`}
            />
            <RateCard
              title="Character Creation Rate"
              explanation="Loading character creation rate"
              isFetching={isFetchingMain}
              ratePct={(mainMetrics?.characterCreationRate ?? 0) * 100}
              goalPct={RECRUITMENT_GOALS.SIGNUP_RATE_PERCENT}
              counts={
                mainMetrics &&
                `${mainMetrics.characterCreations} / ${mainMetrics.visitors}`
              }
              numeratorsByDevice={mainMetrics?.characterCreationsByDevice}
              denominatorsByDevice={mainMetrics?.visitorsByDevice}
            />
            <RateCard
              title="Finished Tutorial"
              explanation="Loading tutorial completion"
              isFetching={isFetchingMain}
              ratePct={percentOf(
                mainMetrics?.tutorialFinishedSignups,
                mainMetrics?.signups,
              )}
              goalPct={RECRUITMENT_GOALS.TUTORIAL_RATE_PERCENT}
              counts={
                mainMetrics &&
                `${mainMetrics.tutorialFinishedSignups} / ${mainMetrics.signups}`
              }
              numeratorsByDevice={mainMetrics?.tutorialFinishedByDevice}
              denominatorsByDevice={mainMetrics?.signupsByDevice}
            />
            <RateCard
              title="Did PvP Fight"
              explanation="Loading PvP signups"
              isFetching={isFetchingMain}
              ratePct={percentOf(mainMetrics?.pvpSignups, mainMetrics?.signups)}
              goalPct={RECRUITMENT_GOALS.PVP_RATE_PERCENT}
              counts={
                mainMetrics && `${mainMetrics.pvpSignups} / ${mainMetrics.signups}`
              }
            />
            <RateCard
              title="Student+"
              explanation="Loading student progress"
              isFetching={isFetchingMain}
              ratePct={percentOf(mainMetrics?.nonStudentSignups, mainMetrics?.signups)}
              goalPct={RECRUITMENT_GOALS.RANK_RATE_PERCENT}
              counts={
                mainMetrics &&
                `${mainMetrics.nonStudentSignups} / ${mainMetrics.signups} signups`
              }
            />
            <RateCard
              title="Genin+"
              explanation="Loading rank progress"
              isFetching={isFetchingMain}
              ratePct={percentOf(
                mainMetrics?.nonStudentGeninSignups,
                mainMetrics?.signups,
              )}
              goalPct={RECRUITMENT_GOALS.RANK_RATE_PERCENT}
              counts={
                mainMetrics &&
                `${mainMetrics.nonStudentGeninSignups} / ${mainMetrics.signups} signups`
              }
            />

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
                    className={`font-bold text-xl ${getColorClass(Number(mainMetrics?.signupValueUsd ?? 0), RECRUITMENT_GOALS.SIGNUP_VALUE_USD)}`}
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
                  stepDescriptions={TUTORIAL_STEPS.map(
                    (step) => `${step.title}: ${step.action ?? step.id}`,
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
            <GroupedLevelStats datasets={data} xaxis={metricLabel} />
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
            <DailyCountsBySourceChart datasets={dailyBySource} />
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

/** One funnel rate against its goal, with its raw counts once loaded. */
const RateCard: React.FC<RateCardProps> = (props) => {
  const { title, explanation, isFetching, ratePct, goalPct, counts } = props;
  const { numeratorsByDevice: numerators, denominatorsByDevice: denominators } = props;
  return (
    <Card>
      <CardHeader className="pt-2 pb-0">
        <CardTitle className="font-medium text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="py-1">
        {isFetching ? (
          <Loader explanation={explanation} />
        ) : (
          <>
            <div className={`font-bold text-xl ${getColorClass(ratePct, goalPct)}`}>
              {ratePct.toFixed(1)}%
            </div>
            <div className="text-foreground-muted text-xs">Goal: {goalPct}%</div>
          </>
        )}
        {!isFetching && counts && (
          <>
            <div className="text-foreground-muted text-xs">{counts}</div>
            {numerators && denominators && (
              <div className="mt-1 text-foreground-muted text-xs">
                {DEVICE_ICONS.map(
                  ([icon, device]) =>
                    `${icon} ${percentOf(numerators[device], denominators[device]).toFixed(1)}% (${numerators[device]})`,
                ).join(" | ")}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

const DEVICE_ICONS = [
  ["📱", "mobile"],
  ["💻", "desktop"],
  ["❓", "unknown"],
] as const;

/** Return a cohort share as a percentage, treating an empty cohort as zero. */
const percentOf = (numerator = 0, denominator = 0) =>
  denominator > 0 ? (numerator / denominator) * 100 : 0;

/** Mark met goals green, results within ten percent orange, and lower results red. */
const getColorClass = (value: number, goal: number) => {
  if (value >= goal) return "text-green-600";
  if (value >= goal * 0.9) return "text-orange-500";
  return "text-red-600";
};

type DeviceCounts = { mobile: number; desktop: number; unknown: number };

interface RateCardProps {
  title: string;
  /** Loader text while the metrics load. */
  explanation: string;
  isFetching: boolean;
  ratePct: number;
  goalPct: number;
  counts?: string;
  numeratorsByDevice?: DeviceCounts | null;
  denominatorsByDevice?: DeviceCounts | null;
}
