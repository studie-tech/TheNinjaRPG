"use client";

import { Ban, Loader2, SendHorizontal } from "lucide-react";
import type React from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { usePendingIds } from "@/hooks/usePendingIds";
import AvatarImage from "@/layout/Avatar";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import UserRequestSystem from "@/layout/UserRequestSystem";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { showMutationToast } from "@/libs/toast";
import type { BaseServerResponse } from "@/server/api/trpc";
import { useUserPicker } from "@/utils/search";
import { useRequiredUserData } from "@/utils/UserContext";

/**
 * Marriage
 */
export const Marriage: React.FC = () => {
  // tRPC utility
  const utils = api.useUtils();
  const divorces = usePendingIds();

  const maxUsers = 1;
  const { methods: userSearchMethods, user: targetUser } = useUserPicker(maxUsers);

  const { data: marriages } = api.marriage.getMarriedUsers.useQuery(
    {},
    {
      staleTime: 300000,
    },
  );

  const { data: requests } = api.marriage.getRequests.useQuery(undefined, {
    staleTime: 300000,
  });

  // How to deal with success responses
  const onSuccess = async (data: BaseServerResponse) => {
    showMutationToast(data);
    if (data.success) {
      await Promise.all([
        utils.marriage.getMarriedUsers.invalidate(),
        utils.marriage.getRequests.invalidate(),
      ]);
    }
  };

  // Queries & mutations
  const { data: userData } = useRequiredUserData();
  const { mutate: create, isPending: isCreating } =
    api.marriage.createRequest.useMutation({ onSuccess });
  const { mutate: accept, isPending: isAccepting } =
    api.marriage.acceptRequest.useMutation({ onSuccess });
  const { mutate: reject, isPending: isRejecting } =
    api.marriage.rejectRequest.useMutation({ onSuccess });
  const { mutate: cancel, isPending: isCancelling } =
    api.marriage.cancelRequest.useMutation({ onSuccess });
  const { mutateAsync: divorce } = api.marriage.divorce.useMutation({ onSuccess });

  const handleDivorce = async (userId: string) => {
    if (!divorces.begin(userId)) return;

    try {
      await divorce({ userId });
    } catch {
      // The shared tRPC error handler surfaces transport errors. Keep the
      // confirmation open so the user can safely retry.
    } finally {
      divorces.end(userId);
    }
  };

  if (!requests) return <Loader explanation="Loading requests" />;

  //Derived
  const shownRequests = requests.filter((r) => r.status === "PENDING");

  // Render
  return (
    <>
      <Label className="pt-2">Users who are married to you</Label>
      <div className="grid grid-cols-6">
        {marriages?.map((user) => {
          const isDivorcing = divorces.ids.has(user.userId);

          return (
            <div
              key={user.userId}
              className="relative flex flex-col items-center text-xs"
            >
              <AvatarImage
                href={user.avatar}
                alt={user.username}
                hover_effect={false}
                size={100}
              />
              {user.username}
              <Confirm
                id={`divorce-${user.userId}`}
                title={`Divorce ${user.username}?`}
                proceed_label="Divorce"
                proceed_loading_label="Divorcing"
                confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                isLoading={isDivorcing}
                keepOpenOnAccept
                disabled={isDivorcing}
                button={
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="absolute top-0 right-0 h-8 w-8 rounded-full shadow-sm"
                    disabled={isDivorcing}
                    aria-label={
                      isDivorcing
                        ? `Divorcing ${user.username}`
                        : `Divorce ${user.username}`
                    }
                    aria-busy={isDivorcing}
                  >
                    {isDivorcing ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Ban className="h-4 w-4" aria-hidden="true" />
                    )}
                  </Button>
                }
                onAccept={(event) => {
                  event.preventDefault();
                  void handleDivorce(user.userId);
                }}
              >
                Divorcing {user.username} will immediately end your marriage. This
                action cannot be undone.
              </Confirm>
            </div>
          );
        })}
      </div>

      <ContentBox title="Proposals" subtitle="" initialBreak={true} padding={false}>
        <div className="p-3">
          <div className="flex flex-col gap-1">
            <UserSearchSelect
              useFormMethods={userSearchMethods}
              label="Search user you'd like to propose to"
              showYourself={false}
              inline={true}
              maxUsers={maxUsers}
              showAi={false}
            />
          </div>
        </div>
        <div className="p-2">
          <p>Send a proposal to this user</p>
          <Button
            id="send"
            disabled={targetUser === undefined}
            className="mt-2 w-full"
            onClick={() => {
              if (targetUser) create({ userId: targetUser.userId });
            }}
          >
            <SendHorizontal className="mr-2 h-5 w-5" />
            Send Proposal
          </Button>
        </div>
        {shownRequests.length === 0 && (
          <p className="p-2 italic">No current proposals</p>
        )}
        {shownRequests.length > 0 && userData && (
          <UserRequestSystem
            isLoading={isCreating || isAccepting || isRejecting || isCancelling}
            requests={shownRequests}
            userId={userData.userId}
            onAccept={accept}
            onReject={reject}
            onCancel={cancel}
          />
        )}
      </ContentBox>
    </>
  );
};
