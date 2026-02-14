"use client";
import { Trash2 } from "lucide-react";
import { use } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import Confirm2 from "@/layout/Confirm2";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import StatisticsFiltering, {
  getFilter as getStatisticsFilter,
  useFiltering as useStatisticsFiltering,
} from "@/layout/StatisticsFiltering";
import { jutsuText } from "@/layout/seoTexts";
import { LevelStats, UsageStats } from "@/layout/UsageStatistics";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import { useRequiredUserData, useUserData } from "@/utils/UserContext";

export default function JutsuStatistics(props: {
  params: Promise<{ jutsuid: string }>;
}) {
  const params = use(props.params);
  const jutsuId = params.jutsuid;

  // Queries
  const statsFilter = useStatisticsFiltering();
  const filterParams = getStatisticsFilter(statsFilter);

  const { data: userData } = useUserData();
  const { data: currentUserData } = useRequiredUserData();
  const { data, isPending } = api.data.getStatistics.useQuery(
    { id: jutsuId, type: "jutsu", ...filterParams },
    { enabled: !!jutsuId },
  );
  const jutsu = data?.info;
  const filteredUsage = data?.usage;
  const totalUsers = data?.totalUsers ?? 0;
  const levelDistribution = data?.levelDistribution;
  const total = filteredUsage?.reduce((acc, curr) => acc + curr.count, 0) ?? 0;
  const name = jutsu && "name" in jutsu ? jutsu.name : "";

  // Mutations
  const { mutate: deleteSingleData, isPending: isDeleting } =
    api.data.deleteSingleDataBattleAction.useMutation({
      onSuccess: async (result) => {
        showMutationToast(result);
        if (result.success) {
          // Invalidate the statistics query to refresh the data
          await utils.data.getStatistics.invalidate();
        }
      },
    });

  const utils = api.useUtils();

  // Check if user can change content
  const canDelete = canChangeContent(currentUserData?.role ?? "USER");

  // Prevent unauthorized access
  if (isPending) return <Loader explanation="Loading data" />;

  // Show panel controls
  return (
    <>
      {!userData && jutsu && "name" in jutsu && (
        <ContentBox
          title="Jutsu Statistics"
          subtitle={jutsu.name}
          defaultBackHref="/manual/jutsu"
        >
          {jutsuText(jutsu.name)}
        </ContentBox>
      )}
      <ContentBox
        title={`Jutsu: ${name}`}
        subtitle={`Total users: ${totalUsers}`}
        initialBreak={!userData && !!jutsu}
        defaultBackHref={userData ? "/manual/jutsu" : undefined}
      >
        {levelDistribution && (
          <LevelStats
            levelDistribution={levelDistribution}
            title="#Users vs. Jutsu Level"
            xaxis="Jutsu Level"
          />
        )}
      </ContentBox>
      <ContentBox
        title="Usage Statistics"
        subtitle={`Total battles: ${total}`}
        initialBreak={true}
        topRightContent={
          <div className="flex items-center gap-2">
            <StatisticsFiltering state={statsFilter} />
            {canDelete && (
              <Confirm2
                title={`Clear ${name} Battle Data`}
                button={
                  <Button size="icon">
                    <Trash2 className="h-5 w-5 cursor-pointer" />
                  </Button>
                }
                proceed_label="Clear Data"
                confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onAccept={(e) => {
                  e.preventDefault();
                  deleteSingleData({ contentId: jutsuId, type: "jutsu" });
                }}
              >
                {isDeleting ? (
                  <Loader explanation="Deleting data" />
                ) : (
                  <>
                    Are you sure you want to clear all battle action data for{" "}
                    <strong>{name}</strong>? This action cannot be undone and will reset
                    all usage statistics for this jutsu. This action will be logged for
                    future audit and review.
                  </>
                )}
              </Confirm2>
            )}
          </div>
        }
      >
        {filteredUsage && <UsageStats usage={filteredUsage} />}
      </ContentBox>
    </>
  );
}
