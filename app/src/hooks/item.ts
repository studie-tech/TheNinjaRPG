import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef } from "react";
import { type Path, useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import {
  AttackMethods,
  AttackTargets,
  BattleUsageTypes,
  HomeFurnitureActions,
  ItemPurchaseLimitPeriods,
  ItemRarities,
  ItemSlotTypes,
  ItemTypes,
  WeaponTypes,
} from "@/drizzle/constants";
import type { CraftingRequirement, Item } from "@/drizzle/schema";
import type { FormEntry } from "@/layout/EditContent";
import { focusWeightedCacheError } from "@/layout/WeightedCacheEditor";
import { EVOLUTION_STAT_FORM_FIELDS } from "@/libs/evolution";
import { showFormErrorsToast, showMutationToast } from "@/libs/toast";
import { calculateContentDiff } from "@/utils/diff";
import type { ZodAllTags, ZodItemInput, ZodItemType } from "@/validators/combat";
import { IncreaseStatTag, ItemValidator } from "@/validators/combat";
import { MEAL_ITEM_DEFAULTS } from "@/validators/cooking";
import { DEFAULT_FURNITURE_DATA, FURNITURE_ITEM_DEFAULTS } from "@/validators/item";

/**
 * Hook used when creating frontend forms for editing items
 * @param data
 */
export const useItemEditForm = (
  data: Item & { craftingRequirements: CraftingRequirement[] },
  refetch: () => Promise<unknown>,
) => {
  const utils = api.useUtils();
  const submitInFlight = useRef(false);

  // Case type
  const expireFromStoreAt = data.expireFromStoreAt
    ? data.expireFromStoreAt.slice(0, 10)
    : "";
  const item = {
    ...data,
    coordinateTargeting: data.coordinateTargeting || null,
    methodSize: data.methodSize || null,
    effects: data.effects,
    expireFromStoreAt: expireFromStoreAt,
    crystalTargetTypes: data.crystalTargetTypes || null,
    furnitureData: data.furnitureData || null,
    craftingRequirements: data.craftingRequirements.map((req) => ({
      ids: [req.requirementItemId],
      number: req.quantity,
    })),
  };

  // Form handling
  const form = useForm<ZodItemInput, unknown, ZodItemType>({
    mode: "all",
    criteriaMode: "all",
    values: item as ZodItemInput,
    defaultValues: item as ZodItemInput,
    resolver: zodResolver(ItemValidator),
  });
  // Keep parent-owned objects registered while their conditional editors are hidden.
  form.register("coordinateTargeting");
  form.register("methodSize");
  form.register("furnitureData");

  // Mutation for updating item
  const { mutateAsync: updateItem, isPending: isUpdating } =
    api.item.update.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          // Token selectors use compatibility metadata; variant labels use the item name.
          await Promise.all([
            refetch(),
            utils.item.getAllNames.invalidate(),
            utils.item.getVariantNames.invalidate(),
          ]);
        }
      },
      onSettled: () => {
        submitInFlight.current = false;
      },
    });

  // Form submission
  const handleItemSubmit = form.handleSubmit(
    async (data: ZodItemType) => {
      if (submitInFlight.current) return;
      const cacheError = focusWeightedCacheError();
      if (cacheError) {
        showMutationToast({ success: false, message: `Cannot save. ${cacheError}` });
        return;
      }
      const newItem = {
        ...item,
        ...data,
      };
      const diff = calculateContentDiff(item, newItem);
      if (diff.length > 0) {
        submitInFlight.current = true;
        try {
          await updateItem({ id: item.id, data: newItem });
        } catch {
          // The shared tRPC error handler reports transport failures. Do not
          // refetch here: retaining this draft makes the failed save retryable.
        }
      }
    },
    (errors) => {
      const cacheError = errors.effects ? focusWeightedCacheError() : undefined;
      if (cacheError)
        showMutationToast({ success: false, message: `Cannot save. ${cacheError}` });
      else showFormErrorsToast(errors);
    },
  );

  // Watch the effects
  const effects = useWatch({
    control: form.control,
    name: "effects",
  });

  // Handle updating of effects
  const setEffects = (newEffects: ZodAllTags[]) => {
    form.setValue("effects", newEffects, { shouldDirty: true });
  };

  // Watch for changes to avatar
  const imageUrl = useWatch({
    control: form.control,
    name: "image",
  });

  // Watch for changes to canBeCrafted
  const canBeCrafted = useWatch({
    control: form.control,
    name: "canBeCrafted",
  });

  const isFarmSeed = useWatch({
    control: form.control,
    name: "isFarmSeed",
  });

  const isFarmFertilizer = useWatch({
    control: form.control,
    name: "isFarmFertilizer",
  });

  // Watch for changes to itemType
  const itemType = useWatch({
    control: form.control,
    name: "itemType",
  });
  const previousItemType = useRef(itemType);
  const isFurniture = itemType === "FURNITURE";
  useEffect(() => {
    if (previousItemType.current !== "FURNITURE" && isFurniture) {
      for (const [field, value] of Object.entries(FURNITURE_ITEM_DEFAULTS)) {
        form.setValue(field as keyof ZodItemInput, field === "effects" ? [] : value, {
          shouldDirty: true,
        });
      }
      form.setValue(
        "furnitureData",
        { ...DEFAULT_FURNITURE_DATA },
        { shouldDirty: true },
      );
      form.clearErrors();
      void form.trigger();
    } else if (previousItemType.current === "FURNITURE" && !isFurniture) {
      form.setValue("furnitureData", null, { shouldDirty: true });
      form.setValue("maxImbueNumber", 1, { shouldDirty: true });
      form.setValue("maxDurability", 100, { shouldDirty: true });
    }
    previousItemType.current = itemType;
  }, [form, isFurniture, itemType]);

  // Hidden combat fields must still satisfy meal validation when switching item types.
  const isMeal = itemType === "MEAL";
  useEffect(() => {
    if (!isMeal) return;
    for (const [field, value] of Object.entries(MEAL_ITEM_DEFAULTS)) {
      form.setValue(field as keyof ZodItemInput, value, { shouldDirty: true });
    }
    if (!form.getValues("effects")?.length)
      form.setValue("effects", [
        IncreaseStatTag.parse({ statTypes: ["Ninjutsu"], target: "SELF" }),
      ]);
  }, [form, isMeal]);

  // All item names, shared by the crafting, farming, and evolution pickers.
  const { data: allItemNames } = api.item.getAllNames.useQuery();

  // Query for bloodlines for bloodline requirement dropdown
  const { data: bloodlinesData } = api.bloodline.getAllNames.useQuery();

  const { data: requiredSkills } = api.skillTree.getAllNames.useQuery();

  // Object for form values
  const targetingMethod = useWatch({ control: form.control, name: "method" });
  const previousTargetingMethod = useRef(targetingMethod);
  useEffect(() => {
    if (
      previousTargetingMethod.current === "COORDINATES" &&
      targetingMethod !== "COORDINATES"
    ) {
      form.setValue("coordinateTargeting", null, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
    // Clear inactive expansion so a hidden draft cannot block schema validation.
    if (targetingMethod === "ALL" || targetingMethod === "COORDINATES") {
      form.setValue("methodSize", null, { shouldDirty: true, shouldValidate: true });
    }
    previousTargetingMethod.current = targetingMethod;
  }, [targetingMethod, form]);

  const formData: FormEntry<Path<ZodItemType>>[] = [
    { id: "name", label: "Item Name", type: "text" },
    { id: "image", type: "avatar", href: imageUrl },
    { id: "itemType", type: "str_array", values: ItemTypes },
    { id: "rarity", type: "str_array", values: ItemRarities },
    { id: "slot", type: "str_array", values: ItemSlotTypes },
    { id: "weaponType", type: "str_array", values: WeaponTypes },
    { id: "description", type: "text", doubleWidth: true },
    { id: "battleDescription", type: "text", doubleWidth: true },
    { id: "target", type: "str_array", values: AttackTargets },
    { id: "method", type: "str_array", values: AttackMethods },
    ...(targetingMethod !== "ALL" && targetingMethod !== "COORDINATES"
      ? [{ id: "methodSize" as const, type: "method_size" as const, fullWidth: true }]
      : []),
    ...(targetingMethod === "COORDINATES"
      ? [
          {
            id: "coordinateTargeting" as const,
            label: "Coordinate pattern",
            type: "coordinate_targeting" as const,
            fullWidth: true,
          },
        ]
      : []),
    { id: "battleUsageType", type: "str_array", values: BattleUsageTypes },
    { id: "cost", type: "number" },
    { id: "repsCost", type: "number" },
    { id: "seichiSilverCost", type: "number" },
    { id: "cooldown", type: "number" },
    { id: "stackSize", type: "number" },
    { id: "range", type: "number" },
    { id: "chakraCost", type: "number" },
    { id: "staminaCost", type: "number" },
    { id: "chakraCostReducePerLvl", type: "number" },
    { id: "staminaCostReducePerLvl", type: "number" },
    { id: "healthCostReducePerLvl", type: "number" },
    { id: "actionCostPerc", type: "number" },
    { id: "healthCost", type: "number" },
    { id: "maxEquips", type: "number" },
    { id: "requiredLevel", type: "number", label: "Required Level" },
    {
      id: "requiredSkillId",
      label: "Required Skill (Activated)",
      type: "db_values",
      values: requiredSkills,
      searchable: true,
      resetButton: true,
    },
    { id: "xpToLevel", type: "number", label: "XP Per Level" },
    {
      id: "bloodlineId",
      type: "db_values",
      values: bloodlinesData,
      label: "Required Bloodline",
      resetButton: true,
    },
    {
      id: "parentItemId",
      label: "Parent Item (Evolution)",
      type: "db_values",
      values: allItemNames?.filter((i) => i.id !== item.id),
      resetButton: true,
    },
    ...EVOLUTION_STAT_FORM_FIELDS.map(
      (field) =>
        ({
          id: field.id,
          label: field.label,
          type: "number",
        }) as FormEntry<Path<ZodItemType>>,
    ),
    { id: "destroyOnUse", type: "boolean" },
    { id: "canStack", type: "boolean" },
    { id: "maxImbueNumber", type: "number" },
    { id: "hidden", type: "boolean" },
    { id: "isEventItem", type: "boolean" },
    { id: "inShop", type: "boolean" },
    { id: "purchaseLimitPeriod", type: "str_array", values: ItemPurchaseLimitPeriods },
    {
      id: "purchaseLimit",
      type: "number",
      label: "Purchase limit (units per period; NONE is unlimited)",
    },
    { id: "preventBattleUsage", type: "boolean" },
    { id: "canBeHunted", type: "boolean" },
    { id: "canBeGathered", type: "boolean" },
    {
      id: "canBeCrafted",
      type: "boolean",
      label: isMeal ? "Can be cooked in the kitchen" : "Can Be Crafted",
    },
    { id: "canBeTraded", type: "boolean" },
    {
      id: "auctionMinPrice",
      type: "number",
      label: "Auction minimum ryo per unit (blank for none)",
    },
    {
      id: "auctionMaxPrice",
      type: "number",
      label: "Auction maximum ryo per unit (blank for none)",
    },
    { id: "canBeImbued", type: "boolean" },
    ...(isMeal
      ? [
          {
            id: "cookingMinLevel" as const,
            type: "number" as const,
            label: "Required Cooking level",
          },
          {
            id: "cookingTimeSeconds" as const,
            type: "number" as const,
            label: "Cooking time per meal (seconds)",
          },
          {
            id: "cookingOutputQuantity" as const,
            type: "number" as const,
            label: "Meals per batch",
          },
          {
            id: "cookingExperience" as const,
            type: "number" as const,
            label: "Cooking XP per meal (on completion)",
          },
          {
            id: "mealDurationSeconds" as const,
            type: "number" as const,
            label: "Meal effect duration (seconds)",
          },
        ]
      : [
          {
            id: "craftingExperience" as const,
            type: "number" as const,
            label: "Crafting Experience",
          },
        ]),
    { id: "isFarmSeed", type: "boolean", label: "Farm Seed" },
    { id: "farmGrowTimeSeconds", type: "number", label: "Grow Time (seconds)" },
    {
      id: "farmYieldItemId",
      type: "db_values",
      values: allItemNames?.filter((i) => i.id !== item.id) ?? [],
      label: "Crop Item (yield)",
      resetButton: true,
    },
    { id: "farmMinLevel", type: "number", label: "Min Grow Level (to plant)" },
    ...(isFarmSeed
      ? [
          {
            id: "farmPlantExperience" as const,
            type: "number" as const,
            label: "Plant XP",
          },
        ]
      : !isFarmFertilizer
        ? [
            {
              id: "farmHarvestExperience" as const,
              type: "number" as const,
              label: "Harvest XP",
            },
          ]
        : []),
    {
      id: "farmSellValue",
      type: "number",
      label: isFarmSeed ? "Farm Shop Price (coins)" : "Farm Crop Sell Value (coins)",
    },
    {
      id: "farmExtractSeedItemId",
      type: "db_values",
      values: allItemNames?.filter((i) => i.id !== item.id) ?? [],
      label: "Extract → Seed Item",
      resetButton: true,
    },
    { id: "farmExtractSeedCount", type: "number", label: "Seeds Per Extraction" },
    { id: "isFarmFertilizer", type: "boolean", label: "Farm Fertilizer" },
    {
      id: "farmTimeReductionSeconds",
      type: "number",
      label: "Grow Time Reduction (seconds)",
    },
    { id: "farmFertilizerExperience", type: "number", label: "Apply XP" },
    { id: "expireFromStoreAt", type: "date", label: "Remove from store at" },
  ];

  if (canBeCrafted || isMeal) {
    formData.push({
      id: "craftingRequirements",
      doubleWidth: true,
      label: isMeal
        ? "Recipe ingredients [and quantity per batch]"
        : "Crafting Requirements [and quantity]",
      type: "db_values_with_number",
      values: allItemNames?.filter((i) => i.id !== item.id) || [],
    });
  }

  // Add crystal target types field only for CRYSTAL items
  if (itemType === "CRYSTAL") {
    formData.push({
      id: "crystalTargetTypes",
      type: "str_array",
      values: ItemTypes,
      label: "Crystal Target Type",
    });
  }

  const mealFields = new Set([
    "name",
    "image",
    "itemType",
    "rarity",
    "description",
    "cost",
    "repsCost",
    "seichiSilverCost",
    "stackSize",
    "canStack",
    "hidden",
    "isEventItem",
    "inShop",
    "canBeCrafted",
    "canBeTraded",
    "auctionMinPrice",
    "auctionMaxPrice",
    "craftingRequirements",
    "cookingMinLevel",
    "cookingTimeSeconds",
    "cookingOutputQuantity",
    "cookingExperience",
    "mealDurationSeconds",
  ]);
  const visibleFormData = isMeal
    ? formData.filter((field) => mealFields.has(field.id))
    : isFurniture
      ? formData.filter((field) => FURNITURE_FORM_FIELDS.has(field.id))
      : formData;
  if (isFurniture) {
    visibleFormData.splice(
      3,
      0,
      {
        id: "furnitureData.action",
        label: "Home action (blank for decoration)",
        type: "str_array",
        values: HomeFurnitureActions,
        resetButton: true,
      },
      {
        id: "furnitureData.isFloor",
        label: "Floor decoration",
        type: "boolean",
      },
    );
  }

  return {
    item,
    effects,
    form,
    formData: visibleFormData,
    setEffects,
    handleItemSubmit,
    isUpdating,
  };
};

const FURNITURE_FORM_FIELDS = new Set<Path<ZodItemType>>([
  "name",
  "itemType",
  "rarity",
  "description",
  "cost",
  "repsCost",
  "seichiSilverCost",
  "requiredLevel",
  "hidden",
  "isEventItem",
  "inShop",
  "purchaseLimitPeriod",
  "purchaseLimit",
  "canBeCrafted",
  "canBeTraded",
  "auctionMinPrice",
  "auctionMaxPrice",
  "craftingExperience",
  "expireFromStoreAt",
  "craftingRequirements",
]);
