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
 * In the tutorial Activity takes the right and chat the left, whatever the preference: on a
 * wide screen, where its lessons stand beside what they point at and the menus are, so it
 * need not cross the page; and in a fight, whose action bar leaves its right end free.
 */
export function useActivityDock() {
  const [stored, setSwapSides] = useLocalStorage("swapChatAndActivity", false);
  const { data: isInTutorial } = useUserDataSelector(isTutorialActive);
  const prefersSwapSides = stored === true;
  const isWide = useMediaQuery(WIDE_LESSON_QUERY);
  const isInFight = usePublicPathname() === "/combat";
  const isSideFixed = (isWide || isInFight) && isInTutorial === true;
  return {
    swapSides: isSideFixed || prefersSwapSides,
    prefersSwapSides,
    isSideFixed,
    setSwapSides,
  };
}

/**
 * On a wide screen, the width that keeps the open dock beside the page's centre column
 * instead of over it and, with `nearColumn`, the space from the screen's edge that stands it
 * next to the column; null for either keeps the dock's own. The dock never narrows below a
 * readable lesson column for it, so a screen with too little gutter is only overlapped less.
 */
export function useActivityDockFit(
  dockRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  swapSides: boolean,
  nearColumn: boolean,
) {
  const [fit, setFit] = useState<{ width: number | null; edge: number | null }>(NO_FIT);
  useEffect(() => {
    const dock = dockRef.current;
    if (!enabled || !dock || typeof window.matchMedia !== "function") {
      setFit(NO_FIT);
      return;
    }
    const wide = window.matchMedia(WIDE_SCREEN_QUERY);
    const column = getCentreColumn();
    const measure = () => {
      if (!wide.matches || !column) {
        setFit(NO_FIT);
        return;
      }
      const columnBox = column.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const gutter =
        (swapSides ? viewportWidth - columnBox.right : columnBox.left) -
        DOCK_COLUMN_GAP_PX;
      const edge =
        DOCK_EDGE_REM *
        (Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 12);
      const width = Math.floor(Math.max(DOCK_MIN_FIT_WIDTH_PX, gutter - edge));
      const inset = Math.floor(gutter - ACTIVITY_DOCK_WIDTH_PX);
      setFit({ width, edge: nearColumn && inset > edge ? inset : null });
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
  }, [dockRef, enabled, swapSides, nearColumn]);
  return fit;
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

/** Screens on which a lesson stands beside its target. */
const WIDE_LESSON_QUERY = "(min-width: 768px)";
/** Screens this wide fit the open dock to the gutter beside the centre column. */
const WIDE_SCREEN_QUERY = "(min-width: 1280px)";
/** Narrowest fitted dock, which still reads as a lesson column. */
const DOCK_MIN_FIT_WIDTH_PX = 320;
/** The dock's own width. */
export const ACTIVITY_DOCK_WIDTH_PX = 420;
/** The dock's space from the screen's edge (`md:left-5`). */
const DOCK_EDGE_REM = 1.25;
/** A dock that keeps its own width and place. */
const NO_FIT = { width: null, edge: null };
/** Space kept between a fitted dock and the centre column. */
const DOCK_COLUMN_GAP_PX = 8;

/** The page's centre column: the widest reading surface on screen. */
export const getCentreColumn = () => {
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
