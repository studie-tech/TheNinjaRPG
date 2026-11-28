"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  KAGE_KICK_COOLDOWN_DAYS,
  VILLAGE_KICK_REASON_MAX_LENGTH,
  VILLAGE_KICK_REASON_MIN_LENGTH,
  VILLAGE_KICK_REJOIN_DAYS,
} from "@/drizzle/constants";
import Confirm from "@/layout/Confirm";

/** Require a reviewable reason before a Kage confirms an expulsion. */
export function VillageKickButton(props: {
  username: string;
  disabled: boolean;
  isPending: boolean;
  onKick: (reason: string, close: () => void) => void;
}) {
  const [reason, setReason] = useState("");
  const reasonId = useId();
  return (
    <Confirm
      title={`Expel ${props.username}`}
      tone="destructive"
      button={
        <Button variant="destructive" size="sm">
          Expel
        </Button>
      }
      disabled={props.disabled}
      isLoading={props.isPending}
      keepOpenOnAccept
      isValid={reason.trim().length >= VILLAGE_KICK_REASON_MIN_LENGTH}
      proceed_label="Expel player"
      onAccept={(_, { close }) => props.onKick(reason.trim(), close)}
      onClose={() => setReason("")}
    >
      <p>
        You can expel one player every {KAGE_KICK_COOLDOWN_DAYS} days. This player
        cannot rejoin this village for {VILLAGE_KICK_REJOIN_DAYS} days. Their next
        village join and subsequent leave will have no training or regeneration slow.
      </p>
      <label htmlFor={reasonId} className="mt-3 block">
        Reason (shared with the player and staff)
        <Textarea
          id={reasonId}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          minLength={VILLAGE_KICK_REASON_MIN_LENGTH}
          maxLength={VILLAGE_KICK_REASON_MAX_LENGTH}
          placeholder={`Give a specific reason (at least ${VILLAGE_KICK_REASON_MIN_LENGTH} characters)`}
        />
      </label>
    </Confirm>
  );
}
