import { calculateContentDiff } from "@/utils/diff";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ItemValidator } from "@/libs/combat/types";
import { WeaponTypes } from "@/drizzle/constants";
import { AttackTargets } from "@/drizzle/constants";
import { AttackMethods } from "@/drizzle/constants";
import { ItemTypes } from "@/drizzle/constants";
import { ItemRarities } from "@/drizzle/constants";
import { ItemSlotTypes } from "@/drizzle/constants";
import { BattleUsageTypes } from "@/drizzle/constants";
import { api } from "@/app/_trpc/client";
import { showMutationToast, showFormErrorsToast } from "@/libs/toast";
import type { Item, CraftingRequirement } from "@/drizzle/schema";
import type { ZodAllTags } from "@/libs/combat/types";
import type { FormEntry } from "@/layout/EditContent";
import type { ZodItemType } from "@/libs/combat/types";

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
  const form = useForm<ZodItemType>({
    mode: "all",
    criteriaMode: "all",
    values: item,
    defaultValues: item,
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
        ...data
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

  // Watch for changes to itemType
  const itemType = useWatch({
    control: form.control,
    name: "itemType",
  });

  // Query for items if this item is canBeCrafted
  const { data: itemsData } = api.item.getAllNames.useQuery(undefined, {
    enabled: canBeCrafted,
  });

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
    {
      id: "bloodlineId",
      type: "db_values",
      values: bloodlinesData,
      label: "Required Bloodline",
      resetButton: true,
    },
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
    { id: "expireFromStoreAt", type: "date", label: "Remove from store at" },
  ];

  if (canBeCrafted) {
    formData.push({
      id: "craftingRequirements",
      doubleWidth: true,
      label: "Crafting Requirements [and quantity]",
      type: "db_values_with_number",
      values: itemsData?.filter((i) => i.id !== item.id) || [],
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
