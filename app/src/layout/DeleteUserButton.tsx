import { sendGTMEvent } from "@next/third-parties/google";
import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import type React from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import Confirm2 from "@/layout/Confirm2";
import Countdown from "@/layout/Countdown";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";

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
          className={`h-6 w-6 cursor-pointer hover:text-orange-500 ${userData.deletionAt ? "animate-pulse text-red-500" : ""}`}
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
          <p className="py-3 font-bold">
            NOTE: Account is banned, and cannot delete the account until the ban is
            over!
          </p>
        )}
        {userData.deletionAt && (
          <Button
            id="create"
            disabled={userData.deletionAt > new Date() || userData.isBanned}
            className="mt-3 w-full"
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
