"use client";

import { BellRing, SquarePen, Trash2, Users } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, startTransition, useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button, buttonVariants } from "@/components/ui/button";
import { useInboxConversations } from "@/hooks/useConversationCacheUpdate";
import AvatarImage from "@/layout/Avatar";
import ContentBox from "@/layout/ContentBox";
import Conversation from "@/layout/Conversation";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { NewConversationPrompt } from "@/layout/NewConversationPrompt";
import { UserBlacklistPopover } from "@/layout/UserBlacklistControl";
import { isRaidChatConversationId } from "@/libs/raids";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";

export default function Inbox() {
  return (
    <Suspense fallback={<Loader explanation="Loading inbox" />}>
      <InboxContent />
    </Suspense>
  );
}

function InboxContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const linkedConversationId = searchParams.get("conversationId");
  const { data: userData } = useRequiredUserData();
  const [selectedConvo, setSelectedConvo] = useState<string | null>(
    linkedConversationId,
  );
  useEffect(() => {
    setSelectedConvo(linkedConversationId);
  }, [linkedConversationId]);
  // Opening a thread or going back swaps the whole view, unmounting the clicked control;
  // as a transition, that render does not block the click's next paint.
  const selectConvo: React.Dispatch<React.SetStateAction<string | null>> = (value) =>
    startTransition(() => setSelectedConvo(value));
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
      <UserBlacklistPopover />
    </div>
  );

  if (selectedConvo) {
    return (
      <Conversation
        refreshKey={0}
        convo_id={selectedConvo}
        defaultBackHref="/inbox"
        onBack={() => {
          selectConvo(null);
          if (linkedConversationId) router.replace("/inbox");
        }}
        title="Inbox"
        subtitle="Private messages"
        topRightContent={topRightContent}
      />
    );
  }
  return (
    <ContentBox
      title="Inbox"
      subtitle="Private Conversations"
      padding={false}
      topRightContent={topRightContent}
    >
      <ShowConversations setSelectedConvo={selectConvo} />
    </ContentBox>
  );
}

/**
 * Component for displaying a conversations
 */
interface ShowConversationsProps {
  setSelectedConvo: React.Dispatch<React.SetStateAction<string | null>>;
}
const ShowConversations: React.FC<ShowConversationsProps> = (props) => {
  // Get user data & destructure
  const { data: userData } = useRequiredUserData();
  const { setSelectedConvo } = props;
  const [pendingConvoId, setPendingConvoId] = useState<string | null>(null);
  const [isExitConfirmOpen, setIsExitConfirmOpen] = useState(false);

  // This list unmounts while a thread is open. Refetch on remount so going back after
  // reading or creating a conversation picks up lastReadAt and new threads. staleTime
  // still skips window-focus refetches while the list stays mounted.
  const {
    data: allConversations,
    refetch,
    isPending,
  } = useInboxConversations({ staleTime: 30_000, refetchOnMount: "always" });

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
            <li className="flex w-full items-center rounded-lg p-2">
              <Users className="h-6 w-6" />
              <span className="ml-3 truncate font-bold">Chats</span>
            </li>

            <hr />
            {filteredConversations?.map((convo) => {
              const isExiting = isExitingConversation && exitingConvoId === convo.id;
              // Raid chat membership follows the raid queue, so the server always
              // rejects a manual exit; don't offer the control for those rows.
              const canExit = !isRaidChatConversationId(convo.id);
              return (
                <li
                  className="relative mx-3 my-3 flex min-h-12 flex-row items-center gap-2 rounded-lg py-1 hover:bg-popover"
                  key={convo.id}
                >
                  <button
                    type="button"
                    className="absolute inset-0 h-full w-full"
                    onClick={() => setSelectedConvo(convo.id)}
                    aria-label={`Select conversation with ${convo.users.map((u) => u.userData.username).join(", ")}`}
                  />
                  {convo.users.length > 0 && (
                    <div className="flex shrink-0 items-center -space-x-4">
                      {convo.users.slice(0, INBOX_AVATARS_SHOWN).map((relation) => {
                        const user = relation.userData;
                        return (
                          <div key={user.userId} className="w-12">
                            <AvatarImage
                              href={user.avatar}
                              alt={user.username}
                              size={50}
                            />
                          </div>
                        );
                      })}
                      {convo.users.length > INBOX_AVATARS_SHOWN && (
                        <span className="rounded-full bg-popover px-1.5 py-0.5 text-xs font-semibold">
                          +{convo.users.length - INBOX_AVATARS_SHOWN}
                        </span>
                      )}
                    </div>
                  )}
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block truncate">{convo.title}</span>
                    <span className="block truncate text-muted-foreground">
                      {convo.createdAt.toDateString()}
                    </span>
                  </span>
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
            // Stays in its disabled "Exiting" state until onSettled closes it.
            keepOpenOnAccept
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

/** Overlapping avatars shown per conversation before the rest collapse into "+N". */
const INBOX_AVATARS_SHOWN = 3;
