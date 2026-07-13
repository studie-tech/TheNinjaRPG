"use client";

import { FileMinus, FilePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { use, useEffect, useMemo } from "react";
import { api } from "@/app/_trpc/client";
import type { SageMode } from "@/drizzle/schema";
import { useSageModeEditForm } from "@/hooks/sageMode";
import ContentBox from "@/layout/ContentBox";
import { EditContent, EffectFormWrapper } from "@/layout/EditContent";
import Loader from "@/layout/Loader";
import { canChangeContent } from "@/utils/permissions";
import { setNullsToEmptyStrings } from "@/utils/typeutils";
import { useRequiredUserData } from "@/utils/UserContext";
import { DamageTag, SageModeValidator, tagTypes } from "@/validators/combat";

export default function SageModeEdit(props: {
  params: Promise<{ sagemodeid: string }>;
}) {
  const params = use(props.params);
  const router = useRouter();
  const sageModeId = params.sagemodeid;
  const { data: userData } = useRequiredUserData();

  const { data, isPending, refetch } = api.sageMode.get.useQuery(
    { id: sageModeId },
    { retry: false, enabled: !!sageModeId && !!userData },
  );

  const normalizedData = useMemo(() => {
    if (!data) return null;
    const copy: SageMode = {
      ...data,
      effects: [...data.effects],
      afterEffects: [...data.afterEffects],
      level2Effects: [...data.level2Effects],
    };
    setNullsToEmptyStrings(copy as unknown as Record<string, unknown>);
    return copy;
  }, [data]);

  useEffect(() => {
    if (userData && !canChangeContent(userData.role)) {
      void router.push("/profile");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData]);

  if (isPending || !userData || !canChangeContent(userData.role) || !normalizedData) {
    return <Loader explanation="Loading data" />;
  }

  return <SingleEditSageMode sageMode={normalizedData} refetch={refetch} />;
}

interface SingleEditSageModeProps {
  sageMode: SageMode;
  refetch: () => void;
}

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

  const addEffect = () => {
    setEffects([
      ...effects,
      DamageTag.parse({
        description: "placeholder",
        residualModifier: 0,
      }),
    ]);
  };

  const removeEffect = (i: number) => {
    const newEffects = [...effects];
    newEffects.splice(i, 1);
    setEffects(newEffects);
  };

  const addAfterEffect = () => {
    setAfterEffects([
      ...afterEffects,
      DamageTag.parse({
        description: "placeholder",
        residualModifier: 0,
      }),
    ]);
  };

  const removeAfterEffect = (i: number) => {
    const newEffects = [...afterEffects];
    newEffects.splice(i, 1);
    setAfterEffects(newEffects);
  };

  const addLevel2Effect = () => {
    setLevel2Effects([
      ...level2Effects,
      DamageTag.parse({
        description: "placeholder",
        residualModifier: 0,
      }),
    ]);
  };

  const removeLevel2Effect = (i: number) => {
    const newEffects = [...level2Effects];
    newEffects.splice(i, 1);
    setLevel2Effects(newEffects);
  };

  return (
    <>
      <ContentBox
        title="Content Panel"
        subtitle="Sage Mode Management"
        defaultBackHref="/manual/sageMode"
        noRightAlign={true}
      >
        {!sageMode && <p>Could not find this sage mode</p>}
        {!loading && sageMode && (
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
      {effects.length === 0 && (
        <ContentBox
          title="Active Effects"
          subtitle="Effects while Sage Mode is active"
          initialBreak={true}
          topRightContent={
            <div className="flex flex-row">
              <FilePlus
                className="h-6 w-6 cursor-pointer hover:text-orange-500"
                onClick={addEffect}
              />
            </div>
          }
        >
          Please add active effects to this sage mode
        </ContentBox>
      )}
      {effects.map((tag, i) => (
        <ContentBox
          key={`effect-${tag.type}-${i}`}
          title={`Active Effect #${i + 1}`}
          subtitle="Effect while sage mode is active"
          initialBreak={true}
          topRightContent={
            <div className="flex flex-row">
              <FilePlus
                className="h-6 w-6 cursor-pointer hover:text-orange-500"
                onClick={addEffect}
              />
              <FileMinus
                className="h-6 w-6 cursor-pointer hover:text-orange-500"
                onClick={() => removeEffect(i)}
              />
            </div>
          }
        >
          <EffectFormWrapper
            idx={i}
            type="sageMode"
            tag={tag}
            availableTags={tagTypes}
            effects={effects}
            setEffects={setEffects}
          />
        </ContentBox>
      ))}

      {/* After Effects (Exhaustion) */}
      {afterEffects.length === 0 && (
        <ContentBox
          title="After Effects (Exhaustion)"
          subtitle="Effects applied after Sage Mode expires"
          initialBreak={true}
          topRightContent={
            <div className="flex flex-row">
              <FilePlus
                className="h-6 w-6 cursor-pointer hover:text-orange-500"
                onClick={addAfterEffect}
              />
            </div>
          }
        >
          Please add after-effects (exhaustion debuffs) to this sage mode
        </ContentBox>
      )}
      {afterEffects.map((tag, i) => (
        <ContentBox
          key={`aftereffect-${tag.type}-${i}`}
          title={`After Effect #${i + 1}`}
          subtitle="Exhaustion effect after sage mode expires"
          initialBreak={true}
          topRightContent={
            <div className="flex flex-row">
              <FilePlus
                className="h-6 w-6 cursor-pointer hover:text-orange-500"
                onClick={addAfterEffect}
              />
              <FileMinus
                className="h-6 w-6 cursor-pointer hover:text-orange-500"
                onClick={() => removeAfterEffect(i)}
              />
            </div>
          }
        >
          <EffectFormWrapper
            idx={i}
            type="sageMode"
            tag={tag}
            availableTags={tagTypes}
            effects={afterEffects}
            setEffects={setAfterEffects}
          />
        </ContentBox>
      ))}

      {/* Level 2 Effects */}
      {level2Effects.length === 0 && (
        <ContentBox
          title="Level 2 Effects"
          subtitle="Extra effects that apply only at sage level 2"
          initialBreak={true}
          topRightContent={
            <div className="flex flex-row">
              <FilePlus
                className="h-6 w-6 cursor-pointer hover:text-orange-500"
                onClick={addLevel2Effect}
              />
            </div>
          }
        >
          Add level 2 effects (applied additionally when the user reaches sage level 2)
        </ContentBox>
      )}
      {level2Effects.map((tag, i) => (
        <ContentBox
          key={`level2effect-${tag.type}-${i}`}
          title={`Level 2 Effect #${i + 1}`}
          subtitle="Effect applied additionally at sage level 2"
          initialBreak={true}
          topRightContent={
            <div className="flex flex-row">
              <FilePlus
                className="h-6 w-6 cursor-pointer hover:text-orange-500"
                onClick={addLevel2Effect}
              />
              <FileMinus
                className="h-6 w-6 cursor-pointer hover:text-orange-500"
                onClick={() => removeLevel2Effect(i)}
              />
            </div>
          }
        >
          <EffectFormWrapper
            idx={i}
            type="sageMode"
            tag={tag}
            availableTags={tagTypes}
            effects={level2Effects}
            setEffects={setLevel2Effects}
          />
        </ContentBox>
      ))}
    </>
  );
};
