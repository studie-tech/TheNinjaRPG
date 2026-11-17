"use client";

import { createContext, useContext } from "react";

/**
 * Where portaled UI (dialogs, popovers, sheets, selects, tooltips) mounts. Unset, it is the
 * document body. A stage in element fullscreen sets itself, since the browser shows only
 * the fullscreen element and its descendants; anything portaled to the body would open
 * invisibly behind it.
 */
export const PortalContainerContext = createContext<HTMLElement | null>(null);

/** The element portaled UI mounts in, or `undefined` for the document body. */
export const usePortalContainer = () => useContext(PortalContainerContext) ?? undefined;
