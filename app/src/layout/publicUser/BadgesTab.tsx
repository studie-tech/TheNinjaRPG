"use client";

import { BarChart2, Plus, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Badge, UserBadge } from "@/drizzle/schema";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import { ActionSelector } from "@/layout/CombatActions";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import Modal from "@/layout/Modal";
import { showRetryableErrorToast } from "@/libs/retryableToast";
import { showMutationToast } from "@/libs/toast";
import { canModifyUserBadges } from "@/utils/permissions";
import { useUserDataSelector } from "@/utils/UserContext";

// Keep statistics code and its query off the initial public-profile load.
const BadgeStatisticsModal = dynamic(() =>
  import("@/layout/BadgeStatisticsModal").then((module) => module.BadgeStatisticsModal),
);

interface BadgesTabProps {
  userId: string;
  username: string;
  currentBadges: (UserBadge & { badge: Badge })[];
}

type BadgeAssignmentSnapshot = {
  userId: string;
  username: string;
  badgeId: string;
  badgeName: string;
  badgeImage: string;
};

type BadgeRemovalSnapshot = {
  userId: string;
  username: string;
  badgeId: string;
  badgeName: string;
  badgeImage: string;
  assignmentKey: string;
};

const badgeAssignmentKey = (badgeId: string, createdAt: Date) =>
  `${badgeId}:${createdAt.toISOString()}`;

/** Manage badge assignments with retryable edits tied to each assignment's identity. */
export const BadgesTab: React.FC<BadgesTabProps> = ({
  userId,
  username,
  currentBadges,
}) => {
  const { data: currentUser } = useUserDataSelector((u) => ({ role: u.role }));
  const canModify = currentUser && canModifyUserBadges(currentUser.role);
  const [statisticsBadge, setStatisticsBadge] = useState<Pick<
    Badge,
    "id" | "name" | "image"
  > | null>(null);
  const statisticsTrigger = useRef<HTMLButtonElement | null>(null);

  // Only fetch the list of all badges when the add-badge popover is opened
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [assignment, setAssignment] = useState<BadgeAssignmentSnapshot | null>(null);
  const [assignmentNeedsRetry, setAssignmentNeedsRetry] = useState(false);
  const [removal, setRemoval] = useState<BadgeRemovalSnapshot | null>(null);
  const [removalNeedsRetry, setRemovalNeedsRetry] = useState(false);
  const [removedAssignments, setRemovedAssignments] = useState<Set<string>>(
    () => new Set(),
  );
  const [optimisticBadges, setOptimisticBadges] = useState<
    Map<string, Pick<Badge, "id" | "name" | "image">>
  >(() => new Map());
  const assignmentFlight = useSingleFlight<BadgeAssignmentSnapshot>();
  const removalFlight = useSingleFlight<BadgeRemovalSnapshot>();
  const assignmentPending = assignmentFlight.isPending;
  const removalPending = removalFlight.isPending;
  const profileIdentityRef = useRef({ userId, username });
  profileIdentityRef.current = { userId, username };

  const { data: allBadges } = api.badge.getAllNames.useQuery(undefined, {
    enabled: popoverOpen,
  });

  const utils = api.useUtils();
  const insertUserBadge = api.staff.insertUserBadge.useMutation({
    meta: { handlesTransportError: true },
  });

  const removeUserBadge = api.staff.removeUserBadge.useMutation({
    meta: { handlesTransportError: true },
  });

  // Once an authoritative profile response contains an optimistic assignment, it no longer
  // needs a client overlay. Other optimistic badges remain independent.
  useEffect(() => {
    const currentIds = new Set(currentBadges.map((entry) => entry.badgeId));
    setOptimisticBadges((previous) => {
      const next = new Map(previous);
      for (const badgeId of currentIds) next.delete(badgeId);
      return next.size === previous.size ? previous : next;
    });
  }, [currentBadges]);

  // Keep a successful removal hidden while an invalidation can still return the old profile.
  // The tombstone is assignment-specific, so a newly re-awarded copy remains visible.
  useEffect(() => {
    const currentKeys = new Set(
      currentBadges.map((entry) => badgeAssignmentKey(entry.badgeId, entry.createdAt)),
    );
    setRemovedAssignments((previous) => {
      const next = new Set([...previous].filter((key) => currentKeys.has(key)));
      return next.size === previous.size ? previous : next;
    });
  }, [currentBadges]);

  useEffect(() => {
    // A tab instance can be reused while navigating between profiles. Never let an unsubmitted
    // choice from the old profile become an assignment to the new one.
    if (!assignmentFlight.current()) {
      setAssignment(null);
      setAssignmentNeedsRetry(false);
    }
    setPopoverOpen(false);
    setStatisticsBadge(null);
    setOptimisticBadges(new Map());
    if (!removalFlight.current()) {
      setRemoval(null);
      setRemovalNeedsRetry(false);
    }
    setRemovedAssignments(new Set());
  }, [userId, username]);

  const openBadgeAssignment = (badgeId: string) => {
    if (assignmentFlight.current() || removalFlight.current()) return;
    const selectedBadge = allBadges?.find((entry) => entry.id === badgeId);
    if (!selectedBadge) return;

    setAssignment({
      userId,
      username,
      badgeId: selectedBadge.id,
      badgeName: selectedBadge.name,
      badgeImage: selectedBadge.image,
    });
    setAssignmentNeedsRetry(false);
    setPopoverOpen(false);
  };

  const closeBadgeAssignment = () => {
    if (assignmentFlight.current()) return;
    setAssignment(null);
    setAssignmentNeedsRetry(false);
  };

  const confirmBadgeAssignment = async () => {
    const target = assignment;
    if (!target) return;

    await assignmentFlight.run(target, async () => {
      try {
        const result = await insertUserBadge.mutateAsync({
          userId: target.userId,
          badgeId: target.badgeId,
        });
        if (!result.success) return showMutationToast(result);

        showMutationToast(result);
        if (
          profileIdentityRef.current.userId === target.userId &&
          profileIdentityRef.current.username === target.username
        ) {
          setOptimisticBadges((previous) => {
            const next = new Map(previous);
            next.set(target.badgeId, {
              id: target.badgeId,
              name: target.badgeName,
              image: target.badgeImage,
            });
            return next;
          });
        }
        setAssignment(null);
        setAssignmentNeedsRetry(false);
        void Promise.allSettled([
          utils.profile.getPublicUser.invalidate({ userId: target.userId }),
          utils.logs.getContentChanges.invalidate(),
        ]);
      } catch (error) {
        // The endpoint has no replay key, so block another assignment until the profile is checked.
        setAssignmentNeedsRetry(true);
        showRetryableErrorToast(
          error,
          "The assignment outcome is unknown. Refresh the profile before trying again.",
        );
      }
    });
  };

  const openBadgeRemoval = (entry: UserBadge & { badge: Badge }) => {
    if (removalFlight.current() || assignmentFlight.current()) return;

    setRemoval({
      userId,
      username,
      badgeId: entry.badgeId,
      badgeName: entry.badge.name,
      badgeImage: entry.badge.image,
      assignmentKey: badgeAssignmentKey(entry.badgeId, entry.createdAt),
    });
    setRemovalNeedsRetry(false);
    setPopoverOpen(false);
  };

  const closeBadgeRemoval = () => {
    if (removalFlight.current()) return;
    setRemoval(null);
    setRemovalNeedsRetry(false);
  };

  const confirmBadgeRemoval = async () => {
    const target = removal;
    if (!target) return;

    await removalFlight.run(target, async () => {
      try {
        const result = await removeUserBadge.mutateAsync({
          userId: target.userId,
          badgeId: target.badgeId,
        });
        // Structured failures are known not to have committed, so staff can retry.
        if (!result.success) return showMutationToast(result);

        showMutationToast(result);
        if (
          profileIdentityRef.current.userId === target.userId &&
          profileIdentityRef.current.username === target.username
        ) {
          setRemovedAssignments((previous) => {
            const next = new Set(previous);
            next.add(target.assignmentKey);
            return next;
          });
        }
        setRemoval(null);
        setRemovalNeedsRetry(false);
        void Promise.allSettled([
          utils.profile.getPublicUser.invalidate({ userId: target.userId }),
          utils.logs.getContentChanges.invalidate(),
        ]);
      } catch (error) {
        setRemovalNeedsRetry(true);
        showRetryableErrorToast(
          error,
          "The removal outcome is unknown. Refresh the profile before trying again.",
        );
      }
    });
  };

  const currentBadgeIds = new Set(currentBadges.map((entry) => entry.badgeId));
  const displayedBadges = [
    ...currentBadges
      .filter(
        (entry) =>
          !removedAssignments.has(badgeAssignmentKey(entry.badgeId, entry.createdAt)),
      )
      .map((entry) => ({ badge: entry.badge, userBadge: entry })),
    ...[...optimisticBadges.values()]
      .filter((entry) => !currentBadgeIds.has(entry.id))
      .map((entry) => ({ badge: entry, userBadge: null })),
  ];
  const unavailableBadgeIds = new Set([...currentBadgeIds, ...optimisticBadges.keys()]);

  return (
    <>
      <ContentBox
        title="Achieved Badges"
        subtitle={`Badges earned by ${username}`}
        initialBreak={true}
        topRightContent={
          canModify && (
            <Popover
              open={popoverOpen}
              onOpenChange={(open) => {
                if (!assignmentFlight.current() && !removalFlight.current())
                  setPopoverOpen(open);
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  className="w-full"
                  disabled={assignmentPending || removalPending}
                >
                  <Plus className="mr-2 h-6 w-6" /> New
                </Button>
              </PopoverTrigger>
              <PopoverContent className="max-h-[min(70vh,32rem)] w-96 overflow-y-auto">
                <div
                  aria-busy={assignmentPending}
                  className={
                    assignmentPending ? "pointer-events-none opacity-60" : undefined
                  }
                >
                  <ActionSelector
                    items={
                      allBadges
                        ? allBadges.filter(
                            (entry) => !unavailableBadgeIds.has(entry.id),
                          )
                        : []
                    }
                    labelSingles={true}
                    onClick={openBadgeAssignment}
                    showBgColor={false}
                    roundFull={true}
                    hideBorder={true}
                    gridClassNameOverwrite="grid grid-cols-5 md:grid-cols-6"
                    showLabels={true}
                    emptyText="No badges are available to add."
                  />
                </div>
              </PopoverContent>
            </Popover>
          )
        }
      >
        {displayedBadges.length === 0 && <p>No badges found</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-5">
          {displayedBadges.map(({ badge: displayedBadge, userBadge }) => (
            <div
              key={displayedBadge.id}
              className={
                canModify
                  ? "grid grid-cols-[auto_minmax(0,1fr)] items-start gap-1.5"
                  : undefined
              }
            >
              {canModify && (
                <div className="flex flex-col gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`View statistics for ${displayedBadge.name}`}
                    title="Badge statistics"
                    className="rounded-full border-2 border-black bg-amber-100 p-0 text-slate-700 hover:bg-amber-200 hover:text-orange-700"
                    onClick={(event) => {
                      statisticsTrigger.current = event.currentTarget;
                      setStatisticsBadge(displayedBadge);
                    }}
                  >
                    <BarChart2 aria-hidden="true" className="h-5 w-5" />
                  </Button>
                  {userBadge && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${displayedBadge.name} from ${username}`}
                      disabled={
                        removalPending &&
                        removal?.assignmentKey ===
                          badgeAssignmentKey(userBadge.badgeId, userBadge.createdAt)
                      }
                      className="rounded-full border-2 border-black bg-amber-100 p-0 hover:bg-amber-100"
                      onClick={() => openBadgeRemoval(userBadge)}
                    >
                      <Trash2 className="h-7 w-7 fill-slate-500 p-1 hover:fill-orange-500" />
                    </Button>
                  )}
                </div>
              )}
              <Image
                src={displayedBadge.image}
                alt={displayedBadge.name}
                width={128}
                height={128}
                className="mx-auto h-auto w-full max-w-32"
              />
              <div className="col-span-full text-center font-bold wrap-anywhere">
                {displayedBadge.name}
              </div>
            </div>
          ))}
        </div>
      </ContentBox>

      {canModify && statisticsBadge && (
        <BadgeStatisticsModal
          key={statisticsBadge.id}
          badge={statisticsBadge}
          returnFocusRef={statisticsTrigger}
          setIsOpen={(open) => {
            if (!(typeof open === "function" ? open(true) : open))
              setStatisticsBadge(null);
          }}
        />
      )}

      <Modal
        id="insert-user-badge"
        title="Add badge"
        isOpen={assignment !== null}
        setIsOpen={(open) => {
          if (!open) closeBadgeAssignment();
        }}
        proceed_label="Add badge"
        proceed_loading_label="Adding"
        isLoading={assignmentPending}
        proceedDisabled={!assignment || assignmentNeedsRetry}
        keepOpenOnAccept
        onAccept={() => void confirmBadgeAssignment()}
        onClose={closeBadgeAssignment}
      >
        {assignment && (
          <div className="space-y-4" aria-busy={assignmentPending}>
            <div className="flex items-center gap-3 rounded-md border bg-muted/40 p-3">
              <Image
                src={assignment.badgeImage}
                alt={assignment.badgeName}
                width={64}
                height={64}
              />
              <div>
                <p className="font-semibold">{assignment.badgeName}</p>
                <p className="text-muted-foreground text-sm">
                  Badge ID: <code className="break-all">{assignment.badgeId}</code>
                </p>
              </div>
            </div>
            <p>
              Add <strong>{assignment.badgeName}</strong> to{" "}
              <strong>{assignment.username}</strong>?
            </p>
            <p className="text-muted-foreground text-sm">
              Target user ID: <code className="break-all">{assignment.userId}</code>
            </p>
            {assignmentNeedsRetry && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                The previous response was not confirmed. Close this dialog and refresh
                the profile before attempting another assignment.
              </p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        id="remove-user-badge"
        title="Remove badge"
        isOpen={removal !== null}
        setIsOpen={(open) => {
          if (!open) closeBadgeRemoval();
        }}
        proceed_label="Remove badge"
        proceed_loading_label="Removing"
        confirmClassName="bg-red-600 text-white hover:bg-red-700"
        isLoading={removalPending}
        proceedDisabled={!removal || removalNeedsRetry}
        keepOpenOnAccept
        onAccept={() => void confirmBadgeRemoval()}
        onClose={closeBadgeRemoval}
      >
        {removal && (
          <div className="space-y-4" aria-busy={removalPending}>
            <div className="flex items-center gap-3 rounded-md border bg-muted/40 p-3">
              <Image
                src={removal.badgeImage}
                alt={removal.badgeName}
                width={64}
                height={64}
              />
              <div>
                <p className="font-semibold">{removal.badgeName}</p>
                <p className="text-muted-foreground text-sm">
                  Badge ID: <code className="break-all">{removal.badgeId}</code>
                </p>
              </div>
            </div>
            <p>
              Permanently remove <strong>{removal.badgeName}</strong> from{" "}
              <strong>{removal.username}</strong>?
            </p>
            <p className="text-muted-foreground text-sm">
              Target user ID: <code className="break-all">{removal.userId}</code>
            </p>
            <p className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
              This removes the selected badge assignment immediately. It can only be
              restored by assigning the badge again.
            </p>
            {removalNeedsRetry && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                The previous response was not confirmed. Close this dialog and refresh
                the profile before attempting another removal.
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
};
