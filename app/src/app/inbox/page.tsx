"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  BellOff,
  BellRing,
  SquarePen,
  Trash2,
  UserRoundX,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { FederalStatus, UserRank } from "@/drizzle/constants";
import { MESSAGING_MIN_LEVEL } from "@/drizzle/constants";
import AvatarImage from "@/layout/Avatar";
import Confirm2 from "@/layout/Confirm2";
import ContentBox from "@/layout/ContentBox";
import Conversation from "@/layout/Conversation";
import Loader from "@/layout/Loader";
import Modal2 from "@/layout/Modal2";
import RichInput from "@/layout/RichInput";
import UserBlacklistControl from "@/layout/UserBlacklistControl";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { showMutationToast } from "@/libs/toast";
import { canPostAsAi, getMessagingRestriction } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";
import {
  type CreateConversationSchema,
  createConversationSchema,
} from "@/validators/comments";
import { getSearchValidator } from "@/validators/register";

export default function Inbox() {
  const { data: userData } = useRequiredUserData();
  const [selectedConvo, setSelectedConvo] = useState<string | null>(null);
  if (!userData) return <Loader explanation="Loading userdata" />;

  const topRightContent = (
    <div className="flex flex-row gap-1">
      <NewConversationPrompt
        setSelectedConvo={setSelectedConvo}
        newButton={
          <Button id="conversation">
            <SquarePen className="mr-2 h-5 w-5" />
            New
          </Button>
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

  // Fetch conversations. Note we pass the selected convo to automatically re-fetch when it changes
  const {
    data: allConversations,
    refetch,
    isPending,
  } = api.comments.getUserConversations.useQuery(
    { selectedConvo: selectedConvo },
    { enabled: !!userData, staleTime: 0 },
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
                </li>
              );
            })}
          </ul>
          <Modal2
            title="Confirm exiting conversation"
            isOpen={isExitConfirmOpen}
            setIsOpen={setIsExitConfirmOpen}
            isLoading={isExitingPending}
            proceed_loading_label="Exiting..."
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
          </Modal2>
          <div className="m-3 italic">- Messages deleted after 14 days</div>
        </div>
      )}
    </div>
  );
};

/**
 * Component for creating a new conversation
 */
export interface NewConversationPromptProps {
  setSelectedConvo?: React.Dispatch<React.SetStateAction<string | null>>;
  preSelectedUser?: {
    userId: string;
    username: string;
    rank: UserRank;
    level: number;
    avatar?: string | null;
    federalStatus: FederalStatus;
  };
  newButton: React.ReactNode;
}

export const NewConversationPrompt: React.FC<NewConversationPromptProps> = (props) => {
  const { data: userData } = useRequiredUserData();
  const maxUsers = 5;

  const create = useForm<CreateConversationSchema>({
    resolver: zodResolver(createConversationSchema),
    defaultValues: {
      title: "",
      comment: "",
      users: props.preSelectedUser?.userId ? [props.preSelectedUser?.userId] : [],
      senderId: null,
    },
  });

  const userSearchSchema = getSearchValidator({ max: maxUsers });
  const userSearchMethods = useForm<z.infer<typeof userSearchSchema>>({
    resolver: zodResolver(userSearchSchema),
    defaultValues: {
      username: "",
      users: [props.preSelectedUser],
    },
  });

  // User search for sender selection (AI posting)
  const maxSenderUsers = 1;
  const senderSearchSchema = getSearchValidator({ max: maxSenderUsers });
  const senderSearchMethods = useForm<z.infer<typeof senderSearchSchema>>({
    resolver: zodResolver(senderSearchSchema),
    defaultValues: { username: "", users: [] },
  });
  const watchedSenderUsers = useWatch({
    control: senderSearchMethods.control,
    name: "users",
    defaultValue: [],
  });
  const senderUser = watchedSenderUsers?.[0];
  const canPostAsAI = userData && canPostAsAi(userData.role);
  const composeRestriction = userData ? getMessagingRestriction(userData) : null;

  const users = useWatch({
    control: userSearchMethods.control,
    name: "users",
    defaultValue: [],
  });
  useEffect(() => {
    if (users && users.length > 0) {
      create.setValue(
        "users",
        users.map((u) => u.userId),
      );
    }
  }, [users, create]);

  const createConversation = api.comments.createConversation.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      if (data.success) {
        create.reset();
        if (data.conversationId) props.setSelectedConvo?.(data.conversationId);
      }
    },
  });

  const onSubmit = create.handleSubmit(
    (data) => {
      createConversation.mutate({
        ...data,
        ...(senderUser?.userId ? { senderId: senderUser.userId } : {}),
      });
    },
    (errors) => {
      const firstError = Object.values(errors)[0];
      if (firstError?.message) {
        showMutationToast({ success: false, message: firstError.message });
      }
    },
  );

  return (
    <div className="flex flex-row items-center">
      {userData && composeRestriction && (
        <TooltipProvider delayDuration={50}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  id="conversation"
                  disabled
                  variant="outline"
                  aria-label={`${composeRestriction}. You cannot start a conversation.`}
                >
                  <BellOff className="mr-2 h-6 w-6 text-red-500" />
                  {userData.isBanned
                    ? "Banned"
                    : userData.isSilenced
                      ? "Silenced"
                      : `Level ${MESSAGING_MIN_LEVEL} Required`}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {composeRestriction}. You cannot start a conversation.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {userData && !composeRestriction && (
        <Confirm2
          title="Create a new conversation"
          proceed_label="Submit"
          isValid={create.formState.isValid}
          button={props.newButton}
          onAccept={onSubmit}
        >
          <Form {...create}>
            {canPostAsAI && (
              <div className="mb-3">
                <FormLabel>Sender</FormLabel>
                <UserSearchSelect
                  useFormMethods={senderSearchMethods}
                  label="Post as (leave empty to post as yourself)"
                  selectedUsers={[]}
                  showYourself={true}
                  showAi={true}
                  inline={true}
                  maxUsers={maxSenderUsers}
                />
              </div>
            )}
            <div>
              <FormLabel>Receivers</FormLabel>
              <UserSearchSelect
                useFormMethods={userSearchMethods}
                label="Users to send to"
                showAi={false}
                showYourself={false}
                maxUsers={maxUsers}
              />
            </div>
            <FormField
              control={create.control}
              name="title"
              render={({ field }) => (
                <FormItem className="mb-2">
                  <FormLabel>Conversation name</FormLabel>
                  <FormControl>
                    <Input placeholder="" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <RichInput
              id="comment"
              label="Initial conversation message"
              height="300"
              placeholder=""
              control={create.control}
              error={create.formState.errors.comment?.message}
            />
          </Form>
        </Confirm2>
      )}
    </div>
  );
};
