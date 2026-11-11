"use client";

import { use } from "react";
import { type UseFormReturn, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import type { SkillTree } from "@/drizzle/schema";
import { useSkillTreeEditForm } from "@/hooks/skillTree";
import { useEditorTitle } from "@/hooks/useEditorTitle";
import { useRequireRole } from "@/hooks/useRequireRole";
import ContentBox from "@/layout/ContentBox";
import { SkillTreeHelper } from "@/layout/ContentHelp";
import { EditContent } from "@/layout/EditContent";
import { EffectTagListEditor } from "@/layout/EffectTagListEditor";
import Loader from "@/layout/Loader";
import { canAccessHiddenSkillTree, canChangeContent } from "@/utils/permissions";
import { setNullsToEmptyStrings } from "@/utils/typeutils";
import {
  DamageTag,
  SkillTreeValidator,
  type ZodSkillTreeType,
} from "@/validators/combat";

export default function SkillTreeEdit(props: { params: Promise<{ skillid: string }> }) {
  const params = use(props.params);
  const skillId = params.skillid;
  const { userData, hasAccess } = useRequireRole(canChangeContent);

  // Queries
  const { data, isPending, isError, refetch } = api.skillTree.get.useQuery(
    { id: skillId },
    { retry: false, enabled: !!skillId && !!userData },
  );

  // Convert key null values to empty strings, preparing data for form
  setNullsToEmptyStrings(data);

  // Prevent unauthorized access
  if (isPending || !userData || !hasAccess) {
    return <Loader explanation="Loading data" />;
  }

  // get returns nothing for a hidden skill this role cannot read, and for a missing id.
  if (!data) {
    return (
      <ContentBox
        title="Edit skill"
        subtitle="Skill Tree Management"
        defaultBackHref="/manual/skillTree"
      >
        <p role="alert">
          {isError
            ? "Could not load this skill."
            : canAccessHiddenSkillTree(userData.role)
              ? "This skill does not exist."
              : "You are not authorized to view this skill."}
        </p>
      </ContentBox>
    );
  }

  return <SingleEditSkillTree skillTree={data} refetch={refetch} />;
}

interface SingleEditSkillTreeProps {
  skillTree: SkillTree;
  refetch: () => void;
}

const SingleEditSkillTree: React.FC<SingleEditSkillTreeProps> = (props) => {
  // Form handling
  const {
    loading,
    skillTree,
    effects,
    form,
    formData,
    setEffects,
    handleSkillTreeSubmit,
  } = useSkillTreeEditForm(props.skillTree, props.refetch);
  const entryName = useWatch({ control: form.control, name: "name" });
  const heading = useEditorTitle("skill", entryName);

  // Show panel controls
  return (
    <>
      <ContentBox
        title={heading}
        subtitle={
          skillTree.pathType === "BLOODRIGHT"
            ? "Bloodright Management"
            : "Skill Tree Management"
        }
        defaultBackHref={
          skillTree.pathType === "BLOODRIGHT"
            ? "/manual/bloodright"
            : "/manual/skillTree"
        }
        topRightContent={
          <div className="flex justify-end">
            <SkillTreeHelper
              skillTree={form.getValues() as unknown as ZodSkillTreeType}
            />
          </div>
        }
      >
        {!loading && (
          <EditContent
            schema={SkillTreeValidator}
            form={form as unknown as UseFormReturn<ZodSkillTreeType, any>}
            formData={formData}
            showSubmit={true}
            buttonTxt="Save to Database"
            type="skillTree"
            relationId={skillTree.id}
            allowImageUpload={true}
            onAccept={handleSkillTreeSubmit}
          />
        )}
      </ContentBox>

      <EffectTagListEditor
        allowActivityBonuses={skillTree.pathType === "SKILL"}
        type="skillTree"
        effects={effects}
        setEffects={setEffects}
        newTag={() =>
          DamageTag.parse({
            description: "placeholder",
            rounds: 0,
            residualModifier: 0,
          })
        }
        tagTitle="Skill Tag"
        emptyTitle="Skill Tags"
        emptyText="Please add effects to this skill"
      />
    </>
  );
};
