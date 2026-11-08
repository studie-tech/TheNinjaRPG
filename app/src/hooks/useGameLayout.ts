"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import {
  GAME_LAYOUT_ATTRIBUTE,
  GAME_LAYOUT_FRAME_ATTRIBUTE,
  type GameLayoutId,
  getGameLayout,
} from "@/libs/gameLayouts";
import {
  LAYOUT_PREFERENCE_COOKIE,
  persistLayoutPreferenceCookie,
} from "@/libs/layoutPreference";
import { useChangeLayout } from "@/utils/LayoutContext";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/utils/storage";

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
  const router = useRouter();
  return useCallback(
    (layout: GameLayoutId) => {
      safeLocalStorageSetItem(LAYOUT_PREFERENCE_COOKIE, JSON.stringify(layout));
      persistLayoutPreferenceCookie(layout);
      changeLayout(layout);
      router.refresh();
    },
    [changeLayout, router],
  );
};
