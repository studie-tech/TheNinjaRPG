"use client";

import { MapPin } from "lucide-react";
import { use } from "react";
import { type UseFormReturn, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { useAiEditForm } from "@/hooks/ai";
import { useEditorTitle } from "@/hooks/useEditorTitle";
import { useRequireRole } from "@/hooks/useRequireRole";
import AiProfileEdit from "@/layout/AiProfileEdit";
import { AiSpriteAnimations } from "@/layout/AiSpriteAnimations";
import { AiTransformationEdit } from "@/layout/AiTransformationEdit";
import ContentBox from "@/layout/ContentBox";
import { AiHelper } from "@/layout/ContentHelp";
import { EditContent } from "@/layout/EditContent";
import { EditorQueryFeedback } from "@/layout/EditorQueryFeedback";
import { EffectTagListEditor } from "@/layout/EffectTagListEditor";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import NindoChange from "@/layout/NindoChange";
import { PoolStatusBars } from "@/layout/PoolStatusBars";
import { SuggestChange } from "@/layout/SuggestChange";
import { showMutationToast } from "@/libs/toast";
import type { AiWithRelations } from "@/routers/profile";
import { canChangeContent, isStaffRole } from "@/utils/permissions";
import { type InsertAiSchema, insertAiSchema } from "@/validators/aiInput";
import { WeaknessTag } from "@/validators/combat";

export default function ManualAisEdit(props: { params: Promise<{ aiid: string }> }) {
  const params = use(props.params);
  // State
  const aiId = params.aiid;
  const { userData, hasAccess } = useRequireRole(isStaffRole);

  // Keep fetched values intact: nullable enums must stay null for form validation.
  const { data, isPending, isError, isFetching, refetch } = api.profile.getAi.useQuery(
    { userId: aiId },
    { enabled: aiId !== undefined },
  );

  // Prevent unauthorized access
  if (isPending || !userData || !hasAccess) {
    return <Loader explanation="Loading data" />;
  }
  if (!data) {
    return (
      <EditorQueryFeedback
        label="AI"
        subtitle="AI Management"
        backHref="/manual/ai"
        isError={isError}
        isFetching={isFetching}
        onRetry={refetch}
      />
    );
  }

  return (
    <SingleEditUser
      user={data}
      refetch={refetch}
      canSave={canChangeContent(userData.role)}
    />
  );
}

interface SingleEditUserProps {
  /** Staff who cannot save content still get the editor, to suggest changes. */
  canSave: boolean;
  user: AiWithRelations;
  refetch: () => void;
}

const SingleEditUser: React.FC<SingleEditUserProps> = (props) => {
  // tRPC utility
  const utils = api.useUtils();

  // Form handling
  const {
    loading,
    effects,
    processedUser,
    form,
    formData,
    setEffects,
    handleUserSubmit,
  } = useAiEditForm(props.user);
  const entryName = useWatch({ control: form.control, name: "username" });
  const heading = useEditorTitle("AI", entryName);

  // Mutations
  const { mutate: updateNindo, isPending: isUpdating } =
    api.profile.updateNindo.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.profile.getNindo.invalidate();
        }
      },
    });

  // Show panel controls
  return (
    <>
      <ContentBox
        title={heading}
        subtitle="Stats scale by level; editing a stat reweights the level budget"
        defaultBackHref="/manual/ai"
        topRightContent={
          <div className="flex flex-row gap-1">
            <Button id="ai-placements" hoverText="Overworld Placements" asChild>
              <Link href={`/manual/ai/${processedUser.userId}/placements`}>
                <MapPin className="h-6 w-6" />
              </Link>
            </Button>
            <AiHelper
              ai={{
                userId: processedUser.userId,
                username: processedUser.username,
              }}
            />
          </div>
        }
      >
        {!loading && (
          <>
            <PoolStatusBars pools={processedUser} status={processedUser.status} />
            <EditContent
              guardUnsavedChanges
              schema={insertAiSchema}
              form={form as unknown as UseFormReturn<InsertAiSchema, any>}
              formData={formData}
              showSubmit={props.canSave}
              buttonTxt="Save to Database"
              type="ai"
              relationId={processedUser.userId}
              allowImageUpload={props.canSave}
              onAccept={handleUserSubmit}
            />
            <div className="mt-2 flex justify-end">
              <SuggestChange
                entityType="AI"
                entityId={processedUser.userId}
                getData={() => form.getValues()}
                label={props.canSave ? "Suggest instead" : "Suggest a change"}
              />
            </div>
          </>
        )}
      </ContentBox>

      <EffectTagListEditor
        type="item"
        effects={effects}
        setEffects={setEffects}
        newTag={() =>
          WeaknessTag.parse({ rounds: 100, residualModifier: 0, dmgModifier: 1 })
        }
        tagTitle="AI Tag"
        emptyTitle="AI Tags"
        emptyText="Please add effects to this AI"
      />

      {props.canSave && (
        <>
          <AiProfileEdit userData={props.user} />
          <AiSpriteAnimations userId={processedUser.userId} />
          <AiTransformationEdit
            userId={processedUser.userId}
            username={processedUser.username}
          />
          <ContentBox title="Nindo" subtitle="Edit the AI Nindo" initialBreak>
            {isUpdating && <Loader explanation="Updating..." />}
            {!isUpdating && (
              <NindoChange
                userId={processedUser.userId}
                onChange={(data) =>
                  updateNindo({
                    userId: processedUser.userId,
                    content: data.content,
                  })
                }
              />
            )}
          </ContentBox>
        </>
      )}
    </>
  );
};
