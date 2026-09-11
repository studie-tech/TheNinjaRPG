import { zodResolver } from "@hookform/resolvers/zod";
import { useRef } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { GameAssetTypes } from "@/drizzle/constants";
import type { GameAsset } from "@/drizzle/schema";
import type { FormEntry } from "@/layout/EditContent";
import { showFormErrorsToast, showMutationToast } from "@/libs/toast";
import { calculateContentDiff } from "@/utils/diff";
import type { ZodGameAssetInput, ZodGameAssetType } from "@/validators/asset";
import { gameAssetValidator } from "@/validators/asset";

/**
 * Hook used when creating frontend forms for editing assets
 * @param data
 */
export const useAssetEditForm = (asset: GameAsset, refetch: () => Promise<unknown>) => {
  const submitInFlight = useRef(false);

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
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await refetch();
        }
      },
      onSettled: () => {
        submitInFlight.current = false;
      },
    });

  // Form submission
  const handleAssetSubmit = form.handleSubmit(
    async (data: ZodGameAssetType) => {
      if (submitInFlight.current) return;
      const newAsset = { ...asset, ...data };
      const diff = calculateContentDiff(asset, newAsset);
      if (diff.length > 0) {
        submitInFlight.current = true;
        try {
          await updateAsset({ id: asset.id, data: newAsset });
        } catch {
          // Mutation errors are surfaced by the shared tRPC error handler. Keep the
          // current form values in place so the editor can retry without retyping.
        }
      }
    },
    (errors) => showFormErrorsToast(errors),
  );

  // Watch for changes to avatar
  const imageUrl = useWatch({
    control: form.control,
    name: "image",
  });
  const soundUrl = useWatch({
    control: form.control,
    name: "url",
  });
  const type = useWatch({
    control: form.control,
    name: "type",
  });

  // Start with empty array
  const formData: FormEntry<keyof ZodGameAssetType>[] = [];

  // For scene backgrounds
  if (type === "SCENE_BACKGROUND") {
    formData.push({
      id: "image",
      type: "avatar",
      href: imageUrl,
      size: "landscape",
      maxDim: 512,
    });
  } else if (type === "SCENE_CHARACTER") {
    formData.push({
      id: "image",
      type: "avatar",
      href: imageUrl,
      size: "portrait",
      maxDim: 512,
    });
  } else if (type !== "SFX") {
    formData.push({ id: "image", type: "avatar", href: imageUrl, size: "square" });
  }

  // Object for form values
  formData.push(
    { id: "name", label: "Asset Name", type: "text" },
    { id: "licenseDetails", type: "text", label: "License Details" },
    { id: "type", type: "str_array", values: GameAssetTypes },
    { id: "folder", type: "text", label: "Folder Name" },
    { id: "hidden", type: "boolean" },
  );

  if (type === "MUSIC") {
    formData.push({
      id: "url",
      type: "audio",
      href: soundUrl,
      label: "Music URL",
      doubleWidth: true,
    });
  }

  if (type === "SFX") {
    formData.push({
      id: "url",
      type: "audio",
      href: soundUrl,
      label: "Music URL",
      doubleWidth: true,
    });
  }

  // For animations
  if (type === "ANIMATION") {
    formData.push({ id: "frames", type: "number", label: "Number of Frames" });
    formData.push({ id: "speed", type: "number", label: "Speed of Animation" });
  }

  // For static
  if (type === "STATIC") {
    formData.push({ id: "onInitialBattleField", type: "boolean" });
  }

  return { asset, form, formData, handleAssetSubmit, isUpdating };
};
