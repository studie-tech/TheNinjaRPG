"use client";
import { use } from "react";
import { api } from "@/app/_trpc/client";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import StatisticsFiltering, {
  getFilter as getStatisticsFilter,
  useFiltering as useStatisticsFiltering,
} from "@/layout/StatisticsFiltering";
import { aiText } from "@/layout/seoTexts";
import { UsageStats } from "@/layout/UsageStatistics";
import { useUserData } from "@/utils/UserContext";

export default function ManualAIsStatistcs(props: {
  params: Promise<{ aiid: string }>;
}) {
  const params = use(props.params);
  const aiId = params.aiid;

  // Queries
  const statsFilter = useStatisticsFiltering();
  const filterParams = getStatisticsFilter(statsFilter);

  const { data: userData } = useUserData();
  const { data, isPending } = api.data.getStatistics.useQuery(
    { id: aiId, type: "ai", ...filterParams },
    { enabled: !!aiId },
  );
  const ai = data?.info;
  const filteredUsage = data?.usage;
  const total = filteredUsage?.reduce((acc, curr) => acc + curr.count, 0) ?? 0;
  const name = ai && "username" in ai ? ai.username : "";

  // Prevent unauthorized access
  if (isPending) {
    return <Loader explanation="Loading data" />;
  }

  // Show panel controls
  return (
    <>
      {!userData && ai && "username" in ai && (
        <ContentBox
          title="AI Profile"
          subtitle={ai.username}
          defaultBackHref="/manual/ai"
        >
          {aiText(ai.username)}
        </ContentBox>
      )}
      <ContentBox
        title={`AI: ${name}`}
        subtitle={`Total battles: ${total}`}
        initialBreak={!userData && !!ai}
        defaultBackHref={userData ? "/manual/ai" : undefined}
        topRightContent={<StatisticsFiltering state={statsFilter} />}
      >
        {filteredUsage && <UsageStats usage={filteredUsage} />}
      </ContentBox>
    </>
  );
}
