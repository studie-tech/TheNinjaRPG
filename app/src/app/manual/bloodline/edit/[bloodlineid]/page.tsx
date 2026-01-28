"use client";

import { useEffect, use } from "react";
import { useRouter } from "next/navigation";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import ChatInputField from "@/layout/ChatInputField";
import { api } from "@/app/_trpc/client";
import {
  DamageTag,
  BloodlineValidator,
  getTagSchema,
  tagTypes,
} from "@/validators/combat";
import { EditContent } from "@/layout/EditContent";
import { EffectFormWrapper } from "@/layout/EditContent";
import { BloodlineHelper } from "@/layout/ContentHelp";
import { FilePlus, FileMinus } from "lucide-react";
import { useRequiredUserData } from "@/utils/UserContext";
import { setNullsToEmptyStrings } from "@/utils/typeutils";
import { canChangeContent } from "@/utils/permissions";
import { useBloodlineEditForm } from "@/hooks/bloodline";
import type { ZodBloodlineType } from "@/validators/combat";
import type { Bloodline } from "@/drizzle/schema";

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Icon for adding tag
  const AddTagIcon = (
    <FilePlus
      className="h-6 w-6 cursor-pointer hover:text-orange-500"
      onClick={() => {
        setEffects([
          ...effects,
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
                      continue;
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
            <BloodlineHelper bloodline={form.getValues()} />
          </div>
        }
      >
        {!bloodline && <p>Could not find this bloodline</p>}
        {!loading && bloodline && (
          <EditContent
            schema={BloodlineValidator}
            form={form}
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

      {effects.length === 0 && (
        <ContentBox
          title={`Bloodline Tags`}
          initialBreak={true}
          topRightContent={<div className="flex flex-row">{AddTagIcon}</div>}
        >
          Please add effects to this bloodline
        </ContentBox>
      )}
      {effects.map((tag, i) => {
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
              type="bloodline"
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
