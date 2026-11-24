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
 * On a wide screen, the width that keeps the open dock beside the page's centre column
 * instead of over it, or null to keep the dock's own width. The dock never narrows below
 * a readable lesson column for it, so a screen with too little gutter is only overlapped
 * less.
 */
export function useActivityDockFitWidth(
  dockRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  swapSides: boolean,
) {
  const [fitWidth, setFitWidth] = useState<number | null>(null);
  useEffect(() => {
    const dock = dockRef.current;
    if (!enabled || !dock || typeof window.matchMedia !== "function") {
      setFitWidth(null);
      return;
    }
    const wide = window.matchMedia(WIDE_SCREEN_QUERY);
    const column = getCentreColumn();
    const measure = () => {
      if (!wide.matches || !column) {
        setFitWidth(null);
        return;
      }
      const dockBox = dock.getBoundingClientRect();
      const columnBox = column.getBoundingClientRect();
      const room = swapSides
        ? dockBox.right - columnBox.right - DOCK_COLUMN_GAP_PX
        : columnBox.left - dockBox.left - DOCK_COLUMN_GAP_PX;
      setFitWidth(Math.floor(Math.max(DOCK_MIN_FIT_WIDTH_PX, room)));
    };
    measure();
    window.addEventListener("resize", measure);
    wide.addEventListener("change", measure);
    const observer =
      column && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : null;
    if (column) observer?.observe(column);
    return () => {
      window.removeEventListener("resize", measure);
      wide.removeEventListener("change", measure);
      observer?.disconnect();
    };
  }, [dockRef, enabled, swapSides]);
  return fitWidth;
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
/** Screens this wide fit the open dock to the gutter beside the centre column. */
const WIDE_SCREEN_QUERY = "(min-width: 1280px)";
/** Narrowest fitted dock, which still reads as a lesson column. */
const DOCK_MIN_FIT_WIDTH_PX = 256;
/** Space kept between a fitted dock and the centre column. */
const DOCK_COLUMN_GAP_PX = 8;

/** The page's centre column: the widest reading surface on screen. */
const getCentreColumn = () => {
  let widest: HTMLElement | null = null;
  let widestWidth = 0;
  for (const surface of document.querySelectorAll<HTMLElement>(
    "[data-reading-surface]",
  )) {
    const { width } = surface.getBoundingClientRect();
    if (width > widestWidth) {
      widest = surface;
      widestWidth = width;
    }
  }
  return widest;
};

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
