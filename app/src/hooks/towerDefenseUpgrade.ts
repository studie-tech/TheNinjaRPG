import { z } from "zod";
import { calculateContentDiff } from "@/utils/diff";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "@/app/_trpc/client";
import { showMutationToast, showFormErrorsToast } from "@/libs/toast";
import { TowerDefenseUpgradeTypes } from "@/drizzle/constants";
import type { TowerDefenseUpgrade } from "@/drizzle/schema";
import type { FormEntry } from "@/layout/EditContent";

// Schema for editing tower defense upgrades
export const updateTowerDefenseUpgradeSchema = z.object({
  name: z.string().min(1).max(191),
  description: z.string(),
  maxLevel: z.coerce.number().int().min(1),
  baseCost: z.coerce.number().int().min(0),
  costMultiplier: z.coerce.number().min(1),
  upgradeType: z.enum(TowerDefenseUpgradeTypes),
  effectValue: z.coerce.number().min(0),
});
type UpdateTowerDefenseUpgrade = z.infer<typeof updateTowerDefenseUpgradeSchema>;

/**
 * Hook used when creating frontend forms for editing Tower Defense upgrades
 */
export const useTowerDefenseUpgradeEditForm = (
  upgrade: TowerDefenseUpgrade,
  refetch: () => void,
) => {
  // Form handling
  const form = useForm<UpdateTowerDefenseUpgrade>({
    mode: "all",
    criteriaMode: "all",
    values: upgrade,
    defaultValues: upgrade,
    resolver: zodResolver(updateTowerDefenseUpgradeSchema),
  });

  // tRPC utility
  const utils = api.useUtils();

  // Mutation for updating upgrade
  const { mutate: updateUpgrade, isPending: isUpdating } =
    api.towerDefense.updateUpgrade.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await utils.towerDefense.getUpgrade.invalidate({ id: upgrade.id });
        refetch();
      },
    });

  // Form submission
  const handleUpgradeSubmit = form.handleSubmit(
    (data) => {
      const diff = calculateContentDiff(upgrade, data);
      if (diff.length > 0) {
        updateUpgrade({ id: upgrade.id, data });
      }
    },
    (errors) => showFormErrorsToast(errors),
  );

  // Object for form values
  const formData: FormEntry<keyof UpdateTowerDefenseUpgrade>[] = [
    { id: "name", label: "Upgrade Name", type: "text" },
    { id: "description", label: "Description", type: "text", doubleWidth: true },
    {
      id: "upgradeType",
      label: "Upgrade Type",
      type: "str_array",
      values: TowerDefenseUpgradeTypes,
    },
    { id: "maxLevel", label: "Max Level", type: "number" },
    { id: "baseCost", label: "Base Cost (points)", type: "number" },
    { id: "costMultiplier", label: "Cost Multiplier", type: "number" },
    { id: "effectValue", label: "Effect Value (per level)", type: "number" },
  ];

  return {
    upgrade,
    form,
    formData,
    isUpdating,
    handleUpgradeSubmit,
  };
};
