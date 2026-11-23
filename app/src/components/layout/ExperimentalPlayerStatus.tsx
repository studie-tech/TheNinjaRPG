"use client";

import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import AvatarImage from "@/layout/Avatar";
import Link from "@/layout/Link";
import {
  ProfileDailyActivities,
  ProfileLevel,
  ProfileMoney,
  ProfilePools,
  ProfileReputation,
  ProfileTimers,
  StatusLink,
} from "@/layout/MenuBoxProfile";
import { modalScrollableBodyClassName, modalViewportClassName } from "@/layout/Modal";
import { useUserDataSelector } from "@/utils/UserContext";

/** Live character shortcuts with detailed resources and timers available on demand. */
export function ExperimentalPlayerStatus({ hasLocation }: { hasLocation: boolean }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsFocus = useRef<HTMLElement | null>(null);
  const detailsTitle = useRef<HTMLHeadingElement>(null);
  const inspectResources = () => {
    detailsFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDetailsOpen(true);
  };
  const { data: identity } = useUserDataSelector((user) => ({
    avatar: user.avatar,
    username: user.username,
    level: user.level,
    rank: user.rank,
    status: user.status,
    village: user.village?.name,
  }));
  if (!identity) return null;

  return (
    <>
      <section className="experimental-player-status" aria-label="Character status">
        <Link
          href="/profile"
          className="player-status-avatar"
          aria-label={`${identity.username}'s profile`}
        >
          <AvatarImage
            href={identity.avatar}
            alt={identity.username}
            size={64}
            priority
            className="player-status-portrait"
          />
          <span className="player-status-level" title={`Level ${identity.level}`}>
            {identity.level}
          </span>
        </Link>
        <div className="player-status-identity">
          <Link
            href="/profile"
            className="player-status-name"
            title={`${identity.username} · ${identity.rank}`}
          >
            {identity.username}
          </Link>
          <span className="player-status-rank">{identity.rank}</span>
          <div className="player-status-standing">
            <span className="player-status-state">
              <span data-player-summary-label>Status:</span>
              <StatusLink status={identity.status} hasLocation={hasLocation} />
            </span>
            {identity.village && (
              <Link
                href="/village"
                className="player-status-village"
                aria-label={identity.village}
                title={identity.village}
              >
                <span data-player-summary-label>Village:</span>
                {identity.village}
              </Link>
            )}
          </div>
        </div>
        <fieldset className="player-status-pools" aria-label="Resources">
          <ProfilePools compact onInspect={inspectResources} />
          <ProfileLevel compact onInspect={inspectResources} />
        </fieldset>
        <fieldset
          className="player-status-activities"
          aria-label="Daily activities and balances"
        >
          <ProfileMoney hasLocation={hasLocation} compact />
          <ProfileDailyActivities compact />
          <ProfileReputation compact />
        </fieldset>
        <fieldset
          className="player-status-timers"
          aria-label="Active effects and training"
        >
          <ProfileTimers compact />
        </fieldset>
      </section>
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent
          className={`md:max-w-md ${modalViewportClassName}`}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            detailsTitle.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            if (detailsFocus.current?.isConnected) {
              event.preventDefault();
              detailsFocus.current.focus({ preventScroll: true });
            }
          }}
        >
          <DialogHeader>
            <DialogTitle ref={detailsTitle} tabIndex={-1} className="outline-none">
              Character details
            </DialogTitle>
          </DialogHeader>
          <div className={modalScrollableBodyClassName}>
            <div className="space-y-3">
              <ProfilePools />
              <ProfileLevel />
            </div>
            <section className="experimental-character-timers">
              <h3 className="mb-2 font-semibold">Effects and training</h3>
              <div className="flex flex-col gap-2">
                <ProfileTimers compact />
              </div>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
