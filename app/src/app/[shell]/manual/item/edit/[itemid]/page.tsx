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
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_ITEM_VARIANTS,
  NonActionItemTypes,
  VARIANT_COST_TYPES,
} from "@/drizzle/constants";
import type { CraftingRequirement, Item } from "@/drizzle/schema";
import { useItemEditForm } from "@/hooks/item";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import { ItemHelper } from "@/layout/ContentHelp";
import ContentImageSelector from "@/layout/ContentImageSelector";
import { EditContent, EffectFormWrapper } from "@/layout/EditContent";
import { FurnitureViewsEditor } from "@/layout/FurnitureViewsEditor";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import { SuggestChange } from "@/layout/SuggestChange";
import { showFormErrorsToast, showMutationToast } from "@/libs/toast";
import { canChangeContent, isStaffRole } from "@/utils/permissions";
import { setNullsToEmptyStrings } from "@/utils/typeutils";
import { useRequiredUserData } from "@/utils/UserContext";
import type { ZodAllTags, ZodItemType } from "@/validators/combat";
import { DamageTag, ItemValidatorRawSchema, tagTypes } from "@/validators/combat";
import type { ZodItemVariantType } from "@/validators/item";
import { displayCostType, ItemVariantValidator } from "@/validators/item";
import {
  DEFAULT_FURNITURE_DATA,
  type FurnitureData,
  type FurnitureVariantData,
  type FurnitureViews,
  furnitureGeometrySchema,
} from "@/validators/itemFurniture";

/** Staff item editor with type-specific configuration and validated effects. */
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
    <SingleEditItem
      item={data}
      refetch={refetch}
      canSave={canChangeContent(userData.role)}
    />
  );
}

interface SingleEditItemProps {
  /** Staff who cannot save content still get the editor, to suggest changes. */
  canSave: boolean;
  item: Item & { craftingRequirements: CraftingRequirement[] };
  refetch: () => Promise<unknown>;
}

const SingleEditItem: React.FC<SingleEditItemProps> = (props) => {
  // Form handling
  const { item, effects, form, formData, setEffects, handleItemSubmit, isUpdating } =
    useItemEditForm(props.item, props.refetch);

  const itemType = useWatch({ control: form.control, name: "itemType" });
  const isFurniture = itemType === "FURNITURE";
  const furnitureImage = useWatch({ control: form.control, name: "image" });
  const furnitureData = useWatch({ control: form.control, name: "furnitureData" });
  const [isFurnitureMeasuring, setIsFurnitureMeasuring] = React.useState(false);
  const itemName = useWatch({ control: form.control, name: "name" });
  const itemDescription = useWatch({ control: form.control, name: "description" });

  // Filter out any undefined effects from useWatch
  const validEffects = (effects?.filter((e): e is ZodAllTags => e !== undefined) ??
    []) as ZodAllTags[];

  // Icon for adding tag
  const AddTagIcon = (
    <FilePlus
      className={`h-6 w-6 ${isUpdating ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:text-orange-500"}`}
      aria-disabled={isUpdating}
      onClick={() => {
        if (isUpdating) return;
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
          <ItemHelper item={form.getValues() as unknown as ZodItemType} />
        }
      >
        {!item && <p>Could not find this item</p>}
        {item && (
          <>
            <EditContent
              schema={ItemValidatorRawSchema}
              form={form as unknown as UseFormReturn<ZodItemType, any>}
              formData={formData}
              showSubmit={props.canSave}
              buttonTxt="Save to Database"
              type="item"
              relationId={item.id}
              allowImageUpload={props.canSave}
              onAccept={async (values) => {
                if (!isFurnitureMeasuring) await handleItemSubmit(values);
              }}
              submitLoading={isUpdating || isFurnitureMeasuring}
              submitLoadingText={
                isFurnitureMeasuring ? "Measuring furniture" : "Saving"
              }
            />
            {isFurniture && (
              <Controller
                control={form.control}
                name="furnitureData.views"
                render={({ field }) => (
                  <FurnitureViewsEditor
                    id={item.id}
                    name={itemName}
                    description={itemDescription}
                    image={furnitureImage || ""}
                    width={Number(furnitureData?.width ?? DEFAULT_FURNITURE_DATA.width)}
                    groundAnchor={Number(
                      furnitureData?.groundAnchor ??
                        DEFAULT_FURNITURE_DATA.groundAnchor,
                    )}
                    geometry={
                      furnitureGeometrySchema.safeParse(furnitureData?.geometry).data
                    }
                    useFullFootprint={
                      Boolean(furnitureData?.isFloor) ||
                      furnitureData?.action === "sleep"
                    }
                    views={(field.value ?? {}) as FurnitureViews}
                    onViewsChange={field.onChange}
                    onMeasurementPendingChange={setIsFurnitureMeasuring}
                    onBaseChange={(change) => {
                      if (change.image !== undefined)
                        form.setValue("image", change.image, {
                          shouldDirty: true,
                          shouldValidate: true,
                        });
                      const { image: _image, ...framing } = change;
                      if (Object.keys(framing).length > 0)
                        form.setValue(
                          "furnitureData",
                          { ...form.getValues("furnitureData"), ...framing },
                          { shouldDirty: true, shouldValidate: true },
                        );
                    }}
                    canEdit={props.canSave}
                    disabled={isUpdating}
                  />
                )}
              />
            )}
            <div className="mt-2 flex justify-end">
              <SuggestChange
                entityType="ITEM"
                entityId={item.id}
                getData={() => form.getValues()}
                label={props.canSave ? "Suggest instead" : "Suggest a change"}
              />
            </div>
          </>
        )}
        {item && props.canSave && (
          <ItemVariantsEditor
            itemId={item.id}
            furnitureData={
              isFurniture
                ? {
                    width: Number(furnitureData?.width ?? DEFAULT_FURNITURE_DATA.width),
                    groundAnchor: Number(
                      furnitureData?.groundAnchor ??
                        DEFAULT_FURNITURE_DATA.groundAnchor,
                    ),
                    isFloor: Boolean(furnitureData?.isFloor),
                    action: furnitureData?.action || null,
                  }
                : null
            }
          />
        )}
      </ContentBox>

      {!isFurniture && validEffects.length === 0 && (
        <ContentBox
          title={`Item Tags`}
          initialBreak={true}
          topRightContent={<div className="flex flex-row">{AddTagIcon}</div>}
        >
          Please add effects to this item
        </ContentBox>
      )}
      {!isFurniture &&
        validEffects.map((tag, i) => {
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
                    className={`h-6 w-6 ${isUpdating ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:text-orange-500"}`}
                    aria-disabled={isUpdating}
                    onClick={() => {
                      if (isUpdating) return;
                      const newEffects = [...validEffects];
                      newEffects.splice(i, 1);
                      setEffects(newEffects);
                    }}
                  />
                </div>
              }
            >
              <EffectFormWrapper
                allowJutsuSlotGrants={itemType === "CONSUMABLE"}
                allowActivityBonuses={[
                  "ARMOR",
                  "ACCESSORY",
                  "KEYSTONE",
                  "CRYSTAL",
                ].includes(itemType)}
                idx={i}
                type="item"
                allowCoordinateTargeting={
                  !NonActionItemTypes.includes(
                    itemType as (typeof NonActionItemTypes)[number],
                  )
                }
                tag={tag}
                availableTags={tagTypes}
                effects={validEffects}
                setEffects={setEffects}
                submitLoading={isUpdating}
              />
            </ContentBox>
          );
        })}
    </>
  );
};

interface ItemVariantsEditorProps {
  itemId: string;
  furnitureData?: Pick<
    FurnitureData,
    "width" | "groundAnchor" | "isFloor" | "action"
  > | null;
}

type VariantFormInput = {
  id?: string;
  name: string;
  image: string;
  requiredItemId?: string | null;
  costType: ZodItemVariantType["costType"];
  cost: number | string;
  order: number | string;
  description?: string;
  battleDescription?: string;
  furnitureData?: FurnitureVariantData | null;
};

const ItemVariantsEditor: React.FC<ItemVariantsEditorProps> = ({
  itemId,
  furnitureData,
}) => {
  const isFurniture = Boolean(furnitureData);
  const utils = api.useUtils();
  const [editingVariant, setEditingVariant] = React.useState<ZodItemVariantType | null>(
    null,
  );
  const [showForm, setShowForm] = React.useState(false);
  const deletingVariantIdsRef = React.useRef<Set<string>>(new Set());
  const [deletingVariantIds, setDeletingVariantIds] = React.useState<
    ReadonlySet<string>
  >(() => new Set());
  const variantOperationInFlightRef = React.useRef(false);
  const [variantOperationPending, setVariantOperationPending] = React.useState(false);
  const [isFurnitureMeasuring, setIsFurnitureMeasuring] = React.useState(false);

  const setVariantDeleting = (variantId: string, deleting: boolean) => {
    const next = new Set(deletingVariantIdsRef.current);
    if (deleting) {
      next.add(variantId);
    } else {
      next.delete(variantId);
    }
    deletingVariantIdsRef.current = next;
    setDeletingVariantIds(next);
  };

  const { data: variants } = api.item.getItemVariants.useQuery({ itemId });
  const { data: unlockItems } = api.item.getAllNames.useQuery();

  useEffect(() => {
    if (
      editingVariant?.id &&
      variants &&
      !variants.some((variant) => variant.id === editingVariant.id)
    ) {
      setEditingVariant(null);
      setShowForm(false);
    }
  }, [editingVariant, variants]);

  const upsert = api.item.upsertItemVariant.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      if (result.success) {
        await Promise.all([
          utils.item.getItemVariants.invalidate({ itemId }),
          utils.item.getVariantNames.invalidate(),
        ]);
        setShowForm(false);
        setEditingVariant(null);
      }
    },
    onSettled: () => {
      variantOperationInFlightRef.current = false;
      setVariantOperationPending(false);
    },
  });

  const remove = api.item.deleteItemVariant.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      if (result.success) {
        await Promise.all([
          utils.item.getItemVariants.invalidate({ itemId }),
          utils.item.getVariantNames.invalidate(),
        ]);
      }
    },
    onSettled: (_result, _error, variables) => {
      setVariantDeleting(variables.variantId, false);
      variantOperationInFlightRef.current = false;
      setVariantOperationPending(false);
    },
  });

  const deleteVariant = (variantId: string) => {
    // mutate() updates React state asynchronously, so guard duplicate activations with
    // a ref before starting the request. Other variant rows remain independently usable.
    if (
      variantOperationInFlightRef.current ||
      deletingVariantIdsRef.current.has(variantId)
    ) {
      return;
    }
    variantOperationInFlightRef.current = true;
    setVariantOperationPending(true);
    setVariantDeleting(variantId, true);
    try {
      remove.mutate({ variantId });
    } catch (error) {
      variantOperationInFlightRef.current = false;
      setVariantOperationPending(false);
      setVariantDeleting(variantId, false);
      throw error;
    }
  };

  const form = useForm<VariantFormInput, unknown, ZodItemVariantType>({
    resolver: zodResolver(ItemVariantValidator) as any,
    defaultValues: {
      name: "",
      image: "",
      requiredItemId: null,
      costType: "MONEY",
      cost: 0,
      order: 1,
      furnitureData: null,
    },
  });

  useEffect(() => {
    if (editingVariant) {
      form.reset(editingVariant);
    } else {
      form.reset({
        name: "",
        image: "",
        requiredItemId: null,
        costType: "MONEY",
        cost: 0,
        order: (variants?.length ?? 0) + 1,
        description: "",
        battleDescription: "",
        furnitureData: null,
      });
    }
    // variants?.length intentionally omitted: order is computed once at form-open time,
    // not on every background refetch. showForm is included so the default order
    // re-computes when the blank editor opens with the latest variants count.
  }, [editingVariant, form, showForm]);

  const variantCostType = useWatch({ control: form.control, name: "costType" });
  const imageValue = useWatch({ control: form.control, name: "image" });
  const variantName = useWatch({ control: form.control, name: "name" });
  const variantDescription = useWatch({ control: form.control, name: "description" });
  const variantFurniture = useWatch({ control: form.control, name: "furnitureData" });

  const onSubmit = form.handleSubmit(
    (data) => {
      if (variantOperationInFlightRef.current || isFurnitureMeasuring) return;
      variantOperationInFlightRef.current = true;
      setVariantOperationPending(true);
      try {
        upsert.mutate({
          itemId,
          variant: {
            ...data,
            requiredItemId:
              data.costType === "VARIANT_TOKEN" ? data.requiredItemId : null,
            furnitureData: isFurniture ? data.furnitureData : null,
          },
        });
      } catch (error) {
        variantOperationInFlightRef.current = false;
        setVariantOperationPending(false);
        throw error;
      }
    },
    (errors) => showFormErrorsToast(errors),
  );

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
            {variants.map((v) => {
              const isDeleting = deletingVariantIds.has(v.id);
              return (
                <tr
                  key={v.id}
                  className="border-b"
                  aria-busy={isDeleting}
                  data-testid={`item-variant-row-${v.id}`}
                >
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
                        disabled={variantOperationPending}
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
                      <Confirm
                        title="Delete Variant"
                        disabled={variantOperationPending}
                        button={
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={variantOperationPending}
                            loading={isDeleting}
                          >
                            {isDeleting ? "Deleting" : "Delete"}
                          </Button>
                        }
                        onAccept={() => deleteVariant(v.id)}
                      >
                        <p>
                          Delete this variant? Players who have already unlocked it will
                          lose access.
                        </p>
                      </Confirm>
                      {isDeleting && (
                        <span role="status" className="sr-only" aria-live="polite">
                          Deleting {v.name}…
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {!showForm && (variants?.length ?? 0) < MAX_ITEM_VARIANTS && (
        <Button
          variant="outline"
          disabled={variantOperationPending}
          onClick={() => {
            setEditingVariant(null);
            setShowForm(true);
          }}
        >
          + Add Variant
        </Button>
      )}

      {showForm && (
        <form
          onSubmit={onSubmit}
          className="mt-2 space-y-3 rounded border p-4"
          aria-busy={variantOperationPending}
        >
          <fieldset disabled={variantOperationPending} className="space-y-3">
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
                <NumberInput
                  id="variant-order"
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
                <NumberInput id="variant-cost" {...form.register("cost")} min={0} />
                {form.formState.errors.cost && (
                  <p className="mt-1 text-destructive text-xs">
                    {form.formState.errors.cost.message}
                  </p>
                )}
              </div>
            </div>
            {variantCostType === "VARIANT_TOKEN" && (
              <Controller
                control={form.control}
                name="requiredItemId"
                render={({ field }) => (
                  <div>
                    <label
                      htmlFor="variant-required-item"
                      className="font-medium text-sm"
                    >
                      Required unlock item (token variants)
                    </label>
                    <Select
                      value={field.value ?? "any"}
                      onValueChange={(value) =>
                        field.onChange(value === "any" ? null : value)
                      }
                    >
                      <SelectTrigger id="variant-required-item">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any compatible token</SelectItem>
                        {(unlockItems ?? [])
                          .filter((entry) =>
                            entry.unlockVariantIds.some(
                              (variantId) =>
                                !variantId || variantId === editingVariant?.id,
                            ),
                          )
                          .map((entry) => (
                            <SelectItem key={entry.id} value={entry.id}>
                              {entry.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              />
            )}
            <div>
              {isFurniture ? (
                <Controller
                  control={form.control}
                  name="furnitureData"
                  render={({ field }) => (
                    <FurnitureViewsEditor
                      key={editingVariant?.id ?? `${itemId}:new-variant`}
                      id={editingVariant?.id ?? `${itemId}:new-variant`}
                      name={variantName || "Item variant"}
                      description={variantDescription}
                      image={imageValue || ""}
                      width={
                        variantFurniture?.width ??
                        furnitureData?.width ??
                        DEFAULT_FURNITURE_DATA.width
                      }
                      groundAnchor={
                        variantFurniture?.groundAnchor ??
                        furnitureData?.groundAnchor ??
                        DEFAULT_FURNITURE_DATA.groundAnchor
                      }
                      geometry={variantFurniture?.geometry}
                      useFullFootprint={
                        Boolean(furnitureData?.isFloor) ||
                        furnitureData?.action === "sleep"
                      }
                      views={field.value?.views ?? {}}
                      onViewsChange={(views) =>
                        field.onChange({ ...field.value, views })
                      }
                      onMeasurementPendingChange={setIsFurnitureMeasuring}
                      onBaseChange={(change) => {
                        if (change.image !== undefined)
                          form.setValue("image", change.image, {
                            shouldDirty: true,
                            shouldValidate: true,
                          });
                        const { image: _image, ...framing } = change;
                        if (Object.keys(framing).length > 0)
                          field.onChange({
                            ...field.value,
                            views: field.value?.views ?? {},
                            ...framing,
                          });
                      }}
                      canEdit
                      disabled={variantOperationPending}
                    />
                  )}
                />
              ) : (
                <ContentImageSelector
                  label="Image"
                  imageUrl={imageValue || null}
                  id={editingVariant?.id ?? itemId}
                  prompt={
                    [variantName, variantDescription].filter(Boolean).join(" ") ||
                    "Item variant image"
                  }
                  allowImageUpload={true}
                  disabled={variantOperationPending}
                  type="item"
                  onUploadComplete={(url) =>
                    form.setValue("image", url, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                  size="square"
                  maxDim={256}
                />
              )}
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
            {!isFurniture && (
              <div>
                <label
                  htmlFor="variant-battle-description"
                  className="font-medium text-sm"
                >
                  Battle Description (optional)
                </label>
                <Textarea
                  id="variant-battle-description"
                  {...form.register("battleDescription")}
                  placeholder="%user strikes with the Crimson Blade"
                  rows={2}
                />
              </div>
            )}
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={
                  variantOperationPending ||
                  isFurnitureMeasuring ||
                  (editingVariant?.id
                    ? deletingVariantIds.has(editingVariant.id)
                    : false)
                }
              >
                {isFurnitureMeasuring
                  ? "Measuring furniture"
                  : upsert.isPending
                    ? "Saving"
                    : "Save Variant"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={
                  variantOperationPending ||
                  (editingVariant?.id
                    ? deletingVariantIds.has(editingVariant.id)
                    : false)
                }
                onClick={() => {
                  setShowForm(false);
                  setEditingVariant(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </fieldset>
        </form>
      )}
    </div>
  );
};
