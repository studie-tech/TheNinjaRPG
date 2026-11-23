"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { useCallback, useRef } from "react";
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

/** Keep one map session while route-backed building dialogs open and close. */
export function ExperimentalTravelHost({
  children,
  isGuidedTutorial,
}: {
  children: ReactNode;
  isGuidedTutorial: boolean;
}) {
  const pathname = usePublicPathname();
  const router = useNavigationRouter();
  const returnFocus = useRef<HTMLElement | null>(null);
  const closeBuilding = useCallback(
    () => router.replace("/travel", { scroll: false }),
    [router],
  );
  const building =
    pathname === "/bank" ? "Bank" : pathname === "/itemshop" ? "Item Shop" : undefined;

  return (
    <>
      <div className="h-full" inert={!!building}>
        <TravelScreen immersive isInteractive={!building} />
      </div>
      <Dialog
        open={!!building}
        modal={!isGuidedTutorial}
        onOpenChange={(open) => {
          if (!open) closeBuilding();
        }}
      >
        <DialogContent
          className="experimental-building-dialog"
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
                  "[data-experimental-travel-link], .experimental-nav-map-controls button",
                );
            target?.focus({ preventScroll: true });
          }}
          onInteractOutside={(event) => {
            if (isGuidedTutorial) event.preventDefault();
          }}
        >
          <DialogTitle className="sr-only">{building}</DialogTitle>
          <DialogDescription className="sr-only">
            Visit the {building}. Close to return to the sector map.
          </DialogDescription>
          <ScreenNavigationProvider onBack={closeBuilding}>
            {building ? children : null}
          </ScreenNavigationProvider>
        </DialogContent>
      </Dialog>
    </>
  );
}
