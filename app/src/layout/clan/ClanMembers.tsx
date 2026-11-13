import { ArrowBigDownDash, ArrowBigUpDash, DoorOpen, Loader2 } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  ASSASSIN_MAX_PER_FACTION,
  CLAN_ASSASSIN_SLOTS,
  CLAN_MAX_MEMBERS,
} from "@/drizzle/constants";
import { usePendingIds } from "@/hooks/usePendingIds";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import Table from "@/layout/Table";
import { showUserRank } from "@/libs/profile";
import { showMutationToast } from "@/libs/toast";
import { canEditClans } from "@/utils/permissions";
import { useRequiredUserDataSelector } from "@/utils/UserContext";
import { checkAssassin, checkCoLeader } from "@/validators/clan";

interface ClanMembersProps {
  userId: string;
  clanId: string;
}

/** List clan or faction members and reconcile confirmed membership and role changes. */
export const ClanMembers: React.FC<ClanMembersProps> = (props) => {
  // Destructure
  const { userId, clanId } = props;
  const {
    data: userData,
    updateUser,
    prepareUserUpdate,
  } = useRequiredUserDataSelector((u) => ({ isOutlaw: u.isOutlaw, role: u.role }));
  const groupLabel = userData?.isOutlaw ? "faction" : "clan";

  // State
  const [kickTargetId, setKickTargetId] = useState<string | null>(null);
  const kickingMembers = usePendingIds();
  const [successfulKick, setSuccessfulKick] = useState<{
    memberId: string;
    dataUpdatedAt: number;
  } | null>(null);
  const [promoteTargetId, setPromoteTargetId] = useState<string | null>(null);
  const promotingMembers = usePendingIds();
  const [successfulPromotions, setSuccessfulPromotions] = useState<
    Array<{
      memberId: string;
      expectedRole: "leader" | "coleader" | "assassin";
      dataUpdatedAt: number;
    }>
  >([]);
  const [demoteTargetId, setDemoteTargetId] = useState<string | null>(null);
  const demotingMembers = usePendingIds();
  const [successfulDemotions, setSuccessfulDemotions] = useState<
    Array<{
      memberId: string;
      clearedColeaderRole: boolean;
      clearedAssassinRole: boolean;
      dataUpdatedAt: number;
    }>
  >([]);

  // Get react query utility
  const utils = api.useUtils();

  // Query
  const { data: clanData, dataUpdatedAt: clanDataUpdatedAt } = api.clan.get.useQuery(
    { clanId: clanId },
    { enabled: !!userData },
  );

  // Mutations
  const { mutateAsync: kick } = api.clan.kickMember.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _variables, revision) => {
      showMutationToast(data);
      if (data.success || data.userPatch) await updateUser(data, { revision });
    },
  });
  const { mutateAsync: promote } = api.clan.promoteMember.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _variables, revision) => {
      if (data.success || data.userPatch) await updateUser(data, { revision });
    },
  });
  const { mutateAsync: demote } = api.clan.demoteMember.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _variables, revision) => {
      if (data.success || data.userPatch) await updateUser(data, { revision });
    },
  });

  // A later clan read is authoritative only once it actually omits the removed
  // member. Failed or stale refetches must not expose the destructive action again.
  useEffect(() => {
    if (
      successfulKick &&
      clanData &&
      clanDataUpdatedAt > successfulKick.dataUpdatedAt &&
      !clanData.members.some((member) => member.userId === successfulKick.memberId)
    ) {
      setSuccessfulKick(null);
    }
  }, [clanData, clanDataUpdatedAt, successfulKick]);

  // Keep a successful promotion's old action suppressed until a later clan read
  // actually proves that exact member reached the server-selected next role. A
  // failed refetch, or a newer response that still contains the old role, must
  // not expose a duplicate promotion path.
  useEffect(() => {
    if (!clanData || successfulPromotions.length === 0) return;

    setSuccessfulPromotions((current) => {
      let changed = false;
      const next = current.filter((promotion) => {
        if (clanDataUpdatedAt <= promotion.dataUpdatedAt) return true;

        const member = clanData.members.find(
          (candidate) => candidate.userId === promotion.memberId,
        );
        if (!member) {
          changed = true;
          return false;
        }

        const authoritativeRole =
          member.userId === clanData.leaderId
            ? "leader"
            : checkCoLeader(member.userId, clanData)
              ? "coleader"
              : checkAssassin(member.userId, clanData)
                ? "assassin"
                : "member";
        if (authoritativeRole === promotion.expectedRole) {
          changed = true;
          return false;
        }
        return true;
      });

      return changed ? next : current;
    });
  }, [clanData, clanDataUpdatedAt, successfulPromotions.length]);

  // A successful response proves that the role assignment(s) present when the
  // action was submitted were cleared. Do not expose a stale repeat action until
  // a later authoritative read independently confirms every relevant slot is
  // empty. Once that absence has been observed, a future reappointment is shown
  // normally rather than being masked by old client state.
  useEffect(() => {
    if (!clanData || successfulDemotions.length === 0) return;

    setSuccessfulDemotions((current) => {
      let changed = false;
      const next = current.filter((demotion) => {
        if (clanDataUpdatedAt <= demotion.dataUpdatedAt) return true;

        const coleaderStillAssigned =
          demotion.clearedColeaderRole && checkCoLeader(demotion.memberId, clanData);
        const assassinStillAssigned =
          demotion.clearedAssassinRole && checkAssassin(demotion.memberId, clanData);
        if (!coleaderStillAssigned && !assassinStillAssigned) {
          changed = true;
          return false;
        }
        return true;
      });

      return changed ? next : current;
    });
  }, [clanData, clanDataUpdatedAt, successfulDemotions.length]);

  // Loader
  if (!clanData) return <Loader explanation="Loading clan data" />;

  // Derived
  const isColeader = checkCoLeader(userId, clanData);
  const isLeader = userId === clanData.leaderId;
  const canEdit = userData ? canEditClans(userData.role) : false;
  const kickTarget = clanData.members.find((member) => member.userId === kickTargetId);
  const promoteTarget = clanData.members.find(
    (member) => member.userId === promoteTargetId,
  );
  const demoteTarget = clanData.members.find(
    (member) => member.userId === demoteTargetId,
  );
  const promoteTargetIsLeader = promoteTarget?.userId === clanData.leaderId;
  const promoteTargetIsColeader = promoteTarget
    ? checkCoLeader(promoteTarget.userId, clanData)
    : false;
  const promoteTargetIsAssassin = promoteTarget
    ? checkAssassin(promoteTarget.userId, clanData)
    : false;
  const demoteTargetIsLeader = demoteTarget?.userId === clanData.leaderId;
  const demoteTargetIsColeader = demoteTarget
    ? checkCoLeader(demoteTarget.userId, clanData)
    : false;
  const demoteTargetIsAssassin = demoteTarget
    ? checkAssassin(demoteTarget.userId, clanData)
    : false;
  const currentLeader = clanData.members.find(
    (member) => member.userId === clanData.leaderId,
  );
  const currentAssassinCount = CLAN_ASSASSIN_SLOTS.filter(
    (slot) => clanData[slot],
  ).length;
  const hasOpenColeaderSlot = Boolean(
    !clanData.coLeader1 || !clanData.coLeader2 || !clanData.coLeader3,
  );

  const getExpectedPromotionRole = (
    member: NonNullable<typeof promoteTarget>,
  ): "leader" | "coleader" | "assassin" => {
    if (checkCoLeader(member.userId, clanData)) return "leader";
    if (member.isOutlaw && !checkAssassin(member.userId, clanData)) {
      return "assassin";
    }
    return "coleader";
  };

  const onKick = async () => {
    if (!kickTarget) return;

    const memberId = kickTarget.userId;
    if (!kickingMembers.begin(memberId)) return;
    try {
      const data = await kick({ clanId, memberId });
      if (!data.success) return;

      // The successful response proves this exact member was removed. Hide only
      // their stale row immediately; cache refreshes must never expose a duplicate
      // destructive retry path.
      setSuccessfulKick({ memberId, dataUpdatedAt: clanDataUpdatedAt });
      setKickTargetId(null);

      await Promise.all([
        utils.clan.get.invalidate({ clanId }),
        utils.clan.getRequests.invalidate(),
      ]);
    } catch {
      // The mutation's onError callback supplies the toast. Preserve the target
      // confirmation and consequence summary so the user can retry safely.
    } finally {
      kickingMembers.end(memberId);
    }
  };

  const onPromote = async () => {
    if (!promoteTarget || promoteTargetIsLeader) return;

    const memberId = promoteTarget.userId;
    const expectedRole = getExpectedPromotionRole(promoteTarget);
    if (!promotingMembers.begin(memberId)) return;
    try {
      const data = await promote({ clanId, memberId });
      showMutationToast(data);
      if (!data.success) return;

      // The response proves this exact role transition committed. Close at once
      // and suppress only its stale promotion action while refresh is best-effort.
      setSuccessfulPromotions((current) => [
        ...current.filter((promotion) => promotion.memberId !== memberId),
        { memberId, expectedRole, dataUpdatedAt: clanDataUpdatedAt },
      ]);
      setPromoteTargetId(null);

      await Promise.all([
        utils.clan.get.invalidate({ clanId }),
        utils.clan.getRequests.invalidate(),
      ]);
    } catch {
      // The mutation's onError callback supplies the toast. Keep the target and
      // its exact consequence visible so the same dialog can be retried.
    } finally {
      promotingMembers.end(memberId);
    }
  };

  const onDemote = async () => {
    if (!demoteTarget || demoteTargetIsLeader) return;

    const memberId = demoteTarget.userId;
    const clearedColeaderRole = demoteTargetIsColeader;
    const clearedAssassinRole = demoteTargetIsAssassin;
    if (!demotingMembers.begin(memberId)) return;
    try {
      const data = await demote({ clanId, memberId });
      showMutationToast(data);
      if (!data.success) return;

      // The mutation committed both relevant role removals. Close immediately,
      // but suppress a destructive retry while clan refreshes are best-effort.
      setSuccessfulDemotions((current) => [
        ...current.filter((demotion) => demotion.memberId !== memberId),
        {
          memberId,
          clearedColeaderRole,
          clearedAssassinRole,
          dataUpdatedAt: clanDataUpdatedAt,
        },
      ]);
      setDemoteTargetId(null);

      void Promise.all([
        utils.clan.get.invalidate({ clanId }),
        utils.clan.getRequests.invalidate(),
      ]);
    } catch {
      // The mutation's onError callback supplies the toast. Preserve the target
      // and exact role consequences in the dialog so the user can retry.
    } finally {
      demotingMembers.end(memberId);
    }
  };

  // Adjust members for table
  const members = clanData.members
    .filter((member) => member.userId !== successfulKick?.memberId)
    .map((member) => {
      const memberIsLeader = member.userId === clanData.leaderId;
      const memberIsColeader = checkCoLeader(member.userId, clanData);
      const memberIsAssassin = checkAssassin(member.userId, clanData);
      const canKick =
        canEdit || // canEdit role can kick anyone
        (isLeader && !memberIsLeader) || // Leader can kick anyone except other leaders
        (isColeader && !memberIsLeader && !memberIsColeader); // Co-leaders can kick normal members only
      const isThisMemberBeingKicked = kickingMembers.ids.has(member.userId);
      const isThisMemberBeingPromoted = promotingMembers.ids.has(member.userId);
      const isThisMemberBeingDemoted = demotingMembers.ids.has(member.userId);
      const isThisMemberBusy =
        isThisMemberBeingKicked ||
        isThisMemberBeingPromoted ||
        isThisMemberBeingDemoted;
      const hasCommittedPromotion = successfulPromotions.some(
        (promotion) => promotion.memberId === member.userId,
      );
      const hasCommittedDemotion = successfulDemotions.some(
        (demotion) => demotion.memberId === member.userId,
      );
      const canAttemptDemotion =
        (memberIsLeader
          ? canEdit && member.userId !== userId
          : isLeader ||
            canEdit ||
            (isColeader &&
              ((memberIsAssassin && !memberIsColeader) ||
                (memberIsColeader && member.userId === userId)))) &&
        (memberIsAssassin || memberIsLeader || memberIsColeader);
      return {
        ...member,
        rank: memberIsLeader
          ? "Leader"
          : memberIsColeader
            ? "Coleader"
            : memberIsAssassin
              ? "Assassin"
              : showUserRank(member),
        actions: (
          <div className="flex flex-row gap-1">
            {member.userId !== userId && (
              <>
                {/* Kick: staff with canEdit may also kick leaders */}
                {canKick && (
                  <Button
                    id={`kick-${member.userId}`}
                    hoverText="Kick Member"
                    disabled={isThisMemberBusy}
                    aria-busy={isThisMemberBeingKicked}
                    aria-label={
                      isThisMemberBeingKicked
                        ? "Kicking"
                        : isThisMemberBeingPromoted
                          ? "Promoting"
                          : `Kick ${member.username}`
                    }
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setKickTargetId(member.userId);
                    }}
                  >
                    {isThisMemberBeingKicked ? (
                      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                    ) : (
                      <DoorOpen className="h-5 w-5" aria-hidden />
                    )}
                  </Button>
                )}

                {/* PROMOTE BUTTON */}
                {(isLeader ||
                  (isColeader && !memberIsLeader && !memberIsColeader) ||
                  canEdit) &&
                  !memberIsLeader &&
                  !hasCommittedPromotion && (
                    <Button
                      id={`promote-${member.userId}`}
                      hoverText="Promote Member"
                      disabled={isThisMemberBusy}
                      aria-busy={isThisMemberBeingPromoted}
                      aria-label={
                        isThisMemberBeingPromoted
                          ? "Promoting"
                          : `Promote ${member.username}`
                      }
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setPromoteTargetId(member.userId);
                      }}
                    >
                      {isThisMemberBeingPromoted ? (
                        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                      ) : (
                        <ArrowBigUpDash className="h-5 w-5" aria-hidden />
                      )}
                    </Button>
                  )}
              </>
            )}

            {/* DEMOTE BUTTON */}
            {canAttemptDemotion && !hasCommittedDemotion && (
              <Button
                id={`demote-${member.userId}`}
                hoverText={member.userId === userId ? "Step Down" : "Demote Member"}
                disabled={isThisMemberBusy}
                aria-busy={isThisMemberBeingDemoted}
                aria-label={
                  isThisMemberBeingDemoted
                    ? "Demoting"
                    : member.userId === userId
                      ? `Step down ${member.username}`
                      : `Demote ${member.username}`
                }
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setDemoteTargetId(member.userId);
                }}
              >
                {isThisMemberBeingDemoted ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                ) : (
                  <ArrowBigDownDash className="h-5 w-5" aria-hidden />
                )}
              </Button>
            )}
          </div>
        ),
      };
    })
    .sort((a, b) => {
      if (a.rank === "Leader") return -1;
      if (b.rank === "Leader") return 1;
      if (a.rank === "Coleader") return -1;
      if (b.rank === "Coleader") return 1;
      if (a.rank === "Assassin") return -1;
      if (b.rank === "Assassin") return 1;
      return 0;
    });

  // Render
  return (
    <>
      <ContentBox
        title="Members"
        subtitle={`In the ${groupLabel} [${members.length} / ${CLAN_MAX_MEMBERS}]`}
        initialBreak={true}
        padding={false}
      >
        {members.length === 0 && <p className="p-2 italic">No current members</p>}
        {members.length > 0 && (
          <Table
            data={members}
            columns={[
              { key: "avatar", header: "", type: "avatar" },
              { key: "username", header: "Username", type: "string" },
              { key: "rank", header: "Rank", type: "capitalized" },
              { key: "pvpExperience", header: "PvP XP", type: "number" },
              { key: "actions", header: "Actions", type: "jsx" },
            ]}
            linkPrefix="/username/"
            linkColumn={"username"}
          />
        )}
      </ContentBox>

      <Modal
        id={
          demoteTarget
            ? `demote-${demoteTarget.userId}-confirm`
            : "demote-member-confirm"
        }
        title={
          demoteTargetIsLeader
            ? `Cannot demote ${demoteTarget?.username ?? "leader"}`
            : demoteTarget?.userId === userId
              ? "Step down from your role?"
              : `Demote ${demoteTarget?.username ?? "member"}?`
        }
        proceed_label="Demote member"
        proceed_loading_label="Demoting"
        confirmClassName="bg-red-600 text-white hover:bg-red-700"
        isOpen={demoteTarget !== undefined}
        setIsOpen={(open) => {
          if (!open) setDemoteTargetId(null);
        }}
        isLoading={
          demoteTarget !== undefined && demotingMembers.ids.has(demoteTarget.userId)
        }
        keepOpenOnAccept
        proceedDisabled={demoteTargetIsLeader}
        onAccept={() => void onDemote()}
      >
        {demoteTarget && (
          <div className="space-y-3">
            {demoteTargetIsLeader ? (
              <>
                <p>
                  <strong>{demoteTarget.username}</strong> is the current {groupLabel}
                  leader and cannot be demoted directly.
                </p>
                <p className="font-medium text-amber-600 text-sm">
                  Promote a co-leader to leader first. The previous leader will then
                  remain in the {groupLabel} as a regular member.
                </p>
              </>
            ) : (
              <>
                <p>
                  {demoteTarget.userId === userId ? "Step down" : "Demote"}{" "}
                  <strong>{demoteTarget.username}</strong> in this {groupLabel}?
                </p>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {demoteTargetIsColeader && (
                    <li>Every co-leader position assigned to them is cleared.</li>
                  )}
                  {demoteTargetIsAssassin && (
                    <li>Their assassin assignment is cleared.</li>
                  )}
                  <li>
                    Their {groupLabel} membership and member progress remain intact.
                  </li>
                  <li>The current leader and every other member are unaffected.</li>
                </ul>
                {demoteTarget.userId === userId && (
                  <p className="text-muted-foreground text-sm">
                    You will remain in the {groupLabel} as a regular member.
                  </p>
                )}
                {canEdit && !isLeader && !isColeader && (
                  <p className="text-muted-foreground text-sm">
                    This demotion uses your staff clan-management override.
                  </p>
                )}
                <p className="text-muted-foreground text-sm">
                  The role change takes effect immediately after confirmation.
                </p>
              </>
            )}
          </div>
        )}
      </Modal>

      <Modal
        id={
          promoteTarget
            ? `promote-${promoteTarget.userId}-confirm`
            : "promote-member-confirm"
        }
        title={promoteTarget ? `Promote ${promoteTarget.username}?` : "Promote member?"}
        proceed_label="Promote member"
        proceed_loading_label="Promoting"
        isOpen={promoteTarget !== undefined}
        setIsOpen={(open) => {
          if (!open) setPromoteTargetId(null);
        }}
        isLoading={
          promoteTarget !== undefined && promotingMembers.ids.has(promoteTarget.userId)
        }
        keepOpenOnAccept
        proceedDisabled={promoteTargetIsLeader}
        onAccept={() => void onPromote()}
      >
        {promoteTarget && (
          <div className="space-y-3">
            <p>
              Promote <strong>{promoteTarget.username}</strong> in this {groupLabel}?
            </p>

            {promoteTargetIsColeader ? (
              <ul className="list-disc space-y-1 pl-5 text-sm">
                <li>
                  {promoteTarget.username} becomes the {groupLabel} leader.
                </li>
                {currentLeader && (
                  <li>
                    {currentLeader.username}{" "}
                    {clanData.coLeader1 === promoteTarget.userId
                      ? "moves into this co-leader position."
                      : "becomes a regular member under the current leadership-slot ordering."}
                  </li>
                )}
                {(clanData.village.type === "HIDEOUT" ||
                  clanData.village.type === "STRONGHOLD") && (
                  <li>
                    Settlement leadership of {clanData.village.name} also transfers to{" "}
                    {promoteTarget.username}.
                  </li>
                )}
                {promoteTargetIsAssassin && (
                  <li>Their existing assassin assignment remains recorded.</li>
                )}
              </ul>
            ) : promoteTarget.isOutlaw && !promoteTargetIsAssassin ? (
              <div className="space-y-2 text-sm">
                <p>
                  {promoteTarget.username} will be assigned the next open assassin
                  position.
                </p>
                {currentAssassinCount >= ASSASSIN_MAX_PER_FACTION && (
                  <p className="font-medium text-amber-600">
                    All {ASSASSIN_MAX_PER_FACTION} assassin positions are occupied, so
                    the server is expected to refuse this promotion.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                <p>
                  {promoteTarget.username} will be assigned the next open co-leader
                  position.
                </p>
                {promoteTargetIsAssassin && (
                  <p>Their existing assassin assignment remains recorded.</p>
                )}
                {!hasOpenColeaderSlot && (
                  <p className="font-medium text-amber-600">
                    All three co-leader positions are occupied, so the server is
                    expected to refuse this promotion.
                  </p>
                )}
              </div>
            )}

            {canEdit && !isLeader && !isColeader && (
              <p className="text-muted-foreground text-sm">
                This promotion uses your staff clan-management override.
              </p>
            )}
            <p className="text-muted-foreground text-sm">
              The role changes immediately after confirmation.
            </p>
          </div>
        )}
      </Modal>

      <Modal
        id={kickTarget ? `kick-${kickTarget.userId}-confirm` : "kick-member-confirm"}
        title={kickTarget ? `Kick ${kickTarget.username}?` : "Kick member?"}
        proceed_label="Kick member"
        proceed_loading_label="Kicking"
        confirmClassName="bg-red-600 text-white hover:bg-red-700"
        isOpen={kickTarget !== undefined}
        setIsOpen={(open) => {
          if (!open) setKickTargetId(null);
        }}
        isLoading={
          kickTarget !== undefined && kickingMembers.ids.has(kickTarget.userId)
        }
        keepOpenOnAccept
        onAccept={() => void onKick()}
      >
        {kickTarget && (
          <div className="space-y-3">
            <p>
              Remove <strong>{kickTarget.username}</strong> from this {groupLabel}?
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              <li>Their {groupLabel} membership is removed immediately.</li>
              <li>Any assigned leadership or assassin role is cleared.</li>
              <li>Clan requests involving them are deleted.</li>
              <li>
                They are removed from queued clan battles and returned to Awake if
                currently queued.
              </li>
              {kickTarget.isOutlaw && <li>They are returned to the Syndicate.</li>}
            </ul>
            {kickTarget.userId === clanData.leaderId && (
              <p className="font-medium text-amber-600 text-sm">
                This member is the current leader. Confirm the leadership transition
                before continuing.
              </p>
            )}
            <p className="text-muted-foreground text-sm">
              This cannot be undone here; the member would need to join again.
            </p>
          </div>
        )}
      </Modal>
    </>
  );
};
