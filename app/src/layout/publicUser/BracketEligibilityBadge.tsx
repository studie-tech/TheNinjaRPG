"use client";

import type React from "react";
import { ELITE_JONIN_BRACKET, RANKS_RESTRICTED_FROM_PVP } from "@/drizzle/constants";
import type { UserRank } from "@/drizzle/schema";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import { canAttackBracket, getExpBracket } from "@/libs/profile";

interface BracketEligibilityBadgeProps {
  viewerExperience: number;
  viewerRank: UserRank;
  viewerWarParticipantUntil: Date;
  targetExperience: number;
  targetRank: UserRank;
  targetBracketImmunityLiftedUntil: Date;
  targetWarParticipantUntil: Date;
}

/** Explain PvP bracket eligibility and refresh when temporary protection windows expire. */
export const BracketEligibilityBadge: React.FC<BracketEligibilityBadgeProps> = ({
  viewerExperience,
  viewerRank,
  viewerWarParticipantUntil,
  targetExperience,
  targetRank,
  targetBracketImmunityLiftedUntil,
  targetWarParticipantUntil,
}) => {
  const now = Date.now();
  const attackerBracket = getExpBracket(viewerExperience, viewerRank);
  const targetBracket = getExpBracket(targetExperience, targetRank);
  const immunityLifted = targetBracketImmunityLiftedUntil.getTime() > now;
  const bothWarParticipants =
    viewerWarParticipantUntil.getTime() > now &&
    targetWarParticipantUntil.getTime() > now;
  const viewerIsPvpRestricted = RANKS_RESTRICTED_FROM_PVP.includes(viewerRank);
  const targetIsPvpRestricted = RANKS_RESTRICTED_FROM_PVP.includes(targetRank);

  // Re-render when the next time window (immunity lift or war participation) elapses, so the badge
  // does not keep showing stale eligibility while the profile stays open past an expiry.
  useRefreshAt(
    [
      targetBracketImmunityLiftedUntil,
      viewerWarParticipantUntil,
      targetWarParticipantUntil,
    ],
    () => undefined,
  );

  if (viewerIsPvpRestricted) {
    return (
      <p className="font-medium text-red-500 text-sm">
        ✗ Cannot attack (Academy students &amp; Genin cannot do PvP)
      </p>
    );
  }
  if (targetIsPvpRestricted) {
    return (
      <p className="font-medium text-red-500 text-sm">
        ✗ Protected (Academy students &amp; Genin cannot be attacked)
      </p>
    );
  }

  if (canAttackBracket(attackerBracket, targetBracket)) {
    return (
      <p className="font-medium text-green-600 text-sm">
        ✓ Bracket-eligible (they are in your bracket, one below, or higher — server-side
        checks still apply)
      </p>
    );
  }
  if (viewerRank === "ELITE JONIN" || targetRank === "ELITE JONIN") {
    return (
      <p className="font-medium text-red-500 text-sm">
        ✗ Protected (Elite Jonin can only fight brackets {ELITE_JONIN_BRACKET - 1} and{" "}
        {ELITE_JONIN_BRACKET})
      </p>
    );
  }
  if (immunityLifted) {
    return (
      <p className="font-medium text-orange-500 text-sm">
        ✓ Bracket-eligible (their immunity is lifted — server-side checks still apply)
      </p>
    );
  }
  if (bothWarParticipants) {
    return (
      <p className="font-medium text-sm text-yellow-600">
        ~ May be attackable (both war participants — requires active village war, server
        decides)
      </p>
    );
  }
  return (
    <p className="font-medium text-red-500 text-sm">
      ✗ Protected (lower bracket — {targetBracket} vs your {attackerBracket})
    </p>
  );
};
