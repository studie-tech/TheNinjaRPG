"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import {
  AttackMethods,
  AttackTargets,
  BattleUsageTypes,
  ElementNames,
  JutsuTypes,
  LetterRanks,
  StatTypes,
  UserRanks,
  WeaponTypes,
} from "@/drizzle/constants";
import type { Jutsu } from "@/drizzle/schema";
import type { FormEntry } from "@/layout/EditContent";
import { EVOLUTION_STAT_FORM_FIELDS } from "@/libs/evolution";
import {
  getJutsuReskinMechanics,
  inheritJutsuReskinEffects,
} from "@/libs/jutsu/reskins";
import { showFormErrorsToast, showMutationToast } from "@/libs/toast";
import { calculateContentDiff } from "@/utils/diff";
import { objectKeys } from "@/utils/typeutils";
import type { ZodAllTags, ZodJutsuInput, ZodJutsuType } from "@/validators/combat";
import { JutsuValidator } from "@/validators/combat";

/**
 * Hook used when creating frontend forms for editing jutsus
 * @param data
 */
export const useJutsuEditForm = (data: Jutsu, refetch: () => void) => {
  // Case type
  const jutsu = {
    ...data,
    elementClassification: data.elementClassification || "None",
    effects: data.effects,
  };

  // Form handling
  const form = useForm<ZodJutsuInput, unknown, ZodJutsuType>({
    mode: "all",
    criteriaMode: "all",
    values: jutsu as ZodJutsuInput,
    defaultValues: jutsu as ZodJutsuInput,
    resolver: zodResolver(JutsuValidator),
  });

  // Query for bloodlines, villages, and jutsus (for evolution parent selection)
  const { data: bloodlines, isPending: l1 } =
    api.bloodline.getAllNames.useQuery(undefined);
  const { data: villages, isPending: l2 } = api.village.getAllNames.useQuery(undefined);
  const { data: jutsus, isPending: l4 } = api.jutsu.getAllNames.useQuery(undefined);
  const { data: reskinParents, isPending: l6 } = api.jutsu.getReskinParents.useQuery();

  const reskinParentId = useWatch({
    control: form.control,
    name: "reskinParentJutsuId",
  });
  const previousReskinParentId = useRef(reskinParentId);
  // Preserve a saved group on load; changing the source requires a fresh selection.
  useEffect(() => {
    if (previousReskinParentId.current !== reskinParentId) {
      form.setValue("bloodlineReskinId", null, { shouldDirty: true });
      previousReskinParentId.current = reskinParentId;
    }
  }, [reskinParentId, form]);
  const { data: reskinParent } = api.jutsu.get.useQuery(
    { id: reskinParentId || "" },
    { enabled: !!reskinParentId },
  );
  const { data: bloodlineReskins } = api.bloodline.getReskinsForBloodline.useQuery(
    { bloodlineId: reskinParent?.bloodlineId || "" },
    { enabled: !!reskinParent?.bloodlineId },
  );

  // Preview the same inheritance as the server, which re-reads the source on save.
  useEffect(() => {
    if (!reskinParent) return;
    const inherited = getJutsuReskinMechanics(reskinParent);
    for (const key of objectKeys(inherited)) {
      form.setValue(key, inherited[key], { shouldDirty: true });
    }
    form.setValue("jutsuRank", "H", { shouldDirty: true });
    form.setValue("parentJutsuId", null, { shouldDirty: true });
    form.setValue(
      "effects",
      inheritJutsuReskinEffects(
        reskinParent.effects,
        form.getValues("effects") as ZodAllTags[],
      ),
      { shouldDirty: true },
    );
  }, [reskinParent, form]);

  // Watch bloodlineId to filter bloodline items to only those for the selected bloodline
  const selectedBloodlineId = useWatch({
    control: form.control,
    name: "bloodlineId",
  });
  const { data: bloodlineItems, isPending: l5 } =
    api.item.getBloodlineItemNames.useQuery({ bloodlineId: selectedBloodlineId });

  // Clear the required bloodline item whenever the admin changes the bloodline, so a
  // jutsu can't be saved requiring an item from a different bloodline. Skip the initial
  // mount so an existing jutsu's saved value isn't wiped on load.
  const didInitBloodline = useRef(false);
  useEffect(() => {
    if (!didInitBloodline.current) {
      didInitBloodline.current = true;
      return;
    }
    form.setValue("requiredBloodlineItemId", null, { shouldDirty: true });
  }, [selectedBloodlineId, form]);

  const [updateError, setUpdateError] = useState<string | null>(null);

  // Mutation for updating jutsu
  const { mutate: updateJutsu, isPending: l3 } = api.jutsu.update.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      setUpdateError(data.success ? null : data.message);
      if (data.success) refetch();
    },
    onError: (error) => setUpdateError(error.message),
  });

  // Form submission
  const handleJutsuSubmit = form.handleSubmit(
    (data: ZodJutsuType) => {
      const newJutsu = { ...jutsu, ...data };
      const diff = calculateContentDiff(jutsu, newJutsu);
      if (diff.length > 0) {
        updateJutsu({ id: jutsu.id, data: newJutsu });
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

  // Are we loading data
  const loading = l1 || l2 || l3 || l4 || l5 || l6;

  // Watch for changes to avatar
  const imageUrl = useWatch({
    control: form.control,
    name: "image",
  });

  // Object for form values
  const formData: FormEntry<keyof ZodJutsuType>[] = [
    {
      id: "reskinParentJutsuId",
      label: "Reskin Parent Jutsu",
      searchable: true,
      fullWidth: true,
      type: "db_values",
      values: reskinParents?.filter((j) => j.id !== data.id),
      resetButton: true,
    },
    {
      id: "bloodlineReskinId",
      label: "Bloodline Reskin",
      searchable: true,
      fullWidth: true,
      type: "db_values",
      values: bloodlineReskins,
      resetButton: true,
    },
    { id: "image", type: "avatar", href: imageUrl },
    { id: "name", type: "text" },
    { id: "actionCostPerc", label: "AP Cost [%]", type: "number" },
    { id: "staminaCost", type: "number" },
    { id: "chakraCost", type: "number" },
    { id: "healthCost", type: "number" },
    { id: "chakraCostReducePerLvl", type: "number" },
    { id: "staminaCostReducePerLvl", type: "number" },
    { id: "healthCostReducePerLvl", type: "number" },
    { id: "extraBaseCost", type: "number" },
    { id: "description", type: "text", doubleWidth: true },
    { id: "battleDescription", type: "text", doubleWidth: true },
    { id: "statClassification", type: "str_array", values: StatTypes },
    {
      id: "elementClassification",
      label: "Element Classification",
      type: "str_array",
      values: ElementNames,
    },
    { id: "range", type: "number" },
    { id: "cooldown", type: "number" },
    { id: "requiredLevel", type: "number" },
    { id: "jutsuType", type: "str_array", values: JutsuTypes },
    { id: "bloodlineId", type: "db_values", values: bloodlines, resetButton: true },
    {
      id: "requiredBloodlineItemId",
      label: "Required Bloodline Item",
      type: "db_values",
      values: bloodlineItems,
      resetButton: true,
    },
    { id: "villageId", type: "db_values", values: villages, resetButton: true },
    { id: "jutsuWeapon", type: "str_array", values: WeaponTypes },
    { id: "method", type: "str_array", values: AttackMethods },
    { id: "jutsuRank", type: "str_array", values: LetterRanks },
    { id: "requiredRank", type: "str_array", values: UserRanks },
    { id: "target", type: "str_array", values: AttackTargets },
    { id: "battleUsageType", type: "str_array", values: BattleUsageTypes },
    { id: "hidden", type: "boolean" },
    { id: "injectableInBattle", type: "boolean" },
    {
      id: "parentJutsuId",
      label: "Parent Jutsu (Evolution)",
      type: "db_values",
      values: jutsus,
      resetButton: true,
    },
    ...EVOLUTION_STAT_FORM_FIELDS.map(
      (field) =>
        ({
          id: field.id,
          label: field.label,
          type: "number",
        }) as FormEntry<keyof ZodJutsuType>,
    ),
  ];

  const cosmeticFields = new Set([
    "reskinParentJutsuId",
    "bloodlineReskinId",
    "image",
    "name",
    "description",
    "battleDescription",
    "hidden",
    "injectableInBattle",
  ]);
  const visibleFormData = reskinParentId
    ? formData.filter((field) => cosmeticFields.has(field.id))
    : formData;
  return {
    jutsu,
    effects,
    form,
    formData: visibleFormData,
    loading,
    setEffects,
    handleJutsuSubmit,
    reskinParentId,
    updateError,
  };
};
