"use client";

import { type z } from "zod";
import { useState, useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Conversation from "@/layout/Conversation";
import RichInput from "@/layout/RichInput";
import Confirm2 from "@/layout/Confirm2";
import Loader from "@/layout/Loader";
import AvatarImage from "@/layout/Avatar";
import ContentBox from "@/layout/ContentBox";
import UserSearchSelect from "@/layout/UserSearchSelect";
import UserBlacklistControl from "@/layout/UserBlacklistControl";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserRoundX } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormLabel,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { SquarePen, Users, X, Trash2, BellRing, BellOff } from "lucide-react";
import { api } from "@/app/_trpc/client";
import { useRequiredUserData } from "@/utils/UserContext";
import { createConversationSchema } from "@/validators/comments";
import { type CreateConversationSchema } from "@/validators/comments";
import { getSearchValidator } from "@/validators/register";
import type { FederalStatus, UserRank } from "@/drizzle/schema";
import { showMutationToast } from "@/libs/toast";
import { canPostAsAi } from "@/utils/permissions";

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
        <PopoverContent className="w-[300px] p-0 overflow-hidden">
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
  const { mutate: exitConversation } = api.comments.exitConversation.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await refetch();
      }
    },
  });

  // Derived
  const filteredConversations = allConversations?.map((c) => {
    const user = c.users.find((u) => u.userId === userData?.userId);
    const hasNewMessages = !user?.lastReadAt || user.lastReadAt < c.updatedAt;
    return { ...c, hasNewMessages };
  });

  // Render
  return (
    <div>
      {isPending && <Loader explanation="Looking for conversations" />}
      {allConversations && (
        <div className="relative">
          <ul className="space-y-2">
            <li>
              <a
                href="#"
                className="flex items-center rounded-lg p-2 text-base font-normal"
              >
                {selectedConvo ? (
                  <X
                    className="h-6 w-6 hover:text-orange-500"
                    onClick={() => setSelectedConvo(null)}
                  />
                ) : (
                  <Users className="h-6 w-6" />
                )}
                <span className="... ml-3 truncate font-bold">Chats</span>
              </a>
            </li>

            <hr />
            {filteredConversations?.map((convo) => (
              <li
                className={`relative mx-3 my-3 flex h-12 flex-row items-center rounded-lg hover:bg-popover ${
                  selectedConvo && selectedConvo === convo.id ? "bg-popover" : ""
                }`}
                key={convo.id}
                onClick={() => setSelectedConvo(convo.id)}
              >
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
                  className="... truncate text-sm grow"
                  style={{
                    marginLeft: (convo.users.length * 2 + 1.5).toString() + "rem",
                  }}
                >
                  {convo.title}
                  <br />
                  {convo.createdAt.toDateString()}
                </span>
                <div className="grow"></div>
                {convo.hasNewMessages && (
                  <BellRing className="h-6 w-6 text-red-500 hover:text-orange-500 hover:cursor-pointer animate-[wiggle_1s_ease-in-out_infinite]" />
                )}
                <Trash2
                  className="mx-2 h-6 w-6 hover:cursor-pointer rounded-full hover:text-orange-500"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    exitConversation({ convo_id: convo.id });
                  }}
                />
              </li>
            ))}
          </ul>
          <div className="italic m-3">- Messages deleted after 14 days</div>
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
      users: props.preSelectedUser?.userId ? [props.preSelectedUser?.userId] : [],
    },
  });

  const userSearchSchema = getSearchValidator({ max: maxUsers });
  const userSearchMethods = useForm<z.infer<typeof userSearchSchema>>({
    resolver: zodResolver(userSearchSchema),
    defaultValues: {
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
      create.reset();
      if (data.conversationId) {
        props.setSelectedConvo?.(data.conversationId);
      }
    },
  });

  const onSubmit = create.handleSubmit(
    (data) => {
      console.log(data);
      createConversation.mutate({
        ...data,
        ...(senderUser?.userId ? { senderId: senderUser.userId } : {}),
      });
    },
    (error) => console.error(error),
  );

  return (
    <div className="flex flex-row items-center">
      {userData && (userData.isBanned || userData.isSilenced) && (
        <Button id="conversation">
          <BellOff className="h-6 w-6 text-red-500 mr-2" />
          {userData.isBanned && "Banned"}
          {userData.isSilenced && "Silenced"}
        </Button>
      )}
      {userData && !userData.isBanned && !userData.isSilenced && (
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
