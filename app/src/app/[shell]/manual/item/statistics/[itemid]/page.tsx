"use client";
import { use } from "react";
import { api } from "@/app/_trpc/client";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import StatisticsFiltering, {
  getFilter as getStatisticsFilter,
  useFiltering as useStatisticsFiltering,
} from "@/layout/StatisticsFiltering";
import { itemText } from "@/layout/seoTexts";
import { UsageStats } from "@/layout/UsageStatistics";
import { useUserData } from "@/utils/UserContext";

export default function ItemStatistics(props: { params: Promise<{ itemid: string }> }) {
  const params = use(props.params);
  const itemId = params.itemid;

  // Queries
  const statsFilter = useStatisticsFiltering();
  const filterParams = getStatisticsFilter(statsFilter);

  const { data: userData } = useUserData();
  const { data, isPending } = api.data.getStatistics.useQuery(
    { id: itemId, type: "item", ...filterParams },
    { enabled: !!itemId },
  );
  const item = data?.info;
  const filteredUsage = data?.usage;
  const totalUsers = data?.totalUsers ?? 0;
  const total = filteredUsage?.reduce((acc, curr) => acc + curr.count, 0) ?? 0;
  const name = item && "name" in item ? item.name : "";

  // Prevent unauthorized access
  if (isPending) return <Loader explanation="Loading data" />;

  // Show panel controls
  return (
    <>
      {!userData && item && "name" in item && (
        <ContentBox
          title="Item Statistics"
          subtitle={item.name}
          defaultBackHref="/manual/item"
        >
          {itemText(item.name)}
        </ContentBox>
      )}
      <ContentBox
        title={`Item: ${name}`}
        subtitle={`#battles: ${total}. #users: ${totalUsers}`}
        initialBreak={!userData && !!item}
        defaultBackHref={userData ? "/manual/item" : undefined}
        topRightContent={<StatisticsFiltering state={statsFilter} />}
      >
        {filteredUsage && <UsageStats usage={filteredUsage} />}
      </ContentBox>
    </>
  );
}
