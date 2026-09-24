"use client";

import { BellRing, SquarePen, Trash2, UserRoundX, Users, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button, buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import AvatarImage from "@/layout/Avatar";
import ContentBox from "@/layout/ContentBox";
import Conversation from "@/layout/Conversation";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { NewConversationPrompt } from "@/layout/NewConversationPrompt";
import UserBlacklistControl from "@/layout/UserBlacklistControl";
import { isRaidChatConversationId } from "@/libs/raids";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";

export default function Inbox() {
  const { data: userData } = useRequiredUserData();
  const [selectedConvo, setSelectedConvo] = useState<string | null>(null);
  if (!userData) return <Loader explanation="Loading userdata" />;

  const topRightContent = (
    <div className="flex flex-row gap-1">
      <NewConversationPrompt
        setSelectedConvo={setSelectedConvo}
        newButton={
          <span className={buttonVariants()}>
            <SquarePen className="mr-2 h-5 w-5" />
            New
          </span>
        }
      />
      <Popover>
        <PopoverTrigger asChild>
          <Button id="filter-bloodline">
            <UserRoundX className="h-6 w-6 hover:text-orange-500" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] overflow-hidden p-0">
          <UserBlacklistControl />
        </PopoverContent>
      </Popover>
    </div>
  );

  if (selectedConvo) {
    return (
      <Conversation
        refreshKey={0}
        convo_id={selectedConvo}
        defaultBackHref="/inbox"
        onBack={() => setSelectedConvo(null)}
        title="Inbox"
        subtitle="Private messages"
        topRightContent={topRightContent}
      />
    );
  } else if (!selectedConvo) {
    return (
      <ContentBox
        title="Inbox"
        subtitle="Private Conversations"
        padding={false}
        topRightContent={topRightContent}
      >
        <ShowConversations
          selectedConvo={selectedConvo}
          setSelectedConvo={setSelectedConvo}
        />
      </ContentBox>
    );
  }
}

/**
 * Component for displaying a conversations
 */
interface ShowConversationsProps {
  selectedConvo?: string | null;
  setSelectedConvo: React.Dispatch<React.SetStateAction<string | null>>;
}
const ShowConversations: React.FC<ShowConversationsProps> = (props) => {
  // Get user data & destructure
  const { data: userData } = useRequiredUserData();
  const { selectedConvo, setSelectedConvo } = props;
  const [pendingConvoId, setPendingConvoId] = useState<string | null>(null);
  const [isExitConfirmOpen, setIsExitConfirmOpen] = useState(false);

  // This list unmounts while a thread is open, so selectedConvo is always null here
  // and cannot bust the cache. Refetch on remount so going back after reading or
  // creating a conversation picks up lastReadAt and new threads. staleTime still
  // skips window-focus refetches while the list stays mounted.
  const {
    data: allConversations,
    refetch,
    isPending,
  } = api.comments.getUserConversations.useQuery(
    { selectedConvo: selectedConvo },
    { enabled: !!userData, staleTime: 30_000, refetchOnMount: "always" },
  );

  // Mutations
  const {
    mutate: exitConversation,
    isPending: isExitingConversation,
    variables: exitConversationVariables,
  } = api.comments.exitConversation.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      if (data.success) {
        void refetch();
      }
    },
  });

  // Derived
  const filteredConversations = allConversations?.map((c) => {
    const user = c.users.find((u) => u.userId === userData?.userId);
    const hasNewMessages = !user?.lastReadAt || user.lastReadAt < c.updatedAt;
    return { ...c, hasNewMessages };
  });
  const pendingConversation = filteredConversations?.find(
    (convo) => convo.id === pendingConvoId,
  );
  const exitingConvoId = exitConversationVariables?.convo_id;
  const isExitingPending = isExitingConversation && exitingConvoId === pendingConvoId;

  // Render
  return (
    <div>
      {isPending && <Loader explanation="Looking for conversations" />}
      {allConversations && (
        <div className="relative">
          <ul className="space-y-2">
            <li>
              <button
                type="button"
                className="flex w-full items-center rounded-lg p-2 text-left"
                onClick={() => selectedConvo && setSelectedConvo(null)}
              >
                {selectedConvo ? (
                  <X className="h-6 w-6 hover:text-orange-500" />
                ) : (
                  <Users className="h-6 w-6" />
                )}
                <span className="... ml-3 truncate font-bold">Chats</span>
              </button>
            </li>

            <hr />
            {filteredConversations?.map((convo) => {
              const isExiting = isExitingConversation && exitingConvoId === convo.id;
              // Raid chat membership follows the raid queue, so the server always
              // rejects a manual exit; don't offer the control for those rows.
              const canExit = !isRaidChatConversationId(convo.id);
              return (
                <li
                  className={`relative mx-3 my-3 flex h-12 flex-row items-center rounded-lg hover:bg-popover ${selectedConvo && selectedConvo === convo.id ? "bg-popover" : ""}`}
                  key={convo.id}
                >
                  <button
                    type="button"
                    className="absolute inset-0 h-full w-full"
                    onClick={() => setSelectedConvo(convo.id)}
                    aria-label={`Select conversation with ${convo.users.map((u) => u.userData.username).join(", ")}`}
                  />
                  {convo.users.length > 0 &&
                    convo.users.map((relation, i) => {
                      const user = relation.userData;
                      return (
                        <div
                          key={user.userId}
                          className={`absolute w-14`}
                          style={{ left: `${i * 2}rem` }}
                        >
                          <AvatarImage
                            href={user.avatar}
                            userId={user.userId}
                            alt={user.username}
                            size={50}
                            priority
                          />
                        </div>
                      );
                    })}
                  <span
                    className="... grow truncate text-sm"
                    style={{
                      marginLeft: `${(convo.users.length * 2 + 1.5).toString()}rem`,
                    }}
                  >
                    {convo.title}
                    <br />
                    {convo.createdAt.toDateString()}
                  </span>
                  <div className="grow"></div>
                  {convo.hasNewMessages && (
                    <BellRing className="h-6 w-6 animate-[wiggle_1s_ease-in-out_infinite] text-red-500 hover:cursor-pointer hover:text-orange-500" />
                  )}
                  {canExit && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="relative z-10 mx-2 rounded-full"
                      aria-label={`Exit conversation ${convo.title}`}
                      disabled={isExiting}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setPendingConvoId(convo.id);
                        setIsExitConfirmOpen(true);
                      }}
                    >
                      <Trash2 className="h-6 w-6 hover:text-orange-500" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          <Modal
            title="Confirm exiting conversation"
            isOpen={isExitConfirmOpen}
            setIsOpen={setIsExitConfirmOpen}
            // Keep Modal from self-closing on accept, so this destructive action
            // stays visible in its disabled "Exiting" state until the request
            // settles and onSettled closes the dialog.
            isValid={false}
            isLoading={isExitingPending}
            proceed_loading_label="Exiting"
            proceed_label="Proceed"
            proceedDisabled={!pendingConvoId || isExitingPending}
            onAccept={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!pendingConvoId) return;
              const requestedConvoId = pendingConvoId;
              exitConversation(
                { convo_id: requestedConvoId },
                {
                  onSettled: () => {
                    setPendingConvoId((currentConvoId) =>
                      currentConvoId === requestedConvoId ? null : currentConvoId,
                    );
                    setIsExitConfirmOpen(false);
                  },
                },
              );
            }}
            onClose={() => {
              if (!isExitingPending) {
                setPendingConvoId(null);
              }
            }}
          >
            {pendingConversation
              ? `You are about to exit "${pendingConversation.title}". Are you sure?`
              : "You are about to exit this conversation. Are you sure?"}
          </Modal>
          <div className="m-3 italic">- Messages deleted after 14 days</div>
        </div>
      )}
    </div>
  );
};
