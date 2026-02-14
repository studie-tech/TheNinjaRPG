import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import type { TowerDefenseCharacterDb } from "@/drizzle/schema";
import type { FormEntry } from "@/layout/EditContent";
import { showFormErrorsToast, showMutationToast } from "@/libs/toast";
import { calculateContentDiff } from "@/utils/diff";
import {
  type CharacterAnimationState,
  type CharacterAssetConfig,
  characterAnimationStates,
  type InsertTowerDefenseCharacter,
  type InsertTowerDefenseCharacterInput,
  insertTowerDefenseCharacterSchema,
} from "@/validators/towerDefense";

/**
 * Hook used when creating frontend forms for editing Tower Defense characters
 */
export const useTowerDefenseCharacterEditForm = (
  character: TowerDefenseCharacterDb,
  refetch: () => void,
) => {
  // Form handling
  const form = useForm<
    InsertTowerDefenseCharacterInput,
    unknown,
    InsertTowerDefenseCharacter
  >({
    mode: "all",
    criteriaMode: "all",
    values: character as InsertTowerDefenseCharacterInput,
    defaultValues: character as InsertTowerDefenseCharacterInput,
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
    const config = assetConfig as CharacterAssetConfig;

    const updatedAnimations = [...config.animations];
    const anim = updatedAnimations[animIndex];
    if (anim) {
      updatedAnimations[animIndex] = { ...anim, state: newState };
      setAssetConfig({ ...config, animations: updatedAnimations });
    }
  };

  // Update animation settings
  const updateAnimationSettings = (
    animIndex: number,
    settings: { frameDurationMs?: number; loop?: boolean },
  ) => {
    if (!assetConfig) return;
    const config = assetConfig as CharacterAssetConfig;

    const updatedAnimations = [...config.animations];
    const anim = updatedAnimations[animIndex];
    if (anim) {
      updatedAnimations[animIndex] = { ...anim, ...settings };
      setAssetConfig({ ...config, animations: updatedAnimations });
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
