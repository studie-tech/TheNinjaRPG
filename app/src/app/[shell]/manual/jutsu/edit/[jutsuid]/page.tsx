"use client";

import { FileMinus, FilePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { use, useEffect } from "react";
import type { UseFormReturn } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import type { Jutsu } from "@/drizzle/schema";
import { useJutsuEditForm } from "@/hooks/jutsu";
import ChatInputField from "@/layout/ChatInputField";
import ContentBox from "@/layout/ContentBox";
import { JutsuHelper } from "@/layout/ContentHelp";
import { EditContent, EffectFormWrapper } from "@/layout/EditContent";
import Loader from "@/layout/Loader";
import { SuggestChange } from "@/layout/SuggestChange";
import { canChangeContent, isStaffRole } from "@/utils/permissions";
import { setNullsToEmptyStrings } from "@/utils/typeutils";
import { useRequiredUserData } from "@/utils/UserContext";
import type { ZodAllTags, ZodJutsuType } from "@/validators/combat";
import {
  DamageTag,
  getTagSchema,
  JutsuValidatorRawSchema,
  tagTypes,
} from "@/validators/combat";

export default function JutsuEdit(props: { params: Promise<{ jutsuid: string }> }) {
  const params = use(props.params);
  const jutsuId = params.jutsuid;

  // State
  const router = useRouter();
  const { data: userData } = useRequiredUserData();

  // Queries
  const { data, isPending, refetch } = api.jutsu.get.useQuery(
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
  if (isPending || !userData || !isStaffRole(userData.role) || !data) {
    return <Loader explanation="Loading data" />;
  }

  return (
    <SingleEditJutsu
      jutsu={data}
      refetch={refetch}
      canSave={canChangeContent(userData.role)}
    />
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
  const { loading, jutsu, effects, form, formData, setEffects, handleJutsuSubmit } =
    useJutsuEditForm(props.jutsu, props.refetch);

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
          <div className="flex flex-row gap-2">
            {formData.find((e) => e.id === "description") ? (
              <ChatInputField
                inputProps={{
                  id: "chatInput",
                  placeholder: "Instruct ChatGPT to edit",
                }}
                aiProps={{
                  apiEndpoint: "/api/chat/jutsu",
                  systemMessage: `
                  Current jutsu data: ${JSON.stringify(form.getValues())}. 
                  Current effects: ${JSON.stringify(effects)}
                `,
                }}
                onToolCall={(toolCall) => {
                  const data = toolCall.args as ZodJutsuType;
                  let key: keyof typeof data;
                  for (key in data) {
                    if (["villageId", "image"].includes(key)) {
                    } else if (key === "effects") {
                      const newEffects = data.effects
                        .map((effect) => {
                          const schema = getTagSchema(effect.type);
                          const parsed = schema.safeParse(effect);
                          if (parsed.success) {
                            return parsed.data;
                          } else {
                            return undefined;
                          }
                        })
                        .filter((e): e is NonNullable<typeof e> => e !== undefined);
                      setEffects(newEffects);
                    } else {
                      form.setValue(key, data[key]);
                    }
                  }
                  void form.trigger();
                }}
              />
            ) : undefined}
            <JutsuHelper jutsu={form.getValues() as unknown as ZodJutsuType} />
          </div>
        }
      >
        {!jutsu && <p>Could not find this jutsu</p>}
        {!loading && jutsu && (
          <>
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
            <p className="mt-2 text-muted-foreground text-sm">
              Element Classification controls eligibility and Potency matching. Any
              selected element qualifies; leave empty for unrestricted use. Each combat
              tag keeps its own elemental behavior and targeting.
            </p>
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

      {validEffects.length === 0 && (
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
              type="jutsu"
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
