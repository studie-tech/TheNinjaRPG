"use client";
import { use } from "react";
import { api } from "@/app/_trpc/client";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import StatisticsFiltering, {
  getFilter as getStatisticsFilter,
  useFiltering as useStatisticsFiltering,
} from "@/layout/StatisticsFiltering";
import { bloodlineText } from "@/layout/seoTexts";
import { LevelStats, UsageStats } from "@/layout/UsageStatistics";
import { useUserData } from "@/utils/UserContext";

export default function BloodlineStatistics(props: {
  params: Promise<{ bloodlineid: string }>;
}) {
  const params = use(props.params);
  const bloodlineId = params.bloodlineid;

  // Queries
  const statsFilter = useStatisticsFiltering();
  const filterParams = getStatisticsFilter(statsFilter);

  const { data: userData } = useUserData();
  const { data, isPending } = api.data.getStatistics.useQuery(
    { id: bloodlineId, type: "bloodline", ...filterParams },
    { enabled: !!bloodlineId },
  );
  const bloodline = data?.info;
  const filteredUsage = data?.usage;
  const totalUsers = data?.totalUsers ?? 0;
  const levelDistribution = data?.levelDistribution;
  const total = filteredUsage?.reduce((acc, curr) => acc + curr.count, 0) ?? 0;
  const name = bloodline && "name" in bloodline ? bloodline.name : "";

  // Prevent unauthorized access
  if (isPending) {
    return <Loader explanation="Loading data" />;
  }

  // Show panel controls
  return (
    <>
      {!userData && bloodline && "name" in bloodline && (
        <ContentBox
          title="Bloodline Statistics"
          subtitle={bloodline.name}
          defaultBackHref="/manual/bloodline"
        >
          {bloodlineText(bloodline.name)}
        </ContentBox>
      )}
      <ContentBox
        title={`Bloodline: ${name}`}
        subtitle={`Total users: ${totalUsers}`}
        initialBreak={!userData && !!bloodline}
        defaultBackHref={userData ? "/manual/bloodline" : undefined}
      >
        {levelDistribution && (
          <LevelStats
            levelDistribution={levelDistribution}
            title="#Users vs. User Level"
            xaxis="User Level"
          />
        )}
      </ContentBox>
      <ContentBox
        title="Usage Statistics"
        subtitle={`Total battles: ${total}`}
        initialBreak={true}
        topRightContent={<StatisticsFiltering state={statsFilter} />}
      >
        {filteredUsage && <UsageStats usage={filteredUsage} />}
      </ContentBox>
    </>
  );
}
