import { zodResolver } from "@hookform/resolvers/zod";
import type { Resolver } from "react-hook-form";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { LetterRanks } from "@/drizzle/constants";
import type { SageMode } from "@/drizzle/schema";
import type { FormEntry } from "@/layout/EditContent";
import { showFormErrorsToast, showMutationToast } from "@/libs/toast";
import { calculateContentDiff } from "@/utils/diff";
import type { ZodAllTags, ZodSageModeType } from "@/validators/combat";
import { SageModeValidator } from "@/validators/combat";

/**
 * Hook used when creating frontend forms for editing sage modes
 */
export const useSageModeEditForm = (data: SageMode, refetch: () => void) => {
  const sageMode = {
    ...data,
    battleDescription: data.battleDescription ?? "",
    effects: data.effects,
    afterEffects: data.afterEffects,
  };

  const form = useForm<ZodSageModeType, any, ZodSageModeType>({
    mode: "all",
    criteriaMode: "all",
    values: sageMode as ZodSageModeType,
    defaultValues: sageMode as ZodSageModeType,
    resolver: zodResolver(SageModeValidator) as Resolver<
      ZodSageModeType,
      any,
      ZodSageModeType
    >,
  });

  const { data: villages, isPending: l1 } = api.village.getAllNames.useQuery(undefined);

  const { mutate: updateSageMode, isPending: l2 } = api.sageMode.update.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      refetch();
    },
  });

  const handleSageModeSubmit = form.handleSubmit(
    (data: ZodSageModeType) => {
      const newSageMode = { ...sageMode, ...data };
      const diff = calculateContentDiff(sageMode, newSageMode);
      if (diff.length > 0) {
        updateSageMode({ id: sageMode.id, data: newSageMode });
      }
    },
    (errors) => showFormErrorsToast(errors),
  );

  const effects = useWatch({
    control: form.control,
    name: "effects",
  });

  const afterEffects = useWatch({
    control: form.control,
    name: "afterEffects",
  });

  const setEffects = (newEffects: ZodAllTags[]) => {
    form.setValue("effects", newEffects, { shouldDirty: true });
  };

  const setAfterEffects = (newEffects: ZodAllTags[]) => {
    form.setValue("afterEffects", newEffects, { shouldDirty: true });
  };

  const level2Effects = useWatch({
    control: form.control,
    name: "level2Effects",
  });

  const setLevel2Effects = (newEffects: ZodAllTags[]) => {
    form.setValue("level2Effects", newEffects, { shouldDirty: true });
  };

  const loading = l1 || l2;

  const imageUrl = useWatch({
    control: form.control,
    name: "image",
  });

  const formData: FormEntry<keyof ZodSageModeType>[] = [
    { id: "name", type: "text" },
    {
      id: "battleDescription",
      type: "text",
      label: "Activation Message (%user templated)",
    },
    { id: "image", type: "avatar", href: imageUrl },
    { id: "level", type: "number", label: "Roll Pool Level (1 = rollable)" },
    { id: "requiredSageMastery", type: "number", label: "Required Sage Mastery" },
    { id: "activationRounds", type: "number", label: "Active Duration (rounds)" },
    {
      id: "afterEffectRounds",
      type: "number",
      label: "After-Effect Duration (rounds)",
    },
    { id: "chakraCostPerc", type: "number", label: "Chakra Cost %" },
    { id: "staminaCostPerc", type: "number", label: "Stamina Cost %" },
    { id: "hidden", type: "boolean" },
    { id: "villageId", type: "db_values", values: villages, resetButton: true },
    { id: "rank", type: "str_array", values: LetterRanks },
    { id: "description", type: "richinput", doubleWidth: true },
  ];

  return {
    sageMode,
    effects,
    afterEffects,
    level2Effects,
    form,
    formData,
    loading,
    setEffects,
    setAfterEffects,
    setLevel2Effects,
    handleSageModeSubmit,
  };
};
