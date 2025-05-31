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
import { api } from "@/app/_trpc/client";
import { showMutationToast, showFormErrorsToast } from "@/libs/toast";
import type { Item } from "@/drizzle/schema";
import type { ZodAllTags } from "@/libs/combat/types";
import type { FormEntry } from "@/layout/EditContent";
import type { ZodItemType } from "@/libs/combat/types";

/**
 * Hook used when creating frontend forms for editing items
 * @param data
 */
export const useItemEditForm = (data: Item, refetch: () => void) => {
  // Case type
  const item = { ...data, effects: data.effects };

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
      const newItem = { ...item, ...data };
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
    { id: "cost", type: "number" },
    { id: "repsCost", type: "number" },
    { id: "cooldown", type: "number" },
    { id: "stackSize", type: "number" },
    { id: "destroyOnUse", type: "number" },
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
    { id: "canStack", type: "boolean" },
    { id: "hidden", type: "boolean" },
    { id: "isEventItem", type: "boolean" },
    { id: "inShop", type: "boolean" },
    { id: "preventBattleUsage", type: "boolean" },
  ];

  return { item, effects, form, formData, setEffects, handleItemSubmit };
};
