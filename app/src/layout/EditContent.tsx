import { z } from "zod";
import { calculateContentDiff } from "@/utils/diff";
import { useForm, useWatch } from "react-hook-form";
import Image from "next/image";
import React, { useEffect, useState } from "react";
import ContentImageSelector from "@/layout/ContentImageSelector";
import RichInput from "@/layout/RichInput";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { objectKeys } from "@/utils/typeutils";
import { getTagSchema } from "@/libs/combat/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "@/app/_trpc/client";
import { getObjectiveSchema } from "@/validators/objectives";
import { Button } from "@/components/ui/button";
import { MultiSelect, type OptionType } from "@/components/ui/multi-select";
import { X, Plus } from "lucide-react";
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
import type { Path, PathValue } from "react-hook-form";
import type { AllObjectivesType } from "@/validators/objectives";
import type { ZodAllTags } from "@/libs/combat/types";
import type { FieldValues } from "react-hook-form";
import type { UseFormReturn } from "react-hook-form";
import type { ContentType, IMG_ORIENTATION } from "@/drizzle/constants";

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
  | { type: "animation_array"; values: readonly string[] }
  | { type: "statics_array"; values: readonly string[] }
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
  bgColor?: "bg-slate-600" | "";
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

  // const load = isLoading || load1 || load2 || load3;
  return (
    <Form {...form}>
      <form
        onSubmit={props.onAccept}
        className={
          formClassName ?? "grid grid-cols-1 md:grid-cols-2 items-center gap-2"
        }
      >
        {formData
          .filter((formEntry) => formEntry.type !== "avatar3d")
          .sort((a, b) => {
            if (["dialog_options", "db_values_with_number"].includes(a.type)) return 1;
            if (["dialog_options", "db_values_with_number"].includes(b.type)) return -1;
            return 0;
          })
          .map((formEntry) => {
            // Derived
            const id = formEntry.id;
            let type = formEntry.type;

            // Options for select & multi-select
            let options: OptionType[] = [];
            if (
              formEntry.type === "animation_array" ||
              formEntry.type === "statics_array" ||
              formEntry.type === "str_array"
            ) {
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

            // Render
            return (
              <div
                key={`formEntry-${id}`}
                className={`${["avatar", "avatar3d"].includes(type) ? "row-span-5" : ""} ${
                  formEntry.doubleWidth ? "md:col-span-2" : ""
                } ${
                  props.fixedWidths
                    ? `grow-0 shrink-0 px-2 pt-3 h-32 ${props.fixedWidths}`
                    : ""
                } ${props.bgColor ? props.bgColor : ""}`}
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
                          <br />
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
                  type === "db_values" ||
                  type === "animation_array" ||
                  type === "statics_array") && (
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
                          const dynamicOptions = dynamicOptionsMap[fieldId] || options;
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
                                field.onChange([...currentValues, newItemInput.trim()]);
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
                                              (option) => option.value === field.value,
                                            )?.label
                                          : "Select option"}
                                        <ChevronsUpDown className="opacity-50" />
                                      </Button>
                                    </FormControl>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-[200px] p-0">
                                    <Command>
                                      {formEntry.searchable && (
                                        <CommandInput
                                          placeholder="Search..."
                                          className="h-9"
                                        />
                                      )}

                                      <CommandList>
                                        <CommandEmpty>No framework found.</CommandEmpty>
                                        <CommandGroup>
                                          {dynamicOptions.map((option) => (
                                            <CommandItem
                                              value={option.label}
                                              key={option.value}
                                              onSelect={() => {
                                                form.setValue(
                                                  id,
                                                  option.value as PathValue<S, K>,
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
                {type === "avatar" &&
                  props.allowImageUpload &&
                  "href" in formEntry &&
                  props.type && (
                    <ContentImageSelector
                      label={formEntry.label ? formEntry.label : id}
                      imageUrl={currentValues?.[id] ?? formEntry.href}
                      id={props.relationId ?? nanoid()}
                      allowImageUpload={props.allowImageUpload}
                      prompt={prompt}
                      type={props.type}
                      onUploadComplete={(url) => {
                        form.setValue(id, url as PathValue<S, K>, {
                          shouldDirty: true,
                        });
                      }}
                      size={formEntry.size ?? "square"}
                      maxDim={formEntry.maxDim ?? 256}
                    />
                  )}
                {formEntry.type === "dialog_options" ? (
                  <FormField
                    control={form.control}
                    name={id}
                    render={({ field }) => {
                      const dialogOptions: { text: string; nextObjectiveId: string }[] =
                        Array.isArray(field.value)
                          ? (field.value as { text: string; nextObjectiveId: string }[])
                          : [];
                      return (
                        <FormItem className="flex flex-col gap-2">
                          <FormLabel>{formEntry.label ?? id}</FormLabel>
                          <div className="flex flex-col gap-2">
                            {dialogOptions.map((opt, idx) => {
                              const option: { text: string; nextObjectiveId: string } =
                                opt;
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
                                      {options.find((o) => entry.ids.includes(o.value))
                                        ?.label || "Select Entry"}
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
                                  min={1}
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
            );
          })}
        {showSubmit && props.onAccept && (
          <div className="col-span-2 items-center mt-3">
            <Button
              id="create"
              className="w-full"
              onClick={props.onAccept}
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
  type: "jutsu" | "bloodline" | "item";
  availableTags: readonly string[];
  formClassName?: string;
  hideTagType?: boolean;
  tag: ZodAllTags;
  fixedWidths?: "basis-32" | "basis-64" | "basis-96";
  bgColor?: "bg-slate-600" | "";
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
    enabled: fields.includes("jutsus") || fields.includes("reward_jutsus"),
  });

  const { data: itemData } = api.item.getAllNames.useQuery(undefined, {
    enabled: fields.includes("items") || fields.includes("reward_items"),
  });

  const { data: bloodlines } = api.bloodline.getAllNames.useQuery(undefined, {
    enabled: fields.includes("reward_bloodlines"),
  });

  const { data: badgeData } = api.badge.getAll.useQuery(undefined, {
    enabled: fields.includes("reward_badges"),
  });

  const { data: assetData } = api.misc.getAllGameAssetNames.useQuery(undefined, {
    enabled:
      fields.includes("staticAssetPath") ||
      fields.includes("appearAnimation") ||
      fields.includes("staticAnimation") ||
      fields.includes("disappearAnimation"),
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
  // Add direction to ignore list if not increasestat or decreasestat
  if (!["increasestat", "decreasestat"].includes(tag.type)) {
    ignore.push("direction");
  }
  const formData: FormEntry<Attribute>[] = attributes
    .filter((value) => !ignore.includes(value))
    .map((value) => {
      const innerType = getInner(tagSchema.shape[value]);
      if ((value as string) === "aiId" && aiData) {
        return {
          id: value,
          label: "AI",
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
          type: "db_values",
        };
      } else if ((value as string) === "jutsus" && jutsuData) {
        return {
          id: value,
          values: jutsuData,
          multiple: true,
          type: "db_values",
        };
      } else if ((value as string) === "reward_items" && itemData) {
        return {
          id: value,
          values: itemData.sort((a, b) => a.name.localeCompare(b.name)),
          doubleWidth: true,
          multiple: true,
          label: "Reward Items [and drop chance%]",
          type: "db_values_with_number",
        };
      } else if ((value as string) === "reward_jutsus" && jutsuData) {
        return {
          id: value,
          values: jutsuData,
          multiple: true,
          type: "db_values",
        };
      } else if ((value as string) === "reward_bloodlines" && bloodlines) {
        return {
          id: value,
          values: bloodlines,
          multiple: true,
          type: "db_values",
        };
      } else if ((value as string) === "reward_badges" && badgeData?.data) {
        return {
          id: value,
          values: badgeData?.data,
          multiple: true,
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
      bgColor={props.bgColor}
    />
  );
};

interface ObjectiveFormWrapperProps {
  idx: number;
  availableTags: readonly string[];
  hideTagType?: boolean;
  hideRounds?: boolean;
  objective: AllObjectivesType;
  formClassName?: string;
  fixedWidths?: "basis-32" | "basis-64" | "basis-96";
  bgColor?: "bg-slate-600" | "";
  objectives: AllObjectivesType[];
  consecutiveObjectives: boolean;
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
          if (form.formState.isValid) {
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
        props.consecutiveObjectives ||
        !["nextObjectiveId", "failObjectiveId"].includes(value)
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
          label: "Random Attacker AIs [and encounter chance %]",
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
          label: "Opponent AIs [and number]",
          type: "db_values_with_number",
        };
      } else if (value === "reward_items" && itemData) {
        return {
          id: value,
          values: itemData.sort((a, b) => a.name.localeCompare(b.name)),
          doubleWidth: true,
          multiple: true,
          label: "Reward Items [and drop chance%]",
          type: "db_values_with_number",
        };
      } else if (value === "reward_jutsus" && jutsuData) {
        return {
          id: value,
          values: jutsuData,
          multiple: true,
          type: "db_values",
        };
      } else if (value === "reward_bloodlines" && bloodlines) {
        return {
          id: value,
          values: bloodlines,
          multiple: true,
          type: "db_values",
        };
      } else if (value === "reward_badges" && badgeData?.data) {
        return {
          id: value,
          values: badgeData?.data,
          multiple: true,
          type: "db_values",
        };
      } else if (["collectItemIds", "deliverItemIds"].includes(value) && itemData) {
        return {
          id: value,
          values: itemData,
          multiple: true,
          type: "db_values",
        };
      } else if (["sceneBackground"].includes(value) && sceneBackgrounds) {
        return {
          id: value,
          values: sceneBackgrounds,
          type: "db_values",
        };
      } else if (["sceneCharacters"].includes(value) && sceneCharacters) {
        return {
          id: value,
          values: sceneCharacters,
          multiple: true,
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
            type: "dialog_options",
            objectiveIds: obejctiveIds,
          };
        } else {
          return {
            id: value,
            values: obejctiveIds,
            type: "str_array",
            resetButton: true,
          };
        }
      } else if (["failObjectiveId"].includes(value) && props.objectives) {
        const obejctiveIds = props.objectives.map((objective) => objective.id);
        return {
          id: value,
          values: obejctiveIds,
          type: "str_array",
          resetButton: true,
        };
      } else if (([value] as string[]).includes("newQuestIds") && quests) {
        return {
          id: value,
          values: quests,
          multiple: true,
          type: "db_values",
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
        };
      } else if (innerType instanceof z.ZodBoolean) {
        return { id: value, label: value, type: "boolean" };
      } else {
        return { id: value, label: value, type: "text" };
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
      fixedWidths={props.fixedWidths}
      bgColor={props.bgColor}
    />
  );
};
