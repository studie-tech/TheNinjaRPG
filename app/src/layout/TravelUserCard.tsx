"use client";

import { ChevronRight } from "lucide-react";
import type React from "react";
import { useRef } from "react";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { MAX_PVP_BRACKET } from "@/drizzle/constants";
import AvatarImage from "@/layout/Avatar";
import Link from "@/layout/Link";
import StatusBar from "@/layout/StatusBar";
import {
  getKnownEffectiveLevel,
  getKnownExpBracket,
  showUserRank,
} from "@/libs/profile";
import { travelAvatar } from "@/libs/rendering/scenes/travelActors";
import type { SectorUser } from "@/libs/sector-map/world-types";
import { cn } from "@/libs/shadui";

/**
 * Who a player on the map is, opened from their profile control so scouting never leaves
 * travel. It reads only the sector snapshot, so it opens without a request.
 */
export const TravelUserCard: React.FC<{
  user: SectorUser;
  /** Client coordinates of the tap that opened the card; read once per mount. */
  anchor: { x: number; y: number };
  onClose: () => void;
}> = ({ user, anchor, onClose }) => {
  const { data: villages } = api.village.getAll.useQuery(undefined);
  // Fixed for this mount; callers key the card by tap so a new tap re-anchors it.
  const anchorRef = useRef({
    getBoundingClientRect: () => DOMRect.fromRect({ x: anchor.x, y: anchor.y }),
  });
  const village = villages?.find((entry) => entry.id === user.villageId);
  const level = getKnownEffectiveLevel(user);
  const bracket = getKnownExpBracket(user);
  const relation = travelRelation(user);
  return (
    <Popover open onOpenChange={(open) => !open && onClose()}>
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        side="top"
        sideOffset={12}
        collisionPadding={12}
        // A map tap opened it: focusing the HP tooltip trigger would ring the bar.
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-64 p-3"
        aria-label={`${user.username} profile summary`}
      >
        <div className="flex gap-3">
          <AvatarImage
            href={travelAvatar(user)}
            alt={user.username}
            size={100}
            className="m-0 w-20 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold" title={user.username}>
              {user.username}
            </p>
            <p className="text-sm">
              Lvl. {level ?? "?"} {showUserRank(user)}
            </p>
            <p className="flex items-center gap-1.5 truncate text-sm">
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/40"
                style={{ backgroundColor: village?.hexColor ?? "gray" }}
              />
              {village?.name ?? "Unknown village"}
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              <Badge
                className={cn("border-transparent text-white", relation.className)}
              >
                {relation.label}
              </Badge>
              {user.isVillageDuty && (
                <Badge variant="secondary">Village protector · AI patrol</Badge>
              )}
              {user.status !== "AWAKE" && (
                <Badge variant="secondary">{user.status.toLowerCase()}</Badge>
              )}
            </div>
          </div>
        </div>
        <div className="mt-3 space-y-2 text-sm">
          <StatusBar
            title="HP"
            color="bg-red-500"
            showText
            current={user.curHealth}
            total={user.maxHealth}
            status={user.status}
          />
          <p>
            PvP bracket{" "}
            <span className="font-semibold">
              {bracket == null ? "?" : `${bracket}/${MAX_PVP_BRACKET}`}
            </span>
          </p>
        </div>
        <Button asChild size="sm" className="mt-3 w-full">
          <Link href={`/userid/${user.villageDutyUserId ?? user.userId}`}>
            View full profile
            <ChevronRight className="h-4 w-4" />
          </Link>
        </Button>
      </PopoverContent>
    </Popover>
  );
};

/** War sides outrank standing alliances; colors match the map's ally/neutral/enemy pins. */
const travelRelation = (user: SectorUser) => {
  if (user.warRelationship === "ENEMY")
    return { label: "At war", className: "bg-red-700" };
  if (user.warRelationship === "ALLY")
    return { label: "War ally", className: "bg-green-700" };
  if (user.allianceStatus === "ALLY")
    return { label: "Ally", className: "bg-green-700" };
  if (user.allianceStatus === "NEUTRAL")
    return { label: "Neutral", className: "bg-sky-700" };
  return { label: "Enemy", className: "bg-red-700" };
};
