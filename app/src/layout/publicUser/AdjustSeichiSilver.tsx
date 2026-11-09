"use client";

import { Coins } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SEICHI_SILVER_ADJUST_LIMIT } from "@/drizzle/constants";
import Modal from "@/layout/Modal";
import { TOOLBAR_BUTTON_CLASS } from "@/layout/publicUser/toolbarButtonClass";
import { showMutationToast } from "@/libs/toast";

interface AdjustSeichiSilverProps {
  userId: string;
  username: string;
}

/** Validate signed staff silver adjustments and require a reason for the audit trail. */
export const AdjustSeichiSilver: React.FC<AdjustSeichiSilverProps> = ({
  userId,
  username,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const utils = api.useUtils();
  const { data: currentSilver, isPending: silverLoading } =
    api.profile.getSeichiSilverForStaff.useQuery({ userId }, { enabled: isOpen });
  const trimmedDelta = delta.trim();
  const parsedDelta = Number(trimmedDelta);
  const isValid =
    // Plain signed integer only — rejects "1.5", "1e3", "", and whitespace so the
    // submitted value always matches what staff typed.
    /^-?\d+$/.test(trimmedDelta) &&
    Number.isSafeInteger(parsedDelta) &&
    parsedDelta !== 0 &&
    Math.abs(parsedDelta) <= SEICHI_SILVER_ADJUST_LIMIT &&
    reason.trim().length >= 10;

  const { mutate, isPending } = api.profile.adjustSeichiSilver.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        setIsOpen(false);
        setDelta("");
        setReason("");
        await utils.profile.getSeichiSilverForStaff.invalidate({ userId });
      }
    },
  });

  return (
    <>
      <TooltipProvider delayDuration={50}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={TOOLBAR_BUTTON_CLASS}
              aria-label="Adjust Seichi Silver"
              onClick={() => setIsOpen(true)}
            >
              <Coins className="h-6 w-6" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Adjust Seichi Silver</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Modal
        title="Adjust Seichi Silver"
        isOpen={isOpen}
        setIsOpen={setIsOpen}
        proceed_label="Apply"
        proceed_loading_label="Saving"
        isLoading={isPending}
        keepOpenOnAccept
        proceedDisabled={!isValid}
        onAccept={(e) => {
          e.preventDefault();
          if (!isValid) return;
          mutate({ userId, delta: parsedDelta, reason: reason.trim() });
        }}
      >
        <div className="space-y-4">
          <p className="text-muted-foreground text-sm">
            Adjust <strong>{username}</strong>&apos;s Seichi Silver (current:{" "}
            {silverLoading ? "…" : (currentSilver ?? 0)}). Use a negative number to
            subtract. This action is logged.
          </p>
          <div className="space-y-2">
            <Label htmlFor="silver-delta">Amount (+/-)</Label>
            <NumberInput
              id="silver-delta"
              value={delta}
              onTextChange={setDelta}
              placeholder="e.g. 500 or -250"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="silver-reason">Reason *</Label>
            <Input
              id="silver-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (minimum 10 characters)..."
            />
          </div>
        </div>
      </Modal>
    </>
  );
};
