"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useNavigationRouter } from "@/hooks/navigation";
import Loader from "@/layout/Loader";
import { ScreenNavigationProvider } from "@/screens/ScreenNavigationContext";
import { usePublicPathname } from "@/utils/routing";

const TravelScreen = dynamic(
  () => import("@/screens/travel/TravelScreen").then((module) => module.TravelScreen),
  {
    loading: () => <Loader explanation="Loading travel" />,
  },
);

/** Keep one map session while route-backed screen dialogs open and close. */
export function SectorTravelHost({
  children,
  isGuidedTutorial,
}: {
  children: ReactNode;
  isGuidedTutorial: boolean;
}) {
  const pathname = usePublicPathname();
  const router = useNavigationRouter();
  const returnFocus = useRef<HTMLElement | null>(null);
  const closeScreen = useCallback(
    () => router.replace("/travel", { scroll: false }),
    [router],
  );
  const isScreenOpen = pathname !== "/travel";
  const contentRef = useRef<HTMLDivElement>(null);

  // Each destination starts at its own heading; query-string filters keep their scroll.
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [pathname]);

  return (
    <>
      <div className="h-full" inert={isScreenOpen}>
        <TravelScreen immersive isInteractive={!isScreenOpen} />
      </div>
      <Dialog
        open={isScreenOpen}
        modal={!isGuidedTutorial}
        onOpenChange={(open) => {
          if (!open) closeScreen();
        }}
      >
        <DialogContent
          ref={contentRef}
          className="sector-screen-dialog"
          data-guided-tutorial={isGuidedTutorial || undefined}
          onOpenAutoFocus={() => {
            returnFocus.current =
              document.activeElement instanceof HTMLElement &&
              document.activeElement !== document.body
                ? document.activeElement
                : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = returnFocus.current?.isConnected
              ? returnFocus.current
              : document.querySelector<HTMLElement>(
                  "[data-sector-travel-link], .sector-nav-map-controls button",
                );
            target?.focus({ preventScroll: true });
          }}
          onInteractOutside={(event) => {
            if (isGuidedTutorial) event.preventDefault();
          }}
        >
          <DialogTitle className="sr-only">Game screen</DialogTitle>
          <DialogDescription className="sr-only">
            Close to return to the sector map.
          </DialogDescription>
          <ScreenNavigationProvider onBack={closeScreen}>
            {isScreenOpen ? children : null}
          </ScreenNavigationProvider>
        </DialogContent>
      </Dialog>
    </>
  );
}
