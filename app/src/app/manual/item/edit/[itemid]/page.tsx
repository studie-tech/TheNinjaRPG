"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FileMinus, FilePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import React, { use, useEffect } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Controller, useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MAX_ITEM_VARIANTS, VARIANT_COST_TYPES } from "@/drizzle/constants";
import type { CraftingRequirement, Item } from "@/drizzle/schema";
import { useItemEditForm } from "@/hooks/item";
import ChatInputField from "@/layout/ChatInputField";
import Confirm2 from "@/layout/Confirm2";
import ContentBox from "@/layout/ContentBox";
import { ItemHelper } from "@/layout/ContentHelp";
import ContentImageSelector from "@/layout/ContentImageSelector";
import { EditContent, EffectFormWrapper } from "@/layout/EditContent";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
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
import type { ZodItemVariantType } from "@/validators/item";
import { displayCostType, ItemVariantValidator } from "@/validators/item";

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
        {item && <ItemVariantsEditor itemId={item.id} />}
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

interface ItemVariantsEditorProps {
  itemId: string;
}

type VariantFormInput = {
  id?: string;
  name: string;
  image: string;
  costType: ZodItemVariantType["costType"];
  cost: number | string;
  order: number | string;
  description?: string;
  battleDescription?: string;
};

const ItemVariantsEditor: React.FC<ItemVariantsEditorProps> = ({ itemId }) => {
  const utils = api.useUtils();
  const [editingVariant, setEditingVariant] = React.useState<ZodItemVariantType | null>(
    null,
  );
  const [showForm, setShowForm] = React.useState(false);

  const { data: variants } = api.item.getItemVariants.useQuery({ itemId });

  const upsert = api.item.upsertItemVariant.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      if (result.success) {
        await utils.item.getItemVariants.invalidate({ itemId });
        setShowForm(false);
        setEditingVariant(null);
      }
    },
  });

  const remove = api.item.deleteItemVariant.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      if (result.success) {
        await utils.item.getItemVariants.invalidate({ itemId });
        setEditingVariant(null);
        setShowForm(false);
      }
    },
  });

  const form = useForm<VariantFormInput, unknown, ZodItemVariantType>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(ItemVariantValidator) as any,
    defaultValues: {
      name: "",
      image: "",
      costType: "MONEY",
      cost: 0,
      order: 1,
    },
  });

  useEffect(() => {
    if (editingVariant) {
      form.reset(editingVariant);
    } else {
      form.reset({
        name: "",
        image: "",
        costType: "MONEY",
        cost: 0,
        order: (variants?.length ?? 0) + 1,
        description: "",
        battleDescription: "",
      });
    }
    // variants?.length intentionally omitted: order is computed once at form-open time,
    // not on every background refetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingVariant, form]);

  const imageValue = useWatch({ control: form.control, name: "image" });

  const onSubmit = form.handleSubmit((data) => {
    upsert.mutate({ itemId, variant: data });
  });

  return (
    <div className="mt-6">
      <h2 className="mb-2 font-semibold text-lg">
        Item Variants (max {MAX_ITEM_VARIANTS})
      </h2>

      {variants && variants.length > 0 && (
        <table className="mb-4 w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-1 text-left">Order</th>
              <th className="py-1 text-left">Name</th>
              <th className="py-1 text-left">Cost Type</th>
              <th className="py-1 text-left">Cost</th>
              <th className="py-1 text-left">Preview</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {variants.map((v) => (
              <tr key={v.id} className="border-b">
                <td className="py-1">{v.order}</td>
                <td className="py-1">{v.name}</td>
                <td className="py-1">{displayCostType(v.costType)}</td>
                <td className="py-1">{v.cost}</td>
                <td className="py-1">
                  {v.image && (
                    <Image
                      src={v.image}
                      alt={v.name}
                      width={40}
                      height={40}
                      className="rounded"
                    />
                  )}
                </td>
                <td className="py-1">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingVariant({
                          ...v,
                          description: v.description ?? undefined,
                          battleDescription: v.battleDescription ?? undefined,
                        });
                        setShowForm(true);
                      }}
                    >
                      Edit
                    </Button>
                    <Confirm2
                      title="Delete Variant"
                      button={
                        <Button variant="destructive" size="sm">
                          Delete
                        </Button>
                      }
                      onAccept={() => remove.mutate({ variantId: v.id })}
                    >
                      <p>
                        Delete this variant? Players who have already unlocked it will
                        lose access.
                      </p>
                    </Confirm2>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!showForm && (variants?.length ?? 0) < MAX_ITEM_VARIANTS && (
        <Button
          variant="outline"
          onClick={() => {
            setEditingVariant(null);
            setShowForm(true);
          }}
        >
          + Add Variant
        </Button>
      )}

      {showForm && (
        <form onSubmit={onSubmit} className="mt-2 space-y-3 rounded border p-4">
          <h3 className="font-medium">
            {editingVariant ? "Edit Variant" : "New Variant"}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="variant-name" className="font-medium text-sm">
                Name
              </label>
              <Input
                id="variant-name"
                {...form.register("name")}
                placeholder="e.g. Red Edition"
              />
              {form.formState.errors.name && (
                <p className="mt-1 text-destructive text-xs">
                  {form.formState.errors.name.message}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="variant-order" className="font-medium text-sm">
                Order (1–{MAX_ITEM_VARIANTS})
              </label>
              <Input
                id="variant-order"
                type="number"
                {...form.register("order")}
                min={1}
                max={MAX_ITEM_VARIANTS}
              />
              {form.formState.errors.order && (
                <p className="mt-1 text-destructive text-xs">
                  {form.formState.errors.order.message}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="variant-cost-type" className="font-medium text-sm">
                Cost Type
              </label>
              <Controller
                control={form.control}
                name="costType"
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger id="variant-cost-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VARIANT_COST_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {displayCostType(t)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div>
              <label htmlFor="variant-cost" className="font-medium text-sm">
                Cost
              </label>
              <Input
                id="variant-cost"
                type="number"
                {...form.register("cost")}
                min={0}
              />
              {form.formState.errors.cost && (
                <p className="mt-1 text-destructive text-xs">
                  {form.formState.errors.cost.message}
                </p>
              )}
            </div>
          </div>
          <div>
            <ContentImageSelector
              label="Image"
              imageUrl={imageValue || null}
              id={editingVariant?.id ?? itemId}
              prompt="Item variant image"
              allowImageUpload={true}
              type="item"
              onUploadComplete={(url) => {
                form.setValue("image", url, {
                  shouldDirty: true,
                  shouldValidate: true,
                });
              }}
              size="square"
              maxDim={256}
            />
            {form.formState.errors.image && (
              <p className="mt-1 text-destructive text-xs">
                {form.formState.errors.image.message}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="variant-description" className="font-medium text-sm">
              Description (optional)
            </label>
            <Textarea
              id="variant-description"
              {...form.register("description")}
              placeholder="Flavor text shown in the variant browser"
              rows={3}
            />
          </div>
          <div>
            <label htmlFor="variant-battle-description" className="font-medium text-sm">
              Battle Description (optional)
            </label>
            <Textarea
              id="variant-battle-description"
              {...form.register("battleDescription")}
              placeholder="%user strikes with the Crimson Blade"
              rows={2}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={upsert.isPending}>
              {upsert.isPending ? "Saving..." : "Save Variant"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowForm(false);
                setEditingVariant(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
};
