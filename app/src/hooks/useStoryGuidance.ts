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
import { getStoryGuideDepth, getStoryObjectiveFocus } from "@/libs/storyObjectiveGuide";
import { getTutorialWay } from "@/libs/tutorialWay";
import type { UserWithRelations } from "@/routers/profile";
import { usePublicPathname } from "@/utils/routing";
import { useUserDataSelector } from "@/utils/UserContext";

/** Bumped when story progress lands, so the dock pulses instead of a dialog opening. */
export const storyDockPulseAtom = atom(0);

/** The control the story spotlight found on screen, so the card can say what to press. */
export const storyPointedIdAtom = atom<string | undefined>(undefined);

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

/**
 * The active chapter's current objective as the dock teaches it: what it asks, how it is
 * done, how much the chapter's navigation level shows of that, and the controls to point
 * at, on the way to its page or on the page itself. Undefined while no chapter is under way.
 */
export const useStoryObjectiveGuidance = () => {
  const { item } = useStoryGuidance();
  const pathname = usePublicPathname();
  const { data: user } = useUserDataSelector(selectGuidedQuestUser);
  if (!user || item?.kind !== "chapterActive") return undefined;
  const focus = getStoryObjectiveFocus(user, item.questId);
  if (!focus) return undefined;
  const depth = getStoryGuideDepth(item.navigation);
  // A spot in another sector is reached over the Global map first.
  const destination = focus.objective.sector;
  const isElsewhere =
    focus.guide?.page === "/travel" &&
    destination !== undefined &&
    destination !== user.sector;
  const way = !(focus.guide && depth.points)
    ? undefined
    : isElsewhere && pathname === "/travel"
      ? {
          elementIds: ["tutorial-Global"],
          action: `Travel to sector ${destination} on the Global map.`,
          lead: `Its spot is in sector <b>${destination}</b>. The <b>Global</b> map takes you there.`,
          isInGameMenu: false,
          href: `/travel?sector=${destination}`,
        }
      : getTutorialWay({
          page: focus.guide.page,
          pathname,
          sector: user.sector,
          village: user.village,
          hasUnassignedExperience: false,
        });
  // A finished Mission Hall quest is claimed from its own entry, wherever the page lists it.
  const targets = focus.isClaimable
    ? [`logbook-entry-${focus.questId}`]
    : (way?.elementIds ?? focus.guide?.targets ?? []);
  return { chapter: item.chapter, focus, depth, way, targets };
};

/** The profile fields objective guidance reads: quests, their trackers and where the player is. */
const selectGuidedQuestUser = (user: NonNullable<UserWithRelations>) => ({
  userQuests: user.userQuests,
  questData: user.questData,
  sector: user.sector,
  village: user.village
    ? { name: user.village.name, sector: user.village.sector }
    : null,
});

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
