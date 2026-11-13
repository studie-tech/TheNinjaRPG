"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { BellOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { FederalStatus, UserRank } from "@/drizzle/constants";
import { CONVERSATION_MAX_USERS, MESSAGING_MIN_LEVEL } from "@/drizzle/constants";
import { useConversationCacheUpdate } from "@/hooks/useConversationCacheUpdate";
import { AiSenderSelect } from "@/layout/AiSenderSelect";
import Modal from "@/layout/Modal";
import RichInput from "@/layout/RichInput";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { showMutationToast } from "@/libs/toast";
import { canPostAsAi, getMessagingRestriction } from "@/utils/permissions";
import { useUserPicker } from "@/utils/search";
import { useRequiredUserDataSelector } from "@/utils/UserContext";
import {
  type CreateConversationSchema,
  createConversationSchema,
} from "@/validators/comments";

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
  /** Open the form right away, e.g. when messaging a player from the chat panel. */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const NewConversationPrompt: React.FC<NewConversationPromptProps> = (props) => {
  const { data: userData } = useRequiredUserDataSelector((u) => ({
    role: u.role,
    isBanned: u.isBanned,
    isSilenced: u.isSilenced,
    level: u.level,
  }));
  const { refreshConversationList } = useConversationCacheUpdate();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(
    props.defaultOpen ?? false,
  );
  const createSubmissionRef = useRef(false);
  const previousCreateDialogOpenRef = useRef(isCreateDialogOpen);

  useEffect(() => {
    if (previousCreateDialogOpenRef.current === isCreateDialogOpen) return;
    previousCreateDialogOpenRef.current = isCreateDialogOpen;
    props.onOpenChange?.(isCreateDialogOpen);
  }, [isCreateDialogOpen, props.onOpenChange]);

  const create = useForm<CreateConversationSchema>({
    resolver: zodResolver(createConversationSchema),
    defaultValues: {
      title: "",
      comment: "",
      users: props.preSelectedUser?.userId ? [props.preSelectedUser?.userId] : [],
      senderId: null,
    },
  });

  const { methods: userSearchMethods, users } = useUserPicker(
    CONVERSATION_MAX_USERS,
    props.preSelectedUser ? [props.preSelectedUser] : [],
  );

  // User search for sender selection (AI posting)
  const { methods: senderSearchMethods, user: senderUser } = useUserPicker();
  const canPostAsAI = userData && canPostAsAi(userData.role);
  const composeRestriction = userData ? getMessagingRestriction(userData) : null;

  useEffect(() => {
    create.setValue(
      "users",
      (users ?? []).filter((u) => u?.userId).map((u) => u.userId),
    );
  }, [users, create]);

  const createConversation = api.comments.createConversation.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await refreshConversationList();
        create.reset();
        setIsCreateDialogOpen(false);
        if (data.conversationId) props.setSelectedConvo?.(data.conversationId);
      }
    },
    onSettled: () => {
      createSubmissionRef.current = false;
    },
  });

  const onSubmit = create.handleSubmit(
    (data) => {
      // React Query's pending state arrives on the next render. Guard synchronously
      // as well so a rapid click/Enter sequence cannot create two conversations.
      if (createSubmissionRef.current) return;
      createSubmissionRef.current = true;
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

  const setCreateDialogOpen: React.Dispatch<React.SetStateAction<boolean>> = (
    value,
  ) => {
    setIsCreateDialogOpen((current) => {
      const next = typeof value === "function" ? value(current) : value;
      const resolved = !next && createSubmissionRef.current ? current : next;
      return resolved;
    });
  };

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
        <>
          <button
            type="button"
            id={props.preSelectedUser ? undefined : "conversation"}
            aria-haspopup="dialog"
            aria-expanded={isCreateDialogOpen}
            aria-busy={createConversation.isPending}
            disabled={createConversation.isPending}
            className={`inline-flex items-center border-0 bg-transparent p-0 ${
              createConversation.isPending
                ? "cursor-not-allowed opacity-50"
                : "cursor-pointer"
            }`}
            onClick={(event) => {
              if (createSubmissionRef.current) return;
              event.preventDefault();
              event.stopPropagation();
              setIsCreateDialogOpen(true);
            }}
          >
            {props.newButton}
          </button>
          <Modal
            title="Create a new conversation"
            proceed_label="Submit"
            proceed_loading_label="Creating"
            isOpen={isCreateDialogOpen}
            setIsOpen={setCreateDialogOpen}
            isValid={false}
            isLoading={createConversation.isPending}
            proceedDisabled={!create.formState.isValid || createConversation.isPending}
            onAccept={onSubmit}
          >
            <div aria-busy={createConversation.isPending}>
              <Form {...create}>
                {canPostAsAI && (
                  <div className="mb-3">
                    <FormLabel>Sender</FormLabel>
                    <AiSenderSelect methods={senderSearchMethods} />
                  </div>
                )}
                <div>
                  <FormLabel>Receivers</FormLabel>
                  <UserSearchSelect
                    useFormMethods={userSearchMethods}
                    label="Users to send to"
                    showAi={false}
                    showYourself={false}
                    maxUsers={CONVERSATION_MAX_USERS}
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
              {createConversation.data && !createConversation.data.success && (
                <p role="alert" className="mt-3 text-destructive text-sm">
                  {createConversation.data.message}
                </p>
              )}
              {createConversation.isPending && (
                <div
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                  className="mt-3 rounded-md border border-border bg-muted/50 p-2 text-center text-muted-foreground text-sm"
                >
                  Creating
                </div>
              )}
            </div>
          </Modal>
        </>
      )}
    </div>
  );
};
