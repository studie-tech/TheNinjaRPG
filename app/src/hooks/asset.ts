import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { GameAssetTypes } from "@/drizzle/constants";
import type { GameAsset } from "@/drizzle/schema";
import { useContentSubmit } from "@/hooks/contentSubmit";
import { useLpcCatalogInvalidation } from "@/hooks/lpc";
import type { FormEntry } from "@/layout/EditContent";
import { assetTypeLabels } from "@/libs/assetLibrary";
import { showFormErrorsToast, showMutationToast } from "@/libs/toast";
import type { ZodGameAssetInput, ZodGameAssetType } from "@/validators/asset";
import { gameAssetValidator } from "@/validators/asset";

/**
 * Share media and metadata form state, retain failed edits, and refresh consumers on save.
 * @param asset Persisted baseline for form defaults and change detection.
 * @param refetch Reload the saved asset after a successful mutation.
 */
export const useAssetEditForm = (asset: GameAsset, refetch: () => Promise<unknown>) => {
  const submitContent = useContentSubmit();
  // Retain failure feedback until resubmission; editing a draft must not erase a new error.
  const [saveError, setSaveError] = useState<string | null>(null);
  const utils = api.useUtils();
  const invalidateLpcCatalog = useLpcCatalogInvalidation();

  // Form handling
  const form = useForm<ZodGameAssetInput, unknown, ZodGameAssetType>({
    mode: "all",
    criteriaMode: "all",
    values: asset as ZodGameAssetInput,
    defaultValues: asset as ZodGameAssetInput,
    resolver: zodResolver(gameAssetValidator),
  });

  // Mutation for updating asset
  const { mutateAsync: updateAsset, isPending: isUpdating } =
    api.gameAsset.update.useMutation({
      onSuccess: async (data, variables) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            refetch(),
            ...(asset.type === "LPC" || variables.data.type === "LPC"
              ? [invalidateLpcCatalog()]
              : []),
            utils.gameAsset.getAll.invalidate(),
            utils.gameAsset.getAllFolders.invalidate(),
            utils.gameAsset.getAllNames.invalidate(),
            utils.gameAsset.getNameTags.invalidate(),
            utils.misc.getAllGameAssetNames.invalidate(),
          ]);
        } else {
          setSaveError(data.message);
        }
      },
      onError: (error) => setSaveError(error.message),
    });

  // Form submission
  const handleAssetSubmit = form.handleSubmit(
    async (data: ZodGameAssetType) => {
      setSaveError(null);
      await submitContent(asset, { ...asset, ...data }, (newAsset) =>
        updateAsset({ id: asset.id, data: newAsset }),
      );
    },
    (errors) => {
      setSaveError(null);
      showFormErrorsToast(errors);
    },
  );

  // Subscribe to media/type changes without react-hook-form's compiler-incompatible watch.
  const [imageUrl, soundUrl, type] = useWatch({
    control: form.control,
    name: ["image", "url", "type"],
  });

  // Start with empty array
  const formData: FormEntry<keyof ZodGameAssetType>[] = [];

  // Scene artwork keeps landscape backgrounds and portrait characters at 512px.
  if (type === "SCENE_BACKGROUND" || type === "SCENE_CHARACTER") {
    formData.push({
      id: "image",
      label: "Artwork",
      type: "avatar",
      href: imageUrl,
      size: type === "SCENE_BACKGROUND" ? "landscape" : "portrait",
      maxDim: 512,
    });
  } else if (type !== "SFX" && type !== "LPC") {
    formData.push({
      id: "image",
      label: "Artwork",
      type: "avatar",
      href: imageUrl,
      size: "square",
    });
  }

  // Object for form values
  formData.push(
    { id: "name", label: "Asset name", type: "text" },
    {
      id: "licenseDetails",
      type: "textarea",
      rows: 3,
      label: "License details",
      fullWidth: true,
    },
    {
      id: "type",
      label: "Asset type",
      type: "db_values",
      values: GameAssetTypes.map((type) => ({ id: type, name: assetTypeLabels[type] })),
    },
    { id: "folder", type: "text", label: "Folder" },
    { id: "hidden", type: "boolean", label: "Hidden in game" },
  );

  if (type === "MUSIC" || type === "SFX") {
    formData.push({
      id: "url",
      type: "audio",
      href: soundUrl,
      label: type === "MUSIC" ? "Music" : "Sound effect",
      doubleWidth: true,
    });
  }

  // For animations
  if (type === "ANIMATION") {
    formData.push({ id: "frames", type: "number", label: "Number of frames" });
    formData.push({ id: "speed", type: "number", label: "Frame duration (ms)" });
  }

  // For static
  if (type === "STATIC") {
    formData.push({
      id: "onInitialBattleField",
      type: "boolean",
      label: "Use on initial battlefield",
    });
  }

  return { asset, form, formData, handleAssetSubmit, isUpdating, saveError };
};
