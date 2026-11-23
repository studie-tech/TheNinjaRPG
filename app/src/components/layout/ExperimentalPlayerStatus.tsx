"use client";

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
import { useUserDataSelector } from "@/utils/UserContext";

/** Live character meters and shortcuts; the player menu retains the full descriptions. */
export function ExperimentalPlayerStatus({
  hasLocation,
  onOpenPlayerMenu,
}: {
  hasLocation: boolean;
  onOpenPlayerMenu: () => void;
}) {
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
        <div className="player-status-standing">
          <StatusLink status={identity.status} hasLocation={hasLocation} />
          {identity.village && (
            <Link
              href="/village"
              className="player-status-village"
              title={identity.village}
            >
              {identity.village}
            </Link>
          )}
        </div>
      </div>
      <fieldset className="player-status-pools" aria-label="Resources">
        <ProfilePools compact onInspect={onOpenPlayerMenu} />
        <ProfileLevel compact onInspect={onOpenPlayerMenu} />
      </fieldset>
      <fieldset
        className="player-status-activities"
        aria-label="Daily activities and balances"
      >
        <ProfileMoney hasLocation={hasLocation} />
        <ProfileDailyActivities compact />
        <ProfileReputation />
      </fieldset>
      <fieldset
        className="player-status-timers"
        aria-label="Active effects and training"
      >
        <ProfileTimers compact />
      </fieldset>
    </section>
  );
}
