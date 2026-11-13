"use client";

import { Search, UserRound } from "lucide-react";
import type React from "react";
import { useState } from "react";
import type { RouterOutputs } from "@/app/_trpc/client";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  IMG_AVATAR_DEFAULT,
  ONLINE_WINDOW_MINUTES,
  SPARRING_NEAR_LEVEL_RANGE,
} from "@/drizzle/constants";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import { cn } from "@/libs/shadui";
import { capitalizeFirstLetter } from "@/utils/string";
import { formatTimeAgo } from "@/utils/time";
import { useRequiredUserDataSelector } from "@/utils/UserContext";

/**
 * Players to spar with: near your level and online by default, narrowed to your village on
 * request. A name search finds any ninja, whatever their level or activity.
 */
export function OpponentFinder({
  onChallenge,
  challengedIds,
  isChallenging,
}: OpponentFinderProps) {
  const { data: userData } = useRequiredUserDataSelector((u) => ({
    level: u.level,
    userId: u.userId,
    villageId: u.villageId,
  }));
  const [nearLevel, setNearLevel] = useState(true);
  const [onlineNow, setOnlineNow] = useState(true);
  const [myVillage, setMyVillage] = useState(false);
  const [search, setSearch] = useState("");
  const username = useDebouncedValue(search.trim(), 300);

  const level = userData?.level ?? 0;
  const {
    data: pages,
    fetchNextPage,
    hasNextPage,
    isFetching,
    dataUpdatedAt,
  } = api.profile.getPublicUsers.useInfiniteQuery(
    {
      limit: 20,
      orderBy: "Online",
      isAi: false,
      ...(username
        ? { username }
        : {
            ...(nearLevel
              ? {
                  minLevel: level - SPARRING_NEAR_LEVEL_RANGE,
                  maxLevel: level + SPARRING_NEAR_LEVEL_RANGE,
                }
              : {}),
            ...(onlineNow ? { activeWithinMinutes: ONLINE_WINDOW_MINUTES } : {}),
          }),
      ...(myVillage && userData?.villageId ? { village: userData.villageId } : {}),
    },
    {
      enabled: !!userData,
      // Activity changes independently of this player's actions.
      staleTime: 60_000,
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );

  const players = pages?.pages
    .flatMap((page) => page.data)
    .filter((player) => player.userId !== userData?.userId);
  const onlineSince = dataUpdatedAt - ONLINE_WINDOW_MINUTES * 60_000;

  return (
    <section aria-label="Find opponents" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-bold">Find opponents</h2>
        <span className="text-muted-foreground text-xs">
          Your level: {level} · filters combine
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <FilterChip label="Near my level" pressed={nearLevel} onToggle={setNearLevel} />
        <FilterChip label="Online now" pressed={onlineNow} onToggle={setOnlineNow} />
        <FilterChip label="My village" pressed={myVillage} onToggle={setMyVillage} />
        <label className="bg-background flex h-9 min-w-40 flex-1 items-center gap-1.5 rounded-full border px-3">
          <Search className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden />
          <input
            aria-label="Search any ninja by name"
            placeholder="Any ninja by name"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full bg-transparent text-sm outline-none"
          />
        </label>
      </div>
      <ul aria-label="Opponents" className="flex flex-col gap-1.5">
        {players?.map((player) => {
          const isOnline = new Date(player.updatedAt).getTime() >= onlineSince;
          const isChallenged = challengedIds.has(player.userId);
          return (
            <li
              key={player.userId}
              className="bg-card flex items-center gap-2.5 rounded-lg border p-2"
            >
              <PlayerCard player={player} isOnline={isOnline}>
                <span className="relative shrink-0">
                  <Image
                    alt=""
                    src={player.avatar ?? IMG_AVATAR_DEFAULT}
                    width={40}
                    height={40}
                    className="h-10 w-10 rounded-md object-cover"
                  />
                  {isOnline && (
                    <span className="border-card absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 bg-green-600" />
                  )}
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  <b>{player.username}</b> · Lv {player.level}{" "}
                  {capitalizeFirstLetter(player.rank)}
                  <span className="text-muted-foreground block text-xs">
                    {player.village?.name ?? "No village"} ·{" "}
                    {isOnline ? "online" : formatTimeAgo(new Date(player.updatedAt))}
                  </span>
                </span>
              </PlayerCard>
              <Button
                className="h-11 shrink-0"
                variant={isChallenged ? "secondary" : "default"}
                disabled={isChallenged || isChallenging}
                aria-label={`${isChallenged ? "Challenged" : "Challenge"} ${player.username}`}
                onClick={() => onChallenge(player.userId)}
              >
                {isChallenged ? "Challenged" : "Challenge"}
              </Button>
            </li>
          );
        })}
      </ul>
      {players?.length === 0 && (
        <p className="text-muted-foreground py-3 text-center text-sm">
          No ninja match these filters. Turn one off or search by name.
        </p>
      )}
      {hasNextPage && (
        <Button
          variant="outline"
          className="h-11 self-center"
          disabled={isFetching}
          onClick={() => void fetchNextPage()}
        >
          Show more
        </Button>
      )}
    </section>
  );
}

/** Compact player identity and progress, with a local fallback for unavailable portraits. */
function PlayerCard({
  player,
  isOnline,
  children,
}: {
  player: PublicPlayer;
  isOnline: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const avatar = player.avatar?.trim();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`About ${player.username}`}
        className="hover:bg-muted focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left focus-visible:ring-2"
      >
        {children}
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={8} className="w-[224px] p-3">
        <div className="flex items-center gap-2.5">
          <div className="bg-muted flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md">
            {avatar && avatar !== failedAvatar ? (
              <Image
                alt={player.username}
                src={avatar}
                width={48}
                height={48}
                loading="eager"
                className="h-full w-full object-cover"
                onError={() => setFailedAvatar(avatar)}
              />
            ) : (
              <UserRound
                role="img"
                aria-label={`${player.username} avatar unavailable`}
                className="text-muted-foreground h-6 w-6"
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{player.username}</p>
            <p className="text-muted-foreground text-xs">
              Lv {player.level} {capitalizeFirstLetter(player.rank)} ·{" "}
              {player.village?.name ?? "No village"}
            </p>
            <p className="text-muted-foreground text-xs">
              {isOnline
                ? "Online now"
                : `Seen ${formatTimeAgo(new Date(player.updatedAt))}`}
            </p>
          </div>
        </div>
        <dl className="my-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <dt className="text-muted-foreground">Experience</dt>
          <dd className="text-right font-semibold">
            {player.experience.toLocaleString()}
          </dd>
          <dt className="text-muted-foreground">PvP experience</dt>
          <dd className="text-right font-semibold">
            {player.pvpExperience.toLocaleString()}
          </dd>
        </dl>
        <Button asChild variant="outline" className="h-10 w-full">
          <Link href={`/username/${player.username}`} onClick={() => setOpen(false)}>
            <UserRound className="mr-2 h-4 w-4" aria-hidden /> See profile
          </Link>
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function FilterChip({
  label,
  pressed,
  onToggle,
}: {
  label: string;
  pressed: boolean;
  onToggle: (pressed: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onToggle(!pressed)}
      className={cn(
        "h-9 rounded-full border px-3 text-xs font-semibold",
        pressed
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-background text-foreground hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}

type PublicPlayer = RouterOutputs["profile"]["getPublicUsers"]["data"][number];

interface OpponentFinderProps {
  onChallenge: (targetId: string) => void;
  /** Players with a pending challenge from you. */
  challengedIds: Set<string>;
  isChallenging: boolean;
}
