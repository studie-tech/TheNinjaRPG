"use client";

import { useCallback } from "react";
import { useNavigationRouter } from "@/hooks/navigation";
import {
  GAME_LAYOUT_ATTRIBUTE,
  GAME_LAYOUT_FRAME_ATTRIBUTE,
  GAME_LAYOUTS,
  type GameLayoutId,
  getGameLayout,
} from "@/libs/gameLayouts";
import {
  LAYOUT_PREFERENCE_COOKIE,
  persistLayoutPreferenceCookie,
} from "@/libs/layoutPreference";
import { useChangeLayout } from "@/utils/LayoutContext";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/utils/storage";
import { useUserDataSelector } from "@/utils/UserContext";

export const applyGameLayout = (id: GameLayoutId) => {
  const layout = getGameLayout(id);
  document.documentElement.setAttribute(GAME_LAYOUT_ATTRIBUTE, layout.id);
  document.documentElement.setAttribute(GAME_LAYOUT_FRAME_ATTRIBUTE, layout.frame);
  document.documentElement.classList.toggle(
    "dark",
    layout.supportsColorMode
      ? safeLocalStorageGetItem("theme") === "dark"
      : layout.tone === "dark",
  );
};

/** Enable the sector frame only for the authenticated account’s created character. */
export const useCanUseSectorLayout = () => {
  const {
    data: characterId,
    userId,
    isClerkLoaded,
    isSignedIn,
  } = useUserDataSelector((user) => user.userId);
  return !!(isClerkLoaded && isSignedIn && userId && characterId === userId);
};

/** Layout choices available to the current account without exposing a character-only frame. */
export const useAvailableGameLayouts = () => {
  const canUseSectorLayout = useCanUseSectorLayout();
  return GAME_LAYOUTS.filter((layout) => layout.id !== "sector" || canUseSectorLayout);
};

/**
 * Change presentation in place, then refresh the router so its cache agrees.
 *
 * The layout is part of the route (`/[shell]/...`, picked by the proxy from the cookie),
 * so every page the client router already holds was rendered under the old variant.
 * Navigating to one of those remounts the root under the old `[shell]` value, which
 * flips the player back to their previous layout until a hard reload. Refreshing after
 * the cookie is written drops those entries and re-renders the current page under the
 * new variant, so every later navigation agrees with the choice.
 */
export const useSelectGameLayout = () => {
  const changeLayout = useChangeLayout();
  const canUseSectorLayout = useCanUseSectorLayout();
  const router = useNavigationRouter();
  return useCallback(
    (layout: GameLayoutId) => {
      if (layout === "sector" && !canUseSectorLayout) return;
      safeLocalStorageSetItem(LAYOUT_PREFERENCE_COOKIE, JSON.stringify(layout));
      persistLayoutPreferenceCookie(layout);
      changeLayout(layout);
      router.refresh();
      if (layout === "sector") router.replace("/travel");
    },
    [changeLayout, router, canUseSectorLayout],
  );
};
