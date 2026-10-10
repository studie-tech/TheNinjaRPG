"use client";

import { FileMinus, FilePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { use, useEffect } from "react";
import type { UseFormReturn } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import type { Jutsu } from "@/drizzle/schema";
import { useJutsuEditForm } from "@/hooks/jutsu";
import ContentBox from "@/layout/ContentBox";
import { JutsuHelper } from "@/layout/ContentHelp";
import { EditContent, EffectFormWrapper } from "@/layout/EditContent";
import Loader from "@/layout/Loader";
import { SuggestChange } from "@/layout/SuggestChange";
import { JUTSU_EFFECT_COSMETICS } from "@/libs/jutsu/reskins";
import { canChangeContent, isStaffRole } from "@/utils/permissions";
import { setNullsToEmptyStrings } from "@/utils/typeutils";
import { useRequiredUserData } from "@/utils/UserContext";
import type { ZodAllTags, ZodJutsuType } from "@/validators/combat";
import { DamageTag, JutsuValidatorRawSchema, tagTypes } from "@/validators/combat";

export default function JutsuEdit(props: { params: Promise<{ jutsuid: string }> }) {
  const params = use(props.params);
  const jutsuId = params.jutsuid;

  // State
  const router = useRouter();
  const { data: userData } = useRequiredUserData();

  // Queries
  const { data, isPending, isError, isFetching, refetch } = api.jutsu.get.useQuery(
    { id: jutsuId },
    { retry: false, enabled: !!jutsuId },
  );

  // Convert key null values to empty strings, preparing data for form
  setNullsToEmptyStrings(data);

  // Redirect to profile if not staff
  useEffect(() => {
    if (userData && !isStaffRole(userData.role)) {
      void router.push("/profile");
    }
  }, [userData]);

  // Prevent unauthorized access
  if (!userData || !isStaffRole(userData.role)) {
    return <Loader explanation="Loading data" />;
  }

  const queryFeedback = (
    <ContentBox
      title="Content Panel"
      subtitle="Jutsu Management"
      defaultBackHref="/manual/jutsu"
    >
      <p role="alert">
        {isError
          ? data
            ? "Latest jutsu details could not be loaded. The editor is showing previously loaded data."
            : "This jutsu could not be loaded. Please try again."
          : "This jutsu could not be found."}
      </p>
      {isError && (
        <Button disabled={isFetching} onClick={() => void refetch()}>
          {isFetching ? "Retrying..." : "Retry"}
        </Button>
      )}
    </ContentBox>
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
    jutsu,
    effects,
    form,
    formData,
    setEffects,
    handleJutsuSubmit,
    reskinParentId,
    updateError,
  } = useJutsuEditForm(props.jutsu, props.refetch);

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
        subtitle="Jutsu Management"
        defaultBackHref="/manual/jutsu"
        topRightContent={
          <JutsuHelper jutsu={form.getValues() as unknown as ZodJutsuType} />
        }
      >
        {!jutsu && <p>Could not find this jutsu</p>}
        {!loading && jutsu && (
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

      {!reskinParentId && validEffects.length === 0 && (
        <ContentBox
          title={`Jutsu Tags`}
          initialBreak={true}
          topRightContent={<div className="flex flex-row">{AddTagIcon}</div>}
        >
          Please add effects to this jutsu
        </ContentBox>
      )}
      {validEffects.map((tag, i) => {
        return (
          <ContentBox
            key={`${tag.type}-${i}`}
            title={`Jutsu Tag #${i + 1}`}
            subtitle="Control battle effects"
            initialBreak={true}
            topRightContent={
              !reskinParentId ? (
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
              ) : undefined
            }
          >
            <EffectFormWrapper
              idx={i}
              type="jutsu"
              tag={tag}
              availableTags={tagTypes}
              hideTagType={!!reskinParentId}
              editableFields={reskinParentId ? JUTSU_EFFECT_COSMETICS : undefined}
              effects={validEffects}
              setEffects={setEffects}
            />
          </ContentBox>
        );
      })}
    </>
  );
};
