"use client";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  WAR_POINT_CONVERSION_DAYS,
  WAR_POINT_PRESTIGE_RATE,
} from "@/drizzle/constants";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import Link from "@/layout/Link";
import { MercenaryOffers } from "@/layout/WarMercenaries";
import { useRequiredUserData } from "@/utils/UserContext";

/** Surface open camps and expiring claims in the dashboard's standard themed container. */
export const WarDashboardNotices = () => {
  const [feedback, setFeedback] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const { timeDiff } = useRequiredUserData();
  const utils = api.useUtils();
  const claims = api.war.getWarPointClaims.useQuery(undefined, {
    refetchInterval: 60000,
  });
  const camps = api.war.getWarCampNotices.useQuery(undefined, {
    refetchInterval: 60000,
  });
  const convert = api.war.convertWarPoints.useMutation({
    onMutate: () => {
      setFeedback(null);
    },
    onSuccess: async (result) => {
      setFeedback(result);
      void utils.war.getWarPointClaims.invalidate();
      if (result.success) await utils.profile.getUser.invalidate();
    },
    onError: (error) => setFeedback({ success: false, message: error.message }),
  });
  // Remove expired offers at their server deadline, even between background polls.
  useRefreshAt(
    [
      ...(camps.data?.map((camp) => camp.endsAt) ?? []),
      ...(claims.data?.map(
        (claim) =>
          claim.endedAt &&
          new Date(claim.endedAt.getTime() + WAR_POINT_CONVERSION_DAYS * 86400000),
      ) ?? []),
    ],
    () => {
      void claims.refetch();
      void camps.refetch();
    },
    timeDiff,
  );
  if (
    !claims.data?.length &&
    !camps.data?.length &&
    !feedback &&
    !claims.error &&
    !camps.error
  )
    return <MercenaryOffers />;
  return (
    <>
      <MercenaryOffers />
      <div className="mb-4">
        <ContentBox title="War updates" alreadyHasH1>
          <div className="space-y-3">
            {(claims.error || camps.error) && (
              <Alert variant="destructive">
                <AlertDescription>
                  Unable to refresh war updates.
                  <Button
                    variant="outline"
                    onClick={() => {
                      void claims.refetch();
                      void camps.refetch();
                    }}
                  >
                    Try again
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            {camps.data?.map((camp) => (
              <div
                key={camp.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-popover p-3"
              >
                <div>
                  <h3 className="font-semibold">War camp · Sector {camp.sector}</h3>
                  <p className="text-muted-foreground text-sm">
                    Closes in{" "}
                    <Countdown
                      targetDate={camp.endsAt}
                      timeDiff={timeDiff}
                      onEndShow="a moment"
                    />
                  </p>
                </div>
                <Button asChild size="sm">
                  <Link href={`/travel?sector=${camp.sector}`}>Travel to camp</Link>
                </Button>
              </div>
            ))}
            {claims.data
              ?.filter((claim) => claim.endedAt)
              .map((claim) => (
                <div
                  key={claim.warId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-popover p-3"
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold">Your war reward is ready</h3>
                    <p className="text-sm">
                      {claim.points.toLocaleString()} war points →{" "}
                      {(claim.points * WAR_POINT_PRESTIGE_RATE).toLocaleString()}{" "}
                      prestige
                    </p>
                    <p className="text-muted-foreground text-sm">
                      Claim within{" "}
                      <Countdown
                        targetDate={
                          new Date(
                            new Date(claim.endedAt ?? 0).getTime() +
                              WAR_POINT_CONVERSION_DAYS * 86400000,
                          )
                        }
                        timeDiff={timeDiff}
                        onEndShow="a moment"
                      />
                    </p>
                  </div>
                  <Button
                    disabled={convert.isPending}
                    onClick={() => convert.mutate({ warId: claim.warId })}
                  >
                    {convert.isPending && convert.variables?.warId === claim.warId
                      ? "Converting..."
                      : "Convert all war points"}
                  </Button>
                </div>
              ))}
            {feedback && (
              <Alert
                variant={feedback.success ? "default" : "destructive"}
                role={feedback.success ? "status" : "alert"}
              >
                <AlertDescription>
                  <p className="text-foreground">{feedback.message}</p>
                </AlertDescription>
              </Alert>
            )}
          </div>
        </ContentBox>
      </div>
    </>
  );
};
