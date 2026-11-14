"use client";

import { use } from "react";
import { type UseFormReturn, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import type { Bloodline } from "@/drizzle/schema";
import { useBloodlineEditForm } from "@/hooks/bloodline";
import { useEditorTitle } from "@/hooks/useEditorTitle";
import { useRequireRole } from "@/hooks/useRequireRole";
import ContentBox from "@/layout/ContentBox";
import { BloodlineHelper } from "@/layout/ContentHelp";
import { EditContent } from "@/layout/EditContent";
import { EditorQueryFeedback } from "@/layout/EditorQueryFeedback";
import { EffectTagListEditor } from "@/layout/EffectTagListEditor";
import Loader from "@/layout/Loader";
import { SuggestChange } from "@/layout/SuggestChange";
import { canChangeContent, isStaffRole } from "@/utils/permissions";
import { setNullsToEmptyStrings } from "@/utils/typeutils";
import type { ZodBloodlineType } from "@/validators/combat";
import { BloodlineValidator, DamageTag } from "@/validators/combat";

export default function BloodlineEdit(props: {
  params: Promise<{ bloodlineid: string }>;
}) {
  const params = use(props.params);
  const bloodlineId = params.bloodlineid;
  const { userData, hasAccess } = useRequireRole(isStaffRole);

  // Queries
  const { data, isPending, isError, isFetching, refetch } = api.bloodline.get.useQuery(
    { id: bloodlineId },
    { retry: false, enabled: !!bloodlineId && !!userData },
  );

  // Convert key null values to empty strings, preparing data for form
  setNullsToEmptyStrings(data);

  // Prevent unauthorized access
  if (isPending || !userData || !hasAccess) {
    return <Loader explanation="Loading data" />;
  }
  if (!data) {
    return (
      <EditorQueryFeedback
        label="bloodline"
        subtitle="Bloodline Management"
        backHref="/manual/bloodline"
        isError={isError}
        isFetching={isFetching}
        onRetry={refetch}
      />
    );
  }

  return (
    <SingleEditBloodline
      bloodline={data}
      refetch={refetch}
      canSave={canChangeContent(userData.role)}
    />
  );
}

interface SingleEditBloodlineProps {
  /** Staff who cannot save content still get the editor, to suggest changes. */
  canSave: boolean;
  bloodline: Bloodline;
  refetch: () => void;
}

const SingleEditBloodline: React.FC<SingleEditBloodlineProps> = (props) => {
  // Form handling
  const {
    loading,
    bloodline,
    effects,
    form,
    formData,
    setEffects,
    handleBloodlineSubmit,
  } = useBloodlineEditForm(props.bloodline, props.refetch);
  const entryName = useWatch({ control: form.control, name: "name" });
  const heading = useEditorTitle("bloodline", entryName);

  // Show panel controls
  return (
    <>
      <ContentBox
        title={heading}
        subtitle="Bloodline Management"
        defaultBackHref="/manual/bloodline"
        topRightContent={
          <BloodlineHelper
            bloodline={form.getValues() as unknown as ZodBloodlineType}
          />
        }
      >
        {!loading && (
          <>
            <EditContent
              guardUnsavedChanges
              schema={BloodlineValidator}
              form={form as unknown as UseFormReturn<ZodBloodlineType, any>}
              formData={formData}
              showSubmit={props.canSave}
              buttonTxt="Save to Database"
              type="bloodline"
              relationId={bloodline.id}
              allowImageUpload={props.canSave}
              onAccept={handleBloodlineSubmit}
            />
            <div className="mt-2 flex justify-end">
              <SuggestChange
                entityType="BLOODLINE"
                entityId={bloodline.id}
                getData={() => form.getValues()}
                label={props.canSave ? "Suggest instead" : "Suggest a change"}
              />
            </div>
          </>
        )}
      </ContentBox>

      <EffectTagListEditor
        allowActivityBonuses
        type="bloodline"
        effects={effects}
        setEffects={setEffects}
        newTag={() =>
          DamageTag.parse({ description: "placeholder", residualModifier: 0 })
        }
        tagTitle="Bloodline Tag"
        emptyTitle="Bloodline Tags"
        emptyText="Please add effects to this bloodline"
      />
    </>
  );
};
