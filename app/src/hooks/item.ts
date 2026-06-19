import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import {
  AttackMethods,
  AttackTargets,
  BattleUsageTypes,
  ItemRarities,
  ItemSlotTypes,
  ItemTypes,
  WeaponTypes,
} from "@/drizzle/constants";
import type { CraftingRequirement, Item } from "@/drizzle/schema";
import type { FormEntry } from "@/layout/EditContent";
import { EVOLUTION_STAT_FORM_FIELDS } from "@/libs/evolution";
import { showFormErrorsToast, showMutationToast } from "@/libs/toast";
import { calculateContentDiff } from "@/utils/diff";
import type { ZodAllTags, ZodItemInput, ZodItemType } from "@/validators/combat";
import { ItemValidator } from "@/validators/combat";

/**
 * Hook used when creating frontend forms for editing items
 * @param data
 */
export const useItemEditForm = (
  data: Item & { craftingRequirements: CraftingRequirement[] },
  refetch: () => void,
) => {
  // Case type
  const expireFromStoreAt = data.expireFromStoreAt
    ? data.expireFromStoreAt.slice(0, 10)
    : "";
  const item = {
    ...data,
    effects: data.effects,
    expireFromStoreAt: expireFromStoreAt,
    crystalTargetTypes: data.crystalTargetTypes || null,
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

  // Mutation for updating item
  const { mutate: updateItem } = api.item.update.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      refetch();
    },
  });

  // Form submission
  const handleItemSubmit = form.handleSubmit(
    (data: ZodItemType) => {
      const newItem = {
        ...item,
        ...data,
      };
      const diff = calculateContentDiff(item, newItem);
      if (diff.length > 0) {
        updateItem({ id: item.id, data: newItem });
      }
    },
    (errors) => showFormErrorsToast(errors),
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

  // All item names, shared by the crafting, farming, and evolution pickers.
  const { data: allItemNames } = api.item.getAllNames.useQuery();

  // Query for bloodlines for bloodline requirement dropdown
  const { data: bloodlinesData } = api.bloodline.getAllNames.useQuery();

  // Object for form values
  const formData: FormEntry<keyof ZodItemType>[] = [
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
        }) as FormEntry<keyof ZodItemType>,
    ),
    { id: "destroyOnUse", type: "boolean" },
    { id: "canStack", type: "boolean" },
    { id: "maxImbueNumber", type: "number" },
    { id: "hidden", type: "boolean" },
    { id: "isEventItem", type: "boolean" },
    { id: "inShop", type: "boolean" },
    { id: "preventBattleUsage", type: "boolean" },
    { id: "canBeHunted", type: "boolean" },
    { id: "canBeGathered", type: "boolean" },
    { id: "canBeCrafted", type: "boolean" },
    { id: "canBeTraded", type: "boolean" },
    { id: "canBeImbued", type: "boolean" },
    { id: "craftingExperience", type: "number", label: "Crafting Experience" },
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

  if (canBeCrafted) {
    formData.push({
      id: "craftingRequirements",
      doubleWidth: true,
      label: "Crafting Requirements [and quantity]",
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

  return { item, effects, form, formData, setEffects, handleItemSubmit };
};
