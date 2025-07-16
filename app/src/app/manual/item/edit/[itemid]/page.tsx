"use client";

import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import ChatInputField from "@/layout/ChatInputField";
import { ItemHelper } from "@/layout/ContentHelp";
import { api } from "@/app/_trpc/client";
import { useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { EditContent } from "@/layout/EditContent";
import { EffectFormWrapper } from "@/layout/EditContent";
import { FilePlus, FileMinus } from "lucide-react";
import { useRequiredUserData } from "@/utils/UserContext";
import { setNullsToEmptyStrings } from "@/utils/typeutils";
import { DamageTag } from "@/libs/combat/types";
import { ItemValidator } from "@/libs/combat/types";
import { canChangeContent } from "@/utils/permissions";
import { tagTypes } from "@/libs/combat/types";
import { useItemEditForm } from "@/hooks/item";
import { getTagSchema } from "@/libs/combat/types";
import type { CraftingRequirement } from "@/drizzle/schema";
import type { ZodItemType } from "@/libs/combat/types";
import type { Item } from "@/drizzle/schema";

export default function ItemEdit(props: { params: Promise<{ itemid: string }> }) {
  const params = use(props.params);
  const router = useRouter();
  const itemId = params.itemid;
  const { data: userData } = useRequiredUserData();

  // Queries
  const { data, isPending, refetch } =
    api.item.getItemWithCraftingRequirements.useQuery(
      { id: itemId },
      { enabled: !!itemId },
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

  return <SingleEditItem item={data} refetch={refetch} />;
}

interface SingleEditItemProps {
  item: Item & { craftingRequirements: CraftingRequirement[] };
  refetch: () => void;
}

const SingleEditItem: React.FC<SingleEditItemProps> = (props) => {
  // Form handling
  const { item, effects, form, formData, setEffects, handleItemSubmit } =
    useItemEditForm(props.item, props.refetch);

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
        subtitle="Item Management"
        back_href="/manual/item"
        topRightContent={
          formData.find((e) => e.id === "description") ? (
            <div className="flex gap-2 items-center">
              <ChatInputField
                inputProps={{
                  id: "chatInput",
                  placeholder: "Instruct ChatGPT to edit",
                }}
                aiProps={{
                  apiEndpoint: "/api/chat/item",
                  systemMessage: `
                    Current item data: ${JSON.stringify(form.getValues())}. 
                    Current effects: ${JSON.stringify(effects)}
                  `,
                }}
                onToolCall={(toolCall) => {
                  console.log("TOOL CALL", toolCall);
                  const data = toolCall.args as ZodItemType;
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
              <ItemHelper item={form.getValues()} />
            </div>
          ) : undefined
        }
      >
        {!item && <p>Could not find this item</p>}
        {item && (
          <EditContent
            schema={ItemValidator._def.schema._def.schema}
            form={form}
            formData={formData}
            showSubmit={true}
            buttonTxt="Save to Database"
            type="item"
            relationId={item.id}
            allowImageUpload={true}
            onAccept={handleItemSubmit}
          />
        )}
      </ContentBox>

      {effects.length === 0 && (
        <ContentBox
          title={`Item Tags`}
          initialBreak={true}
          topRightContent={<div className="flex flex-row">{AddTagIcon}</div>}
        >
          Please add effects to this item
        </ContentBox>
      )}
      {effects.map((tag, i) => {
        return (
          <ContentBox
            key={`${tag.type}-${i}`}
            title={`Item Tag #${i + 1}`}
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
              type="item"
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
