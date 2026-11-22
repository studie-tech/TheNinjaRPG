"use client";

import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import type { ContentBoxProps } from "@/layout/ContentBox";

const ScreenBackContext = createContext<(() => void) | undefined>(undefined);

/** Let a screen host handle leaving its screen without changing nested navigation. */
export function ScreenNavigationProvider({
  children,
  onBack,
}: {
  children: ReactNode;
  onBack: () => void;
}) {
  return <ScreenBackContext value={onBack}>{children}</ScreenBackContext>;
}

/** Bind only a screen's first header to its host; ordinary pages retain their fallback. */
export const useScreenNavigation = (
  defaultBackHref: string,
): Pick<ContentBoxProps, "defaultBackHref" | "onBack"> => ({
  defaultBackHref,
  onBack: useContext(ScreenBackContext),
});
