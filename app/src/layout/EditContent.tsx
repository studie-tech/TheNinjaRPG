import { z } from "zod";
import { calculateContentDiff } from "@/utils/diff";
import { useForm, useWatch } from "react-hook-form";
import Image from "next/image";
import React, { useEffect, useState, useMemo } from "react";
import ContentImageSelector from "@/layout/ContentImageSelector";
import RichInput from "@/layout/RichInput";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { objectKeys } from "@/utils/typeutils";
import { getTagSchema } from "@/libs/combat/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";
import { getObjectiveSchema } from "@/validators/objectives";
import { Button } from "@/components/ui/button";
import { MultiSelect, type OptionType } from "@/components/ui/multi-select";
import { X, Plus } from "lucide-react";
import { SimpleTasks } from "@/validators/objectives";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { nanoid } from "nanoid";
import { cn } from "src/libs/shadui";
import { InstantTasks } from "@/validators/objectives";
import type { Quest } from "@/drizzle/schema";
import type { DeepPartial } from "@/utils/typeutils";
import type { Path, PathValue } from "react-hook-form";
import type { AllObjectivesType } from "@/validators/objectives";
import type { ZodAllTags } from "@/libs/combat/types";
import type { FieldValues } from "react-hook-form";
import type { UseFormReturn } from "react-hook-form";
import type { ContentType, IMG_ORIENTATION } from "@/drizzle/constants";
import Table from "@/layout/Table";
import type { ColumnDefinitionType } from "@/layout/Table";
import type { ZodItemType, ZodJutsuType, ZodBloodlineType } from "@/libs/combat/types";
import Modal2 from "@/layout/Modal2";
import { ActionSelector } from "@/layout/CombatActions";
import ContentImage from "@/layout/ContentImage";
import ContentAudioSelector from "@/layout/ContentAudioSelector";
import { UploadButton } from "@/utils/uploadthing";

export type FormDbValue = { id: string; name: string };
export type FormEntry<K> = {
  id: K;
  label?: string;
  doubleWidth?: boolean;
  resetButton?: boolean;
  searchable?: boolean;
} & (
  | { type: "text" }
  | { type: "richinput" }
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
}

/**
 * Generic edit content component, used for creating and editing e.g. jutsu, bloodline, item, AI
 * @returns React.ReactNode
 */
export const EditContent = <
  T extends z.AnyZodObject,
  K extends Path<S>,
  S extends z.infer<T>,
>(
  props: EditContentProps<T, K, S>,
) => {
  // Destructure
  const { formData, formClassName, form, showSubmit, buttonTxt, submitDisabled } =
    props;
  const currentValues = form.getValues();

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
    () => (assetPages?.pages.map((p) => p.data).flat() || []).filter((a) => !a.hidden),
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
    if (props.onEnter) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (id === "reason") return "xxx";
    return "default";
  };

  // Count how many columns have been used
  let columnCount = 0;
  let lastCategory = "default";

  // const load = isLoading || load1 || load2 || load3;
  return (
    <Form {...form}>
      <form
        onSubmit={props.onAccept}
        className={
          formClassName ?? "grid grid-cols-1 md:grid-cols-2 items-center gap-1"
        }
      >
        {/* Asset Picker Dialog */}
        {assetPickerOpen && (
          <Modal2
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
            className="w-[800px] max-w-[99%] max-h-[99%]"
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
                    className={
                      "px-2 py-1 rounded border text-xs " +
                      (assetTokens.includes(String(t))
                        ? "bg-foreground text-background border-foreground"
                        : "bg-background border-muted-foreground/30")
                    }
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
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-96 overflow-auto">
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
                            "border rounded p-2 space-y-2",
                            selected ? "border-green-500 bg-green-50" : "",
                          )}
                        >
                          <Label>{a.name}</Label>
                          <audio src={a.url ?? undefined} controls className="w-full" />
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
          </Modal2>
        )}
        {formData
          .filter((formEntry) => formEntry.type !== "avatar3d")
          .filter((formEntry) => {
            return (
              ![
                "reward_hunter_items_ids",
                "reward_hunter_items",
                "reward_hunting_experience",
              ].includes(formEntry.id) || questType === "hunting"
            );
          })
          .filter((formEntry) => {
            return (
              ![
                "reward_gathering_items_ids",
                "reward_gathering_items",
                "reward_gathering_experience",
              ].includes(formEntry.id) || questType === "gathering"
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
            if (formEntry.type === "str_array") {
              options.push(...formEntry.values?.map((v) => ({ label: v, value: v })));
            } else if (formEntry.type === "db_values" && formEntry.values) {
              options.push(
                ...formEntry.values?.map((v) => ({ label: v.name, value: v.id })),
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
              <>
                {includeSpacer && <div key={`spacer-${id}`} />}
                <div
                  key={`formEntry-${id}`}
                  className={cn(
                    "p-2",
                    ["avatar", "avatar3d"].includes(type) ? "row-span-5" : "",
                    formEntry.doubleWidth ? "md:col-span-2" : "",
                    props.fixedWidths
                      ? `grow-0 shrink-0 px-2 pt-3 h-32 ${props.fixedWidths}`
                      : "",
                    // Rewards drawn in green
                    formEntry.category === "reward"
                      ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 border rounded-lg"
                      : "",
                    // Oppoenents drawn in red
                    formEntry.category === "opponent"
                      ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 border rounded-lg"
                      : "",
                    // Attackers drawn in red
                    formEntry.category === "attackers"
                      ? "bg-pink-100 dark:bg-pink-900/20 border-pink-200 dark:border-pink-800 border rounded-lg"
                      : "",
                    // Location things in blue
                    formEntry.category === "location"
                      ? "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 border rounded-lg"
                      : "",
                    // Graph things in purple
                    formEntry.category === "graph"
                      ? "bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800 border rounded-lg"
                      : "",
                    // Description things in yellow
                    formEntry.category === "scene"
                      ? "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 border rounded-lg text-black dark:text-white"
                      : "",
                  )}
                >
                  {["text", "number", "date"].includes(type) && (
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
                              <Input
                                id={id}
                                type={type}
                                isDirty={fieldState.isDirty}
                                {...field}
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
                                checked={field.value}
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
                                height="200"
                                placeholder={currentValues[id] as string}
                                label={formEntry.label ? formEntry.label : id}
                                control={form.control}
                                isDirty={fieldState.isDirty}
                                error={form.formState.errors[id]?.message as string}
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
                    <div className="flex flex-row items-end">
                      <div className="grow">
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
                                  const currentValues = field.value ? field.value : [];
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
                                    selected={field.value ? field.value : []}
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
                                            !field.value && "text-muted-foreground",
                                            fieldState.isDirty && "border-orange-300",
                                          )}
                                        >
                                          {field.value
                                            ? dynamicOptions.find(
                                                (option) =>
                                                  option.value === field.value,
                                              )?.label
                                            : "Select option"}
                                          <ChevronsUpDown className="opacity-50" />
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
                                                    option.value === field.value
                                                      ? "opacity-100"
                                                      : "opacity-0",
                                                  )}
                                                />
                                              </CommandItem>
                                            ))}
                                          </CommandGroup>
                                          {canAddNew && (
                                            <div className="p-2 border-t">
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
                          className="w-8 p-0 ml-1"
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
                      )}
                      {"current" in formEntry && formEntry.current && (
                        <div className="w-12 ml-1 h-12 overflow-y-auto">
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
                              <div className="flex flex-row items-start gap-3 w-full">
                                <FormItem className="flex-1">
                                  <FormLabel>{label}</FormLabel>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      className={cn(
                                        "justify-between w-full",
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
                            <div className="flex flex-col gap-2 items-left w-full">
                              {audioUrl ? (
                                <audio className="w-full" src={audioUrl} controls />
                              ) : (
                                <div className="text-sm text-muted-foreground ">
                                  No audio set currently
                                </div>
                              )}
                              <div className="flex items-center gap-2 justify-center w-full">
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
                          ? (field.value as { text: string; nextObjectiveId: string }[])
                          : [];
                        return (
                          <FormItem className="flex flex-col gap-2">
                            <FormLabel>{formEntry.label ?? id}</FormLabel>
                            <div className="flex flex-col gap-2">
                              {dialogOptions.map((opt, idx) => {
                                const option: {
                                  text: string;
                                  nextObjectiveId: string;
                                } = opt;
                                return (
                                  <div key={idx} className="flex gap-2 items-center">
                                    <Input
                                      className="flex-1"
                                      placeholder="Dialog text..."
                                      value={option.text}
                                      onChange={(e) => {
                                        const updated = [...dialogOptions];
                                        updated[idx] = {
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
                                                    updated[idx] = {
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
                                          (_, i) => i !== idx,
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
                                className="w-full mt-2"
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
                                <Plus className="h-4 w-4 mr-1" /> Add Dialog Option
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
                        // Each entry: { opponentId: string, number: number }
                        const valueArr: { ids: string[]; number: number }[] =
                          Array.isArray(field.value) ? field.value : [];
                        const options = (formEntry.values || []).map((v) => ({
                          label: v.name,
                          value: v.id,
                        }));
                        return (
                          <FormItem className="flex flex-col py-4">
                            <FormLabel>{formEntry.label ?? id}</FormLabel>
                            <div className="flex flex-col gap-2">
                              {valueArr.map((entry, idx) => (
                                <div key={idx} className="flex gap-2 items-center">
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
                                                  updated[idx] = {
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
                                  {/* Number input */}
                                  <Input
                                    type="number"
                                    min={0}
                                    className="w-20"
                                    value={entry.number}
                                    onChange={(e) => {
                                      const updated = [...valueArr];
                                      updated[idx] = {
                                        ...entry,
                                        number: Number(e.target.value),
                                      };
                                      field.onChange(updated);
                                    }}
                                  />
                                  {/* Remove button */}
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    className="p-1"
                                    onClick={() => {
                                      const updated = valueArr.filter(
                                        (_, i) => i !== idx,
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
                                  field.onChange([...valueArr, { ids: [], number: 1 }]);
                                }}
                                disabled={options.length === 0}
                              >
                                <Plus className="h-4 w-4 mr-1" /> Add Entry
                              </Button>
                            </div>
                            <FormMessage />
                          </FormItem>
                        );
                      }}
                    />
                  ) : null}
                </div>
              </>
            );
          })}
        {showSubmit && props.onAccept && (
          <div className="col-span-2 items-center mt-3">
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
              disabled={submitDisabled}
            >
              {buttonTxt ?? "Save"}
            </Button>
          </div>
        )}
      </form>
    </Form>
  );
};

interface EffectFormWrapperProps {
  idx: number;
  type: "jutsu" | "bloodline" | "item" | "skillTree";
  availableTags: readonly string[];
  formClassName?: string;
  hideTagType?: boolean;
  tag: ZodAllTags;
  fixedWidths?: "basis-32" | "basis-64" | "basis-96";
  effects: ZodAllTags[];
  setEffects: (effects: ZodAllTags[]) => void;
}

/**
 * A wrapper component around EditContent for creating a form for a single tag
 * @returns React.ReactNode
 */
export const EffectFormWrapper: React.FC<EffectFormWrapperProps> = (props) => {
  // Destructure props
  const { tag, idx, effects, formClassName, setEffects } = props;

  // Get the schema & parse the tag
  const tagSchema = getTagSchema(tag.type);
  const parsedTag = tagSchema.safeParse(tag);
  const shownTag = parsedTag.success ? parsedTag.data : tag;
  const fields = Object.keys(shownTag);

  // Queries
  const { data: aiData } = api.profile.getAllAiNames.useQuery(undefined, {
    enabled: Object.keys(shownTag).includes("aiId"),
  });

  const { data: jutsuData } = api.jutsu.getAllNames.useQuery(undefined, {
    enabled:
      fields.includes("jutsus") ||
      fields.includes("reward_jutsus") ||
      fields.includes("jutsuIds"),
  });

  const { data: itemData } = api.item.getAllNames.useQuery(undefined, {
    enabled:
      fields.includes("items") ||
      fields.includes("reward_items") ||
      fields.includes("skillId"),
  });

  const { data: bloodlines } = api.bloodline.getAllNames.useQuery(undefined, {
    enabled: fields.includes("reward_bloodlines"),
  });

  const { data: skillsData } = api.skillTree.getAllNames.useQuery(undefined, {
    enabled: fields.includes("skillId"),
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
  const form = useForm<typeof tag>({
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
        // For all typed keys in shownTag, if the key exists in curTag, keep the value, except for type
        objectKeys(shownTag).map((key) => {
          if (!["type", "calculation", "direction"].includes(key) && key in curTag) {
            // @ts-expect-error - we know this is a key of the object
            shownTag[key] = curTag[key];
          }
        });
        newEffects[idx] = shownTag;
        form.reset(shownTag);
      }
      setEffects(newEffects);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag, watchType, idx, effects]);

  // Trigger re-validation after type changes
  useEffect(() => {
    void form.trigger(undefined, { shouldFocus: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag.type]);

  // Automatically update the effects whenever new data
  useEffect(() => {
    // Calculate diff
    const newEffects = [...effects];
    const tagSchema = getTagSchema(watchType);
    const parsedTag = tagSchema.safeParse(watchAll);
    const shownTag = parsedTag.success ? parsedTag.data : tag;
    newEffects[idx] = shownTag;
    const diff = calculateContentDiff(effects, newEffects);
    if (diff.length > 0) {
      if (tag.type === watchType) {
        if (form.formState.isDirty) {
          void form.trigger();
        }
        if (form.formState.isValid) {
          setEffects(newEffects);
          form.reset(watchAll);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchAll]);

  // Attributes on this tag, each of which we should show a form field for
  type Attribute = keyof typeof tag;
  const attributes = Object.keys(tagSchema.shape) as Attribute[];

  /** Unwrap zod types to get inner-most type */
  const getInner = (type: z.ZodTypeAny): z.ZodTypeAny => {
    if (
      type instanceof z.ZodDefault ||
      type instanceof z.ZodOptional ||
      type instanceof z.ZodNullable
    ) {
      return getInner(type._def.innerType as z.ZodTypeAny);
    }
    return type;
  };

  // Parse how to present the tag form
  const ignore = ["timeTracker", "type"];
  if (props.type === "bloodline") {
    ignore.push(...["rounds", "friendlyFire"]);
  }
  // Add direction to ignore list if not increasestat, decreasestat, or redirection
  if (!["increasestat", "decreasestat", "redirection"].includes(tag.type)) {
    ignore.push("direction");
  }

  // Create the form data dynamically based on the tag type
  const formData: FormEntry<Attribute>[] = attributes
    .filter((value) => !ignore.includes(value))
    .filter((value) => {
      return (
        !["noncombatconsumereward", "noncombatgainskill"].includes(watchType) ||
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
        !["rollbloodline", "removebloodline", "marriageslotincrease"].includes(
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
        ].includes(value)
      );
    })
    .map((value) => {
      const innerType = getInner(tagSchema.shape[value]);
      if ((value as string) === "aiId" && aiData) {
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
          values: itemData.sort((a, b) => a.name.localeCompare(b.name)),
          doubleWidth: true,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values_with_number",
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
      } else if ((value as string) === "reward_badges" && badgeData?.data) {
        return {
          id: value,
          values: badgeData?.data,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values",
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
        return { id: value, label: value, type: "number" };
      } else if (innerType instanceof z.ZodEnum) {
        return {
          id: value,
          type: "str_array",
          values: innerType._def.values as string[],
        };
      } else if (innerType instanceof z.ZodNativeEnum) {
        return {
          id: value,
          type: "str_array",
          values: Object.keys(innerType._def.values as Record<string, string>),
        };
      } else if (
        innerType instanceof z.ZodArray &&
        innerType._def.type instanceof z.ZodEnum
      ) {
        const values = innerType._def.type._def.values as string[];
        return { id: value, type: "str_array", values: values, multiple: true };
      } else if (innerType instanceof z.ZodBoolean) {
        return { id: value, label: value, type: "boolean" };
      } else {
        return { id: value, label: value, type: "text" };
      }
    });

  // Add tag type as first entry
  if (!props.hideTagType) {
    formData.unshift({
      id: "type",
      type: "str_array",
      values: props.availableTags,
    });
  }

  // Re-used EditContent component for actually showing the form
  return (
    <EditContent
      schema={tagSchema}
      form={form}
      formData={formData}
      formClassName={formClassName}
      showSubmit={false}
      buttonTxt="Confirm Changes (No database sync)"
      fixedWidths={props.fixedWidths}
    />
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
}

/**
 * A wrapper component around EditContent for creating a form for a single tag
 * @returns React.ReactNode
 */
export const ObjectiveFormWrapper: React.FC<ObjectiveFormWrapperProps> = (props) => {
  // Destructure props
  const { idx, objective, objectives, formClassName, setObjectives } = props;

  // Get the schema & parse the tag
  const objectiveSchema = getObjectiveSchema(objective.task as string);
  const parsedTag = objectiveSchema.safeParse(objective);
  const shownTag = parsedTag.success ? parsedTag.data : objective;

  // Queries
  const fields = Object.keys(shownTag);
  const hasAIs = fields.includes("attackerAIs") || fields.includes("opponentAIs");
  const { data: aiData } = api.profile.getAllAiNames.useQuery(undefined, {
    enabled: hasAIs,
  });

  const { data: jutsuData } = api.jutsu.getAllNames.useQuery(undefined, {
    enabled: fields.includes("reward_jutsus"),
  });

  const { data: badgeData } = api.badge.getAll.useQuery(undefined, {
    enabled: fields.includes("reward_badges"),
  });

  const { data: itemData } = api.item.getAllNames.useQuery(undefined, {
    enabled:
      fields.includes("reward_items") ||
      fields.includes("collectItemIds") ||
      fields.includes("deliverItemIds"),
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
    enabled: fields.includes("newQuestIds"),
  });

  const { data: bloodlines } = api.bloodline.getAllNames.useQuery(undefined, {
    enabled: fields.includes("reward_bloodlines"),
  });

  // Form for handling the specific tag
  const form = useForm<AllObjectivesType>({
    defaultValues: shownTag,
    values: shownTag,
    resolver: zodResolver(objectiveSchema),
    mode: "all",
    reValidateMode: "onBlur",
  });

  // A few fields we need to watch
  const watchTask = useWatch({ control: form.control, name: "task" });
  const watchAll = useWatch({ control: form.control });

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objective, watchTask, idx, objectives]);

  // Trigger re-validation after type changes
  useEffect(() => {
    void form.trigger(undefined, { shouldFocus: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objective.task]);

  // Automatically update the effects whenever dirty
  useEffect(() => {
    const newObjectives = [...objectives];
    const parsedTag = objectiveSchema.safeParse(watchAll);
    const shownTag = parsedTag.success ? parsedTag.data : watchAll;
    if ("id" in shownTag && shownTag.id) {
      newObjectives[idx] = shownTag as AllObjectivesType;
      const diff = calculateContentDiff(objectives, newObjectives);
      if (diff.length > 0) {
        if (objective.task === watchTask) {
          if (form.formState.isDirty) {
            void form.trigger();
          }
          const hasErrors = Object.keys(form.formState.errors).length > 0;
          if (!hasErrors) {
            setObjectives(newObjectives);
            form.reset(watchAll);
          }
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchAll]);

  // Attributes on this tag, each of which we should show a form field for
  type Attribute = keyof AllObjectivesType;
  const attributes = Object.keys(objectiveSchema.shape) as Attribute[];

  /** Unwrap zod types to get inner-most type */
  const getInner = (type: z.ZodTypeAny): z.ZodTypeAny => {
    if (
      type instanceof z.ZodDefault ||
      type instanceof z.ZodOptional ||
      type instanceof z.ZodNullable
    ) {
      return getInner(type._def.innerType as z.ZodTypeAny);
    }
    return type;
  };

  const sectorType = "sectorType" in watchAll ? watchAll.sectorType : undefined;
  const locationType = "locationType" in watchAll ? watchAll.locationType : undefined;

  // Parse how to present the tag form
  const formData: FormEntry<Attribute>[] = attributes
    .filter(
      (value) =>
        !["task", "id", "image", "item_name", "reward", "completed"].includes(value),
    )
    .filter((value) => {
      return (
        !(SimpleTasks as unknown as string[]).includes(watchTask) ||
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
        !["reward_hunter_items_ids", "reward_hunting_experience"].includes(value)
      );
    })
    .filter((value) => {
      return (
        props?.quest?.questType === "gathering" ||
        !["reward_gathering_items_ids", "reward_gathering_experience"].includes(value)
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
    .map((value) => {
      const innerType = getInner(objectiveSchema.shape[value]);
      if ((["attackers"] as string[]).includes(value) && aiData) {
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
      } else if ((["opponentAIs"] as string[]).includes(value) && aiData) {
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
          values: itemData.sort((a, b) => a.name.localeCompare(b.name)),
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
      } else if (value === "reward_badges" && badgeData?.data) {
        return {
          id: value,
          values: badgeData?.data,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
          type: "db_values",
        };
      } else if (["collectItemIds", "deliverItemIds"].includes(value) && itemData) {
        return {
          id: value,
          values: itemData,
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
      } else if (([value] as string[]).includes("newQuestIds") && quests) {
        return {
          id: value,
          values: quests,
          multiple: true,
          type: "db_values",
          label: FORM_LABEL_MAP[value] ?? value,
        };
      } else if (
        innerType instanceof z.ZodLiteral ||
        innerType instanceof z.ZodString
      ) {
        return { id: value, label: FORM_LABEL_MAP[value] ?? value, type: "text" };
      } else if (innerType instanceof z.ZodNumber) {
        return { id: value, label: FORM_LABEL_MAP[value] ?? value, type: "number" };
      } else if (innerType instanceof z.ZodEnum) {
        return {
          id: value,
          type: "str_array",
          values: innerType._def.values as string[],
          label: FORM_LABEL_MAP[value] ?? value,
        };
      } else if (innerType instanceof z.ZodNativeEnum) {
        return {
          id: value,
          type: "str_array",
          label: FORM_LABEL_MAP[value] ?? value,
          values: Object.keys(innerType._def.values as Record<string, string>),
        };
      } else if (
        innerType instanceof z.ZodArray &&
        innerType._def.type instanceof z.ZodEnum
      ) {
        const values = innerType._def.type._def.values as string[];
        return {
          id: value,
          type: "str_array",
          values: values,
          multiple: true,
          label: FORM_LABEL_MAP[value] ?? value,
        };
      } else if (
        innerType instanceof z.ZodArray &&
        innerType._def.type instanceof z.ZodString
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
    <EditContent
      schema={objectiveSchema}
      form={form}
      formData={formData}
      formClassName={formClassName}
      showSubmit={false}
      buttonTxt="Confirm Changes (No database sync)"
    />
  );
};

// Form labels for different tag names
export const FORM_LABEL_MAP: Record<string, string> = {
  reward_items: "Reward Items [and drop chance%]",
  reward_jutsus: "Reward Jutsus",
  reward_bloodlines: "Reward Bloodlines",
  reward_badges: "Reward Badges",
  opponentAIs: "Opponent AIs [and number]",
  nextObjectiveId: "Next Objective ID",
  failObjectiveId: "If fail, go to objective",
  resetObjectiveId: "Reset to specific objective",
  opponent_scaled_to_user: "Scale Opponent to user level",
  scaleGains: "Scale opponent combat gains",
  keepOriginalPools: "Reset pools after opponent battle",
  attackers: "Random Encounter AIs [and encounter chance%]",
  attackers_scaled_to_user: "Scale random encounter to user lvl",
  attackers_scale_gains: "Scale random encounter combat gains",
  attackers_max_per_battle: "Max number of AI in random encounter",
  skillId: "Skill Unlocked by Consumption",
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
    animation?: OptionType[];
    staticAsset?: OptionType[];
  };
}) => {
  const { effect, field, onChange } = opts;
  const schema = getTagSchema(effect.type);
  const fieldSchema = (schema.shape as Record<string, z.ZodTypeAny>)[field] as
    | z.ZodTypeAny
    | undefined;
  if (!fieldSchema) return <div className="text-muted-foreground">N/A</div>;
  const inner = ((): z.ZodTypeAny => {
    let t: z.ZodTypeAny = fieldSchema;
    while (
      t instanceof z.ZodDefault ||
      t instanceof z.ZodOptional ||
      t instanceof z.ZodNullable
    ) {
      t = (t as { _def: { innerType: z.ZodTypeAny } })._def.innerType;
    }
    return t;
  })();
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
      />
    );
  }

  // Primitives
  if (inner instanceof z.ZodNumber) {
    const value = eff[field];
    const numVal = typeof value === "number" ? value : Number(value ?? 0);
    return (
      <Input
        type="number"
        value={String(numVal)}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    );
  }
  if (inner instanceof z.ZodBoolean) {
    const value = eff[field];
    const boolVal = typeof value === "boolean" ? value : Boolean(value);
    return <Switch checked={boolVal} onCheckedChange={(v) => onChange(v)} />;
  }
  if (inner instanceof z.ZodEnum) {
    const values = inner._def.values as string[];
    const options = values.map((v) => ({ label: v, value: v }));
    const raw = eff[field];
    const cur = typeof raw === "string" ? raw : "";
    const handle = (v: string) => onChange(v);
    return <SingleSelectSimple value={cur} onChange={handle} options={options} />;
  }
  if (inner instanceof z.ZodNativeEnum) {
    const values = Object.keys(inner._def.values as Record<string, string>);
    const options = values.map((v) => ({ label: v, value: v }));
    const raw = eff[field];
    const cur = typeof raw === "string" ? raw : "";
    const handle = (v: string) => onChange(v);
    return <SingleSelectSimple value={cur} onChange={handle} options={options} />;
  }
  if (inner instanceof z.ZodArray) {
    const innerArray: z.ZodTypeAny = (inner as z.ZodArray<z.ZodTypeAny>)._def.type;
    let t: z.ZodTypeAny = innerArray;
    while (
      t instanceof z.ZodDefault ||
      t instanceof z.ZodOptional ||
      t instanceof z.ZodNullable
    ) {
      t = (t as { _def: { innerType: z.ZodTypeAny } })._def.innerType;
    }
    if (t instanceof z.ZodEnum) {
      const values = (t._def.values as string[]) || [];
      const options = values.map((v) => ({ label: v, value: v }));
      const selected = Array.isArray(eff[field])
        ? (eff[field] as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      const onChangeMs: React.Dispatch<React.SetStateAction<string[]>> = (v) =>
        onChange(v);
      return (
        <MultiSelect selected={selected} onChange={onChangeMs} options={options} />
      );
    }
    if (t instanceof z.ZodString) {
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
    <Input type="text" value={textVal} onChange={(e) => onChange(e.target.value)} />
  );
};

/** Simple single-select reused helper */
const SingleSelectSimple: React.FC<{
  value: string;
  onChange: (v: string) => void;
  options: OptionType[];
  searchable?: boolean;
}> = ({ value, onChange, options, searchable }) => {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-between">
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
  T extends { id: string; name: string; effects: ZodAllTags[] },
>(props: {
  kind: "item" | "jutsu" | "bloodline";
  entries: T[] | undefined;
  selectedFields: string[];
  onEntriesUpdated?: () => void;
  filterEffectTypes?: string[];
}) => {
  const { kind, entries, selectedFields } = props;

  const [modified, setModified] = useState<Record<string, ZodAllTags[]>>({});

  // Options
  const { data: aiData } = api.profile.getAllAiNames.useQuery(undefined);
  const { data: jutsuData } = api.jutsu.getAllNames.useQuery(undefined);
  const { data: itemData } = api.item.getAllNames.useQuery(undefined);
  const { data: bloodlines } = api.bloodline.getAllNames.useQuery(undefined);
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
        animation: (assetData || [])
          .filter((a) => a.type === "ANIMATION")
          .map((a) => ({ label: a.id, value: a.id })),
        staticAsset: (assetData || [])
          .filter((a) => a.type === "STATIC")
          .map((a) => ({ label: a.id, value: a.id })),
      }) as const,
    [aiData, jutsuData, itemData, bloodlines, assetData],
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
            <EffectFieldInputGeneric
              effect={modified[entry.id]?.[idx] ?? effect}
              field={f}
              onChange={(v) =>
                setModified((prev) => {
                  const next: Record<string, ZodAllTags[]> = { ...prev };
                  const baseEffs = next[entry.id] ?? entry.effects;
                  const effsArray = Array.isArray(baseEffs) ? baseEffs : entry.effects;
                  const updated = [...effsArray];
                  const current = updated[idx] ?? effect;
                  updated[idx] = { ...current, [f]: v } as ZodAllTags;
                  next[entry.id] = updated;
                  return next;
                })
              }
              options={options}
            />
          );
        });
        out.push(row);
      });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, selectedFields, modified, options]);

  // Mutations
  const itemUpdate = api.item.update.useMutation();
  const jutsuUpdate = api.jutsu.update.useMutation();
  const bloodlineUpdate = api.bloodline.update.useMutation();

  const saveRow = async (row: Row) => {
    const entry = (entries || []).find((e) => e.id === row.entryId);
    if (!entry) return;
    const effects = modified[row.entryId] ?? entry.effects;
    if (kind === "item") {
      const data = { ...(entry as unknown as ZodItemType), effects } as ZodItemType;
      const res = await itemUpdate.mutateAsync({ id: entry.id, data });
      showMutationToast(res);
    } else if (kind === "jutsu") {
      const data = { ...(entry as unknown as ZodJutsuType), effects } as ZodJutsuType;
      const res = await jutsuUpdate.mutateAsync({ id: entry.id, data });
      showMutationToast(res);
    } else {
      const data = {
        ...(entry as unknown as ZodBloodlineType),
        effects,
      } as ZodBloodlineType;
      const res = await bloodlineUpdate.mutateAsync({ id: entry.id, data });
      showMutationToast(res);
    }
    setModified((prev) => {
      const next = { ...prev };
      delete next[row.entryId];
      return next;
    });
    props.onEntriesUpdated?.();
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
    <div className="flex flex-col gap-2">
      <Table<Row, keyof Row>
        data={rows}
        columns={columns}
        buttons={[{ label: "Save", onClick: (r: Row) => void saveRow(r) }]}
      />
    </div>
  );
};

export const EffectFieldSelector: React.FC<{
  selected: string[];
  setSelected: React.Dispatch<React.SetStateAction<string[]>>;
  className?: string;
}> = ({ selected, setSelected, className }) => {
  // Build field options from all tag schemas
  const fieldOptions = useMemo<OptionType[]>(() => {
    const fields = new Set<string>();
    // Build from a sample of tag schemas by introspecting one common schema
    // We reuse getTagSchema across tag types using tagTypes from types.ts
    const all = getTagSchema("damage").shape as Record<string, unknown>;
    Object.keys(all)
      .filter((k) => !["type", "timeTracker"].includes(k))
      .forEach((k) => fields.add(k));
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
      />
    </div>
  );
};
