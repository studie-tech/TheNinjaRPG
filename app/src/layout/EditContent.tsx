"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, ChevronsUpDown, Loader2, Plus, X } from "lucide-react";
import { nanoid } from "nanoid";
import type React from "react";
import { Fragment, useEffect, useMemo, useState } from "react";
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
import { NumberInput } from "@/components/ui/number-input";
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
import {
  type ContentType,
  type IMG_ORIENTATION,
  STARTER_VILLAGES,
} from "@/drizzle/constants";
import { ActionSelector } from "@/layout/CombatActions";
import ContentAudioSelector from "@/layout/ContentAudioSelector";
import ContentImage from "@/layout/ContentImage";
import ContentImageSelector from "@/layout/ContentImageSelector";
import { CoordinateTargetingEditor } from "@/layout/CoordinateTargetingEditor";
import { EpidemicSfxSearch } from "@/layout/EpidemicSfxSearch";
import { MethodSizeEditor } from "@/layout/MethodSizeEditor";
import Modal from "@/layout/Modal";
import RichInput from "@/layout/RichInput";
import { WeightedCacheEditor } from "@/layout/WeightedCacheEditor";
import { damageModifierTypes } from "@/libs/combat/constants";
import { POTENCY_TAG_LABELS } from "@/libs/combat/potency";
import type { CombatAction } from "@/libs/combat/types";
import { cn } from "@/libs/shadui";
import { defaultWeightedCache, getWeightedCacheIssues } from "@/libs/weightedCache";
import { calculateContentDiff } from "@/utils/diff";
import { canAwardReputation } from "@/utils/permissions";
import { objectKeys } from "@/utils/typeutils";
import { useUserData } from "@/utils/UserContext";
import { showUploadError, UploadButton } from "@/utils/uploadthing";
import type { ZodAllTags } from "@/validators/combat";
import {
  activityBonusPowerLabel,
  getTagSchema,
  isActivityBonus,
} from "@/validators/combat";
import type { CoordinateTargeting } from "@/validators/coordinateTargeting";
import type { MethodSize } from "@/validators/methodSize";

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

  // Picker controls are rendered in a portal, outside the disabled fieldset below.
  // Close the picker when a caller opts into an in-flight submit lock so every
  // control belonging to this atomic form is consistently unavailable.
  useEffect(() => {
    if (submitLoading) {
      setAssetPickerOpen(false);
    }
  }, [submitLoading]);

  // If this is a quest, deduce the quest-type
  const contentType = props.type;
  const questType =
    contentType === "quest" ? form.getValues("questType" as Path<S>) : undefined;

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
    if (["raidMaxPlayers", "raidBossMaxHealth", "raidBossCurrentHealth"].includes(id))
      return "raid";
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

  // Prompt for image generation, based on name, title and description
  let prompt = "";
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
        className="grid grid-cols-1 items-center gap-1 md:grid-cols-2"
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
                    {allPickerAssets
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
                  items={allPickerAssets.map((a) => ({
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
          .filter((formEntry) =>
            isMaterialRewardFieldVisible(
              String(formEntry.id),
              questType,
              props.allowMaterialRewards,
            ),
          )
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
            const type = formEntry.type;

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
                    type === "avatar" &&
                      !(formEntry.type === "avatar" && formEntry.size === "landscape")
                      ? "row-span-5"
                      : "",
                    formEntry.fullWidth
                      ? "col-span-full"
                      : formEntry.doubleWidth
                        ? "md:col-span-2"
                        : "",
                    CATEGORY_CLASSES[formEntry.category],
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
                                    : "60"
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
                    (type === "db_values" && !ASSET_PICKER_FIELDS.includes(id))) && (
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
                            const nullable = formEntry.type === "db_values" && formEntry.nullable;
                            const selectedValue = field.value ?? (nullable ? "None" : undefined);
                            const selectedLabel = hasComboboxValue(selectedValue)
                              ? dynamicOptions.find(
                                  (option) => String(option.value) === String(selectedValue),
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
                                            !hasComboboxValue(selectedValue) &&
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
                                                    (nullable && option.value === "None" ? null : option.value) as PathValue<S, K>,
                                                    { shouldDirty: true },
                                                  );
                                                }}
                                              >
                                                {option.label}
                                                <Check
                                                  className={cn(
                                                    "ml-auto",
                                                    String(option.value) ===
                                                      String(selectedValue)
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
                    </div>
                  )}
                  {type === "db_values" && ASSET_PICKER_FIELDS.includes(id) && (
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
                    contentType && (
                      <FormField
                        control={form.control}
                        name={id}
                        render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <ContentImageSelector
                                  label={formEntry.label ? formEntry.label : id}
                                  imageUrl={(field.value as string) ?? formEntry.href}
                                  id={props.relationId ?? nanoid()}
                                  allowImageUpload={props.allowImageUpload}
                                  prompt={prompt}
                                  type={contentType}
                                  onUploadComplete={(url) => {
                                    field.onChange(url);
                                  }}
                                  size={formEntry.size ?? "square"}
                                  maxDim={formEntry.maxDim ?? 256}
                                  disabled={submitLoading}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                        )}
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
                                  onUploadError={showUploadError}
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

/**
 * Render one effect tag with schema-derived editor fields.
 * @returns React.ReactNode
 */
export const EffectFormWrapper: React.FC<EffectFormWrapperProps> = (props) => {
  // Destructure props
  const { tag, idx, effects, setEffects } = props;

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

  const { data: variantData } = api.item.getVariantNames.useQuery(undefined, {
    enabled: fields.includes("variantId"),
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
    enabled: ASSET_PICKER_FIELDS.some((field) => fields.includes(field)),
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

  // Asset options and the selected static image
  const statics = assetData?.filter((a) => a.type === "STATIC");
  const animations = assetData?.filter((a) => a.type === "ANIMATION");
  const staticImage = statics?.find((a) => a.id === watchStaticPath)?.image;

  // When user changes type, we need to update the effects array to re-render form
  useEffect(() => {
    if (watchType && watchType !== tag.type) {
      const newEffects = [...effects];
      const curTag = newEffects?.[idx];
      if (curTag) {
        const tagSchema = getTagSchema(watchType);
        const parsedTag = tagSchema.safeParse({ type: watchType });
        const shownTag = parsedTag.success ? parsedTag.data : tag;
        // Switching to noncombat tags must not carry over combat timing or targeting fields.
        const skipKeys = [
          "type",
          "calculation",
          "direction",
          ...(isActivityBonus(shownTag) || shownTag.type === "increasejutsuslots"
            ? ["rounds", "target", "friendlyFire", "powerPerLevel", "timeTracker"]
            : []),
        ];
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
    // Scale drafts reach the parent so Save validates the visible size, including invalid input.
    const hasAnimationScaleDraft = !Object.is(
      watchAll.animationScale,
      tag.animationScale ?? 1,
    );
    const leftCoordinateTarget = tag.target === "COORDINATES" && !hasCoordinateDraft;
    const draft = leftCoordinateTarget
      ? { ...watchAll, coordinateTargeting: null }
      : watchAll;
    const parsedTag = tagSchema.safeParse(draft);
    const shownTag = parsedTag.success
      ? parsedTag.data
      : hasCoordinateDraft || hasItemDraft || hasAnimationScaleDraft
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
          hasAnimationScaleDraft ||
          (leftCoordinateTarget && parsedTag.success) ||
          form.formState.isValid
        ) {
          setEffects(newEffects);
          if (parsedTag.success && !hasAnimationScaleDraft) form.reset(draft);
        }
      }
    }
  }, [watchAll]);

  // Attributes on this tag, each of which we should show a form field for
  type Attribute = keyof typeof tag;
  const attributes = Object.keys(tagSchema.shape) as Attribute[];

  // Parse how to present the tag form
  const ignore = ["timeTracker", "type", "weightedCache", "rewardMode"];
  if (isActivityBonus(tag) || tag.type === "increasejutsuslots")
    ignore.push(
      ...attributes.filter((key) => key !== "power" && key !== "description"),
    );
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
  const rewardCatalogs = {
    items: itemData,
    jutsus: jutsuData,
    bloodlines: bloodlines,
    sageModes: sageModes,
    titles: titleData,
    badges: badgeData?.data,
  };
  const formData: FormEntry<Attribute>[] = attributes
    .filter((value) => !ignore.includes(value))
    .filter((value) => !props.editableFields || props.editableFields.includes(value))
    .filter((value) => !OUT_OF_BATTLE_HIDDEN_FIELDS.get(watchType)?.includes(value))
    .map((value) => {
      const rewardCatalogEntry = rewardCatalogFormEntry(value, rewardCatalogs);
      if (rewardCatalogEntry) return rewardCatalogEntry;
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
      } else if ((value as string) === "variantId") {
        return {
          id: value,
          values: [{ id: "", name: "Any variant" }, ...(variantData ?? [])],
          nullable: true,
          multiple: false,
          label: "Variant",
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
      } else if ((value as string) === "reward_pets") {
        return {
          id: value,
          label: "Companion species",
          type: "db_values",
          multiple: true,
          // Daily-offer availability does not restrict authored companion rewards.
          values: (petSpecies ?? []).map(({ id, name }) => ({ id, name })),
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
        };
      } else if (innerType instanceof z.ZodString && value === "disappearAnimation") {
        return {
          id: value,
          values: animations,
          multiple: false,
          type: "db_values",
        };
      } else if (innerType instanceof z.ZodString && value === "staticAnimation") {
        return {
          id: value,
          values: animations,
          multiple: false,
          type: "db_values",
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
            isActivityBonus(tag) && String(value) === "power"
              ? activityBonusPowerLabel(tag)
              : tag.type === "increasejutsuslots" && String(value) === "power"
                ? "Additional jutsu slots"
                : props.type === "sageMode" && String(value) === "rounds"
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
      values: props.availableTags.filter(
        (type) =>
          (props.allowActivityBonuses || !isActivityBonus({ type })) &&
          (props.allowJutsuSlotGrants || type !== "increasejutsuslots"),
      ),
    });
  }

  // Retained settings are still validated on save; expose repairs without changing the active mode.
  const hasInvalidInactiveCache =
    watchType === "noncombatconsumereward" &&
    watchAll.rewardMode !== "weightedCache" &&
    watchAll.weightedCache &&
    getWeightedCacheIssues(
      watchAll.weightedCache,
      new Map((itemData ?? []).map((item) => [item.id, item])),
      {
        isActive: false,
        catalogReady: !isItemCatalogLoading && !isItemCatalogError && !!itemData,
      },
    ).issues.length > 0;
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
        showSubmit={false}
        submitLoading={props.submitLoading}
      />
    </>
  );
};

/**
 * Entry of a catalog-backed reward field, or undefined for any other field and until
 * its catalog has loaded, so the caller falls through to its schema-based handling.
 */
export const rewardCatalogFormEntry = <K extends string | number | symbol>(
  field: K,
  catalogs: RewardCatalogs,
): FormEntry<K> | undefined => {
  const id = String(field);
  const label = FORM_LABEL_MAP[id] ?? id;
  const catalog = (
    {
      reward_jutsus: catalogs.jutsus,
      reward_bloodlines: catalogs.bloodlines,
      reward_sage_modes: catalogs.sageModes,
      reward_titles: catalogs.titles,
      reward_badges: catalogs.badges,
    } as Record<string, FormDbValue[] | undefined>
  )[id];
  if (id === "reward_items" && catalogs.items) {
    return {
      id: field,
      values: catalogs.items,
      doubleWidth: true,
      label,
      type: "db_values_with_number",
    };
  }
  if (catalog) {
    return { id: field, values: catalog, multiple: true, label, type: "db_values" };
  }
  // Stored as a starter-village key rather than an id, so the schema's enum is the catalog.
  if (id === "reward_village_membership") {
    return { id: field, values: STARTER_VILLAGES, label, type: "str_array" };
  }
  return undefined;
};

// Form labels for different tag names
export const FORM_LABEL_MAP: Record<string, string> = {
  damageBonusPercent: "Damage bonus (%)",
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
  animationScale: "Animation scale (1–3×)",
  shieldRounds: "Shield Rounds",
  delayRounds: "Diffuse Repayment Turns",
};

/** Resolve a field control's schema without removing refinements or transforms. */
export const unwrapFieldSchema = (schema: z.ZodType): z.ZodType => {
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

/**
 * Hunter and gathering rewards show on quests of their own type, or wherever the
 * caller allows material rewards.
 */
const isMaterialRewardFieldVisible = (
  id: string,
  questType: unknown,
  allowMaterialRewards?: boolean,
) => {
  if (allowMaterialRewards) return true;
  if (id === "reward_hunter_items" || id === "reward_hunter_items_ids") {
    return questType === "hunting";
  }
  if (id === "reward_gathering_items" || id === "reward_gathering_items_ids") {
    return questType === "gathering";
  }
  return true;
};

/** Frame of each form-entry category; default entries have none. */
const CATEGORY_CLASSES: Record<string, string> = {
  // Rewards drawn in green
  reward:
    "rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20",
  // Opponents drawn in red
  opponent:
    "rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20",
  // Attackers drawn in pink
  attackers:
    "rounded-lg border border-pink-200 bg-pink-100 dark:border-pink-800 dark:bg-pink-900/20",
  // Raid things in orange
  raid: "rounded-lg border border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-900/20",
  // Location things in blue
  location:
    "rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20",
  // Graph things in purple
  graph:
    "rounded-lg border border-purple-200 bg-purple-50 dark:border-purple-800 dark:bg-purple-900/20",
  // Description things in yellow
  scene:
    "rounded-lg border border-yellow-200 bg-yellow-50 text-black dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-white",
};

/** Effect fields edited through the game-asset picker instead of a combobox. */
const ASSET_PICKER_FIELDS: readonly string[] = [
  "appearAnimation",
  "disappearAnimation",
  "staticAnimation",
  "staticAssetPath",
  "appearSfx",
  "disappearSfx",
];

/** Battle presentation, targeting and timing fields, which out-of-battle tags never use. */
const BATTLE_ONLY_FIELDS = [
  "staticAnimation",
  "animationScale",
  "staticAssetPath",
  "appearAnimation",
  "disappearAnimation",
  "rounds",
  "target",
  "friendlyFire",
  "calculation",
];

/** Noncombat tags also hide power and its per-level scaling. */
const NONCOMBAT_HIDDEN_FIELDS = [...BATTLE_ONLY_FIELDS, "power", "powerPerLevel"];

/** Fields hidden from the editor of each tag that resolves outside battle. */
const OUT_OF_BATTLE_HIDDEN_FIELDS = new Map<string, readonly string[]>([
  ["noncombatconsumereward", NONCOMBAT_HIDDEN_FIELDS],
  ["noncombatgainskill", NONCOMBAT_HIDDEN_FIELDS],
  ["noncombatquest", NONCOMBAT_HIDDEN_FIELDS],
  ["repair", BATTLE_ONLY_FIELDS],
  ["rollbloodline", BATTLE_ONLY_FIELDS],
  ["rollsagemode", BATTLE_ONLY_FIELDS],
  ["removebloodline", BATTLE_ONLY_FIELDS],
  ["marriageslotincrease", BATTLE_ONLY_FIELDS],
]);

/**
 * Whether a combobox field has a selected value. `0` is a real choice (e.g. sage
 * Tier 2 "None"); only `undefined` / `null` / `""` count as empty.
 */
const hasComboboxValue = (value: unknown) =>
  value !== undefined && value !== null && value !== "";

export type FormDbValue = { id: string; name: string };

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
      /** Save the empty option as null instead of the generic None sentinel. */
      nullable?: boolean;
    }
  | {
      type: "db_values_with_number";
      values: FormDbValue[] | undefined;
    }
  | {
      type: "dialog_options";
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
  buttonTxt?: string;
  allowImageUpload?: boolean;
  relationId?: string;
  type?: ContentType;
  onAccept?: (
    e: React.BaseSyntheticEvent<object, any, any> | undefined,
  ) => Promise<void>;
  submitDisabled?: boolean;
  submitLoading?: boolean;
  submitLoadingText?: string;
}

interface EffectFormWrapperProps {
  /** Offer permanent slot grants only for noncombat consumables. */
  allowJutsuSlotGrants?: boolean;
  /** Opt in only for sources that the runtime includes in passive activity aggregation. */
  allowActivityBonuses?: boolean;
  allowCoordinateTargeting?: boolean;
  idx: number;
  type: "jutsu" | "bloodline" | "item" | "skillTree" | "sageMode";
  availableTags: readonly string[];
  hideTagType?: boolean;
  editableFields?: readonly string[];
  tag: ZodAllTags;
  effects: ZodAllTags[];
  setEffects: (effects: ZodAllTags[]) => void;
  submitLoading?: boolean;
}

interface RewardCatalogs {
  items: FormDbValue[] | undefined;
  jutsus: FormDbValue[] | undefined;
  bloodlines: FormDbValue[] | undefined;
  sageModes: FormDbValue[] | undefined;
  titles: FormDbValue[] | undefined;
  badges: FormDbValue[] | undefined;
}
