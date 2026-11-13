"use client";

import type React from "react";
import { api } from "@/app/_trpc/client";
import { ClearContentBattleDataButton } from "@/layout/ClearDataConfirm";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import StatisticsFiltering, {
  getFilter as getStatisticsFilter,
  useFiltering as useStatisticsFiltering,
} from "@/layout/StatisticsFiltering";
import { LevelStats, UsageStats } from "@/layout/UsageStatistics";
import { canChangeContent } from "@/utils/permissions";
import { useUserDataSelector } from "@/utils/UserContext";

/** Public usage statistics of one content entry; only the clear action needs staff. */
export const ContentStatistics: React.FC<ContentStatisticsProps> = (props) => {
  const { type, id, label, seoTitle, seoText, subtitle, levelStats } = props;
  const backHref = `/manual/${type}`;

  // Queries
  const statsFilter = useStatisticsFiltering();
  const filterParams = getStatisticsFilter(statsFilter);

  const { data: userData } = useUserDataSelector((u) => ({ role: u.role }));
  const { data, isPending } = api.data.getStatistics.useQuery(
    { id, type, ...filterParams },
    { enabled: !!id },
  );
  const info = data?.info;
  const filteredUsage = data?.usage;
  const totalUsers = data?.totalUsers ?? 0;
  const levelDistribution = data?.levelDistribution;
  const total = filteredUsage?.reduce((acc, curr) => acc + curr.count, 0) ?? 0;
  const infoName =
    info && "name" in info
      ? info.name
      : info && "username" in info
        ? info.username
        : undefined;
  const name = infoName ?? "";

  if (isPending) return <Loader explanation="Loading data" />;

  const filtering = <StatisticsFiltering state={statsFilter} />;
  const filters = props.allowClearData ? (
    <div className="flex items-center gap-2">
      {filtering}
      {canChangeContent(userData?.role ?? "USER") && (
        <ClearContentBattleDataButton
          id={id}
          type={type}
          label={label.toLowerCase()}
          name={name}
        />
      )}
    </div>
  ) : (
    filtering
  );
  const usage =
    total > 0 ? (
      filteredUsage && <UsageStats usage={filteredUsage} />
    ) : (
      <NoStatistics text="No battles recorded for this filter." />
    );
  const hasLevelData = levelDistribution?.some((entry) => entry.count > 0) ?? false;

  return (
    <>
      {!userData && infoName !== undefined && (
        <ContentBox title={seoTitle} subtitle={infoName} defaultBackHref={backHref}>
          {seoText(infoName)}
        </ContentBox>
      )}
      <ContentBox
        title={`${label}: ${name}`}
        subtitle={subtitle({ total, totalUsers })}
        initialBreak={!userData && !!info}
        defaultBackHref={userData ? backHref : undefined}
        topRightContent={levelStats ? undefined : filters}
      >
        {levelStats
          ? levelDistribution &&
            (hasLevelData ? (
              <LevelStats
                levelDistribution={levelDistribution}
                title={levelStats.title}
                xaxis={levelStats.xaxis}
              />
            ) : (
              <NoStatistics text={`No players have this ${label.toLowerCase()} yet.`} />
            ))
          : usage}
      </ContentBox>
      {levelStats && (
        <ContentBox
          title="Usage Statistics"
          subtitle={`Total battles: ${total}`}
          initialBreak={true}
          topRightContent={filters}
        >
          {usage}
        </ContentBox>
      )}
    </>
  );
};

/** Empty state in place of a chart that would otherwise draw an empty grid. */
const NoStatistics: React.FC<{ text: string }> = ({ text }) => (
  <p className="py-8 text-center text-muted-foreground">{text}</p>
);

interface ContentStatisticsProps {
  type: "jutsu" | "item" | "bloodline" | "ai";
  id: string;
  /** Content name in the title, e.g. "Jutsu". */
  label: string;
  /** Heading of the intro shown to signed-out visitors. */
  seoTitle: string;
  seoText: (name: string) => React.ReactNode;
  /** Subtitle of the first box. */
  subtitle: (totals: { total: number; totalUsers: number }) => string;
  /** Moves usage into its own box below this level chart. */
  levelStats?: { title: string; xaxis: string };
  /** Let content staff clear this entry's battle data. */
  allowClearData?: boolean;
}
