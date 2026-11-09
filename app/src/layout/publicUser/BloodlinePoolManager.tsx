"use client";

import { Droplets } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import Modal from "@/layout/Modal";
import { TOOLBAR_BUTTON_CLASS } from "@/layout/publicUser/toolbarButtonClass";
import { showMutationToast } from "@/libs/toast";

interface BloodlinePoolManagerProps {
  userId: string;
  username: string;
  equippedBloodlineId: string | null;
}

/** Let staff inspect and remove historic bloodlines with an audit reason. */
export const BloodlinePoolManager: React.FC<BloodlinePoolManagerProps> = ({
  userId,
  username,
  equippedBloodlineId,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState("");
  const utils = api.useUtils();

  const { data: pool, isPending: poolLoading } =
    api.bloodline.getUserHistoricBloodlinesForStaff.useQuery(
      { userId },
      { enabled: isOpen },
    );

  const { mutate, isPending } = api.bloodline.removeBloodlineFromPool.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        // getPublicUser + the staff pool query refresh the admin's view of the
        // target. The two self-scoped queries below only matter when an admin
        // manages their OWN pool (userId === ctx.userId); a *different* player's
        // open tab is a separate client we cannot invalidate from here — that
        // staleness is harmless (a stale swap is rejected server-side).
        await Promise.all([
          utils.profile.getPublicUser.invalidate(),
          utils.bloodline.getUserHistoricBloodlinesForStaff.invalidate({ userId }),
          utils.bloodline.getUserHistoricBloodlines.invalidate(),
          utils.bloodline.getSwapInfo.invalidate(),
        ]);
      }
    },
  });

  const reasonValid = reason.trim().length >= 10;

  return (
    <>
      <TooltipProvider delayDuration={50}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={TOOLBAR_BUTTON_CLASS}
              aria-label="Manage Bloodline Pool"
              onClick={() => setIsOpen(true)}
            >
              <Droplets className="h-6 w-6" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Manage Bloodline Pool</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Modal
        title={`Manage Bloodline Pool — ${username}`}
        isOpen={isOpen}
        setIsOpen={setIsOpen}
        proceed_label={null}
      >
        <div className="space-y-4">
          <p className="text-muted-foreground text-sm">
            Remove a bloodline from this player&apos;s swappable pool. The equipped
            bloodline cannot be removed — change it first. All removals are logged.
          </p>
          <div className="space-y-2">
            <Label htmlFor="pool-reason">Reason * (applies to the removal)</Label>
            <Input
              id="pool-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (minimum 10 characters)..."
            />
          </div>
          {poolLoading && <p className="text-sm">Loading pool...</p>}
          {!poolLoading && (pool?.length ?? 0) === 0 && (
            <p className="text-sm">No bloodlines in this player&apos;s pool.</p>
          )}
          <div className="space-y-2">
            {pool?.map((bloodline) => {
              const isEquipped = bloodline.id === equippedBloodlineId;
              return (
                <div
                  key={bloodline.id}
                  className="flex items-center justify-between gap-2 rounded-md border p-2"
                >
                  <span className="text-sm">
                    {bloodline.name}
                    {isEquipped ? " (equipped)" : ""}
                  </span>
                  <Button
                    variant="destructive"
                    disabled={isEquipped || !reasonValid || isPending}
                    title={
                      isEquipped
                        ? "Change the equipped bloodline first"
                        : !reasonValid
                          ? "Enter a reason (10+ characters)"
                          : undefined
                    }
                    onClick={() =>
                      mutate({
                        userId,
                        bloodlineId: bloodline.id,
                        reason: reason.trim(),
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </Modal>
    </>
  );
};
