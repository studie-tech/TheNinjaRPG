"use client";

import { Shield } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  VILLAGE_DUTY_MAX_PATROLS,
  VILLAGE_DUTY_MIN_RANK,
  VILLAGE_DUTY_SLOTS_PER_LEVEL,
} from "@/drizzle/constants";
import { useVillageDuty } from "@/hooks/useVillageDuty";
import AvatarImage from "@/layout/Avatar";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import { FeedbackAlert } from "@/layout/FeedbackAlert";
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
  const [page, setPage] = useState(0);
  const { data, isPending, isError, refetch, setDuty, isChanging, feedback, timeDiff } =
    useVillageDuty(villageId, sector);
  const protectors = data?.protectors ?? [];
  const pageCount = Math.ceil(protectors.length / 4);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const pageProtectors = protectors.slice(currentPage * 4, (currentPage + 1) * 4);
  return (
    <ContentBox
      title="Town Hall"
      subtitle="Village Duty"
      defaultBackHref="/village"
      topRightContent={navTabs}
    >
      <p className="text-muted-foreground mb-4 text-sm">
        Sign up your character's AI copy for the hourly patrol rotation. Village
        Protectors provides {VILLAGE_DUTY_SLOTS_PER_LEVEL} slots per level, up to{" "}
        {VILLAGE_DUTY_MAX_PATROLS}. You can keep playing normally while enrolled.
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
                  {data.available}/{data.capacity} patrolling
                </p>
                <p className="text-muted-foreground text-sm">
                  {data.count.toLocaleString()} signed up
                  {data.defeated > 0
                    ? ` · ${data.defeated} ${data.defeated === 1 ? "copy" : "copies"} defeated`
                    : ""}
                  {data.enrolled && (
                    <span className="block">
                      {data.patrolStatus === "PATROLLING"
                        ? "Your copy is on patrol"
                        : data.patrolStatus === "FIGHTING"
                          ? "Your copy is defending"
                          : data.patrolStatus === "DEFEATED"
                            ? "Your copy is defeated this shift"
                            : "You are in reserve"}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <Button
              id="village-duty-toggle"
              variant={data.enrolled ? "outline" : "default"}
              disabled={isChanging || (!data.enrolled && !data.canEnroll)}
              onClick={() => setDuty(!data.enrolled)}
            >
              {isChanging
                ? "Updating duty..."
                : data.enrolled
                  ? "Stand down"
                  : "Sign up for duty"}
            </Button>
          </div>
          {feedback && <FeedbackAlert feedback={feedback} />}
          {!data.enrolled && !data.canEnroll && (
            <p className="text-sm">
              Sign up while awake in your home village at {VILLAGE_DUTY_MIN_RANK} rank
              or higher.
            </p>
          )}
          <p className="text-muted-foreground text-sm">
            Active stealth avoids roaming patrols; attacking players or shrines still
            confronts them. Each enemy fights one copy at a time; defeated copies stay
            down village-wide until rotation. Defeating a protector or an invader with
            your copy earns PvP wins and points. Your health and items stay untouched.
            <span className="mt-1 block">
              Next rotation:{" "}
              <Countdown
                targetDate={data.nextRotationAt}
                timeDiff={timeDiff}
                onFinish={() => void refetch()}
              />
              {data.nextCapacity !== data.capacity
                ? ` · ${data.nextCapacity} slots next rotation`
                : ""}
              .
            </span>
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {pageProtectors.map((protector) => (
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
                <Badge variant="secondary">
                  {protector.defeated
                    ? "Defeated"
                    : protector.fighting
                      ? "Defending"
                      : "Patrolling"}
                </Badge>
              </Link>
            ))}
          </div>
          {pageCount > 1 && (
            <nav
              aria-label="Village protector pages"
              className="flex items-center justify-between gap-2"
            >
              <Button
                variant="outline"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous
              </Button>
              <span>
                {currentPage + 1} of {pageCount}
              </span>
              <Button
                variant="outline"
                disabled={currentPage + 1 >= pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                Next
              </Button>
            </nav>
          )}
          {data.count === 0 && (
            <p className="text-muted-foreground text-sm">
              No one is on duty yet. Be your village&apos;s first protector.
            </p>
          )}
          {data.count > 0 && data.protectors.length === 0 && (
            <p className="text-muted-foreground text-sm">
              Volunteers are ready for the next hourly selection.
            </p>
          )}
        </div>
      )}
    </ContentBox>
  );
};
