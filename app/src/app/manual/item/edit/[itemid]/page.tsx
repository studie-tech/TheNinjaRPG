"use client";

import { FileMinus, FilePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { use, useEffect } from "react";
import type { UseFormReturn } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import type { CraftingRequirement, Item } from "@/drizzle/schema";
import { useItemEditForm } from "@/hooks/item";
import ChatInputField from "@/layout/ChatInputField";
import ContentBox from "@/layout/ContentBox";
import { ItemHelper } from "@/layout/ContentHelp";
import { EditContent, EffectFormWrapper } from "@/layout/EditContent";
import Loader from "@/layout/Loader";
import { canChangeContent } from "@/utils/permissions";
import { setNullsToEmptyStrings } from "@/utils/typeutils";
import { useRequiredUserData } from "@/utils/UserContext";
import type { ZodAllTags, ZodItemType } from "@/validators/combat";
import {
  DamageTag,
  getTagSchema,
  ItemValidatorRawSchema,
  tagTypes,
} from "@/validators/combat";

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
        subtitle="Item Management"
        defaultBackHref="/manual/item"
        topRightContent={
          formData.find((e) => e.id === "description") ? (
            <div className="flex items-center gap-2">
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
                  const data = toolCall.args as ZodItemType;
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
              <ItemHelper item={form.getValues() as unknown as ZodItemType} />
            </div>
          ) : undefined
        }
      >
        {!item && <p>Could not find this item</p>}
        {item && (
          <EditContent
            schema={ItemValidatorRawSchema}
            form={form as unknown as UseFormReturn<ZodItemType, any>}
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

      {validEffects.length === 0 && (
        <ContentBox
          title={`Item Tags`}
          initialBreak={true}
          topRightContent={<div className="flex flex-row">{AddTagIcon}</div>}
        >
          Please add effects to this item
        </ContentBox>
      )}
      {validEffects.map((tag, i) => {
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
              type="item"
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
