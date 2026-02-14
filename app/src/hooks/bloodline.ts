import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import {
  BloodlineDifficultyRatings,
  LetterRanks,
  StatTypes,
} from "@/drizzle/constants";
import type { Bloodline } from "@/drizzle/schema";
import type { FormEntry } from "@/layout/EditContent";
import { showFormErrorsToast, showMutationToast } from "@/libs/toast";
import { calculateContentDiff } from "@/utils/diff";
import type {
  ZodAllTags,
  ZodBloodlineInput,
  ZodBloodlineType,
} from "@/validators/combat";
import { BloodlineValidator } from "@/validators/combat";

/**
 * Hook used when creating frontend forms for editing bloodlines
 * @param data
 */
export const useBloodlineEditForm = (data: Bloodline, refetch: () => void) => {
  // Case type
  const bloodline = { ...data, effects: data.effects };

  // Form handling
  const form = useForm<ZodBloodlineInput, unknown, ZodBloodlineType>({
    mode: "all",
    criteriaMode: "all",
    values: bloodline as ZodBloodlineInput,
    defaultValues: bloodline as ZodBloodlineInput,
    resolver: zodResolver(BloodlineValidator),
  });

  // Query for bloodlines and villages
  const { data: villages, isPending: l1 } = api.village.getAllNames.useQuery(undefined);

  // Mutation for updating bloodline
  const { mutate: updateBloodline, isPending: l2 } = api.bloodline.update.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      refetch();
    },
  });

  // Form submission
  const handleBloodlineSubmit = form.handleSubmit(
    (data: ZodBloodlineType) => {
      const newBloodline = { ...bloodline, ...data };
      const diff = calculateContentDiff(bloodline, newBloodline);
      if (diff.length > 0) {
        updateBloodline({ id: bloodline.id, data: newBloodline });
      }
    },
    (errors) => showFormErrorsToast(errors),
  );

  // Watch the effects
  const effects = useWatch({
    control: form.control,
    name: "effects",
  });

  // Handle updating of effects. This casting should be safe, and is a hack to make it work with MassEdit functionality types
  const setEffects = (newEffects: ZodAllTags[]) => {
    form.setValue("effects", newEffects, { shouldDirty: true });
  };

  // Are we loading data
  const loading = l1 || l2;

  // Watch for changes to avatar
  const imageUrl = useWatch({
    control: form.control,
    name: "image",
  });

  // Object for form values
  const formData: FormEntry<keyof ZodBloodlineType>[] = [
    { id: "name", type: "text" },
    { id: "image", type: "avatar", href: imageUrl },
    { id: "regenIncrease", type: "number" },
    { id: "hidden", type: "boolean" },
    { id: "villageId", type: "db_values", values: villages, resetButton: true },
    { id: "rank", type: "str_array", values: LetterRanks },
    { id: "statClassification", type: "str_array", values: StatTypes },
    {
      id: "difficulty",
      label: "Difficulty Rating",
      type: "str_array",
      values: BloodlineDifficultyRatings,
      resetButton: true,
    },
    { id: "traits", type: "text", doubleWidth: true, label: "Traits" },
    { id: "description", type: "richinput", doubleWidth: true },
  ];

  return {
    bloodline,
    effects,
    form,
    formData,
    loading,
    setEffects,
    handleBloodlineSubmit,
  };
};
