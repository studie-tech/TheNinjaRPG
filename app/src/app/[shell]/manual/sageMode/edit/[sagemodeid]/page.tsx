"use client";

import { use, useMemo } from "react";
import { useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import type { SageMode } from "@/drizzle/schema";
import { useSageModeEditForm } from "@/hooks/sageMode";
import { useEditorTitle } from "@/hooks/useEditorTitle";
import { useRequireRole } from "@/hooks/useRequireRole";
import ContentBox from "@/layout/ContentBox";
import { EditContent } from "@/layout/EditContent";
import { EditorQueryFeedback } from "@/layout/EditorQueryFeedback";
import { EffectTagListEditor } from "@/layout/EffectTagListEditor";
import Loader from "@/layout/Loader";
import { canChangeContent } from "@/utils/permissions";
import { setNullsToEmptyStrings } from "@/utils/typeutils";
import { DamageTag, SageModeValidator } from "@/validators/combat";

/** Staff editor route for one `SageMode` catalog row. */
export default function SageModeEdit(props: {
  params: Promise<{ sagemodeid: string }>;
}) {
  const params = use(props.params);
  const sageModeId = params.sagemodeid;
  const { userData, hasAccess } = useRequireRole(canChangeContent);

  const { data, isPending, isError, isFetching, refetch } = api.sageMode.get.useQuery(
    { id: sageModeId },
    { retry: false, enabled: !!sageModeId && !!userData },
  );

  const normalizedData = useMemo(() => {
    if (!data) return null;
    const copy = { ...data };
    setNullsToEmptyStrings(copy);
    return copy;
  }, [data]);

  if (isPending || !userData || !hasAccess) {
    return <Loader explanation="Loading data" />;
  }
  if (!normalizedData) {
    return (
      <EditorQueryFeedback
        label="sage mode"
        subtitle="Sage Mode Management"
        backHref="/manual/sageMode"
        isError={isError}
        isFetching={isFetching}
        onRetry={refetch}
      />
    );
  }

  return <SingleEditSageMode sageMode={normalizedData} refetch={refetch} />;
}

interface SingleEditSageModeProps {
  sageMode: SageMode;
  refetch: () => void;
}

/** Form + the three effect panels (active, after, level 2) for one catalog row. */
const SingleEditSageMode: React.FC<SingleEditSageModeProps> = (props) => {
  const {
    loading,
    sageMode,
    effects,
    afterEffects,
    level2Effects,
    form,
    formData,
    setEffects,
    setAfterEffects,
    setLevel2Effects,
    handleSageModeSubmit,
  } = useSageModeEditForm(props.sageMode, props.refetch);
  const entryName = useWatch({ control: form.control, name: "name" });
  const heading = useEditorTitle("sage mode", entryName);

  return (
    <>
      <ContentBox
        title={heading}
        subtitle="Sage Mode Management"
        defaultBackHref="/manual/sageMode"
      >
        {!loading && (
          <EditContent
            schema={SageModeValidator}
            form={form}
            formData={formData}
            showSubmit={true}
            buttonTxt="Save to Database"
            type="sageMode"
            relationId={sageMode.id}
            allowImageUpload={true}
            onAccept={handleSageModeSubmit}
          />
        )}
      </ContentBox>

      {/* Active Effects */}
      <EffectTagListEditor
        type="sageMode"
        effects={effects}
        setEffects={setEffects}
        newTag={newEffectTag}
        tagTitle="Active Effect"
        tagSubtitle="Effect while sage mode is active"
        emptyTitle="Active Effects"
        emptySubtitle="Effects while Sage Mode is active"
        emptyText="Please add active effects to this sage mode"
      />

      {/* After Effects (Exhaustion) */}
      <EffectTagListEditor
        type="sageMode"
        effects={afterEffects}
        setEffects={setAfterEffects}
        newTag={newEffectTag}
        tagTitle="After Effect"
        tagSubtitle="Exhaustion effect after sage mode expires"
        emptyTitle="After Effects (Exhaustion)"
        emptySubtitle="Effects applied after Sage Mode expires"
        emptyText="Please add after-effects (exhaustion debuffs) to this sage mode"
      />

      {/* Level 2 Effects */}
      <EffectTagListEditor
        type="sageMode"
        effects={level2Effects}
        setEffects={setLevel2Effects}
        newTag={newEffectTag}
        tagTitle="Level 2 Effect"
        tagSubtitle="Effect applied additionally at sage level 2"
        emptyTitle="Level 2 Effects"
        emptySubtitle="Extra effects that apply only at sage level 2"
        emptyText="Add level 2 effects (applied additionally when the user reaches sage level 2)"
      />
    </>
  );
};

/** Placeholder damage tag appended by every sage mode effect list. */
const newEffectTag = () =>
  DamageTag.parse({ description: "placeholder", residualModifier: 0 });
