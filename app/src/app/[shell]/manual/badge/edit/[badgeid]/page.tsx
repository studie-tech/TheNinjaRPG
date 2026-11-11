"use client";

import { use } from "react";
import { useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import type { Badge } from "@/drizzle/schema";
import { useBadgeEditForm } from "@/hooks/badge";
import { useEditorTitle } from "@/hooks/useEditorTitle";
import { useRequireRole } from "@/hooks/useRequireRole";
import ContentBox from "@/layout/ContentBox";
import { EditContent } from "@/layout/EditContent";
import { EditorQueryFeedback } from "@/layout/EditorQueryFeedback";
import Loader from "@/layout/Loader";
import { SuggestChange } from "@/layout/SuggestChange";
import { canChangeContent, isStaffRole } from "@/utils/permissions";
import { BadgeValidator } from "@/validators/badge";

export default function BadgeEdit(props: { params: Promise<{ badgeid: string }> }) {
  const params = use(props.params);
  const badgeId = params.badgeid;
  const { userData, hasAccess } = useRequireRole(isStaffRole);

  // Queries
  const { data, isPending, isError, isFetching, refetch } = api.badge.get.useQuery(
    { id: badgeId },
    { enabled: !!badgeId && !!userData },
  );

  // Prevent unauthorized access
  if (isPending || !userData || !hasAccess) {
    return <Loader explanation="Loading data" />;
  }
  if (!data) {
    return (
      <EditorQueryFeedback
        label="badge"
        subtitle="Badge Management"
        backHref="/manual/badge"
        isError={isError}
        isFetching={isFetching}
        onRetry={refetch}
      />
    );
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
  const entryName = useWatch({ control: form.control, name: "name" });
  const heading = useEditorTitle("badge", entryName);

  // Show panel controls
  return (
    <ContentBox
      title={heading}
      subtitle="Badge Management"
      defaultBackHref="/manual/badge"
      backDisabled={isUpdating}
      noRightAlign={true}
    >
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
    </ContentBox>
  );
};
