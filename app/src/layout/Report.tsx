"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type React from "react";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import Modal from "@/layout/Modal";
import Post from "@/layout/Post";
import RichInput from "@/layout/RichInput";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import type { UserCard } from "@/queries/userColumns";
import { parseHtml } from "@/utils/parse";
import { useUserData } from "@/utils/UserContext";
import {
  type systems,
  type UserReportSchema,
  userReportSchema,
} from "@/validators/reports";

interface ReportUserProps {
  button: React.ReactNode;
  /** Accessible name of the trigger; defaults to reporting the user. */
  label?: string;
  /** Classes for the trigger button. */
  className?: string;
  system: (typeof systems)[number];
  user: UserCard;
  content: {
    id: string;
    content?: string;
    title?: string;
  };
}

const ReportUser: React.FC<ReportUserProps> = (props) => {
  const { data: userData } = useUserData();
  const [showModal, setShowModal] = useState<boolean>(false);
  // React mutation state updates on the next render. This ref closes the same-tick
  // double-click / Enter gap before tRPC can expose `isPending`.
  const pendingRequestRef = useRef(false);

  // Get utils
  const utils = api.useUtils();

  // Mutations
  const createReport = api.reports.create.useMutation();

  const {
    handleSubmit,
    reset,
    control,
    formState: { errors, isValid },
  } = useForm<UserReportSchema>({
    defaultValues: {
      system: props.system,
      system_id: props.content.id,
      reported_userId: props.user.userId,
    },
    resolver: zodResolver(userReportSchema),
  });

  const onSubmit = handleSubmit(
    (data) => {
      if (pendingRequestRef.current) return;

      pendingRequestRef.current = true;

      createReport.mutate(data, {
        onSuccess: (response) => {
          showMutationToast(response);
          if (!response.success) return;

          // Clear the draft only after the server reports success.
          reset();
          setShowModal(false);
          void Promise.allSettled([
            utils.reports.getAll.invalidate(),
            utils.comments.getConversationComments.invalidate(),
            utils.comments.getForumComments.invalidate(),
          ]);
        },
        // Failures are presented by the shared tRPC mutation error handler.
        onSettled: () => {
          pendingRequestRef.current = false;
        },
      });
    },
    (errors) => console.error(errors),
  );

  if (!userData) return null;

  if (showModal) {
    return (
      <form onSubmit={onSubmit}>
        <Modal
          id={`report-${props.system}-${props.content.id}`}
          title="Report User"
          isOpen={showModal}
          setIsOpen={setShowModal}
          proceed_label={userData?.isBanned ? "Stop" : "Report User"}
          proceed_loading_label="Submitting"
          onAccept={userData?.isBanned ? undefined : onSubmit}
          isValid={isValid}
          isLoading={createReport.isPending}
          keepOpenOnAccept
        >
          {userData?.isBanned ? (
            <div>You are currently banned, and can therefore not report others</div>
          ) : (
            <>
              <Post title={props.content.title} user={props.user} hover_effect={false}>
                <hr />
                {props.content.content && (
                  <div>
                    {parseHtml(props.content.content)}
                    <hr />
                  </div>
                )}
              </Post>
              <RichInput
                id="reason"
                label="Report reason"
                height="200"
                placeholder="Unless obvious, please state the reason for this report"
                control={control}
                error={errors.reason?.message}
                disabled={createReport.isPending}
              />
            </>
          )}
        </Modal>
      </form>
    );
  } else {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setShowModal(true);
        }}
        aria-label={props.label ?? `Report ${props.user.username}`}
        aria-haspopup="dialog"
        className={cn(
          "inline-flex cursor-pointer items-center justify-center p-0 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
          props.className,
        )}
      >
        {props.button}
      </button>
    );
  }
};

export default ReportUser;
