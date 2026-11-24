"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { PortalContainerContext } from "@/components/ui/portal-container";
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
  const [portalTarget, setPortalTarget] = useState<HTMLDivElement | null>(null);

  // Each destination starts at its own heading; query-string filters keep their scroll.
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [pathname]);

  return (
    <div className="sector-travel-host">
      <div className="h-full" inert={isScreenOpen}>
        <TravelScreen immersive isInteractive={!isScreenOpen} />
      </div>
      <div
        ref={setPortalTarget}
        className="sector-screen-layer"
        data-sector-screen-layer
      >
        {/* Radix omits its backdrop for non-modal roots; shade only the sector. */}
        {isScreenOpen && (
          <div
            className="sector-screen-backdrop"
            data-sector-screen-backdrop
            aria-hidden="true"
          />
        )}
      </div>
      <PortalContainerContext value={portalTarget}>
        {portalTarget && (
          <Dialog
            open={isScreenOpen}
            modal={false}
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
                // Navigation and tutorial controls stay usable without dismissing the page first.
                if (
                  isGuidedTutorial ||
                  !(event.target instanceof Element) ||
                  !event.target.closest("[data-sector-screen-backdrop]")
                )
                  event.preventDefault();
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
        )}
      </PortalContainerContext>
    </div>
  );
}
