"use client";

import { Swords, Target, Triangle, Trophy, Users } from "lucide-react";
import type React from "react";
import { api } from "@/app/_trpc/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ARENA_MODE_LABELS,
  ARENA_MODES,
  type ArenaMode,
  sparExamProgress,
} from "@/libs/battleArena";
import { useRequiredUserDataSelector } from "@/utils/UserContext";

/**
 * Tabs for all five arena modes and the spar exam reminder. The page title owns back navigation.
 */
export function ArenaModeShell({ mode, onSelect, children }: ArenaModeShellProps) {
  const { data: userData } = useRequiredUserDataSelector((u) => ({
    userId: u.userId,
    userQuests: u.userQuests,
    questData: u.questData,
  }));
  const { data: challenges } = api.sparring.getUserChallenges.useQuery(undefined, {
    staleTime: 5000,
    enabled: !!userData,
  });
  const waiting =
    challenges?.filter(
      (c) => c.receiverId === userData?.userId && c.status === "PENDING",
    ).length ?? 0;
  const exam = userData ? sparExamProgress(userData) : null;
  // Radix includes the tab value in its generated element ids.
  const tabValue = encodeURIComponent(mode);

  return (
    <Tabs
      value={tabValue}
      onValueChange={(value) => onSelect(decodeURIComponent(value) as ArenaMode)}
      className="@container flex flex-col gap-3 p-3"
    >
      <TabsList aria-label="Arena modes" className="grid grid-cols-5 gap-0.5 p-0.5">
        {ARENA_MODES.map((option) => {
          const Icon = MODE_ICONS[option];
          return (
            <TabsTrigger
              key={option}
              value={encodeURIComponent(option)}
              className="hover:text-foreground relative flex h-14 min-w-0 flex-col gap-1.5 px-0 text-[11px] font-semibold @min-[600px]:h-10 @min-[600px]:flex-row @min-[600px]:px-3.5 @min-[600px]:text-sm"
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {ARENA_MODE_LABELS[option]}
              {option === "Sparring" && waiting > 0 && (
                <span className="bg-primary text-primary-foreground absolute top-1 right-1 min-w-4 rounded-full px-1 text-[10px] leading-4 @min-[600px]:static">
                  {waiting}
                </span>
              )}
            </TabsTrigger>
          );
        })}
      </TabsList>
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
          <span className="text-primary font-semibold">Find opponents →</span>
        </button>
      )}
      <TabsContent value={tabValue} className="mt-0">
        {children}
      </TabsContent>
    </Tabs>
  );
}

const MODE_ICONS: Record<ArenaMode, typeof Swords> = {
  Arena: Swords,
  Sparring: Users,
  Training: Target,
  "PVP Rank": Trophy,
  "Battle Pyramid": Triangle,
};

interface ArenaModeShellProps {
  mode: ArenaMode;
  onSelect: (mode: ArenaMode) => void;
  children: React.ReactNode;
}
