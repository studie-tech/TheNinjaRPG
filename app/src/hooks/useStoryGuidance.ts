"use client";

import { atom } from "jotai";
import { useRef } from "react";
import { api } from "@/app/_trpc/client";
import { getSeenIntroPatch } from "@/deltas/profile";
import {
  getNewSystemBadges,
  getStoryDockItem,
  getStoryProgress,
  isSystemUnlocked,
  type StorySystemId,
  type StoryUser,
} from "@/libs/storyGuidance";
import type { UserWithRelations } from "@/routers/profile";
import { useUserDataSelector } from "@/utils/UserContext";

/** Bumped when story progress lands, so the dock pulses instead of a dialog opening. */
export const storyDockPulseAtom = atom(0);

/** The profile fields story guidance reads, selected once for every consumer. */
export const selectStoryUser = (user: NonNullable<UserWithRelations>) =>
  ({
    userId: user.userId,
    rank: user.rank,
    level: user.level,
    experience: user.experience,
    earnedExperience: user.earnedExperience,
    guidanceLevel: user.guidanceLevel,
    seenIntros: user.seenIntros,
    lastActiveAt: user.lastActiveAt,
    towerDefenseDutyAt: user.towerDefenseDutyAt,
    chakraStormDutyAt: user.chakraStormDutyAt,
    curHealth: user.curHealth,
    maxHealth: user.maxHealth,
    curChakra: user.curChakra,
    maxChakra: user.maxChakra,
    curStamina: user.curStamina,
    maxStamina: user.maxStamina,
    village: user.village ? { name: user.village.name } : null,
    userQuests: user.userQuests,
    completedQuests: user.completedQuests,
    jutsuLoadoutSize: user.loadout?.jutsuIds.length ?? 0,
  }) satisfies StoryUser & Record<string, unknown>;

/** The player's story state and what the dock should show for it. */
export const useStoryGuidance = () => {
  const { data: user } = useUserDataSelector(selectStoryUser);
  if (!user) return { user: undefined, item: null, story: undefined };
  return { user, item: getStoryDockItem(user), story: getStoryProgress(user) };
};

/** Systems to mark "New" right now, at most three, in introduction order. */
export const useNewSystemBadges = () => {
  const { data: user } = useUserDataSelector(selectStoryUser);
  return user ? getNewSystemBadges(user) : [];
};

/** Whether a story system is open to the player, and whether its intro is still unseen. */
export const useSystemIntro = (id: StorySystemId) => {
  const { data: user } = useUserDataSelector(selectStoryUser);
  return {
    isUnlocked: !!user && isSystemUnlocked(user, id),
    isUnseen: !!user && !(user.seenIntros ?? []).includes(id),
    isLoaded: !!user,
  };
};

/**
 * Record a seen introduction. The cache is patched first, so the badge clears at once;
 * a failed save leaves the intro to show again on the next profile refresh.
 */
export const useMarkIntroSeen = () => {
  const { updateUser } = useUserDataSelector((user) => user.userId);
  const sent = useRef(new Set<string>());
  const { mutate } = api.profile.markIntroSeen.useMutation({
    meta: { handlesTransportError: true },
  });
  return (intro: StorySystemId) => {
    if (sent.current.has(intro)) return;
    sent.current.add(intro);
    void updateUser((current) => getSeenIntroPatch(current, intro));
    mutate({ intro });
  };
};
