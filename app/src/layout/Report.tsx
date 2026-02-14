"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type React from "react";
import { useState } from "react";
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
import Modal2 from "./Modal2";
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

  // Get utils
  const utils = api.useUtils();

  // Mutations
  const createReport = api.reports.create.useMutation({
    onSuccess: async (data) => {
      await utils.reports.getAll.invalidate();
      await utils.comments.getConversationComments.invalidate();
      await utils.comments.getForumComments.invalidate();
      showMutationToast(data);
    },
  });

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
      createReport.mutate(data);
      reset();
      setShowModal(false);
    },
    (errors) => console.error(errors),
  );

  if (!userData) return null;

  if (showModal) {
    return (
      <form onSubmit={onSubmit}>
        <Modal2
          title="Report User"
          isOpen={showModal}
          setIsOpen={setShowModal}
          proceed_label={userData?.isBanned ? "Stop" : "Report User"}
          onAccept={userData?.isBanned ? undefined : onSubmit}
          isValid={isValid}
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
              />
            </>
          )}
        </Modal2>
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
        className="cursor-pointer"
      >
        {props.button}
      </button>
    );
  }
};

export default ReportUser;
