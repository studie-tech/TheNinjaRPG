"use client";

import { CopyCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import type React from "react";
import { api } from "@/app/_trpc/client";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ConfirmedCloneControl } from "@/layout/ConfirmedCloneControl";

type DebugCloneSource = {
  userId: string;
  username: string;
};

/** Confirm copying a player's state into the viewer's separate staff/debug character. */
export const DebugUserCloneControl: React.FC<{
  source: DebugCloneSource;
  cloneUserId: string;
}> = ({ source, cloneUserId }) => {
  const router = useRouter();
  const utils = api.useUtils();
  const { mutateAsync: cloneUser, isPending } =
    api.staff.cloneUserForDebug.useMutation();

  return (
    <ConfirmedCloneControl
      source={{ id: source.userId, name: source.username }}
      label="user"
      isPending={isPending}
      clone={(userId) => cloneUser({ userId })}
      onCloned={() => {
        void Promise.allSettled([
          // Cloning replaces character state and generated relation IDs; reload its complete projection.
          utils.profile.getUser.invalidate(),
          utils.profile.getPublicUser.invalidate({ userId: cloneUserId }),
        ]);
        router.push("/profile");
      }}
      renderTrigger={(open, isTriggerPending) => (
        <TooltipProvider delayDuration={50}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`Clone ${source.username} into your debug account`}
                className="inline-flex items-center disabled:cursor-wait disabled:opacity-50"
                disabled={isTriggerPending}
                onClick={open}
              >
                <CopyCheck className="h-6 w-6 hover:text-orange-500" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Clone User</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      body={({ id, name }) => (
        <>
          <p>
            This copies <b>{name}</b>&apos;s current gameplay state into your separate
            staff/debug account. The source user will not be changed.
          </p>
          <p>
            Your debug account&apos;s stats, location, inventory, jutsu, quest history,
            attributes, ranked rewards, clan, and ANBU membership will be replaced. Your
            identity, username, staff role, moderation state, purchases, messages, and
            other private account data stay unchanged.
          </p>
          <p>
            Source ID: <code>{id}</code>. After cloning, you will be taken to your
            updated profile.
          </p>
        </>
      )}
    />
  );
};
