"use client";

import { Trash2 } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import type { UserRank } from "@/drizzle/schema";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import { UserAvatarTile } from "@/layout/UserAvatarTile";
import { showRetryableErrorToast } from "@/libs/retryableToast";
import { showMutationToast } from "@/libs/toast";
import { canDeleteReferral } from "@/utils/permissions";
import { useUserDataSelector } from "@/utils/UserContext";

// ---------------- Recruited Users Tab ----------------

interface RecruitedUsersTabProps {
  recruits: Array<{
    userId: string;
    username: string;
    rank: UserRank;
    isOutlaw: boolean;
    level: number;
    avatar: string | null;
  }>;
  parentUserId: string;
  parentUsername: string;
  parentRecruitedCount: number;
}

/** Show referrals and retain confirmed removals while their cached roster reconciles. */
export const RecruitedUsersTab: React.FC<RecruitedUsersTabProps> = ({
  recruits,
  parentUserId,
  parentUsername,
  parentRecruitedCount,
}) => {
  const { data: currentUser } = useUserDataSelector((u) => ({ role: u.role }));
  const canDelete = currentUser && canDeleteReferral(currentUser.role);
  const [removedRecruitIds, setRemovedRecruitIds] = useState<Set<string>>(
    () => new Set(),
  );
  const visibleRecruits = recruits.filter(
    (recruit) => !removedRecruitIds.has(recruit.userId),
  );
  const displayedRecruiterCount = Math.max(
    parentRecruitedCount - removedRecruitIds.size,
    0,
  );

  return (
    <ContentBox
      title="Recruited Users"
      subtitle={`${parentUsername} referred these users`}
      initialBreak={true}
    >
      {visibleRecruits.length === 0 && <p>No recruits found</p>}
      {visibleRecruits.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5">
          {visibleRecruits.map((user) => (
            <div key={user.userId} className="relative text-center">
              <UserAvatarTile user={user} className="block" />
              {canDelete && (
                <RemoveReferralButton
                  recruit={user}
                  recruiterId={parentUserId}
                  recruiterUsername={parentUsername}
                  recruiterCount={displayedRecruiterCount}
                  onRemoved={(userId) =>
                    setRemovedRecruitIds((current) => {
                      if (current.has(userId)) return current;
                      return new Set(current).add(userId);
                    })
                  }
                />
              )}
            </div>
          ))}
        </div>
      )}
    </ContentBox>
  );
};

interface RemoveReferralButtonProps {
  recruit: RecruitedUsersTabProps["recruits"][number];
  recruiterId: string;
  recruiterUsername: string;
  recruiterCount: number;
  onRemoved: (userId: string) => void;
}

interface ReferralRemovalRequest {
  userId: string;
  expectedRecruiterId: string;
}

/** Confirm referral removal while retaining the submitted identity for recovery. */
export const RemoveReferralButton: React.FC<RemoveReferralButtonProps> = ({
  recruit,
  recruiterId,
  recruiterUsername,
  recruiterCount,
  onRemoved,
}) => {
  const utils = api.useUtils();
  const removalFlight = useSingleFlight<ReferralRemovalRequest>();
  const isRemoving = removalFlight.isPending;
  const [retryRequest, setRetryRequest] = useState<ReferralRemovalRequest | null>(null);
  const deleteReferral = api.staff.deleteReferral.useMutation({
    meta: { handlesTransportError: true },
  });

  const handleRemove = async () => {
    const request: ReferralRemovalRequest = {
      userId: recruit.userId,
      expectedRecruiterId: recruiterId,
    };

    await removalFlight.run(request, async () => {
      try {
        const result = await deleteReferral.mutateAsync({ userId: request.userId });
        // Structured failures are known not to have committed, so staff can retry.
        if (!result.success) {
          showMutationToast(result);
          return;
        }
        // The commit is authoritative. Remove only this captured row before cache/network work so
        // a slow or stale refresh cannot expose the destructive action for a second click.
        showMutationToast(result);
        setRetryRequest(null);
        onRemoved(request.userId);
        void Promise.allSettled([
          utils.profile.getPublicUser.invalidate({
            userId: request.expectedRecruiterId,
          }),
          utils.profile.getPublicUsers.invalidate(),
        ]);
      } catch (error) {
        setRetryRequest(request);
        showRetryableErrorToast(
          error,
          "The referral response was not confirmed. Refresh before trying again.",
        );
      }
    });
  };

  return (
    <Confirm
      id={`remove-referral-${recruit.userId}`}
      title="Remove referral relationship?"
      proceed_label="Remove referral"
      proceed_loading_label="Removing"
      button={
        <Trash2
          aria-label={`Remove ${recruit.username} as a referral`}
          className="absolute top-0 right-[8%] h-9 w-9 rounded-full border-2 border-black bg-red-100 fill-slate-500 p-1 hover:fill-red-500"
        />
      }
      onAccept={() => void handleRemove()}
      isLoading={isRemoving}
      keepOpenOnAccept
      disabled={isRemoving}
      confirmDisabled={Boolean(retryRequest)}
      confirmClassName="bg-red-600 text-white hover:bg-red-700"
    >
      <div className="space-y-3" aria-busy={isRemoving}>
        <p>
          Remove the referral relationship between <strong>{recruiterUsername}</strong>
          {" and "}
          <strong>{recruit.username}</strong>?
        </p>
        <p className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
          This permanently unlinks {recruit.username} from {recruiterUsername} and
          reduces {recruiterUsername}&apos;s recruited-user count from {recruiterCount}
          {" to "}
          {Math.max(recruiterCount - 1, 0)}. It does not delete either user.
        </p>
        {retryRequest && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            The previous response was not confirmed. Refresh the profile before trying
            again.
          </p>
        )}
        <span className="sr-only" aria-live="polite">
          {isRemoving ? "Removing" : ""}
        </span>
      </div>
    </Confirm>
  );
};
