"use client";

import { FileMinus, FilePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { use, useEffect } from "react";
import type { UseFormReturn } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import type { Bloodline } from "@/drizzle/schema";
import { useBloodlineEditForm } from "@/hooks/bloodline";
import ChatInputField from "@/layout/ChatInputField";
import ContentBox from "@/layout/ContentBox";
import { BloodlineHelper } from "@/layout/ContentHelp";
import { EditContent, EffectFormWrapper } from "@/layout/EditContent";
import Loader from "@/layout/Loader";
import { canChangeContent } from "@/utils/permissions";
import { setNullsToEmptyStrings } from "@/utils/typeutils";
import { useRequiredUserData } from "@/utils/UserContext";
import type { ZodAllTags, ZodBloodlineType } from "@/validators/combat";
import {
  BloodlineValidator,
  DamageTag,
  getTagSchema,
  tagTypes,
} from "@/validators/combat";

export default function BloodlineEdit(props: {
  params: Promise<{ bloodlineid: string }>;
}) {
  const params = use(props.params);
  const router = useRouter();
  const bloodlineId = params.bloodlineid;
  const { data: userData } = useRequiredUserData();

  // Queries
  const { data, isPending, refetch } = api.bloodline.get.useQuery(
    { id: bloodlineId },
    { retry: false, enabled: !!bloodlineId && !!userData },
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

  return <SingleEditBloodline bloodline={data} refetch={refetch} />;
}

interface SingleEditBloodlineProps {
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
        subtitle="Bloodline Management"
        defaultBackHref="/manual/bloodline"
        noRightAlign={true}
        topRightContent={
          <div className="flex flex-row gap-2">
            {formData.find((e) => e.id === "description") ? (
              <ChatInputField
                inputProps={{
                  id: "chatInput",
                  placeholder: "Instruct ChatGPT to edit",
                }}
                aiProps={{
                  apiEndpoint: "/api/chat/bloodline",
                  systemMessage: `
                    Current bloodline data: ${JSON.stringify(form.getValues())}. 
                    Current effects: ${JSON.stringify(effects)}
                  `,
                }}
                onToolCall={(toolCall) => {
                  const data = toolCall.args as ZodBloodlineType;
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
            <BloodlineHelper
              bloodline={form.getValues() as unknown as ZodBloodlineType}
            />
          </div>
        }
      >
        {!bloodline && <p>Could not find this bloodline</p>}
        {!loading && bloodline && (
          <EditContent
            schema={BloodlineValidator}
            form={form as unknown as UseFormReturn<ZodBloodlineType, any>}
            formData={formData}
            showSubmit={true}
            buttonTxt="Save to Database"
            type="bloodline"
            relationId={bloodline.id}
            allowImageUpload={true}
            onAccept={handleBloodlineSubmit}
          />
        )}
      </ContentBox>

      {validEffects.length === 0 && (
        <ContentBox
          title={`Bloodline Tags`}
          initialBreak={true}
          topRightContent={<div className="flex flex-row">{AddTagIcon}</div>}
        >
          Please add effects to this bloodline
        </ContentBox>
      )}
      {validEffects.map((tag, i) => {
        return (
          <ContentBox
            key={`${tag.type}-${i}`}
            title={`Bloodline Tag #${i + 1}`}
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
              type="bloodline"
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
