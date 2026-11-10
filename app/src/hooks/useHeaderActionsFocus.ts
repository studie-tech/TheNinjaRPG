"use client";

import type { RefObject } from "react";
import { createContext, useContext } from "react";

/** Persistent focus target for dialogs opened from collapsed header controls. */
export const HeaderActionsFocusContext =
  createContext<RefObject<HTMLElement | null> | null>(null);

/** Recover a header disclosure's focus target when a dialog has no explicit opener ref. */
export const useHeaderActionsFocus = () => useContext(HeaderActionsFocusContext);

export const DISMISS_HEADER_ACTIONS = "dismiss-content-box-controls";

/** Close a header disclosure before Escape can dismiss the dialog containing it. */
export const dismissHeaderActionsOnEscape = (event: KeyboardEvent) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const disclosure = target.closest<HTMLElement>(
    '[data-content-box-actions][data-expanded="true"]',
  );
  if (!disclosure) return;
  event.preventDefault();
  disclosure.dispatchEvent(new Event(DISMISS_HEADER_ACTIONS));
};
