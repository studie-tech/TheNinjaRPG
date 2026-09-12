"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type React from "react";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import type { FederalStatus, UserRank, UserRole } from "@/drizzle/constants";
import { showMutationToast } from "@/libs/toast";
import { parseHtml } from "@/utils/parse";
import { useUserData } from "@/utils/UserContext";
import {
  type systems,
  type UserReportSchema,
  userReportSchema,
} from "../validators/reports";
import Modal from "./Modal";
import Post from "./Post";
import RichInput from "./RichInput";

interface ReportUserProps {
  button: React.ReactNode;
  system: (typeof systems)[number];
  user: {
    userId: string;
    username: string;
    avatar: string | null;
    level: number;
    rank: UserRank;
    isOutlaw: boolean;
    role: UserRole;
    federalStatus: FederalStatus;
  };
  content: {
    id: string;
    content?: string;
    title?: string;
    symmary?: string;
  };
}

const ReportUser: React.FC<ReportUserProps> = (props) => {
  const { data: userData } = useUserData();
  const [showModal, setShowModal] = useState<boolean>(false);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  // React mutation state updates on the next render. This ref closes the same-tick
  // double-click / Enter gap before tRPC can expose `isPending`.
  const pendingRequestRef = useRef<string | null>(null);

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

      // Capture everything the player confirmed, including the target identity and
      // reason draft, before beginning the asynchronous request.
      const requestId = crypto.randomUUID();
      pendingRequestRef.current = requestId;
      setPendingRequestId(requestId);

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
        onError: (error) => {
          showMutationToast({
            success: false,
            message: error.message || "Could not submit report",
          });
        },
        onSettled: () => {
          if (pendingRequestRef.current !== requestId) return;
          pendingRequestRef.current = null;
          setPendingRequestId(null);
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
          isLoading={pendingRequestId !== null}
          keepOpenOnAccept
        >
          {userData?.isBanned ? (
            <div>You are currently banned, and can therefore not report others</div>
          ) : (
            <>
              <Post title={props.content.title} user={props.user} hover_effect={false}>
                {props.content.symmary && (
                  <div>
                    {parseHtml(props.content.symmary)}
                    <hr />
                  </div>
                )}
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
                disabled={pendingRequestId !== null}
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
        className="inline-flex cursor-pointer items-center p-0"
      >
        {props.button}
      </button>
    );
  }
};

export default ReportUser;
