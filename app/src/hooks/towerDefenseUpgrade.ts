import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { TowerDefenseUpgradeTypes } from "@/drizzle/constants";
import type { TowerDefenseUpgrade } from "@/drizzle/schema";
import type { FormEntry } from "@/layout/EditContent";
import { showFormErrorsToast, showMutationToast } from "@/libs/toast";
import { calculateContentDiff } from "@/utils/diff";
import {
  type UpdateTowerDefenseUpgrade,
  type UpdateTowerDefenseUpgradeInput,
  updateTowerDefenseUpgradeSchema,
} from "@/validators/towerDefense";

/**
 * Hook used when creating frontend forms for editing Tower Defense upgrades
 */
export const useTowerDefenseUpgradeEditForm = (
  upgrade: TowerDefenseUpgrade,
  refetch: () => void,
) => {
  // Form handling
  const form = useForm<
    UpdateTowerDefenseUpgradeInput,
    unknown,
    UpdateTowerDefenseUpgrade
  >({
    mode: "all",
    criteriaMode: "all",
    values: upgrade as UpdateTowerDefenseUpgradeInput,
    defaultValues: upgrade as UpdateTowerDefenseUpgradeInput,
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
