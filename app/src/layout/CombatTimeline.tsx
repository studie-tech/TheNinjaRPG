"use client";

import {
  ChevronLeft,
  ChevronRight,
  Clock,
  type LucideIcon,
  User,
  Users,
  UserX,
} from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { BattleAction } from "@/drizzle/schema";
import { useLocalStorage } from "@/hooks/localstorage";
import ContentImage from "@/layout/ContentImage";
import ItemWithEffects, { type GenericObject } from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import { availableUserActions } from "@/libs/combat/actions";
import type { ActionEffect, ReturnedBattle } from "@/libs/combat/types";
import { getItem, getJutsu } from "@/libs/combat/util";
import { cn } from "@/libs/shadui";
import { parseHtml } from "@/utils/parse";

type UserFilter = "all" | "user" | "opponents";

type CombatTimelineProps = {
  battleId: string;
  battle?: ReturnedBattle | null;
  battleVersion?: number;
  pageSize?: number;
  showBasicActions?: boolean;
};

const effectColors: Record<ActionEffect["color"], string> = {
  red: "bg-red-100 text-red-500",
  green: "bg-green-100 text-green-500",
  blue: "bg-blue-100 text-blue-500",
  yellow: "bg-yellow-100 text-yellow-500",
  purple: "bg-purple-100 text-purple-500",
  orange: "bg-orange-100 text-orange-500",
  pink: "bg-pink-100 text-pink-500",
  gray: "bg-gray-100 text-gray-500",
};

const placeholderObj: GenericObject = {
  id: "unknown",
  name: "Unknown action",
  description: "No details available for this action.",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const filterOptions: { value: UserFilter; icon: LucideIcon; label: string }[] = [
  { value: "all", icon: Users, label: "All" },
  { value: "user", icon: User, label: "You" },
  { value: "opponents", icon: UserX, label: "Opponents" },
];

const CombatTimeline: React.FC<CombatTimelineProps> = ({
  battleId,
  battle,
  battleVersion,
  pageSize = 5,
  showBasicActions = true,
}) => {
  const [selected, setSelected] = useState<BattleAction | null>(null);
  const [limit, setLimit] = useState(pageSize);
  const [userFilter, setUserFilter] = useLocalStorage<UserFilter>(
    "timeline-user-filter",
    "all",
  );
  const [filterExpanded, setFilterExpanded] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  // Close filter dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterExpanded(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Reset limit when battle version or filter changes
  useEffect(
    () => setLimit(pageSize),
    [battleVersion, pageSize, userFilter, showBasicActions],
  );

  const { data: entries, isFetching } = api.combat.getBattleEntries.useQuery(
    {
      battleId,
      limit,
      offset: 0,
      refreshKey: battleVersion ?? 0,
      userFilter,
      showBasicActions,
    },
    { enabled: !!battleId, placeholderData: (prev) => prev },
  );

  const hasMoreOlder = entries?.length === limit;

  const resolvedEntries = useMemo(() => {
    if (!entries?.length) return [];
    return [...entries]
      .reverse() // Oldest on left, newest on right
      .map((entry) => {
        const user = battle?.usersState.find((u) => u.userId === entry.userId);
        const actions =
          battle && entry.userId
            ? availableUserActions(battle, entry.userId, true, false)
            : [];
        const action = actions.find((a) => a.id === entry.actionId);

        const userJutsu = user?.jutsus?.find((j) => j.jutsuId === entry.actionId);
        const jutsu =
          battle && userJutsu ? getJutsu(battle, userJutsu.jutsuId) : undefined;
        const userItem = user?.items?.find((i) => i.itemId === entry.actionId);
        const item = battle && userItem ? getItem(battle, userItem.itemId) : undefined;

        let actionImage: string | undefined;
        let actionItem: GenericObject;

        if (jutsu) {
          actionImage = jutsu.image;
          actionItem = jutsu;
        } else if (userItem && item) {
          actionImage = item.image;
          actionItem = item;
        } else {
          actionImage = action?.image ?? user?.avatar ?? undefined;
          actionItem =
            action?.data ??
            (action
              ? {
                  ...placeholderObj,
                  id: action.id,
                  name: action.name,
                  description: action.battleDescription ?? "",
                  image: action.image,
                  effects: action.effects,
                }
              : placeholderObj);
        }

        // Calculate remaining rounds for active effects from this action
        let remainingRounds = 0;
        let isNewEffect = false;
        if (battle && entry.actionId) {
          const allEffects = [
            ...(battle.usersEffects ?? []),
            ...(battle.groundEffects ?? []),
          ];
          const actionEffects = allEffects.filter(
            (e) =>
              e.actionId === entry.actionId && e.rounds !== undefined && e.rounds > 0,
          );
          if (actionEffects.length > 0) {
            remainingRounds = Math.max(...actionEffects.map((e) => e.rounds ?? 0));
            // Check if any effect was cast this round (not active yet)
            isNewEffect = actionEffects.some((e) => e.castThisRound);
          }
        }

        return {
          entry,
          user,
          action,
          actionItem,
          actionImage,
          remainingRounds,
          isNewEffect,
        };
      });
  }, [entries, battle]);

  // Auto-scroll to right only when new entries appear (not when loading older)
  useEffect(() => {
    const grewAtEnd =
      resolvedEntries.length > prevCountRef.current && limit === pageSize;
    if (scrollContainerRef.current && grewAtEnd) {
      scrollContainerRef.current.scrollLeft = scrollContainerRef.current.scrollWidth;
    }
    prevCountRef.current = resolvedEntries.length;
  }, [resolvedEntries.length, limit, pageSize]);

  return (
    <div className="relative space-y-3 rounded-lg border bg-slate-100 p-3">
      {isFetching && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-slate-950/10 backdrop-blur-sm">
          <Loader noPadding />
        </div>
      )}

      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-gray-700" />
          <Clock className="h-4 w-4 text-gray-700" />
          <span className="font-semibold text-gray-800 text-sm">Action Timeline</span>
        </div>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: Mouse enter/leave for tooltip expansion is supplementary to button click */}
        <div
          ref={filterRef}
          className="relative flex rounded-md border bg-slate-200 p-0.5"
          onMouseEnter={() => setFilterExpanded(true)}
          onMouseLeave={() => setFilterExpanded(false)}
        >
          {filterOptions.map(({ value, icon: Icon, label }, i) => {
            const isActive = userFilter === value;
            const isVisible = isActive || filterExpanded;
            return (
              <button
                type="button"
                key={`${value}-${i}`}
                onClick={() => {
                  if (!filterExpanded) {
                    setFilterExpanded(true);
                  } else {
                    setUserFilter(value);
                    setFilterExpanded(false);
                  }
                }}
                className={cn(
                  "flex items-center gap-1 overflow-hidden rounded font-medium text-xs transition-all duration-200 ease-out",
                  isVisible
                    ? "max-w-24 px-2 py-1 opacity-100"
                    : "max-w-0 px-0 py-1 opacity-0",
                  isActive
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-600 hover:text-gray-900",
                )}
                title={label}
              >
                <Icon className="h-3 w-3 shrink-0" />
                <span className="hidden whitespace-nowrap sm:inline">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div ref={scrollContainerRef} className="relative overflow-x-auto pb-4">
        <div className="relative flex min-w-max items-center gap-2 px-3">
          <div className="pointer-events-none absolute inset-x-12 top-1/2 h-px -translate-y-1/2 bg-gray-400" />

          <Button
            size="icon"
            variant="ghost"
            className="shrink-0 rounded-full border bg-slate-200 shadow-sm hover:bg-slate-300"
            onClick={() => setLimit((l) => l + pageSize)}
            disabled={!hasMoreOlder || isFetching}
            aria-label="Load older actions"
          >
            <ChevronLeft className="h-4 w-4 text-gray-700" />
          </Button>

          {resolvedEntries.length === 0 && (
            <p className="relative z-10 mt-6 flex-1 text-center text-gray-600 text-xs">
              No actions recorded yet.
            </p>
          )}

          {resolvedEntries.map(
            (
              { entry, user, actionImage, actionItem, remainingRounds, isNewEffect },
              idx,
            ) => (
              <React.Fragment key={entry.id}>
                {idx > 0 && (
                  <div className="relative w-4 flex-none">
                    <ChevronRight className="absolute top-1/2 left-0 h-3 w-3 -translate-y-1/2 text-muted-foreground/70" />
                  </div>
                )}
                <TooltipProvider delayDuration={50}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          "group relative flex w-20 flex-none flex-col items-center rounded-lg px-1 py-1 text-xs transition",
                          "hover:bg-slate-200",
                        )}
                        onClick={() => setSelected(entry)}
                        aria-label="View action details"
                      >
                        <div className="flex flex-col items-center">
                          <div className="relative">
                            <div className="rounded-full border bg-slate-50 shadow-sm group-hover:border-gray-400">
                              {actionImage ? (
                                <ContentImage
                                  image={actionImage}
                                  alt="Action"
                                  className="h-16 w-16 rounded-full"
                                />
                              ) : (
                                <div className="h-16 w-16 rounded-full bg-muted" />
                              )}
                            </div>
                            {/* Remaining rounds indicator - bottom left */}
                            {remainingRounds > 0 && (
                              <TooltipProvider delayDuration={50}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div
                                      className={cn(
                                        "absolute -bottom-1 -left-1 flex h-6 w-6 items-center justify-center rounded-full border font-bold text-[10px] shadow-sm",
                                        isNewEffect
                                          ? "border-red-400 bg-red-100 text-red-700"
                                          : "border-green-500 bg-green-100 text-green-700",
                                      )}
                                    >
                                      {remainingRounds}
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {remainingRounds} round
                                    {remainingRounds !== 1 ? "s" : ""} remaining
                                    {isNewEffect ? " (activates next round)" : ""}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                            {/* User avatar - bottom right */}
                            <div className="absolute -right-1 -bottom-1 rounded-full bg-slate-50 shadow-sm group-hover:border-gray-400">
                              {user?.avatar ? (
                                <ContentImage
                                  image={user.avatar}
                                  alt={user.username}
                                  className="h-8 w-8 rounded-full"
                                />
                              ) : (
                                <div className="h-8 w-8 rounded-full bg-muted" />
                              )}
                            </div>
                          </div>
                          <div className="mt-4 font-medium text-[10px] text-gray-600">
                            <span className="inline-flex items-center gap-1 whitespace-nowrap">
                              <Clock className="h-3 w-3" />
                              <span>Round {entry.battleRound}</span>
                            </span>
                          </div>
                        </div>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{actionItem.name}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </React.Fragment>
            ),
          )}
        </div>
      </div>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-3xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-col gap-1">
                  <span>Action details</span>
                  <span className="font-medium text-muted-foreground text-xs">
                    Round {selected.battleRound}
                  </span>
                  <span className="font-normal text-muted-foreground text-sm">
                    {parseHtml(selected.description ?? "")}
                  </span>
                </DialogTitle>
              </DialogHeader>
              {(() => {
                const resolved = resolvedEntries.find(
                  (r) => r.entry.id === selected.id,
                );
                const actionItem = resolved?.actionItem ?? placeholderObj;
                const effects = (selected.appliedEffects ?? []) as ActionEffect[];
                return (
                  <div className="space-y-4">
                    <ItemWithEffects
                      item={actionItem}
                      hideDetails={false}
                      hideDates={true}
                      hideData={true}
                      hideEffects={true}
                    />
                    {effects.length > 0 && (
                      <div className="space-y-2 rounded-md border p-3">
                        <p className="font-semibold text-sm">Applied effects</p>
                        <div className="flex flex-wrap gap-2">
                          {effects.map((effect, i) => (
                            <span
                              key={`${effect.txt}-${i}`}
                              className={cn(
                                "rounded-full px-2 py-1 font-medium text-[11px]",
                                effectColors[effect.color],
                              )}
                            >
                              {effect.txt}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CombatTimeline;
