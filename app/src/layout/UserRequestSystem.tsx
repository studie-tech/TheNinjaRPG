import React from "react";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import Loader from "@/layout/Loader";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import { Button } from "@/components/ui/button";
import { Check, X, Trash2 } from "lucide-react";
import type { UserRequestState, UserRank } from "@/drizzle/constants";
import type { UserRequest } from "@/drizzle/schema";
import type { ArrayElement } from "@/utils/typeutils";

type RequestUser = {
  username: string;
  level: number;
  rank: UserRank;
  village: { name: string } | null;
};
type ReturnedRequest = UserRequest & { receiver: RequestUser; sender: RequestUser };

interface UserRequestSystemProps {
  requests: ReturnedRequest[];
  userId: string;
  isLoading: boolean;
  onAccept: (props: { id: string }) => void;
  onReject: (props: { id: string }) => void;
  onCancel: (props: { id: string }) => void;
}

const UserRequestSystem: React.FC<UserRequestSystemProps> = (props) => {
  // Table for challenges sent
  const challengesSent = props.requests
    ?.filter((c) => c.senderId === props.userId)
    .map((c) => ({
      info: <ChallengeInfo request={c} />,
      receiver: <ChallengeUserInfo user={c.receiver} />,
      status: <ChallengeStatusBox status={c.status} />,
      actions: <ChallengeActionsBox challenge={c} {...props} />,
    }));
  type SparSent = ArrayElement<typeof challengesSent>;
  const sentColumns: ColumnDefinitionType<SparSent, keyof SparSent>[] = [
    { key: "receiver", header: "Receiver", type: "jsx" },
    { key: "info", header: "Info", type: "jsx" },
    { key: "status", header: "Status", type: "jsx" },
    { key: "actions", header: "Actions", type: "jsx" },
  ];

  // Table for challenges received
  const challengesReceived = props.requests
    ?.filter((c) => c.receiverId === props.userId)
    .map((c) => ({
      info: <ChallengeInfo request={c} />,
      sender: <ChallengeUserInfo user={c.sender} />,
      status: <ChallengeStatusBox status={c.status} />,
      actions: <ChallengeActionsBox challenge={c} {...props} />,
    }));
  type SparReceived = ArrayElement<typeof challengesReceived>;
  const receivedColumns: ColumnDefinitionType<SparReceived, keyof SparReceived>[] = [
    { key: "sender", header: "Sender", type: "jsx" },
    { key: "info", header: "Info", type: "jsx" },
    { key: "status", header: "Status", type: "jsx" },
    { key: "actions", header: "Actions", type: "jsx" },
  ];

  return (
    <div>
      {challengesSent && challengesSent.length > 0 && (
        <Table data={challengesSent} columns={sentColumns} />
      )}
      {challengesReceived && challengesReceived.length > 0 && (
        <Table data={challengesReceived} columns={receivedColumns} />
      )}
    </div>
  );
};

interface ChallengeActionsBoxProps extends UserRequestSystemProps {
  challenge: ReturnedRequest;
}

const ChallengeActionsBox: React.FC<ChallengeActionsBoxProps> = (props) => {
  // Destructure
  const { userId, challenge, isLoading, onAccept, onReject, onCancel } = props;

  // Loader
  if (isLoading) return <Loader />;

  if (challenge.status === "PENDING") {
    if (challenge.senderId === userId) {
      return (
        <Button
          className="w-full"
          id="cancel"
          onClick={() => onCancel({ id: challenge.id })}
        >
          <Trash2 className="h-5 w-5 mr-2" />
          Cancel
        </Button>
      );
    } else {
      return (
        <div className="grid grid-cols-2 gap-1">
          <Button id="accept" onClick={() => onAccept({ id: challenge.id })}>
            <Check className="h-5 w-5 mr-2" />
            Accept
          </Button>
          <Button id="reject" onClick={() => onReject({ id: challenge.id })}>
            <X className="h-5 w-5 mr-2" />
            Reject
          </Button>
        </div>
      );
    }
  }
  return null;
};

const ChallengeStatusBox: React.FC<{ status: UserRequestState }> = ({ status }) => {
  switch (status) {
    case "PENDING":
      return (
        <div className="bg-amber-300 p-2 rounded-md border-2 border-amber-400 text-amber-600 font-bold">
          Pending
        </div>
      );
    case "ACCEPTED":
      return (
        <div className="bg-green-300 p-2 rounded-md border-2 border-green-400 text-green-600 font-bold">
          Accepted
        </div>
      );
    case "REJECTED":
      return (
        <div className="bg-red-300 p-2 rounded-md border-2 border-red-400 text-red-600 font-bold">
          Rejected
        </div>
      );
    case "CANCELLED":
      return (
        <div className="bg-slate-300 p-2 rounded-md border-2 border-slate-400 text-slate-600 font-bold">
          Cancelled
        </div>
      );
  }
};

const ChallengeInfo: React.FC<{ request: UserRequest }> = ({ request }) => {
  return (
    <div>
      <p className="font-bold">{capitalizeFirstLetter(request.type)}</p>
      <p>{request.createdAt.toDateString()}</p>
      <p>{request.createdAt.toLocaleTimeString()}</p>
      {request.type === "WAR_ALLY" && <p>Token Amount: {request.value}</p>}
      {request.type === "SPAR" && request.useRankedRules && (
        <p className="text-blue-600 font-semibold">Uses Ranked Rules</p>
      )}
      {request.type === "SPAR" && request.spectatable && (
        <p className="text-green-600 font-semibold">Allows Spectating</p>
      )}
    </div>
  );
};

const ChallengeUserInfo: React.FC<{ user: RequestUser }> = ({ user }) => {
  return (
    <div>
      <p className="font-bold">{user.username}</p>
      <p>
        Lvl. {user.level} {capitalizeFirstLetter(user.rank)}
      </p>
      {user.village && <p>Village: {user.village.name}</p>}
    </div>
  );
};

export default UserRequestSystem;
