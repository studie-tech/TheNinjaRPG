"use client";

import { useParams } from "next/navigation";
import { api } from "@/app/_trpc/client";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import Conversation from "@/layout/Conversation";
import { Button } from "@/components/ui/button";
import { useUserData } from "@/utils/UserContext";
import AvatarImage from "@/layout/Avatar";
import Link from "next/link";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { showMutationToast } from "@/libs/toast";
import { Badge } from "@/components/ui/badge";
import { canApproveApplications, getApprovalGroup } from "@/utils/permissions";

export default function ApplicationDetailPage() {
  // State
  const params = useParams<{ applicationId: string }>();
  const applicationId = params.applicationId;
  const { data: me } = useUserData();

  // Derived
  const isStaff = me?.role && me.role !== "USER";
  const canApprove = me?.role ? canApproveApplications(me.role) : false;

  // Query for application
  const { data: app, isPending } = api.applications.get.useQuery({ id: applicationId });

  // Render
  if (isPending) return <Loader explanation="Loading application" />;
  if (!app)
    return (
      <ContentBox
        title="Application"
        subtitle="Not found"
        defaultBackHref={isStaff ? "/manual/staff/applications" : "/manual/staff"}
      >
        Not found or you do not have access to this application.
      </ContentBox>
    );
  const approvalGroup = me?.role ? getApprovalGroup(me.role) : null;
  const staffVote =
    canApprove && approvalGroup
      ? app?.approvals?.find((a) => a.group === approvalGroup)?.state
      : undefined;

  return (
    <>
      <ContentBox
        title={`Application: ${app.targetRole}`}
        subtitle={`Status: ${app.state.toLowerCase()}`}
        defaultBackHref={isStaff ? "/applications" : "/manual/staff"}
        topRightContent={
          canApprove && app.state !== "APPROVED" ? (
            <div className="flex gap-2">
              {staffVote !== "APPROVED" && <ApproveButton applicationId={app.id} />}
              {staffVote !== "REJECTED" && <RejectButton applicationId={app.id} />}
            </div>
          ) : undefined
        }
      >
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-16">
              <AvatarImage
                href={app.applicant?.avatar || ""}
                alt={app.applicant?.username || "Applicant"}
                userId={app.applicantUserId}
                hover_effect={true}
                priority={true}
                size={100}
              />
            </div>
            <div>
              <div className="font-semibold">
                <Link
                  href={`/username/${app.applicant?.username || "user"}`}
                  className="hover:text-orange-500"
                >
                  {app.applicant?.username || app.applicantUserId}
                </Link>
              </div>
              <div className="text-sm text-muted-foreground">
                Lvl. {app.applicant?.level || 0} {app.applicant?.rank || "STUDENT"}
                {" • "}
                {app.applicant?.village?.name || "Syndicate"}
              </div>
            </div>
          </div>
          <div className="pt-1">
            <div className="font-semibold">Motivation</div>
            <div className="whitespace-pre-wrap break-words">
              {app.motivation || ""}
            </div>
          </div>
          {isStaff && (
            <div className="pt-1">
              <div className="font-semibold mb-1">Approvals</div>
              <div className="flex flex-wrap gap-2">
                <ApprovalBadge app={app} group="EVENT-ADMIN" label="Event" />
                <ApprovalBadge app={app} group="CODING-ADMIN" label="Coding" />
                <ApprovalBadge app={app} group="MODERATOR-ADMIN" label="Moderation" />
                <ApprovalBadge app={app} group="CONTENT-ADMIN" label="Content" />
              </div>
            </div>
          )}
        </div>
      </ContentBox>
      <Conversation
        title="Application Conversation"
        subtitle="Discuss this application"
        refreshKey={0}
        convo_id={app.conversationId}
        initialBreak={true}
      />
    </>
  );
}
type AppApproval = { group: string; state?: "APPROVED" | "REJECTED" };
type ApplicationForBadge = { approvals?: AppApproval[] };

const ApprovalBadge: React.FC<{
  app: ApplicationForBadge;
  group: "EVENT-ADMIN" | "CODING-ADMIN" | "MODERATOR-ADMIN" | "CONTENT-ADMIN";
  label: string;
}> = ({ app, group, label }) => {
  const decision = app?.approvals?.find((a) => a.group === group)?.state;
  const approved = decision === "APPROVED";
  const rejected = decision === "REJECTED";
  return (
    <Badge variant={approved ? "default" : rejected ? "destructive" : "secondary"}>
      {label}: {approved ? "Approved" : rejected ? "Rejected" : "Pending"}
    </Badge>
  );
};

//

const ApproveButton: React.FC<{ applicationId: string }> = ({ applicationId }) => {
  const utils = api.useUtils();
  const { mutate, isPending } = api.applications.approve.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.applications.get.invalidate({ id: applicationId });
        await utils.applications.list.invalidate();
      }
    },
  });
  return (
    <Button disabled={isPending} onClick={() => mutate({ id: applicationId })}>
      <ThumbsUp className="w-5 h-5 mr-2" />
      Approve
    </Button>
  );
};

const RejectButton: React.FC<{ applicationId: string }> = ({ applicationId }) => {
  const utils = api.useUtils();
  const { mutate, isPending } = api.applications.reject.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.applications.get.invalidate({ id: applicationId });
        await utils.applications.list.invalidate();
      }
    },
  });
  return (
    <Button
      variant="destructive"
      disabled={isPending}
      onClick={() => mutate({ id: applicationId })}
    >
      <ThumbsDown className="w-5 h-5 mr-2" />
      Reject
    </Button>
  );
};
