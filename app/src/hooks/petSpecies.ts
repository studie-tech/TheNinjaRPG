import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import {
  BasicElementName,
  PET_POTENTIAL_TIERS,
  PetPotentialModes,
  PetRarities,
  PetRoles,
} from "@/drizzle/constants";
import type { PetSpecies } from "@/drizzle/schema";
import type { FormEntry } from "@/layout/EditContent";
import { getPreferredDamageElement } from "@/libs/combat/elementalDamage";
import { isPetJutsuAllowedForSpecies } from "@/libs/pets/abilities";
import { showFormErrorsToast, showMutationToast } from "@/libs/toast";
import type { AiRuleType } from "@/validators/ai";
import {
  PetSpeciesValidator,
  type ZodPetSpeciesInput,
  type ZodPetSpeciesType,
} from "@/validators/petSpecies";

const emptySpecies: ZodPetSpeciesType = {
  potentialMode: "FIXED",
  potentialValue: 1,
  potentialMin: 1,
  potentialMax: 5,
  potentialWeights: PET_POTENTIAL_TIERS.map((tier) => tier.weight),
  name: "",
  description: "",
  artDirection: null,
  rankConcepts: [],
  rarity: "COMMON",
  role: "ASSAULT",
  preferredDamageElement: null,
  isActive: false,
  defaultJutsuIds: [],
  aiRules: [],
  includeDefaultRules: true,
  effects: [],
};

/** Share the Manual create/edit form while keeping rejected saves recoverable. */
export const usePetSpeciesEditForm = (
  species: PetSpecies | undefined,
  onSaved: () => void | Promise<void>,
) => {
  const utils = api.useUtils();
  const [message, setMessage] = useState<string | null>(null);
  const form = useForm<ZodPetSpeciesInput, unknown, ZodPetSpeciesType>({
    mode: "all",
    criteriaMode: "all",
    values: species ?? emptySpecies,
    defaultValues: species ?? emptySpecies,
    resetOptions: { keepDirtyValues: true },
    resolver: zodResolver(PetSpeciesValidator),
  });
  const [
    isActive,
    effects,
    aiRules,
    includeDefaultRules,
    defaultJutsuIds,
    rarity,
    potentialMode,
  ] = useWatch({
    control: form.control,
    name: [
      "isActive",
      "effects",
      "aiRules",
      "includeDefaultRules",
      "defaultJutsuIds",
      "rarity",
      "potentialMode",
    ],
  });
  const aiProfile = useMemo(
    // Database rows and the controlled AI editor supply normalized rules, including defaults.
    () => ({
      rules: (aiRules ?? []) as AiRuleType[],
      includeDefaultRules: includeDefaultRules ?? true,
    }),
    [aiRules, includeDefaultRules],
  );
  const catalogue = api.jutsu.getAll.useInfiniteQuery(
    { jutsuType: ["PETS"], hidden: false, limit: 1000 },
    { getNextPageParam: (page) => page.nextCursor },
  );
  // New species have no ID yet; only editing can offer jutsu locked to this species.
  const availableJutsus =
    catalogue.data?.pages
      .flatMap((page) => page.data)
      .filter((entry) => isPetJutsuAllowedForSpecies(entry, species?.id)) ?? [];
  const mutationOptions = {
    onSuccess: async (result: { success: boolean; message: string }) => {
      showMutationToast({
        ...result,
        message:
          result.success && !species ? "Companion species created." : result.message,
      });
      if (!result.success) {
        setMessage(result.message);
        return;
      }
      form.reset(form.getValues());
      await Promise.all([
        utils.petSpecies.getAll.invalidate(),
        ...(species ? [utils.petSpecies.get.invalidate({ id: species.id })] : []),
      ]);
      await onSaved();
    },
    onError: (error: { message: string }) => setMessage(error.message),
  };
  const create = api.petSpecies.create.useMutation(mutationOptions);
  const update = api.petSpecies.update.useMutation(mutationOptions);
  const handleSubmit = form.handleSubmit((data) => {
    setMessage(null);
    if (species) update.mutate({ id: species.id, data });
    else create.mutate(data);
  }, showFormErrorsToast);
  const formData: FormEntry<keyof ZodPetSpeciesType>[] = [
    { id: "name", label: "Species name", type: "text" },
    {
      id: "potentialMode",
      label: "Potential mode",
      type: "str_array",
      values: PetPotentialModes,
    },
    // Invalid inactive drafts stay visible so validation never blocks a hidden field.
    ...(potentialMode === "FIXED" || form.formState.errors.potentialValue
      ? ([
          { id: "potentialValue", label: "Fixed potential (1–5)", type: "number" },
        ] as FormEntry<keyof ZodPetSpeciesType>[])
      : []),
    ...(potentialMode === "RANDOM" ||
    form.formState.errors.potentialMin ||
    form.formState.errors.potentialMax ||
    form.formState.errors.potentialWeights
      ? ([
          { id: "potentialMin", label: "Random minimum (1–5)", type: "number" },
          { id: "potentialMax", label: "Random maximum (1–5)", type: "number" },
          ...PET_POTENTIAL_TIERS.map((tier, index) => ({
            id: `potentialWeights.${index}` as keyof ZodPetSpeciesType,
            label: `${tier.title} roll weight (normalized within range)`,
            type: "number" as const,
          })),
        ] as FormEntry<keyof ZodPetSpeciesType>[])
      : []),
    { id: "rarity", label: "Rarity", type: "str_array", values: PetRarities },
    { id: "role", label: "Role", type: "str_array", values: PetRoles },
    {
      id: "preferredDamageElement",
      label: `Primary damage element [default: ${getPreferredDamageElement({})}]`,
      type: "str_array",
      values: BasicElementName,
      resetButton: true,
    },
    {
      id: "description",
      label: "Visual description",
      type: "textarea",
      rows: 4,
      fullWidth: true,
    },
    {
      id: "isActive",
      label: "Available for daily offers",
      type: "boolean",
      fullWidth: true,
    },
  ];
  const loadoutFormData: FormEntry<keyof ZodPetSpeciesType>[] = [
    {
      id: "defaultJutsuIds",
      label: "Default PETS jutsu",
      type: "db_values",
      multiple: true,
      fullWidth: true,
      values: [
        ...availableJutsus.map(({ id, name }) => ({ id, name })),
        ...(defaultJutsuIds ?? [])
          .filter((id) => !availableJutsus.some((entry) => entry.id === id))
          .map((id) => ({ id, name: `${id} (unavailable)` })),
      ],
    },
  ];
  return {
    form,
    formData,
    loadoutFormData,
    catalogue,
    aiProfile,
    effects: effects ?? [],
    rarity,
    handleSubmit,
    isActive,
    isSaving: create.isPending || update.isPending,
    message,
  };
};
