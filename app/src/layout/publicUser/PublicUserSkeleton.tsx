"use client";

import type React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import AvatarImage from "@/layout/Avatar";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import type { PublicUserSeed } from "@/layout/PublicUser";
import { publicUserIntro } from "@/layout/seoTexts";
import { showUserRank } from "@/libs/profile";

interface PublicUserSkeletonProps {
  title: string;
  subtitle?: string;
  defaultBackHref?: string;
  initialBreak?: boolean;
  /** Mirrors the stable signed-in state used by the loaded render. */
  isGuest: boolean;
  /** Profile fields the route already resolved server-side, when it has them. */
  seed?: PublicUserSeed;
}

/**
 * Placeholder shown while the profile query is in flight.
 *
 * The profile is fetched client-side, so the server render carries none of it. A bare
 * spinner is a few dozen pixels tall and the loaded profile is several hundred, which
 * moved everything below it on arrival and put the /username/* template over the poor
 * Cumulative Layout Shift threshold in Search Console.
 *
 * The structure below deliberately mirrors the loaded render rather than approximating
 * it: the same guest-only intro, the same two-column grid, and an avatar reserved at
 * the same `w-full` the loaded one is given. A placeholder that reserves the wrong shape
 * still shifts the page, just by less.
 */
export const PublicUserSkeleton: React.FC<PublicUserSkeletonProps> = ({
  title,
  subtitle,
  defaultBackHref,
  initialBreak,
  isGuest,
  seed,
}) => {
  const seedName = seed
    ? `${seed.username}${seed.displayTitle ? ` [${seed.displayTitle}]` : ""}`
    : null;
  return (
    <>
      <ContentBox
        title={title}
        subtitle={subtitle ?? (seedName ? `Profile: ${seedName}` : "Loading profile")}
        defaultBackHref={defaultBackHref}
        initialBreak={initialBreak}
      >
        {/* With a seed this is the same copy the loaded render shows, so the intro needs
          no placeholder at all and never resizes. Without one, the intro is a single
          short paragraph whose height only varies with the username, so three rows
          reserve it to within a line at desktop width. */}
        {isGuest && (
          <div className="mb-4">
            {seed ? (
              publicUserIntro(seed.username)
            ) : (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className={i === 2 ? "h-4 w-2/3" : "h-4 w-full"} />
                ))}
              </div>
            )}
          </div>
        )}
        <div className="grid grid-cols-2">
          <div className="flex flex-col gap-2">
            {seed && (
              // The three lines the seed can fill are the first three of the loaded
              // "General" block, in the same order, so nothing below them moves. The
              // village row is rendered even when the seed has no village, because the
              // loaded panel always renders it -- omitting it would leave the
              // placeholder a row short and shift everything below it on load.
              <div>
                <b>General</b>
                <p>
                  Lvl. {seed.level} {showUserRank(seed)}
                </p>
                <p>Village: {seed.villageName}</p>
              </div>
            )}
            {Array.from({ length: seed ? 20 : 23 }, (_, i) => (
              <Skeleton key={i} className="h-4 w-11/12" />
            ))}
          </div>
          <div>
            <div className="basis-1/3">
              <div className="relative flex justify-center">
                {seed ? (
                  <AvatarImage
                    href={seed.avatar}
                    alt={seed.username}
                    size={100}
                    priority
                  />
                ) : (
                  <Skeleton className="aspect-square w-full max-w-80 rounded-2xl" />
                )}
              </div>
              <div className="mt-2">
                {Array.from({ length: 3 }, (_, i) => (
                  <div key={i} className="group relative flex-row">
                    <Skeleton className="h-4 w-1/3 rounded-none" />
                    <Skeleton className="h-3 w-full rounded-none border-2 border-black" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <Loader explanation="Fetching Public User Data" />
      </ContentBox>
    </>
  );
};
