"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Gift } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { api } from "@/app/_trpc/client";
import { getRewardArray } from "@/libs/objectives";
import { showRewardToast } from "@/libs/toast";

export function UnclaimedSeasonRewards() {
  // Fetch unclaimed rewards for the logged-in user
  const utils = api.useUtils();
  const { data: unclaimedRewards } =
    api.pvpRank.getUnclaimedUserSeasonRewards.useQuery(undefined);

  // Optional: allow the player to claim all rewards directly from here
  const claimRewards = api.pvpRank.claimSeasonRewards.useMutation({
    onSuccess: async (data) => {
      if (data.success) {
        if ("rewards" in data && data.rewards) {
          showRewardToast([data.message], data.rewards, "Claimed!");
          await Promise.all([
            utils.pvpRank.getUnclaimedUserSeasonRewards.invalidate(),
            utils.profile.getUser.invalidate(),
          ]);
        }
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
                <span className="text-xs text-muted-foreground">{rewardSummary}</span>
              </div>
              {reward.claimed ? (
                <Badge variant="secondary">Claimed</Badge>
              ) : (
                <Badge variant="default">Unclaimed</Badge>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
