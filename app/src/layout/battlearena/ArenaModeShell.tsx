"use client";

import { Swords, Target, Triangle, Trophy, Users } from "lucide-react";
import type React from "react";
import { api } from "@/app/_trpc/client";
import {
  ARENA_MODE_LABELS,
  ARENA_MODES,
  type ArenaMode,
  sparExamProgress,
} from "@/libs/battleArena";
import { cn } from "@/libs/shadui";
import { useRequiredUserData } from "@/utils/UserContext";

interface ArenaModeShellProps {
  mode: ArenaMode;
  onSelect: (mode: ArenaMode) => void;
  onOverview: () => void;
  children: React.ReactNode;
}

/**
 * The frame around every arena mode: a way back to the overview, tabs for all five modes and
 * the spar exam reminder. Below 600px the tabs become five equal columns.
 */
export function ArenaModeShell({
  mode,
  onSelect,
  onOverview,
  children,
}: ArenaModeShellProps) {
  const { data: userData } = useRequiredUserData();
  const { data: challenges } = api.sparring.getUserChallenges.useQuery(undefined, {
    staleTime: 5000,
    enabled: !!userData,
  });
  const waiting =
    challenges?.filter(
      (c) => c.receiverId === userData?.userId && c.status === "PENDING",
    ).length ?? 0;
  const exam = userData ? sparExamProgress(userData) : null;

  return (
    <div className="@container flex flex-col gap-3 p-3">
      <button
        type="button"
        onClick={onOverview}
        className="flex min-h-9 items-center gap-1 self-start font-semibold text-primary text-sm hover:underline"
      >
        ← Overview
      </button>
      <div
        role="tablist"
        aria-label="Arena modes"
        className="grid grid-cols-5 gap-0.5 rounded-lg bg-muted p-0.5 @min-[600px]:flex"
      >
        {ARENA_MODES.map((option) => {
          const Icon = MODE_ICONS[option];
          const selected = option === mode;
          return (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onSelect(option)}
              className={cn(
                "relative flex min-w-0 items-center justify-center gap-1.5 rounded-md font-semibold text-sm",
                "h-14 flex-col text-[11px] @min-[600px]:h-10 @min-[600px]:flex-row @min-[600px]:px-3.5 @min-[600px]:text-sm",
                selected
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {ARENA_MODE_LABELS[option]}
              {option === "Sparring" && waiting > 0 && (
                <span className="absolute top-1 right-1 min-w-4 rounded-full bg-primary px-1 text-[10px] text-primary-foreground leading-4 @min-[600px]:static">
                  {waiting}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {exam && mode !== "Sparring" && (
        <button
          type="button"
          onClick={() => onSelect("Sparring")}
          className="flex min-h-11 items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-left text-sm dark:border-amber-800 dark:bg-amber-950/40"
        >
          <span className="flex-1">
            <b>{exam.questName}</b> · win {exam.target} spars ·{" "}
            <b>
              {exam.done} / {exam.target}
            </b>
          </span>
          <span className="font-semibold text-primary">Find opponents →</span>
        </button>
      )}
      {children}
    </div>
  );
}

const MODE_ICONS: Record<ArenaMode, typeof Swords> = {
  Arena: Swords,
  Sparring: Users,
  Training: Target,
  "PVP Rank": Trophy,
  "Battle Pyramid": Triangle,
};
