"use client";

import { use } from "react";
import { type UseFormReturn, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import type { Jutsu } from "@/drizzle/schema";
import { useJutsuEditForm } from "@/hooks/jutsu";
import { useEditorTitle } from "@/hooks/useEditorTitle";
import { useRequireRole } from "@/hooks/useRequireRole";
import ContentBox from "@/layout/ContentBox";
import { JutsuHelper } from "@/layout/ContentHelp";
import { EditContent } from "@/layout/EditContent";
import { EditorQueryFeedback } from "@/layout/EditorQueryFeedback";
import { EffectTagListEditor } from "@/layout/EffectTagListEditor";
import Loader from "@/layout/Loader";
import { SuggestChange } from "@/layout/SuggestChange";
import { JUTSU_EFFECT_COSMETICS } from "@/libs/jutsu/reskins";
import { canChangeContent, isStaffRole } from "@/utils/permissions";
import { setNullsToEmptyStrings } from "@/utils/typeutils";
import type { ZodJutsuType } from "@/validators/combat";
import { DamageTag, JutsuValidatorRawSchema } from "@/validators/combat";

export default function JutsuEdit(props: { params: Promise<{ jutsuid: string }> }) {
  const params = use(props.params);
  const jutsuId = params.jutsuid;

  // State
  const { userData, hasAccess } = useRequireRole(isStaffRole);

  // Queries
  const { data, isPending, isError, isFetching, refetch } = api.jutsu.get.useQuery(
    { id: jutsuId },
    { retry: false, enabled: !!jutsuId },
  );

  // Convert key null values to empty strings, preparing data for form
  setNullsToEmptyStrings(data);

  // Prevent unauthorized access
  if (!userData || !hasAccess) {
    return <Loader explanation="Loading data" />;
  }

  const queryFeedback = (
    <EditorQueryFeedback
      label="jutsu"
      subtitle="Jutsu Management"
      backHref="/manual/jutsu"
      hasCachedData={!!data}
      isError={isError}
      isFetching={isFetching}
      onRetry={refetch}
    />
  );

  // Missing records settle the loading state; failed refreshes keep the cached editor visible.
  if (!isPending && !data) return queryFeedback;
  if (!data) return <Loader explanation="Loading data" />;

  return (
    <>
      {isError && queryFeedback}
      <SingleEditJutsu
        jutsu={data}
        refetch={refetch}
        canSave={canChangeContent(userData.role)}
      />
    </>
  );
}

interface SingleEditJutsuProps {
  /** Staff who cannot save content still get the editor, to suggest changes. */
  canSave: boolean;
  jutsu: Jutsu;
  refetch: () => void;
}

const SingleEditJutsu: React.FC<SingleEditJutsuProps> = (props) => {
  // Form handling
  const {
    loading,
    isSaving,
    jutsu,
    effects,
    form,
    formData,
    setEffects,
    handleJutsuSubmit,
    reskinParentId,
    updateError,
  } = useJutsuEditForm(props.jutsu, props.refetch);
  const entryName = useWatch({ control: form.control, name: "name" });
  const heading = useEditorTitle("jutsu", entryName);

  // Show panel controls
  return (
    <>
      <ContentBox
        title={heading}
        subtitle="Jutsu Management"
        defaultBackHref="/manual/jutsu"
        topRightContent={
          <JutsuHelper jutsu={form.getValues() as unknown as ZodJutsuType} />
        }
      >
        {!loading && (
          <>
            <p className="mb-4">
              Linked reskins keep their name, descriptions, image, effect visuals and
              visibility. Saving a reskin copies its parent's mechanics and sets its
              rank to H. Future parent edits update all linked reskins automatically.
            </p>
            <EditContent
              schema={JutsuValidatorRawSchema}
              form={form as unknown as UseFormReturn<ZodJutsuType, any>}
              formData={formData}
              showSubmit={props.canSave}
              buttonTxt="Save to Database"
              type="jutsu"
              relationId={jutsu.id}
              allowImageUpload={props.canSave}
              submitLoading={isSaving}
              onAccept={handleJutsuSubmit}
            />
            {updateError && (
              <p role="alert" className="mt-2 text-destructive">
                {updateError}
              </p>
            )}
            <div className="mt-2 flex justify-end">
              <SuggestChange
                entityType="JUTSU"
                entityId={jutsu.id}
                getData={() => form.getValues()}
                label={props.canSave ? "Suggest instead" : "Suggest a change"}
              />
            </div>
          </>
        )}
      </ContentBox>

      <EffectTagListEditor
        type="jutsu"
        allowCoordinateTargeting
        hideTagType={!!reskinParentId}
        editableFields={reskinParentId ? JUTSU_EFFECT_COSMETICS : undefined}
        effects={effects}
        setEffects={setEffects}
        newTag={() =>
          DamageTag.parse({
            description: "placeholder",
            rounds: 0,
            residualModifier: 0,
          })
        }
        tagTitle="Jutsu Tag"
        emptyTitle="Jutsu Tags"
        emptyText="Please add effects to this jutsu"
        lockStructure={!!reskinParentId}
      />
    </>
  );
};
