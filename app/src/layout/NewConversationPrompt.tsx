"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { BellOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { FederalStatus, UserRank } from "@/drizzle/constants";
import { MESSAGING_MIN_LEVEL } from "@/drizzle/constants";
import Modal from "@/layout/Modal";
import RichInput from "@/layout/RichInput";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { showMutationToast } from "@/libs/toast";
import { canPostAsAi, getMessagingRestriction } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";
import {
  type CreateConversationSchema,
  createConversationSchema,
} from "@/validators/comments";
import { getSearchValidator } from "@/validators/register";

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
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const createSubmissionRef = useRef(false);

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
      users: props.preSelectedUser ? [props.preSelectedUser] : [],
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
    create.setValue(
      "users",
      (users ?? []).filter((u) => u?.userId).map((u) => u.userId),
    );
  }, [users, create]);

  const createConversation = api.comments.createConversation.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      if (data.success) {
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
      return !next && createSubmissionRef.current ? current : next;
    });
  };

  const openCreateDialog = () => {
    if (createSubmissionRef.current) return;
    setIsCreateDialogOpen(true);
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
              openCreateDialog();
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
