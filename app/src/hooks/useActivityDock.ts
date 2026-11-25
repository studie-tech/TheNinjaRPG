"use client";

import { type RefObject, useEffect, useState } from "react";
import { useLocalStorage } from "@/hooks/localstorage";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { isTutorialActive } from "@/libs/tutorial";
import { usePublicPathname } from "@/utils/routing";
import { safeLocalStorageRemoveItem } from "@/utils/storage";
import { useUserDataSelector } from "@/utils/UserContext";

/**
 * Keep chat and activities on opposite sides, following the player's display preference.
 * Only on a screen too small for a lesson clear of a tutorial fight does Activity take the
 * right and chat the left, whatever the preference: the action bar starts at the field's
 * left edge and leaves its right end free.
 */
export function useActivityDock() {
  const [stored, setSwapSides] = useLocalStorage("swapChatAndActivity", false);
  const { data: isInTutorial } = useUserDataSelector(isTutorialActive);
  const prefersSwapSides = stored === true;
  const hasRoomForFight = useMediaQuery(ROOMY_FIGHT_QUERY);
  const isSideFixed =
    usePublicPathname() === "/combat" && isInTutorial === true && !hasRoomForFight;
  return {
    swapSides: isSideFixed || prefersSwapSides,
    prefersSwapSides,
    isSideFixed,
    setSwapSides,
  };
}

/**
 * Whether a modal dialog the lesson does not teach is open, so a raised lesson dock steps
 * below it. A modal hides everything outside itself from assistive technology, the dock
 * included; a dialog that holds one of the lesson's targets keeps the lesson above it.
 */
export function useUntaughtModalOpen(
  dockRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  targetIds: readonly string[] | undefined,
) {
  const [isOpen, setIsOpen] = useState(false);
  const targetKey = targetIds?.join(" ") ?? "";
  useEffect(() => {
    const dock = dockRef.current;
    if (!enabled || !dock) {
      setIsOpen(false);
      return;
    }
    const targets = targetKey ? targetKey.split(" ") : [];
    // Most mutations are unrelated, so the state changes only with the answer.
    let last: boolean | undefined;
    const check = () => {
      const next = isUntaughtModalOpen(dock, targets);
      if (next !== last) setIsOpen(next);
      last = next;
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-hidden", "data-state"],
    });
    return () => observer.disconnect();
  }, [dockRef, enabled, targetKey]);
  return enabled && isOpen;
}

/**
 * The dock's open state, tab, seen story news and pinned quests, and the declined
 * Express Trials offer, stored on this device per account (`<name>:<userId>`).
 */
const CHARACTER_PRESENTATION_KEYS = [
  "activityDockOpen",
  "activityDockTab",
  "activityDockAttention",
  "activityPinnedQuests",
  "expressTrialsDeclined",
] as const;

/** The device storage key of one of an account's presentation settings. */
export const characterStorageKey = (
  name: (typeof CHARACTER_PRESENTATION_KEYS)[number],
  userId: string | undefined,
) => `${name}:${userId}`;

/**
 * Clears what a previous character on this account left on the device, so a new
 * character starts with the default dock and offers.
 */
export const resetCharacterPresentation = (userId: string) => {
  for (const name of CHARACTER_PRESENTATION_KEYS) {
    safeLocalStorageRemoveItem(characterStorageKey(name, userId));
  }
};

/** Screens with room for a lesson beside a fight or in a strip under it. */
const ROOMY_FIGHT_QUERY = "(min-width: 768px) and (min-height: 600px)";

const isUntaughtModalOpen = (dock: HTMLElement, targetIds: readonly string[]) => {
  if (!dock.closest('[aria-hidden="true"]')) return false;
  const dialogs = document.querySelectorAll(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
  );
  const targets = targetIds
    .map((id) => document.getElementById(id))
    .filter((target) => target !== null);
  return ![...dialogs].some((dialog) =>
    targets.some((target) => dialog.contains(target)),
  );
};
