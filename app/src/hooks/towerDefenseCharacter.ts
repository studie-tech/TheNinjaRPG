import { calculateContentDiff } from "@/utils/diff";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "@/app/_trpc/client";
import { showMutationToast, showFormErrorsToast } from "@/libs/toast";
import {
  insertTowerDefenseCharacterSchema,
  characterAnimationStates,
  type InsertTowerDefenseCharacter,
  type CharacterAssetConfig,
  type CharacterAnimationState,
} from "@/validators/towerDefense";
import type { TowerDefenseCharacterDb } from "@/drizzle/schema";
import type { FormEntry } from "@/layout/EditContent";

/**
 * Hook used when creating frontend forms for editing Tower Defense characters
 */
export const useTowerDefenseCharacterEditForm = (
  character: TowerDefenseCharacterDb,
  refetch: () => void,
) => {
  // Form handling
  const form = useForm<InsertTowerDefenseCharacter>({
    mode: "all",
    criteriaMode: "all",
    values: character,
    defaultValues: character,
    resolver: zodResolver(insertTowerDefenseCharacterSchema),
  });

  // tRPC utility
  const utils = api.useUtils();

  // Mutation for updating character
  const { mutate: updateCharacter, isPending: isUpdating } =
    api.towerDefense.updateCharacter.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await utils.towerDefense.getCharacter.invalidate({ id: character.id });
        refetch();
      },
    });

  // Form submission
  const handleCharacterSubmit = form.handleSubmit(
    (data) => {
      const diff = calculateContentDiff(character, data);
      if (diff.length > 0) {
        updateCharacter({ id: character.id, data });
      }
    },
    (errors) => showFormErrorsToast(errors),
  );

  // Watch for asset config
  const assetConfig = useWatch({
    control: form.control,
    name: "assetConfig",
    defaultValue: character.assetConfig,
  });

  // Watch for isPlayer
  const isPlayer = useWatch({
    control: form.control,
    name: "isPlayer",
    defaultValue: character.isPlayer,
  });

  // Update asset config
  const setAssetConfig = (config: CharacterAssetConfig | null) => {
    form.setValue("assetConfig", config, { shouldDirty: true });
  };

  // Update a single animation's state mapping
  const updateAnimationState = (
    animIndex: number,
    newState: CharacterAnimationState,
  ) => {
    if (!assetConfig) return;

    const updatedAnimations = [...assetConfig.animations];
    const anim = updatedAnimations[animIndex];
    if (anim) {
      updatedAnimations[animIndex] = { ...anim, state: newState };
      setAssetConfig({ ...assetConfig, animations: updatedAnimations });
    }
  };

  // Update animation settings
  const updateAnimationSettings = (
    animIndex: number,
    settings: { frameDurationMs?: number; loop?: boolean },
  ) => {
    if (!assetConfig) return;

    const updatedAnimations = [...assetConfig.animations];
    const anim = updatedAnimations[animIndex];
    if (anim) {
      updatedAnimations[animIndex] = { ...anim, ...settings };
      setAssetConfig({ ...assetConfig, animations: updatedAnimations });
    }
  };

  // Object for form values - changes based on whether character is player or enemy
  const formData: FormEntry<keyof InsertTowerDefenseCharacter>[] = [
    { id: "name", label: "Character Name", type: "text" },
    { id: "isPlayer", label: "Is Player Character", type: "boolean" },
    // Visual
    { id: "scaleFactor", label: "Visual Scale Factor", type: "number" },
    // Enemy-only fields (combat stats and scaling) - shown for both but only matter for enemies
    ...(isPlayer
      ? []
      : ([
          // Combat stats
          { id: "baseHealth", label: "Base Health", type: "number" },
          { id: "baseDamage", label: "Base Damage", type: "number" },
          { id: "baseSpeed", label: "Base Speed (tiles/sec)", type: "number" },
          { id: "attackCooldown", label: "Attack Cooldown (sec)", type: "number" },
          // Scaling factors
          { id: "healthScaling", label: "Health Scaling (per wave)", type: "number" },
          { id: "damageScaling", label: "Damage Scaling (per wave)", type: "number" },
          { id: "speedScaling", label: "Speed Scaling (per wave)", type: "number" },
          // Spawn configuration
          { id: "firstAppearWave", label: "First Appear Wave", type: "number" },
          { id: "baseCount", label: "Base Count (per wave)", type: "number" },
          { id: "countScaling", label: "Count Scaling (per wave)", type: "number" },
        ] as FormEntry<keyof InsertTowerDefenseCharacter>[])),
  ];

  return {
    character,
    form,
    formData,
    assetConfig,
    isPlayer,
    isUpdating,
    setAssetConfig,
    updateAnimationState,
    updateAnimationSettings,
    handleCharacterSubmit,
    characterAnimationStates,
  };
};
