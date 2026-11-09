"use client";

import { Shield } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VILLAGE_DUTY_MIN_RANK } from "@/drizzle/constants";
import { useVillageDuty } from "@/hooks/useVillageDuty";
import AvatarImage from "@/layout/Avatar";
import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";

/** Enroll a character's AI copy and show the village's standing protector roster. */
export const VillageDuty = ({
  villageId,
  sector,
  navTabs,
}: {
  villageId: string;
  sector?: number;
  navTabs: ReactNode;
}) => {
  const { data, isPending, isError, refetch, setDuty, isChanging, message } =
    useVillageDuty(villageId, sector);
  return (
    <ContentBox
      title="Town Hall"
      subtitle="Village Duty"
      defaultBackHref="/village"
      topRightContent={navTabs}
      stackTopRight
    >
      <p className="text-muted-foreground mb-4 text-sm">
        Put your character on patrol, even while you are away. Your AI copy guards your
        village against hostile visitors and defends attacks on its home shrine. Duty
        continues until you stand down or leave the village. Your character can keep
        playing normally.
      </p>
      {isPending ? (
        <Loader explanation="Loading village protectors" />
      ) : isError ? (
        <div className="space-y-2">
          <p>Could not load village duty.</p>
          <Button onClick={() => void refetch()}>Try again</Button>
        </div>
      ) : !data ? (
        <p>Village duty is available to members of a village.</p>
      ) : (
        <div className="space-y-5">
          <div className="bg-muted/30 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <Shield className="text-primary size-8 shrink-0" aria-hidden />
              <div>
                <p className="font-semibold">
                  {data.count.toLocaleString()} village{" "}
                  {data.count === 1 ? "protector" : "protectors"}
                </p>
                <p className="text-muted-foreground text-sm">
                  {data.onDuty ? "You are on duty" : "Your village can use your help"}
                </p>
              </div>
            </div>
            <Button
              id="village-duty-toggle"
              variant={data.onDuty ? "outline" : "default"}
              disabled={isChanging || (!data.onDuty && !data.canEnroll)}
              onClick={() => setDuty(!data.onDuty)}
            >
              {isChanging
                ? "Updating duty..."
                : data.onDuty
                  ? "Stand down"
                  : "Sign up for duty"}
            </Button>
          </div>
          {!data.onDuty && !data.canEnroll && (
            <p className="text-sm">
              Sign up while awake in your home village at {VILLAGE_DUTY_MIN_RANK} rank
              or higher.
            </p>
          )}
          <p className="text-muted-foreground text-sm">
            Your copy uses your equipped gear, jutsu and AI profile when an encounter
            begins. Patrol battles do not change your own health, items or battle
            record, and grant you no rewards. One protector defends each encounter;
            other protectors continue patrolling.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.protectors.map((protector) => (
              <Link
                key={protector.userId}
                href={`/userid/${protector.userId}`}
                className="hover:bg-muted/50 flex min-w-0 items-center gap-3 rounded border p-3"
              >
                <AvatarImage
                  href={protector.avatar}
                  alt={protector.username}
                  size={40}
                  className="m-0 size-10 shrink-0"
                />
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {protector.username}
                </span>
                <Badge variant="secondary">Protector</Badge>
              </Link>
            ))}
          </div>
          {data.count === 0 && (
            <p className="text-muted-foreground text-sm">
              No one is on duty yet. Be your village&apos;s first protector.
            </p>
          )}
          {data.count > data.protectors.length && (
            <p className="text-muted-foreground text-sm">
              Showing {data.protectors.length} of {data.count} protectors.
            </p>
          )}
        </div>
      )}
      {message && (
        <p role="status" className="mt-3 text-sm">
          {message}
        </p>
      )}
    </ContentBox>
  );
};
