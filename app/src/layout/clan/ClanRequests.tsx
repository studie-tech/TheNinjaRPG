import { SendHorizontal } from "lucide-react";
import type React from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { CLAN_RANK_REQUIREMENT } from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import UserRequestSystem from "@/layout/UserRequestSystem";
import { hasRequiredRank } from "@/libs/rank";
import { showMutationToast } from "@/libs/toast";
import type { BaseServerResponse } from "@/server/api/trpc";
import { useRequiredUserDataSelector } from "@/utils/UserContext";

interface ClanRequestsProps {
  clanId: string;
  clanLeaderId: string;
  isLeaderOrColeader: boolean;
}

/** Manage clan or faction invitations and applications using the viewer's membership role. */
export const ClanRequests: React.FC<ClanRequestsProps> = (props) => {
  // Destructure
  const { data: userData } = useRequiredUserDataSelector((u) => ({
    clanId: u.clanId,
    isOutlaw: u.isOutlaw,
    rank: u.rank,
    userId: u.userId,
  }));
  const { clanId, clanLeaderId, isLeaderOrColeader } = props;
  const groupLabel = userData?.isOutlaw ? "faction" : "clan";

  // Get utils
  const utils = api.useUtils();

  // Query
  const { data: requests } = api.clan.getRequests.useQuery(
    { clanLeaderId: clanLeaderId },
    {
      staleTime: 5000,
    },
  );

  // How to deal with success responses
  const onSuccess = async (data: BaseServerResponse) => {
    showMutationToast(data);
    if (data.success) {
      await Promise.all([
        utils.clan.get.invalidate(),
        utils.clan.getRequests.invalidate(),
      ]);
    }
  };

  // Mutation
  const { mutate: create, isPending: isCreating } = api.clan.createRequest.useMutation({
    onSuccess,
  });
  const { mutate: accept, isPending: isAccepting } = api.clan.acceptRequest.useMutation(
    { onSuccess },
  );
  const { mutate: reject, isPending: isRejecting } = api.clan.rejectRequest.useMutation(
    { onSuccess },
  );
  const { mutate: cancel, isPending: isCancelling } =
    api.clan.cancelRequest.useMutation({ onSuccess });

  // Loaders
  if (!requests) return <Loader explanation="Loading requests" />;
  if (!userData) return <Loader explanation="Loading user data" />;

  // Derived
  const hasPending = requests?.some((req) => req.status === "PENDING");
  const showRequestSystem =
    (isLeaderOrColeader && requests.length > 0) || !userData.clanId;
  const shownRequests = requests.filter(
    (r) => !isLeaderOrColeader || r.status === "PENDING",
  );
  const sufficientRank = hasRequiredRank(userData.rank, CLAN_RANK_REQUIREMENT);

  // Do not show?
  if (!showRequestSystem) return null;

  // Render
  return (
    <ContentBox
      title="Request"
      subtitle={`Requests for ${groupLabel}`}
      initialBreak={true}
      padding={false}
    >
      {/* FOR THOSE WHO CAN SEND REQUESTS */}
      {sufficientRank && !userData.clanId && !hasPending && (
        <div className="p-2">
          <p>Send a request to join this {groupLabel}</p>
          <Button id="send" className="mt-2 w-full" onClick={() => create({ clanId })}>
            <SendHorizontal className="mr-2 h-5 w-5" />
            Send Request
          </Button>
        </div>
      )}
      {/* SHOW REQUESTS */}
      {shownRequests.length === 0 && <p className="p-2 italic">No current requests</p>}
      {shownRequests.length > 0 && (
        <UserRequestSystem
          requests={shownRequests}
          userId={isLeaderOrColeader ? clanLeaderId : userData.userId}
          isLoading={isCreating || isAccepting || isRejecting || isCancelling}
          onAccept={accept}
          onReject={reject}
          onCancel={cancel}
        />
      )}
    </ContentBox>
  );
};
