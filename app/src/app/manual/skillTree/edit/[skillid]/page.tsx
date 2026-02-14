"use client";

import { FileMinus, FilePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { use, useEffect } from "react";
import type { UseFormReturn } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import type { SkillTree } from "@/drizzle/schema";
import { useSkillTreeEditForm } from "@/hooks/skillTree";
import ContentBox from "@/layout/ContentBox";
import { SkillTreeHelper } from "@/layout/ContentHelp";
import { EditContent, EffectFormWrapper } from "@/layout/EditContent";
import Loader from "@/layout/Loader";
import { canChangeContent } from "@/utils/permissions";
import { setNullsToEmptyStrings } from "@/utils/typeutils";
import { useRequiredUserData } from "@/utils/UserContext";
import {
  DamageTag,
  SkillTreeValidator,
  tagTypes,
  type ZodAllTags,
  type ZodSkillTreeType,
} from "@/validators/combat";

export default function SkillTreeEdit(props: { params: Promise<{ skillid: string }> }) {
  const params = use(props.params);
  const router = useRouter();
  const skillId = params.skillid;
  const { data: userData } = useRequiredUserData();

  // Queries
  const { data, isPending, refetch } = api.skillTree.get.useQuery(
    { id: skillId },
    { retry: false, enabled: !!skillId && !!userData },
  );

  // Convert key null values to empty strings, preparing data for form
  setNullsToEmptyStrings(data);

  // Redirect to profile if not content or admin
  useEffect(() => {
    if (userData && !canChangeContent(userData.role)) {
      void router.push("/profile");
    }
  }, [userData]);

  // Prevent unauthorized access
  if (isPending || !userData || !canChangeContent(userData.role) || !data) {
    return <Loader explanation="Loading data" />;
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

  // Filter out any undefined effects from useWatch
  const validEffects = (effects?.filter((e): e is ZodAllTags => e !== undefined) ??
    []) as ZodAllTags[];

  // Icon for adding tag
  const AddTagIcon = (
    <FilePlus
      className="h-6 w-6 cursor-pointer hover:text-orange-500"
      onClick={() => {
        setEffects([
          ...validEffects,
          DamageTag.parse({
            description: "placeholder",
            rounds: 0,
            residualModifier: 0,
          }),
        ]);
      }}
    />
  );

  // Show panel controls
  return (
    <>
      <ContentBox
        title="Content Panel"
        subtitle="Skill Tree Management"
        defaultBackHref="/manual/skillTree"
        noRightAlign={true}
        topRightContent={
          <div className="flex justify-end">
            <SkillTreeHelper
              skillTree={form.getValues() as unknown as ZodSkillTreeType}
            />
          </div>
        }
      >
        {!skillTree && <p>Could not find this skill</p>}
        {!loading && skillTree && (
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

      {validEffects.length === 0 && (
        <ContentBox
          title={`Skill Tags`}
          initialBreak={true}
          topRightContent={<div className="flex flex-row">{AddTagIcon}</div>}
        >
          Please add effects to this skill
        </ContentBox>
      )}
      {validEffects.map((tag, i) => {
        return (
          <ContentBox
            key={`${tag.type}-${i}`}
            title={`Skill Tag #${i + 1}`}
            subtitle="Control battle effects"
            initialBreak={true}
            topRightContent={
              <div className="flex flex-row">
                {AddTagIcon}
                <FileMinus
                  className="h-6 w-6 cursor-pointer hover:text-orange-500"
                  onClick={() => {
                    const newEffects = [...validEffects];
                    newEffects.splice(i, 1);
                    setEffects(newEffects);
                  }}
                />
              </div>
            }
          >
            <EffectFormWrapper
              idx={i}
              type="skillTree"
              tag={tag}
              availableTags={tagTypes}
              effects={validEffects}
              setEffects={setEffects}
            />
          </ContentBox>
        );
      })}
    </>
  );
};
