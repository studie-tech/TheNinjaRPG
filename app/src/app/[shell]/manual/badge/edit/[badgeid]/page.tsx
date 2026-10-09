"use client";

import { useRouter } from "next/navigation";
import { use, useEffect } from "react";
import { api } from "@/app/_trpc/client";
import type { Badge } from "@/drizzle/schema";
import ContentBox from "@/layout/ContentBox";
import { EditContent } from "@/layout/EditContent";
import Loader from "@/layout/Loader";
import { SuggestChange } from "@/layout/SuggestChange";
import { useBadgeEditForm } from "@/libs/badge";
import { canChangeContent, isStaffRole } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";
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

  // Redirect to profile if not staff
  useEffect(() => {
    if (userData && !isStaffRole(userData.role)) {
      router.push("/profile");
    }
  }, [userData]);

  // Prevent unauthorized access
  if (isPending || !userData || !isStaffRole(userData.role) || !data) {
    return <Loader explanation="Loading data" />;
  }

  return (
    <SingleEditBadge
      badge={data}
      refetch={refetch}
      canSave={canChangeContent(userData.role)}
    />
  );
}

interface SingleEditBadgeProps {
  /** Staff who cannot save content still get the editor, to suggest changes. */
  canSave: boolean;
  badge: Badge;
  refetch: () => void;
}

const SingleEditBadge: React.FC<SingleEditBadgeProps> = (props) => {
  // Form handling
  const { badge, form, formData, handleBadgeSubmit, isUpdating } = useBadgeEditForm(
    props.badge,
    props.refetch,
  );

  // Show panel controls
  return (
    <ContentBox
      title="Content Panel"
      subtitle="Badge Management"
      defaultBackHref="/manual/badge"
      backDisabled={isUpdating}
      noRightAlign={true}
    >
      {!badge && <p>Could not find this badge</p>}
      {badge && (
        <>
          <EditContent
            schema={BadgeValidator}
            form={form}
            formData={formData}
            showSubmit={props.canSave}
            buttonTxt="Save to Database"
            type="badge"
            relationId={badge.id}
            allowImageUpload={props.canSave}
            onAccept={handleBadgeSubmit}
            submitLoading={isUpdating}
            submitLoadingText="Saving"
          />
          <div className="mt-2 flex justify-end">
            <SuggestChange
              entityType="BADGE"
              entityId={badge.id}
              getData={() => form.getValues()}
              label={props.canSave ? "Suggest instead" : "Suggest a change"}
            />
          </div>
        </>
      )}
    </ContentBox>
  );
};
