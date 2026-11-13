"use client";

import { Gift } from "lucide-react";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRewardArray } from "@/libs/objectives";
import { showMutationToast, showRewardToast } from "@/libs/toast";
import { useRequiredUserInfo } from "@/utils/UserContext";

export function UnclaimedSeasonRewards() {
  // Fetch unclaimed rewards for the logged-in user
  const utils = api.useUtils();
  const { prepareUserUpdate, updateUser } = useRequiredUserInfo();
  const { data: unclaimedRewards } =
    api.pvpRank.getUnclaimedUserSeasonRewards.useQuery(undefined);

  // Claims every unclaimed season reward at once
  const claimRewards = api.pvpRank.claimSeasonRewards.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _variables, revision) => {
      if (!data.success) {
        showMutationToast(data);
        return;
      }
      if ("rewards" in data && data.rewards) {
        showRewardToast(
          [data.message, ...(data.announcements ?? [])],
          data.rewards,
          "Claimed!",
        );
        await Promise.all([
          utils.pvpRank.getUnclaimedUserSeasonRewards.invalidate(),
          updateUser(data, { revision, delta: data.userDelta }),
        ]);
      }
    },
  });

  if (!unclaimedRewards || unclaimedRewards.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Unclaimed Season Rewards</CardTitle>
        <Button
          onClick={() => claimRewards.mutate()}
          className="hover:underline disabled:opacity-50"
          disabled={claimRewards.isPending}
        >
          <Gift className="mr-2 h-5 w-5" />
          {claimRewards.isPending ? "Claiming…" : "Claim"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {unclaimedRewards.map((reward) => {
          const rewardSummary = getRewardArray(reward.seasonRewards).join(" • ");

          return (
            <div
              key={reward.id}
              className="flex items-center justify-between rounded-md border bg-muted/50 px-3 py-2"
            >
              <div className="flex flex-col">
                <span className="font-medium">
                  {reward.seasonName} – {reward.division}
                </span>
                <span className="text-muted-foreground text-xs">{rewardSummary}</span>
              </div>
              <Badge variant="default">Unclaimed</Badge>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
