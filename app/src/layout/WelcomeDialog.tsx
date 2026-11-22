"use client";

import { BellOff, ChevronDown, Gift, X } from "lucide-react";
import dynamic from "next/dynamic";
import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IMG_WELCOME_DISPATCH } from "@/drizzle/constants";
import type { SplashAnnouncement } from "@/drizzle/schema";
import { ChunkErrorBoundary } from "@/layout/ChunkErrorBoundary";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import { WelcomeBoard } from "@/layout/WelcomeBoard";

export const loadActivityStreakPanel = () => import("@/layout/ActivityStreakPanel");
const ActivityStreakPanel = dynamic(loadActivityStreakPanel, {
  loading: () => <Loader explanation="Loading rewards" />,
});

/** The illustrated player splash dialog, shared with staff's live review toggle. */
export function WelcomeDialog({
  announcements,
  onClose,
  onDismissForToday,
  returnFocusRef,
}: {
  announcements: readonly SplashAnnouncement[];
  onClose: () => void;
  onDismissForToday: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          if (returnFocusRef?.current) {
            event.preventDefault();
            returnFocusRef.current.focus();
          }
        }}
        className="splash-dialog"
      >
        <div className="splash-dialog-scroll">
          <DialogHeader className="splash-masthead">
            <Image
              src={IMG_WELCOME_DISPATCH}
              alt=""
              width={1200}
              height={240}
              sizes="(max-width: 600px) 100vw, 1120px"
              loading="eager"
              className="splash-masthead-art"
            />
            <div className="splash-masthead-title">
              <span className="splash-brand">TheNinja-RPG</span>
              <DialogTitle className="splash-title">
                {announcements.length ? "Village dispatch" : "Daily Activity Rewards"}
              </DialogTitle>
              <DialogDescription className="splash-subtitle">
                {announcements.length
                  ? "New adventures, village news & more from across Seichi"
                  : "Your next reward is waiting. Keep your streak alive."}
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="splash-body">
            <details className="splash-rewards" open={announcements.length === 0}>
              <summary className="splash-rewards-summary">
                <Gift aria-hidden="true" />
                <strong>Daily activity rewards</strong>
                <span>View & claim</span>
                <ChevronDown aria-hidden="true" className="splash-rewards-chevron" />
              </summary>
              <div className="splash-rewards-panel">
                <ChunkErrorBoundary
                  fallback={() => (
                    <div
                      role="alert"
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span>Rewards could not be loaded.</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => window.location.reload()}
                      >
                        Reload
                      </Button>
                    </div>
                  )}
                >
                  <ActivityStreakPanel />
                </ChunkErrorBoundary>
              </div>
            </details>
            <WelcomeBoard
              announcements={announcements}
              onNavigate={onDismissForToday}
            />
          </div>
        </div>
        <div className="splash-dialog-footer">
          <Button variant="ghost" size="sm" onClick={onDismissForToday}>
            <BellOff className="mr-2 h-4 w-4" />
            Dismiss for today
          </Button>
          <Button variant="outline" onClick={onClose}>
            <X className="mr-2 h-4 w-4" />
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
