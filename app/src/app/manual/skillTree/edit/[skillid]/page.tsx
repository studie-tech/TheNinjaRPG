"use client";

import { useEffect, use } from "react";
import { useRouter } from "next/navigation";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { EditContent } from "@/layout/EditContent";
import { EffectFormWrapper } from "@/layout/EditContent";
import { SkillTreeHelper } from "@/layout/ContentHelp";
import { FilePlus, FileMinus } from "lucide-react";
import { api } from "@/app/_trpc/client";
import { useRequiredUserData } from "@/utils/UserContext";
import { setNullsToEmptyStrings } from "@/utils/typeutils";
import { SkillTreeValidator, DamageTag, tagTypes } from "@/validators/combat";
import { canChangeContent } from "@/utils/permissions";
import { useSkillTreeEditForm } from "@/hooks/skillTree";
import type { SkillTree } from "@/drizzle/schema";

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Icon for adding tag
  const AddTagIcon = (
    <FilePlus
      className="h-6 w-6 cursor-pointer hover:text-orange-500"
      onClick={() => {
        setEffects([
          ...effects,
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
            <SkillTreeHelper skillTree={form.getValues()} />
          </div>
        }
      >
        {!skillTree && <p>Could not find this skill</p>}
        {!loading && skillTree && (
          <EditContent
            schema={SkillTreeValidator}
            form={form}
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

      {effects.length === 0 && (
        <ContentBox
          title={`Skill Tags`}
          initialBreak={true}
          topRightContent={<div className="flex flex-row">{AddTagIcon}</div>}
        >
          Please add effects to this skill
        </ContentBox>
      )}
      {effects.map((tag, i) => {
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
                    const newEffects = [...effects];
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
              effects={effects}
              setEffects={setEffects}
            />
          </ContentBox>
        );
      })}
    </>
  );
};
