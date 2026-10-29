"use client";

import { sendGTMEvent } from "@next/third-parties/google";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CHARACTER_DELETION_CONFIRMATION,
  CHARACTER_DELETION_DELAY_DAYS,
} from "@/drizzle/constants";
import Countdown from "@/layout/Countdown";
import Modal from "@/layout/Modal";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { secondsPassed } from "@/utils/time";
import { useRequiredUserData } from "@/utils/UserContext";

/** Keep dialog and confirmation state scoped to a single character. */
const DeleteUserButton = (props: DeleteUserButtonProps) => (
  <DeletionControls key={props.userData.userId} {...props} />
);

/** Explain the waiting period and expose the character's deletion request controls. */
export function CharacterDeletionSettings({
  userData,
}: Pick<DeleteUserButtonProps, "userData">) {
  const { timeDiff } = useRequiredUserData();
  return (
    <div className="space-y-5 text-sm leading-relaxed">
      <p>
        Deleting your character permanently removes your game progress. Start a{" "}
        {CHARACTER_DELETION_DELAY_DAYS}-day waiting period, then return here to confirm
        deletion. The timer does not delete your character automatically.
      </p>
      <p>
        You can continue playing and cancel the request at any time before deletion.
      </p>
      {userData.deletionAt && (
        <div role="status" className="border-border/20 rounded-lg border p-4">
          <p className="font-semibold">Deletion request active</p>
          <p className="mt-1">
            <Countdown
              targetDate={userData.deletionAt}
              timeDiff={timeDiff}
              onEndShow="The waiting period has ended. You can confirm deletion or cancel the request."
            />
          </p>
        </div>
      )}
      <DeleteUserButton
        userData={userData}
        label={userData.deletionAt ? "Manage deletion request" : "Start deletion timer"}
        className="h-auto min-h-11 gap-2 whitespace-normal"
      />
    </div>
  );
}

/** Shared self-service and staff controls with pending guards and inline recovery. */
function DeletionControls({ userData, label, className }: DeleteUserButtonProps) {
  const {
    data: viewer,
    timeDiff,
    prepareUserUpdate,
    updateUser,
  } = useRequiredUserData();
  const utils = api.useUtils();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Countdown completion enables confirmation without introducing another timer.
  const [finishedDeadline, setFinishedDeadline] = useState<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmationId = useId();

  /** Require a fresh typed phrase each time the dialog is opened. */
  const closeDialog = () => {
    setIsOpen(false);
    setConfirmation("");
    setError(null);
  };

  const { mutate: confirmDeletion, isPending: isDeleting } =
    api.profile.confirmDeletion.useMutation({
      onError: (error) => setError(error.message),
      onSuccess: async (data) => {
        showMutationToast(data);
        if (!data.success) {
          setError(data.message);
          return;
        }
        closeDialog();
        if (
          data.affectedUserId &&
          data.affectedUserId === utils.profile.getUser.getData()?.userData?.userId
        ) {
          // Removing the character immediately closes native checkout and clears device state.
          await utils.profile.getUser.cancel();
          utils.profile.getUser.setData(undefined, (current) =>
            current?.userData && current.userData.userId === data.affectedUserId
              ? {
                  ...current,
                  userData: undefined,
                  achievementProgress: [],
                  notifications: [],
                }
              : current,
          );
          router.push("/");
        }
        await utils.profile.getPublicUser.invalidate();
      },
    });

  const { mutate: toggleDeletionTimer, isPending: isTogglingDelete } =
    api.profile.toggleDeletionTimer.useMutation({
      onMutate: prepareUserUpdate,
      onError: (error) => setError(error.message),
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (!data.success) {
          setError(data.message);
          return;
        }
        closeDialog();
        sendGTMEvent({ event: "toggle_deletion", character: userData.userId });
        await Promise.all([
          updateUser(data.userPatch, { revision, delta: data.userDelta }),
          utils.profile.getPublicUser.invalidate(),
        ]);
      },
    });

  const deadline = userData.deletionAt?.getTime();
  const canDelete = Boolean(
    userData.deletionAt &&
      (secondsPassed(userData.deletionAt, timeDiff, false) >= 0 ||
        finishedDeadline === deadline),
  );
  // Cancellation stays available without typing; self-service destructive steps do not.
  const requiresConfirmation =
    viewer?.userId === userData.userId && (!userData.deletionAt || canDelete);
  const hasConfirmed =
    !requiresConfirmation || confirmation === CHARACTER_DELETION_CONFIRMATION;
  const isPending = isDeleting || isTogglingDelete;

  /** Cancel an active request even after its waiting period has finished. */
  const cancelDeletion = () => {
    if (isPending || !userData.deletionAt) return;
    setError(null);
    toggleDeletionTimer({ userId: userData.userId });
  };

  return (
    <>
      <Button
        type="button"
        ref={triggerRef}
        variant={label ? "destructive" : "ghost"}
        size={label ? "default" : "icon"}
        className={className}
        aria-label={label ?? "Delete character"}
        onClick={() => {
          setConfirmation("");
          setError(null);
          setIsOpen(true);
        }}
      >
        <Trash2 aria-hidden="true" className="h-5 w-5 shrink-0" />
        {label}
      </Button>
      <Modal
        title={
          canDelete
            ? "Permanently delete character"
            : userData.deletionAt
              ? "Manage deletion request"
              : "Start character deletion"
        }
        isOpen={isOpen}
        setIsOpen={(open) => {
          if (isPending) return;
          if (open) setIsOpen(true);
          else closeDialog();
        }}
        returnFocusRef={triggerRef}
        keepOpenOnAccept
        isLoading={isPending}
        proceedDisabled={!hasConfirmed}
        proceed_label={
          canDelete
            ? "Delete character permanently"
            : userData.deletionAt
              ? "Cancel deletion request"
              : "Start deletion timer"
        }
        proceed_loading_label="Updating deletion request…"
        confirmClassName={cn(
          "h-auto min-h-11 whitespace-normal",
          canDelete || !userData.deletionAt
            ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
            : "bg-primary text-primary-foreground hover:bg-primary/70",
        )}
        onAccept={(event) => {
          event.preventDefault();
          if (isPending || !hasConfirmed) return;
          setError(null);
          if (canDelete) {
            confirmDeletion({ userId: userData.userId, confirmation });
          } else if (userData.deletionAt) {
            cancelDeletion();
          } else {
            toggleDeletionTimer({ userId: userData.userId, confirmation });
          }
        }}
        footerExtra={
          canDelete ? (
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              className="h-auto min-h-11 whitespace-normal"
              onClick={cancelDeletion}
            >
              Cancel deletion request
            </Button>
          ) : undefined
        }
      >
        <div className="space-y-4 text-sm leading-relaxed">
          <p>
            {canDelete
              ? "The waiting period has ended. Permanently deleting this character removes its game progress and cannot be undone."
              : userData.deletionAt
                ? "The waiting period is still active. You can continue playing or cancel the deletion request."
                : `This starts a ${CHARACTER_DELETION_DELAY_DAYS}-day waiting period. After it ends, return to confirm permanent deletion. Your character will not be deleted automatically.`}
          </p>
          {userData.deletionAt && (
            <p className="font-medium">
              <Countdown
                targetDate={userData.deletionAt}
                timeDiff={timeDiff}
                onFinish={() => setFinishedDeadline(deadline ?? null)}
                onEndShow="Waiting period complete"
              />
            </p>
          )}
          <p className="text-muted-foreground">
            A character with an active ban or silence can be deleted too. To enforce the
            sanction, a minimal record (the account identifier, hashed sign-in
            identifiers, the sanction type, its end date and a reference to the
            moderation case) is kept until the sanction ends, and a new character for
            the same account serves the remaining time.
          </p>
          {requiresConfirmation && (
            <div className="space-y-2">
              <Label htmlFor={confirmationId}>
                Type “{CHARACTER_DELETION_CONFIRMATION}” to continue
              </Label>
              <Input
                id={confirmationId}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                disabled={isPending}
                className="h-11"
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}

/** Button contract shared by profile settings and staff profile actions. */
type DeleteUserButtonProps = {
  className?: string;
  label?: string;
  userData: { userId: string; deletionAt: Date | null };
};

export default DeleteUserButton;
