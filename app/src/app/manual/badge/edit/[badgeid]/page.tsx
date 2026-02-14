"use client";

import { useRouter } from "next/navigation";
import { use, useEffect } from "react";
import { api } from "@/app/_trpc/client";
import type { Badge } from "@/drizzle/schema";
import ChatInputField from "@/layout/ChatInputField";
import ContentBox from "@/layout/ContentBox";
import { EditContent } from "@/layout/EditContent";
import Loader from "@/layout/Loader";
import { useBadgeEditForm } from "@/libs/badge";
import { canChangeContent } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";
import type { ZodBadgeType } from "@/validators/badge";
import { BadgeValidator } from "@/validators/badge";

export default function BadgeEdit(props: { params: Promise<{ badgeid: string }> }) {
  const params = use(props.params);
  const badgeId = params.badgeid;
  const router = useRouter();
  const { data: userData } = useRequiredUserData();

  // Queries
  const { data, isPending, refetch } = api.badge.get.useQuery(
    { id: badgeId },
    { enabled: !!badgeId && !!userData },
  );

  // Redirect to profile if not content or admin
  useEffect(() => {
    if (userData && !canChangeContent(userData.role)) {
      router.push("/profile");
    }
  }, [userData]);

  // Prevent unauthorized access
  if (isPending || !userData || !canChangeContent(userData.role) || !data) {
    return <Loader explanation="Loading data" />;
  }

  return <SingleEditBadge badge={data} refetch={refetch} />;
}

interface SingleEditBadgeProps {
  badge: Badge;
  refetch: () => void;
}

const SingleEditBadge: React.FC<SingleEditBadgeProps> = (props) => {
  // Form handling
  const { badge, form, formData, handleBadgeSubmit } = useBadgeEditForm(
    props.badge,
    props.refetch,
  );

  // Show panel controls
  return (
    <ContentBox
      title="Content Panel"
      subtitle="Badge Management"
      defaultBackHref="/manual/badge"
      noRightAlign={true}
      topRightContent={
        formData.find((e) => e.id === "description") ? (
          <ChatInputField
            inputProps={{
              id: "chatInput",
              placeholder: "Instruct ChatGPT to edit",
            }}
            aiProps={{
              apiEndpoint: "/api/chat/badge",
              systemMessage: `
                Current badge data: ${JSON.stringify(form.getValues())}. 
              `,
            }}
            onToolCall={(toolCall) => {
              const data = toolCall.args as ZodBadgeType;
              let key: keyof typeof data;
              for (key in data) {
                if (key !== "image") form.setValue(key, data[key]);
              }
              void form.trigger();
            }}
          />
        ) : undefined
      }
    >
      {!badge && <p>Could not find this badge</p>}
      {badge && (
        <EditContent
          schema={BadgeValidator}
          form={form}
          formData={formData}
          showSubmit={true}
          buttonTxt="Save to Database"
          type="badge"
          relationId={badge.id}
          allowImageUpload={true}
          onAccept={handleBadgeSubmit}
        />
      )}
    </ContentBox>
  );
};
