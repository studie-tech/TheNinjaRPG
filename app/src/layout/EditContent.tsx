"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, ChevronsUpDown, Loader2, Plus, X } from "lucide-react";
import { nanoid } from "nanoid";
import type React from "react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { FieldValues, Path, PathValue, UseFormReturn } from "react-hook-form";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect, type OptionType } from "@/components/ui/multi-select";
import { NumberInput, validateNumberInputs } from "@/components/ui/number-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ContentType, IMG_ORIENTATION } from "@/drizzle/constants";
import type { Quest } from "@/drizzle/schema";
import { ActionSelector } from "@/layout/CombatActions";
import ContentAudioSelector from "@/layout/ContentAudioSelector";
import ContentImage from "@/layout/ContentImage";
import ContentImageSelector from "@/layout/ContentImageSelector";
import { CoordinateTargetingEditor } from "@/layout/CoordinateTargetingEditor";
import { EpidemicSfxSearch } from "@/layout/EpidemicSfxSearch";
import Image from "@/layout/Image";
import { MapLocationPreview } from "@/layout/MapLocationPreview";
import { MethodSizeEditor } from "@/layout/MethodSizeEditor";
import Modal from "@/layout/Modal";
import { RewardEditor } from "@/layout/RewardEditor";
import RichInput from "@/layout/RichInput";
import type { ColumnDefinitionType } from "@/layout/Table";
import Table from "@/layout/Table";
import { WeightedCacheEditor } from "@/layout/WeightedCacheEditor";
import { damageModifierTypes } from "@/libs/combat/constants";
import { POTENCY_TAG_LABELS } from "@/libs/combat/potency";
import type { CombatAction } from "@/libs/combat/types";
import {
  isSupportedOverworldBindingTask,
  placementsForObjective,
} from "@/libs/overworldAi";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { cacheItemIds, defaultWeightedCache } from "@/libs/weightedCache";
import { calculateContentDiff } from "@/utils/diff";
import { isRetryableTrpcError } from "@/utils/error";
import { canAwardReputation } from "@/utils/permissions";
import type { DeepPartial } from "@/utils/typeutils";
import { objectKeys } from "@/utils/typeutils";
import { useUserData } from "@/utils/UserContext";
import { UploadButton } from "@/utils/uploadthing";
import type {
  ZodAllTags,
  ZodBloodlineType,
  ZodItemType,
  ZodJutsuType,
} from "@/validators/combat";
import {
  BloodlineValidator,
  getTagSchema,
  ItemValidator,
  JutsuValidator,
  questBuffTypes,
  questDebuffTypes,
} from "@/validators/combat";
import type { CoordinateTargeting } from "@/validators/coordinateTargeting";
import { supportsMapStructure } from "@/validators/mapLocation";
import type { MethodSize } from "@/validators/methodSize";
import type { AllObjectivesType } from "@/validators/objectives";
import {
  getObjectiveSchema,
  InstantTasks,
  type RaidTask,
  RaidTasks,
  type SimpleTask,
  SimpleTasks,
} from "@/validators/objectives";
import type { ObjectiveRewardType } from "@/validators/rewards";
import { ObjectiveReward } from "@/validators/rewards";
import { weightedCacheDraftSchema } from "@/validators/weightedCache";

export type FormDbValue = { id: string; name: string };

/**
 * Whether a combobox field has a selected value. `0` is a real choice (e.g. sage
 * Tier 2 "None"); only `undefined` / `null` / `""` count as empty.
 */
const hasComboboxValue = (value: unknown) =>
  value !== undefined && value !== null && value !== "";

export type FormEntry<K> = {
  id: K;
  label?: string;
  doubleWidth?: boolean;
  /** Span every grid track at all breakpoints, including implicit mobile tracks. */
  fullWidth?: boolean;
  resetButton?: boolean;
  searchable?: boolean;
  readonly?: boolean;
} & (
  | { type: "coordinate_targeting" }
  | { type: "method_size" }
  | { type: "text" }
  | { type: "textarea"; rows?: number }
  | { type: "richinput"; height?: string }
  | { type: "date" }
  | { type: "number" }
  | { type: "boolean" }
  | { type: "audio"; href?: string | null }
  | { type: "avatar"; href?: string | null; size?: IMG_ORIENTATION; maxDim?: number }
  | { type: "avatar3d"; modelUrl?: string | null; imgUrl?: string | null }
  | {
      type: "str_array";
      values: readonly string[];
      multiple?: boolean;
      allowAddNew?: boolean;
    }
  | {
      type: "db_values";
      values: FormDbValue[] | undefined;
      multiple?: boolean;
      current?: string;
    }
  | {
      type: "db_values_with_number";
      values: FormDbValue[] | undefined;
      multiple?: boolean;
      current?: string;
    }
  | {
      type: "dialog_options";
      values: { text: string; nextObjectiveId: string }[];
      objectiveIds: string[];
    }
);

interface EditContentProps<T, K, S extends FieldValues> {
  schema: T;
  form: UseFormReturn<S, any>;
  formData: FormEntry<K>[];
  showSubmit: boolean;
  /** Render controls without a nested form when embedded in another editor. */
  fieldsOnly?: boolean;
  /** Expose occupation drops in generic packages, which have no hunting/gathering quest type. */
  allowMaterialRewards?: boolean;
  /** Additional controls sharing this form's submission and disabled state. */
  children?: React.ReactNode;
  formClassName?: string;
  buttonTxt?: string;
  allowImageUpload?: boolean;
  relationId?: string;
  fixedWidths?: "basis-32" | "basis-64" | "basis-96";
  type?: ContentType;
  onAccept?: (
    e: React.BaseSyntheticEvent<object, any, any> | undefined,
  ) => Promise<void>;
  onEnter?: () => Promise<void>;
  submitDisabled?: boolean;
  submitLoading?: boolean;
  submitLoadingText?: string;
}

/**
 * Generic edit content component, used for creating and editing e.g. jutsu, bloodline, item, AI
 * @returns React.ReactNode
 */
export const EditContent = <
  T extends z.ZodObject<any>,
  K extends Path<S>,
  S extends z.infer<T>,
>(
  props: EditContentProps<T, K, S>,
) => {
  // Destructure
  const {
    formData,
    formClassName,
    form,
    showSubmit,
    buttonTxt,
    submitDisabled,
    submitLoading,
    submitLoadingText,
  } = props;
  const [uploadingFields, setUploadingFields] = useState<string[]>([]);
  const isImageUploading = uploadingFields.length > 0;
  const currentValues = form.getValues();
  const [targetingMethod, targetingRange] = useWatch({
    control: form.control,
    name: ["method" as Path<S>, "range" as Path<S>],
  });

  // State for managing dynamic options for fields with allowAddNew
  const [dynamicOptionsMap, setDynamicOptionsMap] = useState<
    Record<string, OptionType[]>
  >({});
  const [newItemInputMap, setNewItemInputMap] = useState<Record<string, string>>({});

  // Asset picker dialog state
  const [assetPickerOpen, setAssetPickerOpen] = useState<boolean>(false);
  const [assetPickerType, setAssetPickerType] = useState<
    "ANIMATION" | "STATIC" | "SFX"
  >("ANIMATION");
  const [assetPickerField, setAssetPickerField] = useState<string | null>(null);
  const [assetTokens, setAssetTokens] = useState<string[]>([]);

  // Asset picker data
  const { data: animationTagResp, isFetching: loadingAnimTags } =
    api.gameAsset.getNameTags.useQuery(
      { type: "ANIMATION", selected: assetTokens },
      { enabled: assetPickerOpen && assetPickerType === "ANIMATION" },
    );
  const { data: generalTagResp, isFetching: loadingGeneralTags } =
    api.gameAsset.getNameTags.useQuery(
      { type: assetPickerType, selected: assetTokens },
      { enabled: assetPickerOpen && assetPickerType !== "ANIMATION" },
    );
  const { data: assetPages } = api.gameAsset.getAll.useInfiniteQuery(
    { limit: 50, type: assetPickerType, nameTokens: assetTokens },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
      enabled: assetPickerOpen,
    },
  );
  const allPickerAssets = useMemo(
    () => (assetPages?.pages.flatMap((p) => p.data) || []).filter((a) => !a.hidden),
    [assetPages],
  );
  const pickerTags =
    assetPickerType === "ANIMATION" ? animationTagResp?.tags : generalTagResp?.tags;

  const openAssetPicker = (fieldId: string, type: "ANIMATION" | "STATIC" | "SFX") => {
    setAssetPickerField(fieldId);
    setAssetPickerType(type);
    setAssetTokens([]);
    setAssetPickerOpen(true);
  };

  // Watch selected asset ids for preview
  const watchAppearSel = useWatch({
    control: form.control,
    name: "appearAnimation" as Path<S>,
  });
  const watchDisappearSel = useWatch({
    control: form.control,
    name: "disappearAnimation" as Path<S>,
  });
  const watchStaticSel = useWatch({
    control: form.control,
    name: "staticAnimation" as Path<S>,
  });
  const watchAppearSfx = useWatch({
    control: form.control,
    name: "appearSfx" as Path<S>,
  });
  const watchDisappearSfx = useWatch({
    control: form.control,
    name: "disappearSfx" as Path<S>,
  });
  const previewIds = useMemo(
    () =>
      [
        watchAppearSel,
        watchDisappearSel,
        watchStaticSel,
        watchAppearSfx,
        watchDisappearSfx,
      ]
        .map((x) => (typeof x === "string" ? x : ""))
        .filter((x) => x.length > 0),
    [
      watchAppearSel,
      watchDisappearSel,
      watchStaticSel,
      watchAppearSfx,
      watchDisappearSfx,
    ],
  );
  const { data: previewAssets } = api.gameAsset.getSceneAssets.useQuery(
    { assetIds: previewIds },
    { enabled: previewIds.length > 0 },
  );

  // Event listener for submitting on enter click
  const onDocumentKeyDown = (event: KeyboardEvent) => {
    if (props.onEnter && !isImageUploading) {
      switch (event.key) {
        case "Enter":
          void props.onEnter();
          break;
      }
    }
  };
  useEffect(() => {
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => {
      document.removeEventListener("keydown", onDocumentKeyDown);
    };
  }, [props.onEnter, isImageUploading]);

  // Picker controls are rendered in a portal, outside the disabled fieldset below.
  // Close the picker when a caller opts into an in-flight submit lock so every
  // control belonging to this atomic form is consistently unavailable.
  useEffect(() => {
    if (submitLoading) {
      setAssetPickerOpen(false);
    }
  }, [submitLoading]);

  // Mutations
  // const { mutate: create3dModel } =
  //   api.openai.create3dModel.useMutation({
  //     onSuccess: (data, variables) => {
  //       showMutationToast({
  //         success: true,
  //         message: "3D model generated. Now fetching",
  //       });
  //       fetchReplicateResult({
  //         replicateId: data.replicateId,
  //         field: variables.field,
  //         removeBg: false,
  //       });
  //     },
  //   });

  // If this is a quest, deduce the quest-type
  const questType =
    props.type === "quest" ? form.getValues("questType" as Path<S>) : undefined;

  /**
   * Get the category of a form entry
   * @param id - The id of the form entry
   * @returns The category of the form entry
   */
  const getCategory = (id: string) => {
    if (id.includes("reward")) return "reward";
    if (id.includes("opponent") || ["scaleGains", "keepOriginalPools"].includes(id))
      return "opponent";
    if (id.includes("attackers")) return "attackers";
    if (["raidBossMaxHealth", "raidBossCurrentHealth"].includes(id)) return "raid";
    if (
      [
        "sector",
        "longitude",
        "latitude",
        "hideLocation",
        "sectorType",
        "locationType",
      ].includes(id)
    )
      return "location";
    if (
      [
        "description",
        "successDescription",
        "failDescription",
        "fleeDescription",
        "drawDescription",
        "completionOutcome",
        "sceneBackground",
        "sceneCharacters",
      ].includes(id)
    )
      return "scene";
    if (["nextObjectiveId", "failObjectiveId", "resetObjectiveId"].includes(id))
      return "graph";
    return "default";
  };

  const FormTag = props.fieldsOnly ? "div" : "form";
  // Count how many columns have been used
  let columnCount = 0;
  let lastCategory = "default";

  return (
    <Form {...form}>
      <FormTag
        onSubmit={(event) => {
          if (isImageUploading) {
            event.preventDefault();
            return;
          }
          void props.onAccept?.(event);
        }}
        className={
          formClassName ?? "grid grid-cols-1 items-center gap-1 md:grid-cols-2"
        }
      >
        {/* Asset Picker Dialog */}
        {assetPickerOpen && !submitLoading && (
          <Modal
            title={
              assetPickerType === "ANIMATION"
                ? "Pick Animation"
                : assetPickerType === "STATIC"
                  ? "Pick Static Asset"
                  : "Pick SFX"
            }
            isOpen={assetPickerOpen}
            setIsOpen={setAssetPickerOpen}
            isValid={false}
            className="max-h-[99%] w-[800px] max-w-[99%]"
          >
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {(loadingAnimTags || loadingGeneralTags) && (
                  <span className="text-sm opacity-70">Loading tags…</span>
                )}
                {pickerTags?.map((t) => (
                  <button
                    type="button"
                    key={t}
                    className={`rounded border px-2 py-1 text-xs ${assetTokens.includes(String(t)) ? "border-foreground bg-foreground text-background" : "border-muted-foreground/30 bg-background"}`}
                    onClick={(e) => {
                      e.preventDefault();
                      setAssetTokens((prev) =>
                        prev.includes(String(t))
                          ? prev.filter((x) => x !== String(t))
                          : [...prev, String(t)],
                      );
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {assetPickerType === "SFX" ? (
                <>
                  <div className="grid max-h-96 grid-cols-2 gap-3 overflow-auto md:grid-cols-3">
                    {(allPickerAssets || [])
                      .filter((a) => a.type === "SFX")
                      .map((a) => {
                        const selected =
                          String(form.getValues(assetPickerField as Path<S>) ?? "") ===
                          a.id;
                        return (
                          <div
                            key={a.id}
                            className={cn(
                              "space-y-2 rounded border p-2",
                              selected ? "border-green-500 bg-green-50" : "",
                            )}
                          >
                            <Label>{a.name}</Label>
                            {/* biome-ignore lint/a11y/useMediaCaption: Audio asset preview - no captions for music/sfx */}
                            <audio
                              src={a.url ?? undefined}
                              controls
                              className="w-full"
                            />
                            <Button
                              type="button"
                              variant={selected ? "default" : "secondary"}
                              className="w-full"
                              onClick={() => {
                                if (assetPickerField) {
                                  form.setValue(
                                    assetPickerField as unknown as Path<S>,
                                    a.id as PathValue<S, K>,
                                    { shouldDirty: true },
                                  );
                                  setAssetPickerOpen(false);
                                }
                              }}
                            >
                              {selected ? "Selected" : "Use this"}
                            </Button>
                          </div>
                        );
                      })}
                  </div>
                  <EpidemicSfxSearch
                    onImported={(assetId) => {
                      if (assetPickerField) {
                        form.setValue(
                          assetPickerField as unknown as Path<S>,
                          assetId as PathValue<S, K>,
                          { shouldDirty: true },
                        );
                        setAssetPickerOpen(false);
                      }
                    }}
                  />
                </>
              ) : (
                <ActionSelector
                  items={allPickerAssets?.map((a) => ({
                    ...a,
                    type: "asset" as const,
                  }))}
                  labelSingles={true}
                  onClick={(pickedId) => {
                    if (assetPickerField) {
                      // Directly set the form value for the field we opened the picker for
                      form.setValue(
                        assetPickerField as unknown as Path<S>,
                        pickedId as PathValue<S, K>,
                        { shouldDirty: true },
                      );
                      setAssetPickerOpen(false);
                    }
                  }}
                  showBgColor={false}
                  roundFull={true}
                  hideBorder={true}
                  showLabels={true}
                  gridClassNameOverwrite="grid grid-cols-3 md:grid-cols-4"
                  emptyText="No assets match the selected tags."
                />
              )}
            </div>
          </Modal>
        )}
        {/* biome-ignore format: Keep the display-contents fieldset from reformatting the large field renderer. */}
        <fieldset disabled={submitLoading} aria-busy={submitLoading} className="contents">
        {formData
          .filter((formEntry) => formEntry.type !== "avatar3d")
          .filter((formEntry) => {
            return (
              !["reward_hunter_items_ids", "reward_hunter_items"].includes(
                formEntry.id,
              ) ||
              questType === "hunting" ||
              props.type === "activityStreak" ||
              props.allowMaterialRewards
            );
          })
          .filter((formEntry) => {
            return (
              !["reward_gathering_items_ids", "reward_gathering_items"].includes(
                formEntry.id,
              ) ||
              questType === "gathering" ||
              props.type === "activityStreak" ||
              props.allowMaterialRewards
            );
          })
          .map((formEntry) => {
            return { ...formEntry, category: getCategory(formEntry.id) };
          })
          .sort((a, b) => {
            // Default category first, then alphabetical by category
            if (a.category === "default" && b.category !== "default") return -1;
            if (a.category !== "default" && b.category === "default") return 1;
            if (a.category !== b.category) {
              return a.category.localeCompare(b.category);
            }
            return 0;
          })
          .map((formEntry) => {
            // Derived
            const id = formEntry.id;
            let type = formEntry.type;

            // Options for select & multi-select
            let options: OptionType[] = [];
            if (formEntry.type === "str_array" && formEntry.values) {
              options.push(...formEntry.values.map((v) => ({ label: v, value: v })));
            } else if (formEntry.type === "db_values" && formEntry.values) {
              options.push(
                ...formEntry.values.map((v) => ({ label: v.name, value: v.id })),
              );
            }
            options = options.map((o) => ({
              label: o.label !== "" ? o.label : "None",
              value: o.value !== "" ? o.value : "None",
            }));

            // Show richInputs as text if fixedWidths
            if (props.fixedWidths && formEntry.type === "richinput") {
              type = "text";
            }

            // Prompt for image generation
            let prompt = "";
            // Generate based on name, title and description
            if (currentValues?.name) {
              prompt += `${currentValues?.name} `;
            }
            if (currentValues?.username) {
              prompt += `${currentValues?.username} `;
            }
            if (currentValues?.title) {
              prompt += `${currentValues?.title} `;
            }
            if (currentValues?.description) {
              prompt += `${currentValues?.description} `;
            }

            // Figure out if we need to add a spacer
            let includeSpacer = false;
            if (formEntry.category !== lastCategory) {
              includeSpacer = columnCount % 2 !== 0;
              columnCount = 0;
              lastCategory = formEntry.category;
            }
            columnCount += formEntry.doubleWidth ? 2 : 1;

            // Render
            return (
              <Fragment key={`formEntry-${id}`}>
                {includeSpacer && <div key={`spacer-${id}`} />}
                <div
                  className={cn(
                    "p-2",
                    ["avatar", "avatar3d"].includes(type) &&
                      !(formEntry.type === "avatar" && formEntry.size === "landscape")
                      ? "row-span-5"
                      : "",
                    formEntry.fullWidth
                      ? "col-span-full"
                      : formEntry.doubleWidth
                        ? "md:col-span-2"
                        : "",
                    props.fixedWidths
                      ? `h-32 shrink-0 grow-0 px-2 pt-3 ${props.fixedWidths}`
                      : "",
                    // Rewards drawn in green
                    formEntry.category === "reward"
                      ? "rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20"
                      : "",
                    // Oppoenents drawn in red
                    formEntry.category === "opponent"
                      ? "rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20"
                      : "",
                    // Attackers drawn in red
                    formEntry.category === "attackers"
                      ? "rounded-lg border border-pink-200 bg-pink-100 dark:border-pink-800 dark:bg-pink-900/20"
                      : "",
                    // Raid things in orange
                    formEntry.category === "raid"
                      ? "rounded-lg border border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-900/20"
                      : "",
                    // Location things in blue
                    formEntry.category === "location"
                      ? "rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20"
                      : "",
                    // Graph things in purple
                    formEntry.category === "graph"
                      ? "rounded-lg border border-purple-200 bg-purple-50 dark:border-purple-800 dark:bg-purple-900/20"
                      : "",
                    // Description things in yellow
                    formEntry.category === "scene"
                      ? "rounded-lg border border-yellow-200 bg-yellow-50 text-black dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-white"
                      : "",
                  )}
                >
                  {["text", "number", "date"].includes(type) && (
                    <FormField
                      control={form.control}
                      name={id}
                      render={({ field, fieldState }) => {
                        // Defaulted numbers need a numeric draft: undefined restores Controller's saved default.
                        const emptyValue = props.schema.shape[id]?.safeParse(undefined);
                        const isOptional =
                          emptyValue?.success &&
                          (emptyValue.data === undefined || emptyValue.data === null);
                        return (
                          <FormItem>
                            <FormLabel htmlFor={id}>
                              {formEntry.label ? formEntry.label : id}
                            </FormLabel>
                            <FormControl>
                              {type === "number" ? (
                                <NumberInput
                                  id={id}
                                  isDirty={fieldState.isDirty}
                                  readOnly={formEntry.readonly}
                                  name={field.name}
                                  ref={field.ref}
                                  onBlur={field.onBlur}
                                  // Read explicit undefined without Controller's saved-value fallback.
                                  value={form.getValues(id) as number | undefined}
                                  optional={isOptional}
                                  onValueChange={
                                    isOptional ? undefined : field.onChange
                                  }
                                  onOptionalValueChange={
                                    isOptional ? field.onChange : undefined
                                  }
                                  step="any"
                                />
                              ) : (
                                <Input
                                  id={id}
                                  type={type}
                                  isDirty={fieldState.isDirty}
                                  readOnly={formEntry.readonly}
                                  {...field}
                                  value={
                                    field.value as
                                      | string
                                      | number
                                      | readonly string[]
                                      | undefined
                                  }
                                />
                              )}
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        );
                      }}
                    />
                  )}
                  {type === "method_size" && (
                    <FormField control={form.control} name={id} render={({ field }) => (
                      <FormItem>
                        <FormLabel>Method size</FormLabel>
                        <MethodSizeEditor value={field.value as MethodSize | null | undefined} onChange={field.onChange} method={targetingMethod as CombatAction["method"]} range={Number(targetingRange) || 0} readonly={formEntry.readonly} />
                        <FormMessage />
                      </FormItem>
                    )} />
                  )}
                  {type === "coordinate_targeting" && (
                    <FormField
                      control={form.control}
                      name={id}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{formEntry.label ?? "Coordinate pattern"}</FormLabel>
                          <CoordinateTargetingEditor value={field.value as CoordinateTargeting | null | undefined} onChange={field.onChange} readonly={formEntry.readonly} />
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                  {type === "textarea" && (
                    <FormField
                      control={form.control}
                      name={id}
                      render={({ field, fieldState }) => {
                        return (
                          <FormItem>
                            <FormLabel htmlFor={id}>
                              {formEntry.label ? formEntry.label : id}
                            </FormLabel>
                            <FormControl>
                              <Textarea
                                id={id}
                                rows={
                                  formEntry.type === "textarea"
                                    ? (formEntry.rows ?? 5)
                                    : 5
                                }
                                isDirty={fieldState.isDirty}
                                readOnly={formEntry.readonly}
                                {...field}
                                value={(field.value as string | undefined) ?? ""}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        );
                      }}
                    />
                  )}
                  {"boolean" === type && (
                    <FormField
                      control={form.control}
                      name={id}
                      render={({ field, fieldState }) => {
                        return (
                          <FormItem>
                            <FormLabel>
                              {formEntry.label ? formEntry.label : id}
                            </FormLabel>
                            <FormControl>
                              <Switch
                                checked={field.value as boolean | undefined}
                                isDirty={fieldState.isDirty}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        );
                      }}
                    />
                  )}
                  {type === "richinput" && currentValues && (
                    <FormField
                      control={form.control}
                      name={id}
                      render={({ fieldState }) => {
                        return (
                          <FormItem>
                            <FormControl>
                              <RichInput
                                id={id}
                                disabled={submitLoading}
                                height={
                                  "height" in formEntry && formEntry.height
                                    ? formEntry.height
                                    : "200"
                                }
                                placeholder={currentValues[id] as string}
                                label={formEntry.label ? formEntry.label : id}
                                control={form.control}
                                isDirty={fieldState.isDirty}
                                error={form.formState.errors[id]?.message as string}
                                allowClipboardPaste={true}
                                onUploadPendingChange={(pending) => setUploadingFields((fields) => pending ? [...new Set([...fields, id])] : fields.filter((fieldId) => fieldId !== id))}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        );
                      }}
                    />
                  )}
                  {(type === "str_array" ||
                    (type === "db_values" &&
                      ![
                        "appearAnimation",
                        "disappearAnimation",
                        "staticAnimation",
                        "staticAssetPath",
                        "appearSfx",
                        "disappearSfx",
                      ].includes(id))) && (
                    <div className="flex min-w-0 flex-row items-end">
                      <div className="min-w-0 flex-1">
                        <FormField
                          control={form.control}
                          name={id}
                          render={({ field, fieldState }) => {
                            const canAddNew =
                              "allowAddNew" in formEntry && formEntry.allowAddNew;

                            // Get or initialize dynamic options for this field
                            const fieldId = String(id);
                            const dynamicOptions =
                              dynamicOptionsMap[fieldId] || options;
                            const newItemInput = newItemInputMap[fieldId] || "";
                            const selectedLabel = hasComboboxValue(field.value)
                              ? dynamicOptions.find(
                                  (option) => String(option.value) === String(field.value),
                                )?.label
                              : "Select option";

                            const setDynamicOptions = (newOptions: OptionType[]) => {
                              setDynamicOptionsMap((prev) => ({
                                ...prev,
                                [fieldId]: newOptions,
                              }));
                            };

                            const setNewItemInput = (value: string) => {
                              setNewItemInputMap((prev) => ({
                                ...prev,
                                [fieldId]: value,
                              }));
                            };

                            const addNewItem = () => {
                              if (
                                newItemInput.trim() &&
                                !dynamicOptions.find(
                                  (opt) => opt.value === newItemInput.trim(),
                                )
                              ) {
                                const newOption = {
                                  label: newItemInput.trim(),
                                  value: newItemInput.trim(),
                                };
                                const updatedOptions = [...dynamicOptions, newOption];
                                setDynamicOptions(updatedOptions);

                                // If single select, auto-select the new item
                                if (!("multiple" in formEntry && formEntry.multiple)) {
                                  form.setValue(
                                    id,
                                    newItemInput.trim() as PathValue<S, K>,
                                  );
                                } else {
                                  // If multi-select, add to current selection
                                  const currentValues = (field.value ?? []) as string[];
                                  field.onChange([
                                    ...currentValues,
                                    newItemInput.trim(),
                                  ]);
                                }

                                setNewItemInput("");
                              }
                            };

                            return (
                              <FormItem className="flex flex-col">
                                <FormLabel>
                                  {formEntry.label ? formEntry.label : id}
                                </FormLabel>

                                {"multiple" in formEntry && formEntry.multiple ? (
                                  <MultiSelect
                                    selected={(field.value ?? []) as string[]}
                                    isDirty={fieldState.isDirty}
                                    options={dynamicOptions}
                                    onChange={field.onChange}
                                    allowAddNew={canAddNew}
                                    onAddNewOption={(newOption) => {
                                      setDynamicOptions([...dynamicOptions, newOption]);
                                    }}
                                  />
                                ) : (
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      <FormControl>
                                        <Button
                                          variant="outline"
                                          role="combobox"
                                          className={cn(
                                            "w-full justify-between",
                                            !hasComboboxValue(field.value) &&
                                              "text-muted-foreground",
                                            fieldState.isDirty && "border-orange-300",
                                          )}
                                        >
                                          <span className="min-w-0 truncate text-left" title={selectedLabel}>
                                            {selectedLabel}
                                          </span>
                                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                        </Button>
                                      </FormControl>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[200px] p-0">
                                      <Command>
                                        {(formEntry.searchable ||
                                          (formEntry.type === "db_values" &&
                                            dynamicOptions.length > 5)) && (
                                          <CommandInput
                                            placeholder="Search..."
                                            className="h-9"
                                          />
                                        )}

                                        <CommandList>
                                          <CommandEmpty>No entries found.</CommandEmpty>
                                          <CommandGroup>
                                            {dynamicOptions.map((option) => (
                                              <CommandItem
                                                value={option.label}
                                                key={option.value}
                                                keywords={[option.label]}
                                                onSelect={() => {
                                                  form.setValue(
                                                    id,
                                                    option.value as PathValue<S, K>,
                                                    { shouldDirty: true },
                                                  );
                                                }}
                                              >
                                                {option.label}
                                                <Check
                                                  className={cn(
                                                    "ml-auto",
                                                    String(option.value) ===
                                                      String(field.value)
                                                      ? "opacity-100"
                                                      : "opacity-0",
                                                  )}
                                                />
                                              </CommandItem>
                                            ))}
                                          </CommandGroup>
                                          {canAddNew && (
                                            <div className="border-t p-2">
                                              <div className="flex items-center space-x-2">
                                                <Input
                                                  placeholder="Add new option..."
                                                  value={newItemInput}
                                                  onChange={(e) =>
                                                    setNewItemInput(e.target.value)
                                                  }
                                                  onKeyDown={(e) => {
                                                    if (e.key === "Enter") {
                                                      e.preventDefault();
                                                      addNewItem();
                                                    }
                                                  }}
                                                  className="h-8"
                                                />
                                                <Button
                                                  size="sm"
                                                  onClick={addNewItem}
                                                  disabled={!newItemInput.trim()}
                                                  className="h-8 w-8 p-0"
                                                >
                                                  <Plus className="h-4 w-4" />
                                                </Button>
                                              </div>
                                            </div>
                                          )}
                                        </CommandList>
                                      </Command>
                                    </PopoverContent>
                                  </Popover>
                                )}

                                <FormMessage />
                              </FormItem>
                            );
                          }}
                        />
                      </div>
                      {formEntry.resetButton && (
                        <Button
                          aria-label={`Clear ${formEntry.label ?? id}`}
                          className="ml-1 w-8 shrink-0 p-0"
                          type="button"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            // Nullable selections clear to null; string-only selections keep an empty string.
                            const emptyValue = props.schema.shape[id]?.isNullable() ? null : "";
                            form.setValue(id, emptyValue as PathValue<S, K>, {
                              shouldDirty: true,
                            });
                          }}
                        >
                          <X className="h-5 w-5 stroke-1" />
                        </Button>
                      )}
                      {"current" in formEntry && formEntry.current && (
                        <div className="ml-1 h-12 w-12 overflow-y-auto">
                          <Image
                            src={formEntry.current}
                            alt={id}
                            width={100}
                            height={100}
                            priority
                          />
                        </div>
                      )}
                    </div>
                  )}
                  {type === "db_values" &&
                    [
                      "appearAnimation",
                      "disappearAnimation",
                      "staticAnimation",
                      "staticAssetPath",
                      "appearSfx",
                      "disappearSfx",
                    ].includes(id) && (
                      <div className="flex flex-row items-start gap-3">
                        <FormField
                          control={form.control}
                          name={id}
                          render={({ field }) => {
                            const label = formEntry.label ? formEntry.label : id;
                            const handleOpen = () => {
                              const t =
                                id === "staticAssetPath"
                                  ? "STATIC"
                                  : id === "appearSfx" || id === "disappearSfx"
                                    ? "SFX"
                                    : "ANIMATION";
                              openAssetPicker(id, t);
                            };
                            const selectedOption = options.find(
                              (o) => o.value === field.value,
                            );
                            return (
                              <div className="flex w-full flex-row items-start gap-3">
                                <FormItem className="flex-1">
                                  <FormLabel>{label}</FormLabel>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      className={cn(
                                        "w-full justify-between",
                                        field.value ? "" : "text-muted-foreground",
                                      )}
                                      onClick={handleOpen}
                                    >
                                      {selectedOption?.label || "Pick from dialog"}
                                    </Button>
                                    <Button
                                      className="w-8 p-0"
                                      type="button"
                                      variant="ghost"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        form.setValue(id, "" as PathValue<S, K>, {
                                          shouldDirty: true,
                                        });
                                      }}
                                    >
                                      <X className="h-5 w-5 stroke-1" />
                                    </Button>
                                  </div>
                                  <FormMessage />
                                </FormItem>
                                {/* Preview to the right */}
                                <div
                                  className={cn(
                                    "h-24",
                                    id === "appearSfx" || id === "disappearSfx"
                                      ? "w-48"
                                      : "w-24",
                                  )}
                                >
                                  {id === "staticAssetPath" ? (
                                    formEntry &&
                                    "current" in formEntry &&
                                    formEntry.current ? (
                                      <ContentImage
                                        image={formEntry.current}
                                        alt={id}
                                        className=""
                                        roundFull={false}
                                        hideBorder={false}
                                      />
                                    ) : null
                                  ) : id === "appearSfx" || id === "disappearSfx" ? (
                                    (() => {
                                      const sfx = (previewAssets || []).find(
                                        (a) => a.id === (field.value as string),
                                      );
                                      return sfx?.url ? (
                                        // biome-ignore lint/a11y/useMediaCaption: SFX assets don't have caption content
                                        <audio
                                          src={sfx.url}
                                          controls
                                          className="w-full"
                                        />
                                      ) : null;
                                    })()
                                  ) : (
                                    (() => {
                                      const asset = (previewAssets || []).find(
                                        (a) => a.id === field.value || "",
                                      );
                                      return asset?.image ? (
                                        <ContentImage
                                          image={asset.image}
                                          alt={String(field.value || id)}
                                          className=""
                                          frames={
                                            typeof asset?.frames === "number"
                                              ? asset?.frames
                                              : undefined
                                          }
                                          speed={
                                            typeof asset?.speed === "number"
                                              ? asset?.speed
                                              : undefined
                                          }
                                          roundFull={false}
                                          hideBorder={false}
                                        />
                                      ) : null;
                                    })()
                                  )}
                                </div>
                              </div>
                            );
                          }}
                        />
                      </div>
                    )}
                  {formEntry.type === "avatar" &&
                    props.allowImageUpload &&
                    props.type && (
                      <FormField
                        control={form.control}
                        name={id}
                        render={({ field }) => {
                          const sizeVal: IMG_ORIENTATION =
                            formEntry.type === "avatar" && "size" in formEntry
                              ? ((formEntry as { size?: IMG_ORIENTATION }).size ??
                                "square")
                              : "square";
                          const maxDimVal: number =
                            formEntry.type === "avatar" && "maxDim" in formEntry
                              ? ((formEntry as { maxDim?: number }).maxDim ?? 256)
                              : 256;
                          return props.type ? (
                            <FormItem>
                              <FormControl>
                                <ContentImageSelector
                                  label={formEntry.label ? formEntry.label : id}
                                  imageUrl={(field.value as string) ?? formEntry.href}
                                  id={props.relationId ?? nanoid()}
                                  allowImageUpload={props.allowImageUpload}
                                  prompt={prompt}
                                  type={props.type}
                                  onUploadComplete={(url) => {
                                    field.onChange(url);
                                  }}
                                  size={sizeVal}
                                  maxDim={maxDimVal}
                                  disabled={submitLoading}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          ) : (
                            <div>Missing content type</div>
                          );
                        }}
                      />
                    )}
                  {formEntry.type === "audio" && (
                    <FormField
                      control={form.control}
                      name={id}
                      render={({ field }) => {
                        const value = field.value as string;
                        const audioUrl = value.includes(".webp")
                          ? undefined
                          : value || (formEntry.href as string | null) || "";
                        return (
                          <FormItem>
                            <FormLabel>
                              {formEntry.label ? formEntry.label : id}
                            </FormLabel>
                            <div className="items-left flex w-full flex-col gap-2">
                              {audioUrl ? (
                                // biome-ignore lint/a11y/useMediaCaption: SFX/audio assets don't have caption content
                                <audio className="w-full" src={audioUrl} controls />
                              ) : (
                                <div className="text-muted-foreground text-sm">
                                  No audio set currently
                                </div>
                              )}
                              <div className="flex w-full items-center justify-center gap-2">
                                <ContentAudioSelector
                                  relationId={props.relationId ?? nanoid()}
                                  value={audioUrl}
                                  onChange={(url) =>
                                    form.setValue(id, url as PathValue<S, K>, {
                                      shouldDirty: true,
                                    })
                                  }
                                />
                                <UploadButton
                                  input={{
                                    relationId: props.relationId ?? nanoid(),
                                  }}
                                  endpoint={(() => {
                                    const assetType =
                                      (props.type === "asset"
                                        ? (form.getValues(
                                            "type" as Path<S>,
                                          ) as unknown as string)
                                        : undefined) || "SFX";
                                    return assetType === "MUSIC"
                                      ? "audioMusicUploader"
                                      : "audioSfxUploader";
                                  })()}
                                  onClientUploadComplete={(res) => {
                                    const url = res?.[0]?.ufsUrl;
                                    if (url) {
                                      form.setValue(id, url as PathValue<S, K>, {
                                        shouldDirty: true,
                                      });
                                    }
                                  }}
                                  onUploadError={(error: Error) => {
                                    showMutationToast({
                                      success: false,
                                      message: error.message,
                                    });
                                  }}
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className="w-8 p-0"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    form.setValue(id, "" as PathValue<S, K>, {
                                      shouldDirty: true,
                                    });
                                  }}
                                  aria-label="Clear audio"
                                >
                                  <X className="h-5 w-5 stroke-1" />
                                </Button>
                              </div>
                            </div>
                            <FormMessage />
                          </FormItem>
                        );
                      }}
                    />
                  )}
                  {formEntry.type === "dialog_options" ? (
                    <FormField
                      control={form.control}
                      name={id}
                      render={({ field }) => {
                        const dialogOptions: {
                          text: string;
                          nextObjectiveId: string;
                        }[] = Array.isArray(field.value)
                          ? (field.value as {
                              text: string;
                              nextObjectiveId: string;
                            }[])
                          : [];
                        return (
                          <FormItem className="flex flex-col gap-2">
                            <FormLabel>{formEntry.label ?? id}</FormLabel>
                            <div className="flex flex-col gap-2">
                              {dialogOptions.map((opt, optionIdx) => {
                                const option: {
                                  text: string;
                                  nextObjectiveId: string;
                                } = opt;
                                return (
                                  <div
                                    key={`dialog-option-${option.nextObjectiveId}-${optionIdx}`}
                                    className="flex items-center gap-2"
                                  >
                                    <Input
                                      className="flex-1"
                                      placeholder="Dialog text..."
                                      value={option.text}
                                      onChange={(e) => {
                                        const updated = [...dialogOptions];
                                        updated[optionIdx] = {
                                          ...option,
                                          text: e.target.value,
                                        };
                                        field.onChange(updated);
                                      }}
                                    />
                                    <Popover>
                                      <PopoverTrigger asChild>
                                        <Button
                                          variant="outline"
                                          className="min-w-[120px] flex-1"
                                        >
                                          {option.nextObjectiveId
                                            ? formEntry.objectiveIds.find(
                                                (oid) => oid === option.nextObjectiveId,
                                              ) || "Select objective"
                                            : "Select objective"}
                                          <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                                        </Button>
                                      </PopoverTrigger>
                                      <PopoverContent className="w-[200px] p-0">
                                        <Command>
                                          <CommandInput
                                            placeholder="Search objectives..."
                                            className="h-9"
                                          />
                                          <CommandList>
                                            <CommandEmpty>
                                              No objectives found.
                                            </CommandEmpty>
                                            <CommandGroup>
                                              {formEntry.objectiveIds.map((oid) => (
                                                <CommandItem
                                                  key={oid}
                                                  value={oid}
                                                  keywords={[oid]}
                                                  onSelect={() => {
                                                    const updated = [...dialogOptions];
                                                    updated[optionIdx] = {
                                                      ...option,
                                                      nextObjectiveId: oid,
                                                    };
                                                    field.onChange(updated);
                                                  }}
                                                >
                                                  {oid}
                                                  <Check
                                                    className={cn(
                                                      "ml-auto",
                                                      oid === option.nextObjectiveId
                                                        ? "opacity-100"
                                                        : "opacity-0",
                                                    )}
                                                  />
                                                </CommandItem>
                                              ))}
                                            </CommandGroup>
                                          </CommandList>
                                        </Command>
                                      </PopoverContent>
                                    </Popover>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      className="p-1"
                                      onClick={() => {
                                        const updated = dialogOptions.filter(
                                          (_, filterIdx) => filterIdx !== optionIdx,
                                        );
                                        field.onChange(updated);
                                      }}
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </div>
                                );
                              })}
                              <Button
                                type="button"
                                variant="secondary"
                                className="mt-2 w-full"
                                onClick={() => {
                                  field.onChange([
                                    ...dialogOptions,
                                    {
                                      text: "",
                                      nextObjectiveId: formEntry.objectiveIds[0] ?? "",
                                    },
                                  ]);
                                }}
                              >
                                <Plus className="mr-1 h-4 w-4" /> Add Dialog Option
                              </Button>
                            </div>
                            <FormMessage />
                          </FormItem>
                        );
                      }}
                    />
                  ) : null}
                  {formEntry.type === "db_values_with_number" ? (
                    <FormField
                      control={form.control}
                      name={id}
                      render={({ field }) => {
                        // Each entry: { ids: string[], number: number, quantity?: number }
                        const valueArr: {
                          ids: string[];
                          number: number;
                          quantity?: number;
                        }[] = Array.isArray(field.value) ? field.value : [];
                        const options = (formEntry.values || []).map((v) => ({
                          label: v.name,
                          value: v.id,
                        }));
                        // Check if this is a reward_items field (supports quantity)
                        const isRewardItems = id === "reward_items";
                        return (
                          <FormItem className="flex flex-col py-4">
                            <FormLabel>{formEntry.label ?? id}</FormLabel>
                            <div className="flex flex-col gap-2">
                              {valueArr.map((entry, entryIdx) => (
                                <div
                                  key={`db-value-${entry.ids.join("-") || entryIdx}-${entry.number}`}
                                  className="flex items-center gap-2"
                                >
                                  {/* Dropdown for db_value */}
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      <Button
                                        variant="outline"
                                        className="min-w-[120px] flex-1 justify-between"
                                      >
                                        {options.find((o) =>
                                          entry.ids.includes(o.value),
                                        )?.label || "Select Entry"}
                                        <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                                      </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[200px] p-0">
                                      <Command>
                                        <CommandInput
                                          placeholder="Search..."
                                          className="h-9"
                                        />
                                        <CommandList>
                                          <CommandEmpty>No options found.</CommandEmpty>
                                          <CommandGroup>
                                            {options.map((option) => (
                                              <CommandItem
                                                key={option.value}
                                                value={option.value}
                                                keywords={[option.label]}
                                                onSelect={() => {
                                                  const updated = [...valueArr];
                                                  const ids = entry.ids.includes(
                                                    option.value,
                                                  )
                                                    ? entry.ids.filter(
                                                        (id) => id !== option.value,
                                                      )
                                                    : [...entry.ids, option.value];
                                                  updated[entryIdx] = {
                                                    ...entry,
                                                    ids: ids,
                                                  };
                                                  field.onChange(updated);
                                                }}
                                              >
                                                {option.label}
                                                <Check
                                                  className={cn(
                                                    "ml-auto",
                                                    entry.ids.includes(option.value)
                                                      ? "opacity-100"
                                                      : "opacity-0",
                                                  )}
                                                />
                                              </CommandItem>
                                            ))}
                                          </CommandGroup>
                                        </CommandList>
                                      </Command>
                                    </PopoverContent>
                                  </Popover>
                                  {/* Drop chance % input (for reward_items) or Number input (for others) */}
                                  <div className="flex items-center gap-1">
                                    <NumberInput
                                      step="any"
                                      min={0}
                                      max={isRewardItems ? 100 : undefined}
                                      className="w-20"
                                      title={isRewardItems ? "Drop chance %" : "Number"}
                                      placeholder={isRewardItems ? "%" : "#"}
                                      value={entry.number}
                                      onValueChange={(value) => {
                                        const updated = [...valueArr];
                                        updated[entryIdx] = { ...entry, number: value };
                                        field.onChange(updated);
                                      }}
                                    />
                                    {isRewardItems && (
                                      <span className="text-muted-foreground text-xs">
                                        %
                                      </span>
                                    )}
                                  </div>
                                  {/* Quantity input (only for reward_items) */}
                                  {isRewardItems && (
                                    <div className="flex items-center gap-1">
                                      <NumberInput
                                        min={1}
                                        step={1}
                                        className="w-20"
                                        title="Quantity"
                                        placeholder="qty"
                                        value={entry.quantity ?? 1}
                                        onValueChange={(value) => {
                                          const updated = [...valueArr];
                                          updated[entryIdx] = { ...entry, quantity: value };
                                          field.onChange(updated);
                                        }}
                                      />
                                      <span className="text-muted-foreground text-xs">
                                        qty
                                      </span>
                                    </div>
                                  )}
                                  {/* Remove button */}
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    className="p-1"
                                    onClick={() => {
                                      const updated = valueArr.filter(
                                        (_, i) => i !== entryIdx,
                                      );
                                      field.onChange(updated);
                                    }}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </div>
                              ))}
                              <Button
                                type="button"
                                variant="secondary"
                                className="w-full"
                                onClick={() => {
                                  // For reward_items: default to 100% drop chance, 1 quantity
                                  // For others (like opponentAIs, attackers): default to number: 1
                                  const newEntry = isRewardItems
                                    ? { ids: [], number: 100, quantity: 1 }
                                    : { ids: [], number: 1 };
                                  field.onChange([...valueArr, newEntry]);
                                }}
                                disabled={options.length === 0}
                              >
                                <Plus className="mr-1 h-4 w-4" /> Add Entry
                              </Button>
                            </div>
                            <FormMessage />
                          </FormItem>
                        );
                      }}
                    />
                  ) : null}
                </div>
              </Fragment>
            );
          })}
        {props.children}
        {showSubmit && props.onAccept && (
          <div className="col-span-full mt-3 items-center">
            <span className="sr-only" role="status" aria-live="polite">
              {submitLoading ? (submitLoadingText ?? "Saving") : ""}
            </span>
            <Button
              id="create"
              className="w-full"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (props?.onAccept) {
                  void props.onAccept(e);
                }
              }}
              disabled={submitDisabled || submitLoading || isImageUploading}
              aria-busy={submitLoading}
            >
              {submitLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {submitLoading
                ? (submitLoadingText ?? "Saving")
                : (buttonTxt ?? "Save")}
            </Button>
          </div>
        )}
        </fieldset>
      </FormTag>
    </Form>
  );
};

interface EffectFormWrapperProps {
  allowCoordinateTargeting?: boolean;
  idx: number;
  type: "jutsu" | "bloodline" | "item" | "skillTree" | "sageMode";
  availableTags: readonly string[];
  formClassName?: string;
  hideTagType?: boolean;
  editableFields?: readonly string[];
  tag: ZodAllTags;
  fixedWidths?: "basis-32" | "basis-64" | "basis-96";
  effects: ZodAllTags[];
  setEffects: (effects: ZodAllTags[]) => void;
  submitLoading?: boolean;
}

/**
 * Render one effect tag with schema-derived editor fields.
 * @returns React.ReactNode
 */
export const EffectFormWrapper: React.FC<EffectFormWrapperProps> = (props) => {
  // Destructure props
  const { tag, idx, effects, formClassName, setEffects } = props;

  // Get user data for permission checks
  const { data: userData } = useUserData();
  const userRole = userData?.role ?? "USER";
  const hasReputationPermission = canAwardReputation(userRole);

  // Get the schema & parse the tag
  const tagSchema = getTagSchema(tag.type);
  const parsedTag = tagSchema.safeParse(tag);
  const shownTag = parsedTag.success ? parsedTag.data : tag;
  const fields = Object.keys(shownTag);

  // Queries
  const { data: aiData } = api.profile.getAllAiNames.useQuery(undefined, {
    enabled: Object.keys(shownTag).includes("aiId"),
  });

  const { data: questData } = api.quests.getAllNames.useQuery(undefined, {
    enabled: fields.includes("questId"),
  });

  const { data: jutsuData } = api.jutsu.getAllNames.useQuery(undefined, {
    enabled:
      fields.includes("jutsus") ||
      fields.includes("reward_jutsus") ||
      fields.includes("jutsuIds"),
  });

  const {
    data: itemData,
    isLoading: isItemCatalogLoading,
    isError: isItemCatalogError,
    refetch: refetchItemCatalog,
  } = api.item.getAllNames.useQuery(undefined, {
    enabled:
      fields.includes("items") ||
      fields.includes("reward_items") ||
      fields.includes("skillId"),
  });

  const { data: bloodlines } = api.bloodline.getAllNames.useQuery(undefined, {
    enabled: fields.includes("reward_bloodlines"),
  });

  const { data: sageModes } = api.sageMode.getAllNames.useQuery(undefined, {
    enabled: fields.includes("reward_sage_modes"),
  });

  const {
    data: petSpecies,
    isError: isPetSpeciesError,
    refetch: refetchPetSpecies,
  } = api.petSpecies.getAll.useQuery(undefined, {
    enabled: fields.includes("reward_pets"),
  });

  const { data: skillsData } = api.skillTree.getAllNames.useQuery(undefined, {
    enabled: fields.includes("skillId"),
  });

  const { data: titleData } = api.title.getAllNames.useQuery(undefined, {
    enabled: fields.includes("reward_titles"),
  });

  const { data: badgeData } = api.badge.getAll.useQuery(undefined, {
    enabled: fields.includes("reward_badges"),
  });

  const { data: assetData } = api.misc.getAllGameAssetNames.useQuery(undefined, {
    enabled:
      fields.includes("staticAssetPath") ||
      fields.includes("appearAnimation") ||
      fields.includes("staticAnimation") ||
      fields.includes("disappearAnimation") ||
      fields.includes("appearSfx") ||
      fields.includes("disappearSfx"),
  });

  // Form for handling the specific tag
  const form = useForm<any>({
    defaultValues: shownTag,
    values: shownTag,
    resolver: zodResolver(tagSchema),
    mode: "all",
  });

  // A few fields we need to watch
  const watchType = useWatch({ control: form.control, name: "type" });
  const watchStaticPath = useWatch({ control: form.control, name: "staticAssetPath" });
  const watchAppear = useWatch({ control: form.control, name: "appearAnimation" });
  const watchStatic = useWatch({ control: form.control, name: "staticAnimation" });
  const watchDisappear = useWatch({
    control: form.control,
    name: "disappearAnimation",
  });
  const watchAll = useWatch({ control: form.control });
  const isDamageModifier = damageModifierTypes.includes(tag.type);
  const [hasElementFilter, setHasElementFilter] = useState(
    "elements" in tag && !!tag.elements?.length,
  );
  useEffect(() => {
    setHasElementFilter("elements" in tag && !!tag.elements?.length);
  }, [tag.type]);
  const incomingHasElements = "elements" in tag && !!tag.elements?.length;
  useEffect(() => {
    // Imported element choices must stay visible; an empty list can be a deliberate
    // Element selection while the editor is waiting for its first choice.
    if (incomingHasElements) setHasElementFilter(true);
  }, [incomingHasElements]);

  // Get images for the different animations and statics
  const statics = assetData?.filter((a) => a.type === "STATIC");
  const animations = assetData?.filter((a) => a.type === "ANIMATION");
  const staticImage = statics?.find((a) => a.id === watchStaticPath)?.image;
  const appearAnimImage = animations?.find((a) => a.id === watchAppear)?.image;
  const disappearAnimImage = animations?.find((a) => a.id === watchDisappear)?.image;
  const staticAnimImage = animations?.find((a) => a.id === watchStatic)?.image;

  // When user changes type, we need to update the effects array to re-render form
  useEffect(() => {
    if (watchType && watchType !== tag.type) {
      const newEffects = [...effects];
      const curTag = newEffects?.[idx];
      if (curTag) {
        const tagSchema = getTagSchema(watchType);
        const parsedTag = tagSchema.safeParse({ type: watchType });
        const shownTag = parsedTag.success ? parsedTag.data : tag;
        const skipKeys = ["type", "calculation", "direction"];
        // For all typed keys in shownTag, if the key exists in curTag, keep the value, except for type
        objectKeys(shownTag).forEach((key) => {
          if (!skipKeys.includes(key) && key in curTag) {
            // @ts-expect-error - we know this is a key of the object
            shownTag[key] = curTag[key];
          }
        });
        newEffects[idx] = shownTag;
        form.reset(shownTag);
      }
      setEffects(newEffects);
    }
  }, [tag, watchType, idx, effects]);

  // Trigger re-validation after type changes
  useEffect(() => {
    void form.trigger(undefined, { shouldFocus: true });
  }, [tag.type]);

  // Automatically update the effects whenever new data
  useEffect(() => {
    // Calculate diff
    const newEffects = [...effects];
    const tagSchema = getTagSchema(watchType);
    // Coordinate drafts must reach the parent validator so Save cannot persist an
    // older valid pattern while duplicate or incomplete coordinates are on screen.
    const hasCoordinateDraft = watchAll.target === "COORDINATES";
    // Keep cache and quest drafts in the parent so Save validates the visible settings.
    // Waiting on child validity can miss the first selection while validation settles.
    const hasItemDraft = ["noncombatconsumereward", "noncombatquest"].includes(
      watchType,
    );
    const leftCoordinateTarget = tag.target === "COORDINATES" && !hasCoordinateDraft;
    const draft = leftCoordinateTarget
      ? { ...watchAll, coordinateTargeting: null }
      : watchAll;
    const parsedTag = tagSchema.safeParse(draft);
    const shownTag = parsedTag.success
      ? parsedTag.data
      : hasCoordinateDraft || hasItemDraft
        ? draft
        : tag;
    newEffects[idx] = shownTag;
    const diff = calculateContentDiff(effects, newEffects);
    if (diff.length > 0) {
      if (tag.type === watchType) {
        if (form.formState.isDirty) {
          void form.trigger();
        }
        if (
          hasCoordinateDraft ||
          hasItemDraft ||
          (leftCoordinateTarget && parsedTag.success) ||
          form.formState.isValid
        ) {
          setEffects(newEffects);
          if (parsedTag.success) form.reset(draft);
        }
      }
    }
  }, [watchAll]);

  // Attributes on this tag, each of which we should show a form field for
  type Attribute = keyof typeof tag;
  const attributes = Object.keys(tagSchema.shape) as Attribute[];

  // Parse how to present the tag form
  const ignore = ["timeTracker", "type", "weightedCache", "rewardMode"];
  if (watchAll.rewardMode === "weightedCache") {
    ignore.push(
      ...Object.keys(tagSchema.shape).filter((key) => key.startsWith("reward_")),
    );
  }
  if (isDamageModifier && !hasElementFilter) ignore.push("elements");
  if (watchAll.target !== "COORDINATES") ignore.push("coordinateTargeting");
  if (props.type === "bloodline") {
    ignore.push(...["rounds", "friendlyFire"]);
  }
  if (props.type === "sageMode") {
    ignore.push("friendlyFire");
    const roundsSchema = tagSchema.shape.rounds
      ? unwrapFieldSchema(tagSchema.shape.rounds)
      : undefined;
    if (roundsSchema instanceof z.ZodNumber && !roundsSchema.safeParse(0).success) {
      ignore.push("rounds");
    }
  }
  // Add direction to ignore list if not increasestat, decreasestat, or redirection
  if (!["increasestat", "decreasestat", "redirection"].includes(tag.type)) {
    ignore.push("direction");
  }

  // Create the form data dynamically based on the tag type
  const formData: FormEntry<Attribute>[] = attributes
    .filter((value) => !ignore.includes(value))
    .filter((value) => !props.editableFields || props.editableFields.includes(value))
    .filter((value) => {
      return (
        !["noncombatconsumereward", "noncombatgainskill", "noncombatquest"].includes(
          watchType,
        ) ||
        ![
          "staticAnimation",
          "staticAssetPath",
          "appearAnimation",
          "disappearAnimation",
          "rounds",
          "target",
          "friendlyFire",
          "calculation",
          "power",
          "powerPerLevel",
        ].includes(value)
      );
    })
    .filter((value) => {
      return (
        !["repair"].includes(watchType) ||
        ![
          "staticAnimation",
          "staticAssetPath",
          "appearAnimation",
          "disappearAnimation",
          "rounds",
          "target",
          "friendlyFire",
          "calculation",
        ].includes(value)
      );
    })
    .filter((value) => {
      return (
        ![
          "rollbloodline",
          "rollsagemode",
          "removebloodline",
          "marriageslotincrease",
        ].includes(watchType) ||
        ![
          "staticAnimation",
          "staticAssetPath",
          "appearAnimation",
          "disappearAnimation",
          "rounds",
          "target",
          "friendlyFire",
          "calculation",
        ].includes(value)
      );
    })
    .map((value) => {
      const innerType = unwrapFieldSchema(tagSchema.shape[value]);
      if (String(value) === "aggroMode") {
        return {
          id: value,
          label: "Aggro mode",
          type: "db_values",
          values: [
            { id: "ENMITY", name: "Current enmity (once per round)" },
            { id: "GENERATION", name: "Damage-generated enmity" },
          ],
        };
      } else if (String(value) === "affectedTag") {
        return {
          id: value,
          label: "Affected Tag",
          type: "db_values",
          values: Object.entries(POTENCY_TAG_LABELS).map(([id, name]) => ({
            id,
            name,
          })),
        };
      } else if ((value as string) === "aiId" && aiData) {
        return {
          id: value,
          label: FORM_LABEL_MAP[value] ?? value,
          values: aiData
            .filter((ai) => ai.isSummon)
            .sort((a, b) => a.level - b.level)
            .map((ai) => ({
              id: ai.userId,
              name: `lvl ${ai.level}: ${ai.username}`,
            })),
          type: "db_values",
        };
      } else if ((value as string) === "items" && itemData) {
        return {
          id: value,
          values: itemData,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values",
        };
      } else if ((value as string) === "jutsus" && jutsuData) {
        return {
          id: value,
          values: jutsuData,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values",
        };
      } else if ((value as string) === "jutsuIds" && jutsuData) {
        return {
          id: value,
          values: jutsuData.filter((j) => j.injectableInBattle),
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values",
        };
      } else if ((value as string) === "questId") {
        return {
          id: value,
          values: (questData ?? []).filter((quest) => quest.questType === "special"),
          multiple: false,
          label: "Special quest",
          type: "db_values",
        };
      } else if ((value as string) === "skillId" && skillsData) {
        return {
          id: value,
          values: skillsData
            .filter((s) => s.skillType === "SPECIAL")
            .map((i) => ({ id: i.id, name: i.name })),
          multiple: false,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values",
        };
      } else if ((value as string) === "reward_items" && itemData) {
        return {
          id: value,
          values: itemData,
          doubleWidth: true,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values_with_number",
        };
      } else if ((value as string) === "reward_pets") {
        return {
          id: value,
          label: "Companion species",
          type: "db_values",
          multiple: true,
          // Daily-offer availability does not restrict authored companion rewards.
          values: (petSpecies ?? []).map(({ id, name }) => ({ id, name })),
        };
      } else if ((value as string) === "reward_jutsus" && jutsuData) {
        return {
          id: value,
          values: jutsuData,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values",
        };
      } else if ((value as string) === "reward_bloodlines" && bloodlines) {
        return {
          id: value,
          values: bloodlines,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values",
        };
      } else if ((value as string) === "reward_sage_modes" && sageModes) {
        return {
          id: value,
          values: sageModes,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values",
        };
      } else if ((value as string) === "reward_titles" && titleData) {
        return {
          id: value,
          values: titleData,
          multiple: true,
          label: "Give Title",
          type: "db_values",
        };
      } else if ((value as string) === "reward_badges" && badgeData?.data) {
        return {
          id: value,
          values: badgeData?.data,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values",
        };
      } else if ((value as string) === "coordinateTargeting") {
        return {
          id: value,
          label: "Tag coordinate pattern",
          type: "coordinate_targeting",
          fullWidth: true,
        };
      } else if ((value as string) === "description") {
        return { id: value, label: value, type: "richinput", doubleWidth: true };
      } else if (innerType instanceof z.ZodString && value === "appearAnimation") {
        return {
          id: value,
          values: animations,
          multiple: false,
          type: "db_values",
          current: appearAnimImage,
        };
      } else if (innerType instanceof z.ZodString && value === "disappearAnimation") {
        return {
          id: value,
          values: animations,
          multiple: false,
          type: "db_values",
          current: disappearAnimImage,
        };
      } else if (innerType instanceof z.ZodString && value === "staticAnimation") {
        return {
          id: value,
          values: animations,
          multiple: false,
          type: "db_values",
          current: staticAnimImage,
        };
      } else if (innerType instanceof z.ZodString && value === "staticAssetPath") {
        return {
          id: value,
          values: statics,
          multiple: false,
          type: "db_values",
          current: staticImage,
        };
      } else if (innerType instanceof z.ZodString && value === "appearSfx") {
        return {
          id: value,
          values: (assetData || []).filter((a) => a.type === "SFX"),
          multiple: false,
          type: "db_values",
          searchable: true,
          label: "appearSfx",
        };
      } else if (innerType instanceof z.ZodString && value === "disappearSfx") {
        return {
          id: value,
          values: (assetData || []).filter((a) => a.type === "SFX"),
          multiple: false,
          type: "db_values",
          searchable: true,
          label: "disappearSfx",
        };
      } else if (
        innerType instanceof z.ZodLiteral ||
        innerType instanceof z.ZodString
      ) {
        return { id: value, label: value, type: "text" };
      } else if (innerType instanceof z.ZodNumber) {
        // Only noncombatconsumereward tag allows reward_reputation field
        const isReputationField =
          watchType === "noncombatconsumereward" &&
          String(value) === "reward_reputation";
        return {
          id: value,
          label:
            props.type === "sageMode" && String(value) === "rounds"
              ? "Instant (0) or mode duration"
              : (FORM_LABEL_MAP[value] ?? value),
          type: "number",
          readonly: isReputationField && !hasReputationPermission,
        };
      } else if (innerType instanceof z.ZodEnum) {
        const enumValues = innerType.options as string[];
        const values =
          value === "target" && !props.allowCoordinateTargeting
            ? enumValues.filter((option) => option !== "COORDINATES")
            : enumValues;
        return {
          id: value,
          type: "str_array",
          values,
        };
      } else if (
        innerType instanceof z.ZodArray &&
        innerType.element instanceof z.ZodEnum
      ) {
        const enumValues = (innerType.element as unknown as { options: string[] })
          .options;
        if (String(value) === "affectedElements") {
          return {
            id: value,
            label: "Affected Elements",
            type: "str_array",
            values: enumValues,
            multiple: true,
          };
        }
        return { id: value, type: "str_array", values: enumValues, multiple: true };
      } else if (innerType instanceof z.ZodBoolean) {
        return { id: value, label: value, type: "boolean" };
      } else {
        return { id: value, label: value, type: "text" };
      }
    });

  // Keep element choices beside their scope selector instead of below animation fields.
  if (isDamageModifier && hasElementFilter) {
    const elementsIndex = formData.findIndex(
      (field) => String(field.id) === "elements",
    );
    if (elementsIndex >= 0) {
      const [elementsField] = formData.splice(elementsIndex, 1);
      if (elementsField) formData.unshift(elementsField);
    }
  }

  // Keep shield duration beside the active conversion duration.
  if (tag.type === "consume" || tag.type === "siphon") {
    const shieldIdx = formData.findIndex((e) => String(e.id) === "shieldRounds");
    if (shieldIdx >= 0) {
      const [shieldEntry] = formData.splice(shieldIdx, 1);
      if (shieldEntry) {
        const powerIdx = formData.findIndex((e) => String(e.id) === "power");
        const insertAt = powerIdx >= 0 ? powerIdx : formData.length;
        formData.splice(insertAt, 0, shieldEntry);
      }
    }
  }

  // Add tag type as first entry
  if (!props.hideTagType) {
    formData.unshift({
      id: "type",
      type: "str_array",
      values: props.availableTags,
    });
  }

  // Retained settings are still validated on save; expose repairs without changing the active mode.
  const hasInvalidInactiveCache =
    watchType === "noncombatconsumereward" &&
    watchAll.rewardMode !== "weightedCache" &&
    watchAll.weightedCache &&
    (!weightedCacheDraftSchema.safeParse(watchAll.weightedCache).success ||
      (!isItemCatalogLoading &&
        !isItemCatalogError &&
        itemData &&
        cacheItemIds(watchAll.weightedCache).some(
          (id) =>
            !itemData.some((item) => item.id === id && !item.isRestrictedCacheReward),
        )));
  const cacheEditor = (
    <WeightedCacheEditor
      cache={watchAll.weightedCache ?? defaultWeightedCache()}
      onChange={(cache) =>
        form.setValue("weightedCache", cache, {
          shouldDirty: true,
          shouldValidate: true,
        })
      }
      items={itemData ?? []}
      isLoading={isItemCatalogLoading}
      isError={isItemCatalogError}
      onRetry={() => void refetchItemCatalog()}
      isActive={watchAll.rewardMode === "weightedCache"}
      disabled={props.submitLoading}
    />
  );

  // Re-used EditContent component for actually showing the form
  return (
    <>
      {fields.includes("reward_pets") && isPetSpeciesError && (
        <div role="alert" className="text-destructive">
          Companion species could not be loaded.
          <Button
            type="button"
            variant="outline"
            onClick={() => void refetchPetSpecies()}
          >
            Retry
          </Button>
        </div>
      )}
      {watchType === "noncombatconsumereward" &&
        (!props.editableFields || props.editableFields.includes("rewardMode")) && (
          <fieldset
            disabled={props.submitLoading}
            aria-busy={props.submitLoading}
            className="my-3 min-w-0 space-y-2"
          >
            <Label>Reward mode</Label>
            <Select
              value={watchAll.rewardMode ?? "standard"}
              disabled={props.submitLoading}
              onValueChange={(value) => {
                if (value === "weightedCache" && !watchAll.weightedCache)
                  form.setValue("weightedCache", defaultWeightedCache(), {
                    shouldDirty: true,
                  });
                form.setValue("rewardMode", value, {
                  shouldDirty: true,
                  shouldValidate: true,
                });
              }}
            >
              <SelectTrigger aria-label="Reward mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Standard rewards</SelectItem>
                <SelectItem value="weightedCache">Weighted Cache</SelectItem>
              </SelectContent>
            </Select>
            {watchAll.rewardMode === "weightedCache" ? (
              cacheEditor
            ) : hasInvalidInactiveCache ? (
              <details className="rounded border p-2">
                <summary className="cursor-pointer font-semibold text-destructive text-sm">
                  Inactive Weighted Cache · Needs attention
                </summary>
                <p className="mt-2 text-sm">
                  Standard rewards remain active. Correct these saved cache settings
                  before saving.
                </p>
                {cacheEditor}
              </details>
            ) : null}
          </fieldset>
        )}
      {isDamageModifier &&
        (!props.editableFields || props.editableFields.includes("elements")) && (
          <div className="mb-3 space-y-1">
            <Label>Damage scope</Label>
            <Select
              value={hasElementFilter ? "element" : "offense"}
              onValueChange={(value) => {
                setHasElementFilter(value === "element");
                if (value === "offense")
                  form.setValue("elements", [], {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
              }}
            >
              <SelectTrigger aria-label="Damage scope" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="offense">Offense</SelectItem>
                <SelectItem value="element">Element</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              Offense affects all damage. Element limits the modifier to selected
              elements; leave elements empty to affect all damage.
            </p>
          </div>
        )}
      {watchAll.target === "COORDINATES" && (
        <p className="mb-3 text-muted-foreground text-sm">
          This tag places ground effects on its own tiles, independently of the parent
          pattern. Friendly Fire controls who is affected when occupying those tiles.
        </p>
      )}
      {(tag.type === "increasepotency" || tag.type === "decreasepotency") && (
        <p className="mb-3 text-muted-foreground text-sm">
          Static adds or subtracts power points. Percentage scales the selected tag’s
          power. For power 40, an increase of 20 gives 60 in Static mode or 48 in
          Percentage mode. All affects every supported tag on subsequent jutsu. Active
          modifiers add together within each mode; Static applies first. Affected
          Elements limits those tags to any of the selected elements. With All or a
          specific Affected Tag, leave elements empty to affect all elements, including
          non-elemental tags. Choose None under Affected Tag to use elements only;
          without selected elements, no tags are affected. None under Affected Elements
          matches tags without an element.
        </p>
      )}
      <EditContent
        schema={tagSchema}
        form={form}
        formData={formData}
        formClassName={formClassName}
        showSubmit={false}
        buttonTxt="Confirm Changes (No database sync)"
        fixedWidths={props.fixedWidths}
        submitLoading={props.submitLoading}
      />
    </>
  );
};

interface ObjectiveFormWrapperProps {
  idx: number;
  quest: DeepPartial<Quest>;
  availableTags: readonly string[];
  hideTagType?: boolean;
  hideRounds?: boolean;
  objective: AllObjectivesType;
  formClassName?: string;
  objectives: AllObjectivesType[];
  setObjectives: (content: AllObjectivesType[]) => void;
  submitLoading?: boolean;
}

/**
 * Render one objective with schema-derived editor fields.
 * Enemy, ally and random-encounter NPC entries share the existing template/count
 * selector; field labels retain their distinct combatant-count or chance semantics.
 * @returns React.ReactNode
 */
export const ObjectiveFormWrapper: React.FC<ObjectiveFormWrapperProps> = (props) => {
  // Destructure props
  const { idx, objective, objectives, formClassName, setObjectives } = props;

  // Get user data for permission checks
  const { data: userData } = useUserData();
  const userRole = userData?.role ?? "USER";
  const hasReputationPermission = canAwardReputation(userRole);

  // Get the schema & parse the tag
  const objectiveSchema = getObjectiveSchema(objective.task as string);
  const parsedTag = objectiveSchema.safeParse(objective);
  const shownTag = parsedTag.success ? parsedTag.data : objective;

  // Queries
  const fields = Object.keys(shownTag);
  const hasAIs =
    fields.includes("attackers") ||
    fields.includes("opponentAIs") ||
    fields.includes("allyAIs");
  const { data: aiData } = api.profile.getAllAiNames.useQuery(undefined, {
    enabled: hasAIs,
  });

  const { data: jutsuData } = api.jutsu.getAllNames.useQuery(undefined, {
    enabled:
      fields.includes("reward_jutsus") ||
      fields.includes("trainJutsuIds") ||
      fields.includes("useJutsuIds"),
  });

  const { data: titleData } = api.title.getAllNames.useQuery(undefined, {
    enabled: fields.includes("reward_titles"),
  });

  const { data: badgeData } = api.badge.getAll.useQuery(undefined, {
    enabled: fields.includes("reward_badges"),
  });

  const { data: itemData } = api.item.getAllNames.useQuery(undefined, {
    enabled:
      fields.includes("reward_items") ||
      fields.includes("collectItemIds") ||
      fields.includes("deliverItemIds") ||
      fields.includes("craftItemIds") ||
      fields.includes("buyItemIds") ||
      fields.includes("useItemIds"),
  });

  const { data: sceneBackgrounds } = api.gameAsset.getAllNames.useQuery(
    { type: "SCENE_BACKGROUND", folderPrefix: true },
    { enabled: fields.includes("sceneBackground") },
  );

  const { data: sceneCharacters } = api.gameAsset.getAllNames.useQuery(
    { type: "SCENE_CHARACTER", folderPrefix: true },
    { enabled: fields.includes("sceneCharacters") },
  );

  const { data: quests } = api.quests.getAllNames.useQuery(undefined, {
    enabled: fields.includes("newQuestIds") || fields.includes("completeQuestIds"),
  });

  const { data: structureAssets = [] } = api.mapAsset.getAll.useQuery(undefined, {
    enabled: supportsMapStructure(objective.task),
  });

  const { data: placementNames } = api.overworldAi.getAllPlacementNames.useQuery(
    undefined,
    { enabled: isSupportedOverworldBindingTask(objective.task) },
  );

  const { data: bloodlines } = api.bloodline.getAllNames.useQuery(undefined, {
    enabled: fields.includes("reward_bloodlines"),
  });

  const { data: sageModes } = api.sageMode.getAllNames.useQuery(undefined, {
    enabled: fields.includes("reward_sage_modes"),
  });

  // Form for handling the specific tag
  const form = useForm<any>({
    defaultValues: shownTag,
    values: shownTag,
    resolver: zodResolver(objectiveSchema),
    mode: "all",
    reValidateMode: "onBlur",
  });

  // A few fields we need to watch
  const watchAll = useWatch({ control: form.control });
  const watchTask = watchAll.task;
  const watchPlacementId = watchAll.overworldPlacementId;
  const watchOpponentAis = watchAll.opponentAIs;
  const [showStructureDraftFields, setShowStructureDraftFields] = useState(false);

  // When user changes type, we need to update the effects array to re-render form
  useEffect(() => {
    if (watchTask && watchTask !== objective.task) {
      const newObjectives = [...objectives];
      const curObjective = newObjectives?.[idx];
      if (curObjective && watchTask) {
        const tagSchema = getObjectiveSchema(watchTask);
        const parsedTag = tagSchema.safeParse({ id: objective.id, task: watchTask });
        const shownTag = parsedTag.success ? parsedTag.data : objective;
        shownTag.task = watchTask;
        newObjectives[idx] = shownTag;
      }
      setObjectives(newObjectives);
    }
  }, [objective, watchTask, idx, objectives]);

  // Trigger re-validation after type changes
  useEffect(() => {
    void form.trigger(undefined, { shouldFocus: true });
  }, [objective.task]);

  // Automatically update the effects whenever dirty
  useEffect(() => {
    const newObjectives = [...objectives];
    const parsedTag = objectiveSchema.safeParse(watchAll);
    // Keep cleared artwork's invalid drafts repairable through correction and blur.
    if (watchAll.structureAssetId) {
      setShowStructureDraftFields(false);
    } else if (
      !parsedTag.success &&
      parsedTag.error.issues.some((issue) =>
        ["locationName", "locationDescription", "structureScale"].includes(
          String(issue.path[0]),
        ),
      )
    ) {
      setShowStructureDraftFields(true);
    }
    const shownTag = parsedTag.success ? parsedTag.data : watchAll;
    if ("id" in shownTag && shownTag.id) {
      newObjectives[idx] = shownTag as AllObjectivesType;
      const diff = calculateContentDiff(objectives, newObjectives);
      if (diff.length > 0) {
        if (objective.task === watchTask) {
          if (form.formState.isDirty) {
            void form.trigger();
          }
          // Parent save validation must see current drafts, including invalid numbers.
          setObjectives(newObjectives);
          // Invalid NaN drafts diff as changed; resetting them would repeat this effect.
          if (parsedTag.success) form.reset(watchAll);
        }
      }
    }
  }, [watchAll]);

  // Attributes on this tag, each of which we should show a form field for
  type Attribute = keyof AllObjectivesType;
  const attributes = Object.keys(objectiveSchema.shape) as Attribute[];

  const sectorType = "sectorType" in watchAll ? watchAll.sectorType : undefined;
  const locationType = "locationType" in watchAll ? watchAll.locationType : undefined;

  // Parse how to present the tag form
  const formData: FormEntry<Attribute>[] = attributes
    .filter((value) => value !== "reward_packages")
    .filter(
      (value) =>
        ![
          "structureAssetId",
          "locationName",
          "locationDescription",
          "structureScale",
        ].includes(String(value)) || supportsMapStructure(watchTask),
    )
    .filter(
      (value) =>
        !["locationName", "locationDescription", "structureScale"].includes(
          String(value),
        ) ||
        !!watchAll.structureAssetId ||
        showStructureDraftFields ||
        !objectiveSchema.shape[value].safeParse(watchAll[value]).success,
    )
    .filter(
      (value) =>
        String(value) !== "durationSeconds" ||
        ["espionage", "sabotage"].includes(watchTask),
    )
    .filter(
      (value) =>
        ![
          "applyBuffs",
          "applyDebuffs",
          "task",
          "id",
          "image",
          "item_name",
          "reward",
          "completed",
          // Mastery promotions are claimed only with the quest's final reward.
          "reward_mastery_stat",
          "reward_mastery_rank",
        ].includes(value),
    )
    .filter((value) => {
      return (
        (!SimpleTasks.includes(watchTask as SimpleTask) &&
          watchTask !== "bloodline_collection") ||
        !["latitude", "longitude", "sector"].includes(value)
      );
    })
    .filter((value) => {
      return (
        !sectorType ||
        (sectorType === "specific" && !["sectorList"].includes(value)) ||
        (sectorType === "from_list" && !["sector"].includes(value)) ||
        (sectorType === "random" && !["sector", "sectorList"].includes(value)) ||
        (sectorType === "user_village" && !["sector", "sectorList"].includes(value)) ||
        (sectorType === "current_sector" && !["sector", "sectorList"].includes(value))
      );
    })
    .filter((value) => {
      return (
        props?.quest?.consecutiveObjectives ||
        !["nextObjectiveId", "failObjectiveId", "resetObjectiveId"].includes(value)
      );
    })
    .filter((value) => {
      return (
        props?.quest?.questType === "hunting" ||
        !["reward_hunter_items_ids"].includes(value)
      );
    })
    .filter((value) => {
      return (
        props?.quest?.questType === "gathering" ||
        !["reward_gathering_items_ids"].includes(value)
      );
    })
    .filter((value) => {
      return (
        !["fail_quest", "win_quest", "reset_quest"].includes(watchTask) ||
        !["nextObjectiveId"].includes(value)
      );
    })
    .filter((value) => {
      return (
        !([...InstantTasks, "dialog"] as string[]).includes(watchTask) ||
        !["sector", "longitude", "latitude"].includes(value)
      );
    })
    .filter((value) => {
      return (
        !locationType ||
        locationType === "specific" ||
        (locationType === "random" && !["longitude", "latitude"].includes(value))
      );
    })
    .filter((value) => {
      // Hide longitude/latitude for raid tasks - these are set via shrine placement
      return (
        !RaidTasks.includes(watchTask as RaidTask) ||
        !["longitude", "latitude"].includes(value)
      );
    })
    .filter((value) => {
      // The field is part of the shared base schema, but only these tasks have defined
      // overworld interaction semantics. Hiding it prevents invalid content at the source;
      // server save validation is the authoritative backstop.
      return (
        value !== "overworldPlacementId" || isSupportedOverworldBindingTask(watchTask)
      );
    })
    .filter((value) => {
      // Opponent is derived from the bound placement at save; hide manual opponentAIs entry
      // for a placement-bound defeat_opponents objective to avoid double configuration.
      return (
        (value as string) !== "opponentAIs" ||
        watchTask !== "defeat_opponents" ||
        !watchPlacementId
      );
    })
    .map((value) => {
      const innerType = unwrapFieldSchema(objectiveSchema.shape[value]);
      if (value === "structureAssetId")
        return {
          id: value,
          type: "db_values",
          label: "Map structure (optional)",
          values: structureAssets,
          searchable: true,
          resetButton: true,
        };
      if (value === "locationName")
        return { id: value, type: "text", label: "Location name" };
      if (value === "locationDescription")
        return {
          id: value,
          type: "textarea",
          label: "Location description (Inspect)",
          doubleWidth: true,
        };
      if (value === "structureScale")
        return { id: value, type: "number", label: "Structure size multiplier" };

      if (
        (["attackers", "opponentAIs", "allyAIs"] as string[]).includes(value) &&
        aiData
      ) {
        return {
          id: value,
          values: aiData
            .sort((a, b) => a.level - b.level)
            .map((ai) => ({
              id: ai.userId,
              name: `lvl ${ai.level}: ${ai.username}`,
            })),
          doubleWidth: true,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values_with_number",
        };
      } else if (value === "reward_items" && itemData) {
        return {
          id: value,
          values: itemData,
          doubleWidth: true,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values_with_number",
        };
      } else if (value === "reward_jutsus" && jutsuData) {
        return {
          id: value,
          values: jutsuData,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values",
        };
      } else if (value === "reward_bloodlines" && bloodlines) {
        return {
          id: value,
          values: bloodlines,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values",
        };
      } else if (value === "reward_sage_modes" && sageModes) {
        return {
          id: value,
          values: sageModes,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values",
        };
      } else if (value === "reward_titles" && titleData) {
        return {
          id: value,
          values: titleData,
          multiple: true,
          label: "Give Title",
          type: "db_values" as const,
        };
      } else if (value === "reward_badges" && badgeData?.data) {
        return {
          id: value,
          values: badgeData?.data,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values",
        };
      } else if (
        [
          "collectItemIds",
          "deliverItemIds",
          "craftItemIds",
          "buyItemIds",
          "useItemIds",
        ].includes(value) &&
        itemData
      ) {
        return {
          id: value,
          values: itemData,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values",
        };
      } else if (["trainJutsuIds", "useJutsuIds"].includes(value) && jutsuData) {
        return {
          id: value,
          values: jutsuData,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values",
        };
      } else if (["sceneBackground"].includes(value) && sceneBackgrounds) {
        return {
          id: value,
          values: sceneBackgrounds,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values",
        };
      } else if (["sceneCharacters"].includes(value) && sceneCharacters) {
        return {
          id: value,
          values: sceneCharacters,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values",
        };
      } else if (value === "nextObjectiveId" && props.objectives) {
        const obejctiveIds = props.objectives.map((objective) => objective.id);
        if (innerType instanceof z.ZodArray) {
          // Dialog objective: nextObjectiveId is an array of {text, nextObjectiveId}
          return {
            id: value,
            values: (shownTag.nextObjectiveId ?? []) as {
              text: string;
              nextObjectiveId: string;
            }[],
            doubleWidth: true,
            label: FORM_LABEL_MAP[value] ?? value,
            type: "dialog_options",
            objectiveIds: obejctiveIds,
          };
        } else {
          return {
            id: value,
            values: obejctiveIds,
            type: "str_array",
            label: FORM_LABEL_MAP[value] ?? value,
            resetButton: true,
          };
        }
      } else if (
        ["failObjectiveId", "resetObjectiveId"].includes(value) &&
        props.objectives
      ) {
        const obejctiveIds = props.objectives.map((objective) => objective.id);
        return {
          id: value,
          values: obejctiveIds,
          type: "str_array",
          label: FORM_LABEL_MAP[value] ?? value,
          resetButton: true,
        };
      } else if (["newQuestIds", "completeQuestIds"].includes(value) && quests) {
        return {
          id: value,
          values: quests,
          multiple: true,
          type: "db_values",
          label: FORM_LABEL_MAP[value] ?? value,
        };
      } else if (value === "overworldPlacementId") {
        // Always render a select (never a free-text fallback) so an arbitrary placement id
        // can't be saved while the names query is still loading or has failed.
        //
        // Narrow the list to placements for the AI chosen in opponentAIs (AI -> placement),
        // so an author picks the AI then its placement. This stays filtered even after a
        // placement is bound: opponentAIs hides (see the filter above) but its value persists,
        // so re-opening the dropdown still shows that enemy's placements, not the full list.
        // deliver_item/dialog instead show only FRIENDLY placements (placementsForObjective).
        const selectedAiIds = (
          (watchOpponentAis as { ids?: string[] }[] | undefined) ?? []
        ).flatMap((o) => o.ids ?? []);
        const matching = placementsForObjective(placementNames ?? [], {
          task: watchTask,
          selectedAiIds,
        });
        return {
          id: value,
          values: matching.map((p) => ({ id: p.id, name: p.label })),
          type: "db_values",
          label: FORM_LABEL_MAP[value] ?? value,
          resetButton: true,
        };
      } else if (["description", "successDescription"].includes(value)) {
        return {
          id: value,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "richinput",
          doubleWidth: true,
        };
      } else if (
        innerType instanceof z.ZodLiteral ||
        innerType instanceof z.ZodString
      ) {
        return { id: value, label: FORM_LABEL_MAP[value] ?? value, type: "text" };
      } else if (innerType instanceof z.ZodNumber) {
        // Check if this is the reward_reputation field
        const valueStr = String(value);
        const isReputationField = valueStr === "reward_reputation";
        return {
          id: value,
          label:
            valueStr === "value" && watchTask === "espionage"
              ? "Espionage points"
              : valueStr === "value" && watchTask === "sabotage"
                ? "Sabotage damage"
                : (FORM_LABEL_MAP[value] ?? value),
          type: "number",
          readonly: isReputationField && !hasReputationPermission,
        };
      } else if (innerType instanceof z.ZodEnum) {
        return {
          id: value,
          type: "str_array",
          values: innerType.options as string[],
          label: FORM_LABEL_MAP[value] ?? value,
        };
      } else if (
        innerType instanceof z.ZodArray &&
        innerType.element instanceof z.ZodEnum
      ) {
        const values = (innerType.element as unknown as { options: string[] }).options;
        return {
          id: value,
          type: "str_array",
          values: values,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
        };
      } else if (
        innerType instanceof z.ZodArray &&
        innerType.element instanceof z.ZodString
      ) {
        return {
          id: value,
          type: "str_array",
          values: [],
          multiple: true,
          allowAddNew: true,
          label: FORM_LABEL_MAP[value] ?? value,
        };
      } else if (innerType instanceof z.ZodBoolean) {
        return { id: value, label: FORM_LABEL_MAP[value] ?? value, type: "boolean" };
      } else {
        return { id: value, label: FORM_LABEL_MAP[value] ?? value, type: "text" };
      }
    });

  // Add tag type as first entry
  if (!props.hideTagType) {
    formData.unshift({
      id: "task",
      type: "str_array",
      values: props.availableTags,
    });
  }

  // Re-used EditContent component for actually showing the form
  return (
    <>
      {"applyBuffs" in shownTag && (
        <>
          <QuestBattleEffects
            title="Starting buffs"
            effects={watchAll.applyBuffs ?? []}
            availableTags={questBuffTypes}
            setEffects={(effects) =>
              form.setValue("applyBuffs", effects, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
            disabled={props.submitLoading}
          />
          <QuestBattleEffects
            title="Starting debuffs"
            effects={watchAll.applyDebuffs ?? []}
            availableTags={questDebuffTypes}
            setEffects={(effects) =>
              form.setValue("applyDebuffs", effects, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
            disabled={props.submitLoading}
          />
        </>
      )}
      {watchAll.structureAssetId && (
        <MapLocationPreview
          isDynamic={Boolean(
            (watchAll.sectorType && watchAll.sectorType !== "specific") ||
              (watchAll.locationType && watchAll.locationType !== "specific") ||
              watchAll.overworldPlacementId,
          )}
          location={{
            id: objective.id,
            sector: Number(watchAll.sector),
            longitude: Number(watchAll.longitude),
            latitude: Number(watchAll.latitude),
            name: watchAll.locationName || "Quest location",
            description: watchAll.locationDescription || "",
            assetId: watchAll.structureAssetId,
            scale: Number(watchAll.structureScale) || 1,
          }}
        />
      )}
      <EditContent
        schema={objectiveSchema}
        form={form}
        formData={formData.filter((entry) => !String(entry.id).startsWith("reward_"))}
        formClassName={formClassName}
        showSubmit={false}
        buttonTxt="Confirm Changes (No database sync)"
        submitLoading={props.submitLoading}
      >
        <RewardEditor
          form={form}
          formData={formData}
          hideFields={["reward_mastery_stat", "reward_mastery_rank"]}
          isObjectiveReward
        />
      </EditContent>
    </>
  );
};

interface RewardFormWrapperProps {
  /** Use node groups for package payloads without recursively offering more packages. */
  grouped?: boolean;
  idx: number;
  reward: ObjectiveRewardType;
  rewards: ObjectiveRewardType[];
  setRewards: (rewards: ObjectiveRewardType[]) => void;
  formClassName?: string;
  hideFields?: string[];
  type?: ContentType;
}

/**
 * A wrapper component around EditContent for creating a form for reward fields
 * @returns React.ReactNode
 */
export const RewardFormWrapper: React.FC<RewardFormWrapperProps> = (props) => {
  const {
    idx,
    reward,
    rewards,
    formClassName,
    setRewards,
    hideFields = [],
    type,
  } = props;

  const { data: rewardUser } = useUserData();
  // Parse reward with schema
  const parsedReward = ObjectiveReward.safeParse(reward);
  const shownReward = parsedReward.success ? parsedReward.data : reward;

  // Queries for db-backed fields
  const { data: itemData } = api.item.getAllNames.useQuery();
  const { data: jutsuData } = api.jutsu.getAllNames.useQuery();
  const { data: badgeData } = api.badge.getAll.useQuery();
  const { data: titleData } = api.title.getAllNames.useQuery();
  const { data: bloodlineData } = api.bloodline.getAllNames.useQuery();
  const { data: sageModeData } = api.sageMode.getAllNames.useQuery();

  // Form for handling the reward
  const form = useForm<any>({
    defaultValues: shownReward,
    values: shownReward,
    resolver: zodResolver(ObjectiveReward),
    mode: "all",
  });

  // Watch form values
  const watchAll = useWatch({ control: form.control });

  // Sync changed drafts; grouped editors include invalid values for parent validation.
  useEffect(() => {
    const newRewards = [...rewards];
    const parsed = ObjectiveReward.safeParse(watchAll);
    if (parsed.success || props.grouped) {
      newRewards[idx] = parsed.success
        ? parsed.data
        : (watchAll as ObjectiveRewardType);
      const diff = calculateContentDiff(rewards, newRewards);
      if (diff.length > 0) {
        setRewards(newRewards);
        // Keep invalid drafts without repeatedly resetting NaN values that diff as changed.
        if (parsed.success) form.reset(watchAll);
      }
    }
  }, [watchAll]);

  // Attributes on this reward schema
  type Attribute = keyof ObjectiveRewardType;
  const attributes = Object.keys(ObjectiveReward.shape) as Attribute[];

  // Generate form data dynamically
  const formData: FormEntry<Attribute>[] = attributes
    .filter((value) => !hideFields.includes(value))
    .map((value) => {
      const innerType = unwrapFieldSchema(ObjectiveReward.shape[value]);

      // Special handling for db-backed array fields
      if (value === "reward_items" && itemData) {
        return {
          id: value,
          values: itemData,
          doubleWidth: true,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values_with_number" as const,
        };
      } else if (value === "reward_jutsus" && jutsuData) {
        return {
          id: value,
          values: jutsuData,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values" as const,
        };
      } else if (value === "reward_bloodlines" && bloodlineData) {
        return {
          id: value,
          values: bloodlineData,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values" as const,
        };
      } else if (value === "reward_sage_modes" && sageModeData) {
        return {
          id: value,
          values: sageModeData,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values" as const,
        };
      } else if (value === "reward_titles" && titleData) {
        return {
          id: value,
          values: titleData,
          multiple: true,
          label: "Give Title",
          type: "db_values" as const,
        };
      } else if (value === "reward_badges" && badgeData?.data) {
        return {
          id: value,
          values: badgeData.data,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values" as const,
        };
      } else if (
        (value === "reward_hunter_items_ids" ||
          value === "reward_gathering_items_ids") &&
        itemData
      ) {
        return {
          id: value,
          values: itemData,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values" as const,
        };
      } else if (innerType instanceof z.ZodNumber) {
        return {
          id: value,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "number" as const,
          readonly:
            value === "reward_reputation" &&
            !canAwardReputation(rewardUser?.role ?? "USER"),
        };
      } else if (innerType instanceof z.ZodBoolean) {
        return {
          id: value,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "boolean" as const,
        };
      } else if (innerType instanceof z.ZodEnum) {
        return {
          id: value,
          type: "str_array" as const,
          values: innerType.options as string[],
          label: FORM_LABEL_MAP[value] ?? value,
        };
      } else {
        return {
          id: value,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "text" as const,
        };
      }
    });

  if (props.grouped)
    return (
      <RewardEditor
        form={form}
        formData={formData}
        allowPackages={false}
        hideFields={hideFields}
      />
    );
  return (
    <EditContent
      fieldsOnly
      schema={ObjectiveReward}
      form={form}
      formData={formData}
      formClassName={formClassName}
      showSubmit={false}
      type={type}
    />
  );
};

// Form labels for different tag names
export const FORM_LABEL_MAP: Record<string, string> = {
  durationSeconds: "Duration (seconds)",
  reward_items: "Reward Items [drop chance % and quantity]",
  reward_jutsus: "Reward Jutsus",
  reward_bloodlines: "Reward Bloodlines",
  reward_sage_modes: "Reward Sage Modes",
  reward_badges: "Reward Badges",
  reward_titles: "Give Title",
  reward_money: "Ryo",
  reward_exp: "Experience",
  reward_pet_experience: "Pet Experience (eligible active pet only)",
  reward_prestige: "Prestige",
  reward_reputation: "Reputation",
  reward_clanpoints: "Clan Points",
  reward_anbupoints: "ANBU Points",
  reward_skillpoints: "Skill Points",
  reward_seichi_silver: "Seichi Silver",
  reward_medical_experience: "Medical Exp",
  reward_hunting_experience: "Hunting Exp",
  reward_crafting_experience: "Crafting Exp",
  reward_gathering_experience: "Gathering Exp",
  reward_sage_mastery_experience: "Sage Mode Exp",
  masteryType: "Jutsu Mastery Type (and selected jutsu, if any)",
  combatType: "Combat Type",
  reward_mastery_stat: "Mastery to Rank Up",
  reward_mastery_rank: "Mastery Rank Reward",
  reward_ninjutsu_experience: "Ninjutsu Mastery XP",
  reward_genjutsu_experience: "Genjutsu Mastery XP",
  reward_taijutsu_experience: "Taijutsu Mastery XP",
  reward_bukijutsu_experience: "Bukijutsu Mastery XP",
  reward_bloodline_experience: "Bloodline Mastery XP",
  reward_sage_stat_experience: "Sage Mastery XP",

  reward_rank: "Reward Rank",
  reward_village_membership: "Village Membership",
  reward_tokens: "Tokens",
  reward_war_damage: "War Damage",
  reward_war_healing: "War Healing",
  reward_hunter_items: "Hunter Items Enabled",
  reward_hunter_items_ids: "Hunter Item IDs",
  reward_gathering_items: "Gathering Items Enabled",
  reward_gathering_items_ids: "Gathering Item IDs",
  opponentAIs: "Opponent AIs [and number]",
  allyAIs: "Ally AI [and number]",
  nextObjectiveId: "Next Objective ID",
  failObjectiveId: "If fail, go to objective",
  resetObjectiveId: "Reset to specific objective",
  opponent_scaled_to_user: "Scale Opponent to user level",
  scaleGains: "Scale opponent combat gains",
  keepOriginalPools: "Reset pools after opponent battle",
  givePools: "Starting pools (% of maximum; leave empty to carry pools)",
  attackers: "Random Encounter AIs [and encounter chance%]",
  attackers_scaled_to_user: "Scale random encounter to user lvl",
  attackers_scale_gains: "Scale random encounter combat gains",
  attackers_max_per_battle: "Max number of AI in random encounter",
  skillId: "Skill Unlocked by Consumption",
  craftItemIds: "Items to Craft",
  buyItemIds: "Items to Buy (NPC shop)",
  useItemIds: "Items to Use in Combat",
  trainJutsuIds: "Jutsu to Train",
  useJutsuIds: "Jutsu to Use in Combat",
  completeQuestIds: "Quests to Complete",
  tagType: "Combat Tag Type",
  singleBattle: "Track best single-battle only (else cumulative)",
  bloodlineRanks: "Bloodline ranks to include",
  shieldRounds: "Shield Rounds",
  delayRounds: "Diffuse Repayment Turns",
};

/**
 * EFFECT FIELD RENDERER (generic): Renders a single effect field input based on its zod type
 */
export const EffectFieldInputGeneric = <E extends ZodAllTags>(opts: {
  effect: E;
  field: string;
  onChange: (value: unknown) => void;
  options?: {
    ai?: OptionType[];
    jutsu?: OptionType[];
    jutsuInjectable?: OptionType[];
    item?: OptionType[];
    bloodline?: OptionType[];
    sageMode?: OptionType[];
    animation?: OptionType[];
    staticAsset?: OptionType[];
  };
  disabled?: boolean;
}) => {
  const { effect, field, onChange } = opts;
  const schema = getTagSchema(effect.type);
  const fieldSchema = (schema.shape as Record<string, z.ZodType>)[field] as
    | z.ZodType
    | undefined;
  if (!fieldSchema) return <div className="text-muted-foreground">N/A</div>;
  const inner = unwrapFieldSchema(fieldSchema);
  const eff = effect as unknown as Record<string, unknown>;

  // Common db-backed fields
  if (field === "aiId") {
    const raw = eff[field];
    const value = typeof raw === "string" ? raw : "";
    return (
      <SingleSelectSimple
        value={value}
        onChange={(v) => onChange(v)}
        options={opts.options?.ai || []}
        disabled={opts.disabled}
      />
    );
  }
  if (field === "jutsuIds") {
    const raw = eff[field];
    const selected = Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
    return (
      <MultiSelect
        selected={selected}
        onChange={(v) => onChange(v)}
        options={opts.options?.jutsuInjectable || []}
        disabled={opts.disabled}
      />
    );
  }
  if (field === "items") {
    const raw = eff[field];
    const selected = Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
    return (
      <MultiSelect
        selected={selected}
        onChange={(v) => onChange(v)}
        options={opts.options?.item || []}
        disabled={opts.disabled}
      />
    );
  }
  if (field === "reward_jutsus") {
    const raw = eff[field];
    const selected = Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
    return (
      <MultiSelect
        selected={selected}
        onChange={(v) => onChange(v)}
        options={opts.options?.jutsu || []}
        disabled={opts.disabled}
      />
    );
  }
  if (field === "reward_bloodlines") {
    const raw = eff[field];
    const selected = Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
    return (
      <MultiSelect
        selected={selected}
        onChange={(v) => onChange(v)}
        options={opts.options?.bloodline || []}
        disabled={opts.disabled}
      />
    );
  }
  if (field === "reward_sage_modes") {
    const raw = eff[field];
    const selected = Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
    return (
      <MultiSelect
        selected={selected}
        onChange={(v) => onChange(v)}
        options={opts.options?.sageMode || []}
        disabled={opts.disabled}
      />
    );
  }
  if (["appearAnimation", "disappearAnimation", "staticAnimation"].includes(field)) {
    const raw = eff[field];
    const value = typeof raw === "string" ? raw : "";
    return (
      <SingleSelectSimple
        value={value}
        onChange={(v) => onChange(v)}
        options={opts.options?.animation || []}
        searchable
        disabled={opts.disabled}
      />
    );
  }
  if (field === "staticAssetPath") {
    const raw = eff[field];
    const value = typeof raw === "string" ? raw : "";
    return (
      <SingleSelectSimple
        value={value}
        onChange={(v) => onChange(v)}
        options={opts.options?.staticAsset || []}
        searchable
        disabled={opts.disabled}
      />
    );
  }

  // Primitives
  if (inner instanceof z.ZodNumber) {
    const value = eff[field];
    const numVal = typeof value === "number" ? value : Number(value ?? 0);
    return (
      <NumberInput
        value={numVal}
        disabled={opts.disabled}
        onValueChange={onChange}
        step="any"
      />
    );
  }
  if (inner instanceof z.ZodBoolean) {
    const value = eff[field];
    const boolVal = typeof value === "boolean" ? value : Boolean(value);
    return (
      <Switch
        checked={boolVal}
        onCheckedChange={(v) => onChange(v)}
        disabled={opts.disabled}
      />
    );
  }
  if (inner instanceof z.ZodEnum) {
    const values = inner.options as string[];
    const options = values.map((v) => ({ label: v, value: v }));
    const raw = eff[field];
    const cur = typeof raw === "string" ? raw : "";
    const handle = (v: string) => onChange(v);
    return (
      <SingleSelectSimple
        value={cur}
        onChange={handle}
        options={options}
        disabled={opts.disabled}
      />
    );
  }
  if (inner instanceof z.ZodArray) {
    const elementSchema = unwrapFieldSchema(inner.element as z.ZodType);
    if (elementSchema instanceof z.ZodEnum) {
      const values = (elementSchema as unknown as { options: string[] }).options || [];
      const options = values.map((v) => ({ label: String(v), value: String(v) }));
      const selected = Array.isArray(eff[field])
        ? (eff[field] as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      const onChangeMs: React.Dispatch<React.SetStateAction<string[]>> = (v) =>
        onChange(v);
      return (
        <MultiSelect
          selected={selected}
          onChange={onChangeMs}
          options={options}
          disabled={opts.disabled}
        />
      );
    }
    if (elementSchema instanceof z.ZodString) {
      const selected = Array.isArray(eff[field])
        ? (eff[field] as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      const onChangeMs: React.Dispatch<React.SetStateAction<string[]>> = (v) =>
        onChange(v);
      return (
        <MultiSelect
          selected={selected}
          onChange={onChangeMs}
          options={[]}
          allowAddNew
          disabled={opts.disabled}
        />
      );
    }
  }
  const rawFinal = eff[field];
  const textVal =
    typeof rawFinal === "string" || typeof rawFinal === "number"
      ? String(rawFinal)
      : "";
  return (
    <Input
      type="text"
      value={textVal}
      onChange={(e) => onChange(e.target.value)}
      disabled={opts.disabled}
    />
  );
};

/** Simple single-select reused helper */
const SingleSelectSimple: React.FC<{
  value: string;
  onChange: (v: string) => void;
  options: OptionType[];
  searchable?: boolean;
  disabled?: boolean;
}> = ({ value, onChange, options, searchable, disabled }) => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  return (
    <Popover
      open={disabled ? false : open}
      onOpenChange={(nextOpen) => {
        if (!disabled) setOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between"
          disabled={disabled}
        >
          {options.find((o) => o.value === value)?.label || "Select"}
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-0">
        <Command>
          {searchable && <CommandInput placeholder="Search..." className="h-9" />}
          <CommandList>
            <CommandEmpty>No options</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => (
                <CommandItem
                  key={opt.value}
                  value={opt.value}
                  keywords={[opt.label]}
                  onSelect={() => onChange(opt.value)}
                >
                  {opt.label}
                  <Check
                    className={cn(
                      "ml-auto",
                      value === opt.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

/**
 * MassEffectEditor (re-exported) - generic mass editor that reuses EffectFieldInputGeneric
 */
export const MassEffectEditor = <
  T extends { id: string; name: string; effects: ZodAllTags[]; updatedAt: Date },
>(props: {
  kind: "item" | "jutsu" | "bloodline";
  entries: T[] | undefined;
  selectedFields: string[];
  onEntriesUpdated?: () => unknown;
  onPendingChange?: (pending: boolean) => void;
  filterEffectTypes?: string[];
}) => {
  const { kind, entries, selectedFields } = props;

  const editorRef = useRef<HTMLDivElement>(null);
  const [modified, setModified] = useState<Record<string, ZodAllTags[]>>({});
  const [committed, setCommitted] = useState<
    Record<string, { effects: ZodAllTags[]; baseUpdatedAt: number }>
  >({});
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [pendingJutsuId, setPendingJutsuId] = useState<string | null>(null);
  const [pendingBloodlineId, setPendingBloodlineId] = useState<string | null>(null);
  const itemSaveInFlight = useRef(false);
  const jutsuSaveInFlight = useRef(false);
  const bloodlineSaveInFlight = useRef(false);
  const itemEditorPending = kind === "item" && pendingItemId !== null;
  const jutsuEditorPending = kind === "jutsu" && pendingJutsuId !== null;
  const bloodlineEditorPending = kind === "bloodline" && pendingBloodlineId !== null;
  const editorPending =
    itemEditorPending || jutsuEditorPending || bloodlineEditorPending;

  useEffect(
    () => () => {
      props.onPendingChange?.(false);
    },
    [props.onPendingChange],
  );

  // A successful save becomes the local source of truth immediately. Retain it
  // only while the list still carries the exact pre-save revision. Once the
  // server revision advances it is authoritative, including when another editor
  // has since committed different effects.
  useEffect(() => {
    setCommitted((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const entry of entries ?? []) {
        const snapshot = next[entry.id];
        if (
          snapshot &&
          (entry.updatedAt.getTime() > snapshot.baseUpdatedAt ||
            JSON.stringify(entry.effects) === JSON.stringify(snapshot.effects))
        ) {
          delete next[entry.id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [entries, kind]);

  // Options
  const { data: aiData } = api.profile.getAllAiNames.useQuery(undefined);
  const { data: jutsuData } = api.jutsu.getAllNames.useQuery(undefined);
  const { data: itemData } = api.item.getAllNames.useQuery(undefined);
  const { data: bloodlines } = api.bloodline.getAllNames.useQuery(undefined);
  const { data: sageModes } = api.sageMode.getAllNames.useQuery(undefined);
  const { data: assetData } = api.misc.getAllGameAssetNames.useQuery(undefined);

  const options = useMemo(
    () =>
      ({
        ai: (aiData || [])
          .filter((a) => a.isSummon)
          .sort((a, b) => a.level - b.level)
          .map((ai) => ({
            label: `lvl ${ai.level}: ${ai.username}`,
            value: ai.userId,
          })),
        jutsu: (jutsuData || []).map((j) => ({ label: j.name, value: j.id })),
        jutsuInjectable: (jutsuData || [])
          .filter((j) => j.injectableInBattle)
          .map((j) => ({ label: j.name, value: j.id })),
        item: (itemData || []).map((i) => ({ label: i.name, value: i.id })),
        bloodline: (bloodlines || []).map((b) => ({ label: b.name, value: b.id })),
        sageMode: (sageModes || []).map((s) => ({ label: s.name, value: s.id })),
        animation: (assetData || [])
          .filter((a) => a.type === "ANIMATION")
          .map((a) => ({ label: a.id, value: a.id })),
        staticAsset: (assetData || [])
          .filter((a) => a.type === "STATIC")
          .map((a) => ({ label: a.id, value: a.id })),
      }) as const,
    [aiData, jutsuData, itemData, bloodlines, sageModes, assetData],
  );

  type Row = {
    id: string;
    name: string;
    effectType: string;
    entryId: string;
    effectIndex: number;
  } & Record<string, React.ReactNode>;
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    (entries || []).forEach((entry) => {
      entry.effects.forEach((effect, idx) => {
        // If effect type filter is set, only include matching effect rows
        if (props.filterEffectTypes && props.filterEffectTypes.length > 0) {
          if (!props.filterEffectTypes.includes(effect.type)) return;
        }
        const row: Row = {
          id: `${entry.id}:${idx}`,
          name: entry.name,
          effectType: effect.type,
          entryId: entry.id,
          effectIndex: idx,
        };
        selectedFields.forEach((f) => {
          row[f] = (
            <div data-effect-entry-id={entry.id}>
              <EffectFieldInputGeneric
                effect={
                  modified[entry.id]?.[idx] ??
                  committed[entry.id]?.effects[idx] ??
                  effect
                }
                field={f}
                onChange={(v) =>
                  setModified((prev) => {
                    const next: Record<string, ZodAllTags[]> = { ...prev };
                    const baseEffs =
                      next[entry.id] ?? committed[entry.id]?.effects ?? entry.effects;
                    const effsArray = Array.isArray(baseEffs)
                      ? baseEffs
                      : entry.effects;
                    const updated = [...effsArray];
                    const current = updated[idx] ?? effect;
                    updated[idx] = { ...current, [f]: v } as ZodAllTags;
                    next[entry.id] = updated;
                    return next;
                  })
                }
                options={options}
                disabled={editorPending}
              />
            </div>
          );
        });
        out.push(row);
      });
    });
    return out;
  }, [entries, selectedFields, modified, committed, options, editorPending]);

  // Mutations
  const itemUpdate = api.item.update.useMutation();
  const jutsuUpdate = api.jutsu.update.useMutation();
  const bloodlineUpdate = api.bloodline.update.useMutation();

  const saveRow = async (row: Row) => {
    const entry = (entries || []).find((e) => e.id === row.entryId);
    if (!entry) return;
    // Saving one row submits every effect for its entry, including sibling rows.
    const fields = editorRef.current?.querySelectorAll<HTMLElement>(
      "[data-effect-entry-id]",
    );
    for (const field of fields ?? []) {
      if (field.dataset.effectEntryId === entry.id && !validateNumberInputs(field)) {
        return;
      }
    }
    const effects =
      modified[row.entryId] ?? committed[row.entryId]?.effects ?? entry.effects;
    const validator =
      kind === "item"
        ? ItemValidator
        : kind === "jutsu"
          ? JutsuValidator
          : BloodlineValidator;
    // Drafts remain in the payload when their field or effect row is hidden.
    const parsed = validator.shape.effects.safeParse(effects);
    if (!parsed.success) {
      showMutationToast({
        success: false,
        message: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
      return;
    }
    if (kind === "item") {
      if (itemSaveInFlight.current) return;
      itemSaveInFlight.current = true;
      setPendingItemId(entry.id);
      props.onPendingChange?.(true);
      try {
        const data = { ...(entry as unknown as ZodItemType), effects } as ZodItemType;
        const res = await itemUpdate.mutateAsync({ id: entry.id, data });
        showMutationToast(res);
        if (!res.success) return;
        setCommitted((prev) => ({
          ...prev,
          [entry.id]: { effects, baseUpdatedAt: entry.updatedAt.getTime() },
        }));
        setModified((prev) => {
          const next = { ...prev };
          delete next[row.entryId];
          return next;
        });
        try {
          await props.onEntriesUpdated?.();
        } catch {
          // The committed local snapshot keeps the successful write truthful if
          // the authoritative list cannot be refreshed immediately.
        }
      } catch (error) {
        showMutationToast({
          success: false,
          message:
            error instanceof Error ? error.message : "Unable to save item effects",
        });
      } finally {
        itemSaveInFlight.current = false;
        setPendingItemId(null);
        props.onPendingChange?.(false);
      }
      return;
    } else if (kind === "jutsu") {
      if (jutsuSaveInFlight.current) return;
      jutsuSaveInFlight.current = true;
      setPendingJutsuId(entry.id);
      props.onPendingChange?.(true);
      try {
        const data = {
          ...(entry as unknown as ZodJutsuType),
          effects,
        } as ZodJutsuType;
        const res = await jutsuUpdate.mutateAsync({ id: entry.id, data });
        showMutationToast(res);
        if (!res.success) return;
        setCommitted((prev) => ({
          ...prev,
          [entry.id]: { effects, baseUpdatedAt: entry.updatedAt.getTime() },
        }));
        setModified((prev) => {
          const next = { ...prev };
          delete next[row.entryId];
          return next;
        });
        try {
          await props.onEntriesUpdated?.();
        } catch {
          // Preserve the committed local snapshot if the authoritative list
          // cannot be refreshed immediately.
        }
      } catch (error) {
        // The global mutation handler intentionally suppresses retryable
        // transport/CDN failures. Surface those here so the retained draft has
        // an actionable explanation, while server errors remain globally handled.
        if (error instanceof Error && isRetryableTrpcError(error)) {
          showMutationToast({
            success: false,
            message: error.message || "Unable to save jutsu effects",
          });
        }
      } finally {
        jutsuSaveInFlight.current = false;
        setPendingJutsuId(null);
        props.onPendingChange?.(false);
      }
      return;
    } else {
      if (bloodlineSaveInFlight.current) return;
      bloodlineSaveInFlight.current = true;
      setPendingBloodlineId(entry.id);
      props.onPendingChange?.(true);
      const data = {
        ...(entry as unknown as ZodBloodlineType),
        effects,
      } as ZodBloodlineType;
      try {
        const res = await bloodlineUpdate.mutateAsync({ id: entry.id, data });
        showMutationToast(res);
        if (!res.success) return;
        setCommitted((prev) => ({
          ...prev,
          [entry.id]: { effects, baseUpdatedAt: entry.updatedAt.getTime() },
        }));
        setModified((prev) => {
          const next = { ...prev };
          delete next[row.entryId];
          return next;
        });
        try {
          await props.onEntriesUpdated?.();
        } catch {
          // Preserve the committed local snapshot if the authoritative list
          // cannot be refreshed immediately.
        }
      } catch (error) {
        // Server/validation errors are already handled by the global mutation
        // handler. It intentionally suppresses retryable transport/CDN errors,
        // so surface only those here while retaining the exact draft.
        if (error instanceof Error && isRetryableTrpcError(error)) {
          showMutationToast({
            success: false,
            message: error.message || "Unable to save bloodline effects",
          });
        }
      } finally {
        bloodlineSaveInFlight.current = false;
        setPendingBloodlineId(null);
        props.onPendingChange?.(false);
      }
      return;
    }
  };

  const columns: ColumnDefinitionType<Row, keyof Row>[] = useMemo(() => {
    const base: ColumnDefinitionType<Row, keyof Row>[] = [
      { key: "name", header: "Name", type: "string" },
      { key: "effectType", header: "Effect", type: "string" },
    ];
    selectedFields.forEach((f) => {
      base.push({ key: f, header: f, type: "jsx" });
    });
    return base;
  }, [selectedFields]);

  return (
    <div ref={editorRef} className="flex flex-col gap-2" aria-busy={editorPending}>
      <Table<Row, keyof Row>
        data={rows}
        columns={columns}
        buttons={
          kind === "item"
            ? [
                {
                  label: (row: Row) =>
                    pendingItemId === row.entryId ? (
                      <>
                        <Loader2
                          className="mr-2 h-4 w-4 animate-spin"
                          aria-hidden="true"
                        />
                        Saving
                      </>
                    ) : (
                      "Save"
                    ),
                  ariaLabel: (row: Row) =>
                    pendingItemId === row.entryId
                      ? `Saving item effects for ${row.name}`
                      : `Save item effects for ${row.name}`,
                  disabled: () => itemEditorPending,
                  onClick: (r: Row) => void saveRow(r),
                },
              ]
            : kind === "jutsu"
              ? [
                  {
                    label: (row: Row) =>
                      pendingJutsuId === row.entryId ? (
                        <>
                          <Loader2
                            className="mr-2 h-4 w-4 animate-spin"
                            aria-hidden="true"
                          />
                          Saving
                        </>
                      ) : (
                        "Save"
                      ),
                    ariaLabel: (row: Row) =>
                      pendingJutsuId === row.entryId
                        ? `Saving jutsu effects for ${row.name}`
                        : `Save jutsu effects for ${row.name}`,
                    disabled: () => jutsuEditorPending,
                    onClick: (r: Row) => void saveRow(r),
                  },
                ]
              : [
                  {
                    label: (row: Row) =>
                      pendingBloodlineId === row.entryId ? (
                        <>
                          <Loader2
                            className="mr-2 h-4 w-4 animate-spin"
                            aria-hidden="true"
                          />
                          Saving
                        </>
                      ) : (
                        "Save"
                      ),
                    ariaLabel: (row: Row) =>
                      pendingBloodlineId === row.entryId
                        ? `Saving bloodline effects for ${row.name}`
                        : `Save bloodline effects for ${row.name}`,
                    disabled: () => bloodlineEditorPending,
                    onClick: (r: Row) => void saveRow(r),
                  },
                ]
        }
      />
      {itemEditorPending && (
        <p
          className="px-3 pb-2 text-muted-foreground text-sm"
          role="status"
          aria-live="polite"
        >
          Saving
        </p>
      )}
      {jutsuEditorPending && (
        <p
          className="px-3 pb-2 text-muted-foreground text-sm"
          role="status"
          aria-live="polite"
        >
          Saving
        </p>
      )}
      {bloodlineEditorPending && (
        <p
          className="px-3 pb-2 text-muted-foreground text-sm"
          role="status"
          aria-live="polite"
        >
          Saving
        </p>
      )}
    </div>
  );
};

export const EffectFieldSelector: React.FC<{
  selected: string[];
  setSelected: React.Dispatch<React.SetStateAction<string[]>>;
  className?: string;
  disabled?: boolean;
}> = ({ selected, setSelected, className, disabled }) => {
  // Build field options from all tag schemas
  const fieldOptions = useMemo<OptionType[]>(() => {
    const fields = new Set<string>();
    // Build from a sample of tag schemas by introspecting one common schema
    // We reuse getTagSchema across tag types using tagTypes from types.ts
    const all = getTagSchema("damage").shape as Record<string, unknown>;
    Object.keys(all)
      .filter((k) => !["type", "timeTracker"].includes(k))
      .forEach((k) => {
        fields.add(k);
      });
    return Array.from(fields)
      .sort((a, b) => a.localeCompare(b))
      .map((f) => ({ label: f, value: f }));
  }, []);

  return (
    <div className={cn("min-w-[240px]", className)}>
      <MultiSelect
        selected={selected}
        options={fieldOptions}
        onChange={setSelected}
        isDirty={false}
        disabled={disabled}
      />
    </div>
  );
};

/** Reuse full combat tag configuration while keeping authored starting effects player-only. */
const QuestBattleEffects = ({
  title,
  effects,
  setEffects,
  availableTags,
  disabled,
}: {
  title: string;
  effects: ZodAllTags[];
  setEffects: (effects: ZodAllTags[]) => void;
  availableTags: readonly ZodAllTags["type"][];
  disabled?: boolean;
}) => (
  <div className="my-4 space-y-3 rounded border p-3">
    <div className="flex items-center justify-between">
      <h3 className="font-bold">{title}</h3>
      <Button
        type="button"
        size="sm"
        disabled={disabled}
        onClick={() => {
          const type = availableTags[0];
          if (type)
            setEffects([
              ...effects,
              getTagSchema(type).parse({ target: "SELF", rounds: 3 }) as ZodAllTags,
            ]);
        }}
      >
        Add effect
      </Button>
    </div>
    <p className="text-muted-foreground text-sm">
      Applies to the player. Duration includes the opening round.
    </p>
    {effects.map((effect, idx) => (
      <div key={`${effect.type}-${idx}`} className="rounded border p-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => setEffects(effects.filter((_, i) => i !== idx))}
        >
          Remove effect {idx + 1}
        </Button>
        <EffectFormWrapper
          idx={idx}
          type="jutsu"
          tag={effect}
          effects={effects}
          availableTags={availableTags}
          editableFields={Object.keys(getTagSchema(effect.type).shape).filter(
            (field) => field !== "target" && field !== "friendlyFire",
          )}
          submitLoading={disabled}
          setEffects={(values) =>
            setEffects(values.map((tag) => ({ ...tag, target: "SELF" })))
          }
        />
      </div>
    ))}
  </div>
);

/** Resolve a field control's schema without removing refinements or transforms. */
const unwrapFieldSchema = (schema: z.ZodType): z.ZodType => {
  let inner = schema;
  while (
    inner instanceof z.ZodDefault ||
    inner instanceof z.ZodOptional ||
    inner instanceof z.ZodNullable ||
    inner instanceof z.ZodPrefault
  ) {
    inner = inner.unwrap() as z.ZodType;
  }
  return inner;
};
