import React from "react";
import { useRouter } from "next/navigation";
import Confirm2 from "@/layout/Confirm2";
import Countdown from "@/layout/Countdown";
import { api } from "@/app/_trpc/client";
import { Trash2, Loader2 } from "lucide-react";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";
import { Button } from "@/components/ui/button";
import { sendGTMEvent } from "@next/third-parties/google";

interface DeleteUserButtonProps {
  userData: {
    userId: string;
    isBanned: boolean;
    deletionAt: Date | null;
  };
}

const DeleteUserButton: React.FC<DeleteUserButtonProps> = (props) => {
  // Destructure
  const { userData } = props;

  // Global state
  const { timeDiff } = useRequiredUserData();

  // tRPC utility
  const utils = api.useUtils();

  // Router for forwarding
  const router = useRouter();

  // Mutations
  const { mutate: confirmDeletion, isPending: isDeleting } =
    api.profile.confirmDeletion.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.profile.getUser.invalidate();
          await utils.profile.getPublicUser.invalidate();
          router.push("/");
        }
      },
    });

  const { mutate: toggleDeletionTimer, isPending: isTogglingDelete } =
    api.profile.toggleDeletionTimer.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          sendGTMEvent({
            event: "toggle_deletion",
            character: userData.userId,
          });
          await utils.profile.getUser.invalidate();
          await utils.profile.getPublicUser.invalidate();
        }
      },
    });

  // Derived
  const canDelete =
    userData &&
    !userData.isBanned &&
    userData.deletionAt &&
    new Date(userData.deletionAt) < new Date();

  if (isTogglingDelete || isDeleting) {
    return <Loader2 className="h-6 w-6 animate-spin" />;
  }

  return (
    <Confirm2
      title="Confirm Deletion"
      button={
        <Trash2
          className={`h-6 w-6 cursor-pointer hover:text-orange-500 ${
            userData.deletionAt ? "text-red-500 animate-pulse" : ""
          }`}
        />
      }
      proceed_label={
        canDelete
          ? "Complete Deletion"
          : userData.deletionAt
            ? "Disable Deletion Timer"
            : "Enable Deletion Timer"
      }
      onAccept={(e) => {
        e.preventDefault();
        if (canDelete) {
          confirmDeletion({ userId: userData.userId });
        } else {
          toggleDeletionTimer({ userId: userData.userId });
        }
      }}
    >
      <span>
        This feature is intended for marking the character for deletion. Toggling this
        feature enables a timer of 2 days, after which you will be able to delete the
        character - this is to ensure no un-intentional character deletion.
        {userData.isBanned && (
          <p className="font-bold py-3">
            NOTE: Account is banned, and cannot delete the account until the ban is
            over!
          </p>
        )}
        {userData.deletionAt && (
          <Button
            id="create"
            disabled={userData.deletionAt > new Date() || userData.isBanned}
            className="w-full mt-3"
            variant="destructive"
            onClick={(e) => {
              e.preventDefault();
              if (userData.deletionAt) {
                toggleDeletionTimer({ userId: userData.userId });
              }
            }}
          >
            {userData.deletionAt < new Date() ? (
              "Disable Deletion Timer"
            ) : (
              <Countdown targetDate={userData.deletionAt} timeDiff={timeDiff} />
            )}
          </Button>
        )}
      </span>
    </Confirm2>
  );
};

export default DeleteUserButton;
