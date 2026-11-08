"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Copy,
  Footprints,
  Handshake,
  Leaf,
  MapPin,
  Pencil,
  Swords,
  Trash2,
  Users,
} from "lucide-react";
import type React from "react";
import { use, useCallback, useState } from "react";
import { type Control, useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { MultiSelect } from "@/components/ui/multi-select";
import { NumberInput } from "@/components/ui/number-input";
import { Switch } from "@/components/ui/switch";
import {
  OVERWORLD_DEFAULT_WANDER_RADIUS,
  OVERWORLD_MAP_SCALE_RANGE,
  OVERWORLD_MAX_GROUP_SIZE,
  OVERWORLD_MAX_SPAWN_COUNT,
  OVERWORLD_MAX_WANDER_RADIUS,
  type OverworldHabitat,
  OverworldHabitats,
  type OverworldInteractionType,
} from "@/drizzle/constants";
import type { OverworldAiPlacement, OverworldAiPlacementQuest } from "@/drizzle/schema";
import { useRequireRole } from "@/hooks/useRequireRole";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import {
  type OverworldPlacementInput,
  OverworldPlacementSchema,
} from "@/validators/overworldAi";

/** Renders the placement editor for an AI template after enforcing content-editor access. */
export default function ManualAiPlacements(props: {
  params: Promise<{ aiid: string }>;
}) {
  const params = use(props.params);
  const aiId = params.aiid;
  const { hasAccess } = useRequireRole(canChangeContent);

  // Queries
  const { data: placements, isPending } = api.overworldAi.getPlacementsForAi.useQuery(
    { aiTemplateUserId: aiId },
    { enabled: !!aiId && hasAccess },
  );

  // Prevent unauthorized access
  if (!hasAccess || isPending) {
    return <Loader explanation="Loading data" />;
  }

  return <PlacementsManager aiId={aiId} placements={placements ?? []} />;
}

/** Manages creation, editing, and deletion of an AI template's overworld placements. */
const PlacementsManager: React.FC<PlacementsManagerProps> = ({ aiId, placements }) => {
  const utils = api.useUtils();
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [sectorInput, setSectorInput] = useState("");

  // Quest names for the pool selector; habitat sizes for the population summary
  const { data: questNames } = api.overworldAi.getAssignableQuestNames.useQuery(
    undefined,
    { staleTime: 60_000 },
  );
  const { data: habitatSectors } = api.overworldAi.getHabitatSectorCounts.useQuery(
    undefined,
    { staleTime: Number.POSITIVE_INFINITY },
  );

  // Form
  const form = useForm<OverworldPlacementInput>({
    resolver: zodResolver(OverworldPlacementSchema),
    defaultValues: defaultFormValues(aiId),
  });

  /** Leaves edit mode and restores an empty placement form for the current AI template. */
  const resetEditor = useCallback(() => {
    setEditingId(undefined);
    form.reset(defaultFormValues(aiId));
    setSectorInput("");
  }, [aiId, form]);

  // Watched fields for conditional rendering — all hooks before any early returns
  const watched = useWatch({ control: form.control }) as OverworldPlacementInput;
  const interactionType = watched.interactionType ?? "HOSTILE";
  const sectorType = watched.sectorType ?? "specific";
  const locationType = watched.locationType ?? "specific";
  const watchedQuests = (watched.quests ?? []) as { questId: string; chance: number }[];
  const watchedSectorList = (watched.sectorList ?? []) as number[];
  const habitats = (watched.habitats ?? []) as OverworldHabitat[];
  const wanderRadius = Number(watched.wanderRadius ?? OVERWORLD_DEFAULT_WANDER_RADIUS);
  const mapScale = Number(watched.mapScale ?? 100);

  /** Refreshes placement data and resets the editor after a successful mutation. */
  const handleMutationSuccess = useCallback(
    async (data: Parameters<typeof showMutationToast>[0]) => {
      showMutationToast(data);
      if (data.success) {
        await utils.overworldAi.getPlacementsForAi.invalidate({
          aiTemplateUserId: aiId,
        });
        resetEditor();
      }
    },
    [aiId, resetEditor, utils.overworldAi.getPlacementsForAi],
  );

  // Mutations
  const { mutate: upsert, isPending: isUpserting } =
    api.overworldAi.upsertPlacement.useMutation({
      onSuccess: handleMutationSuccess,
    });
  const { mutate: remove, isPending: isRemoving } =
    api.overworldAi.deletePlacement.useMutation({
      onSuccess: handleMutationSuccess,
    });

  /** Submits the current form as either a new placement or an update to the selected placement. */
  const onSubmit = (values: OverworldPlacementInput) => {
    upsert({ id: editingId, data: values });
  };

  /** Loads an existing placement and its quest pool into the form for editing. */
  const onEdit = (placement: Placement) => {
    setEditingId(placement.id);
    form.reset({
      aiTemplateUserId: placement.aiTemplateUserId,
      interactionType: placement.interactionType,
      sectorType: placement.sectorType,
      locationType: placement.locationType,
      sector: placement.sector,
      longitude: placement.longitude,
      latitude: placement.latitude,
      sectorList: (placement.sectorList as number[] | null) ?? [],
      quests:
        placement.interactionType === "FRIENDLY"
          ? placement.questPool.map((q) => ({ questId: q.questId, chance: q.chance }))
          : [],
      isActive: placement.isActive,
      wanderRadius: placement.wanderRadius,
      spawnCount: placement.spawnCount,
      groupMin: placement.groupMin,
      groupMax: placement.groupMax,
      habitats: placement.habitats,
      wildOnly: placement.wildOnly,
      mapScale: placement.mapScale,
    });
    setSectorInput("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const selectedQuestIds = watchedQuests.map((quest) => quest.questId);

  // Grantable quests, plus any already-pooled quest whose type has since drifted out of the
  // grantable set — without those the editor would show a bare id and offer no way to remove it.
  const questOptions = (questNames ?? [])
    .filter((quest) => quest.assignable || selectedQuestIds.includes(quest.id))
    .map((quest) => ({
      value: quest.id,
      label: quest.assignable
        ? `${quest.name} (${quest.questType})`
        : `${quest.name} (${quest.questType} — no longer grantable)`,
    }));

  /** Updates selected quests while retaining the configured chance for existing entries. */
  const setSelectedQuestIds: React.Dispatch<React.SetStateAction<string[]>> = (
    next,
  ) => {
    const questIds = typeof next === "function" ? next(selectedQuestIds) : next;
    const chances = new Map(
      watchedQuests.map((quest) => [quest.questId, quest.chance]),
    );
    form.setValue(
      "quests",
      questIds.map((questId) => ({ questId, chance: chances.get(questId) ?? 0 })),
    );
  };

  /** Updates the weighted selection chance for one quest in the placement pool. */
  const setQuestChance = (questId: string, chance: number) => {
    form.setValue(
      "quests",
      watchedQuests.map((q) => (q.questId === questId ? { ...q, chance } : q)),
    );
  };

  /** Parses and adds the pending sector number when it is valid and not already selected. */
  const addSector = () => {
    const num = Number(sectorInput);
    if (
      sectorInput.trim() === "" ||
      !Number.isInteger(num) ||
      watchedSectorList.includes(num)
    )
      return;
    form.setValue("sectorList", [...watchedSectorList, num]);
    setSectorInput("");
  };

  /** Removes a sector from the placement's random-sector allowlist. */
  const removeSector = (sector: number) => {
    form.setValue(
      "sectorList",
      watchedSectorList.filter((s) => s !== sector),
    );
  };

  /** Habitats only narrow random sectors, so leaving that mode clears them. */
  const setSectorType = (value: OverworldPlacementInput["sectorType"]) => {
    form.setValue("sectorType", value);
    if (value !== "random") form.setValue("habitats", []);
  };

  const toggleHabitat = (habitat: OverworldHabitat) =>
    form.setValue(
      "habitats",
      habitats.includes(habitat)
        ? habitats.filter((h) => h !== habitat)
        : [...habitats, habitat],
    );

  const isLoading = isUpserting || isRemoving;
  const questChanceSum = watchedQuests.reduce((sum, quest) => sum + quest.chance, 0);
  const errors = form.formState.errors;

  return (
    <>
      <ContentBox
        title="Overworld Placements"
        subtitle={editingId ? "Editing placement" : "Create new placement"}
        defaultBackHref={`/manual/ai/edit/${aiId}`}
      >
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <Section
              icon={<Handshake className="h-4 w-4" />}
              title="Behaviour"
              description="How players can engage with this AI on the map."
              aside={
                <FormField
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2 space-y-0">
                      <FormLabel className="text-muted-foreground text-xs">
                        {field.value ? "Active" : "Hidden"}
                      </FormLabel>
                      <FormControl>
                        <Switch
                          checked={field.value as boolean}
                          onCheckedChange={field.onChange}
                          aria-label="Active"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              }
            >
              <FormField
                control={form.control}
                name="interactionType"
                render={({ field }) => (
                  <FormItem>
                    <ChoiceCards
                      label="Interaction"
                      value={field.value as OverworldInteractionType}
                      onChange={(value) => {
                        field.onChange(value);
                        // Only friendly placements may carry a quest pool.
                        if (value !== "FRIENDLY") form.setValue("quests", []);
                      }}
                      options={INTERACTION_OPTIONS}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
            </Section>

            <Section
              icon={<MapPin className="h-4 w-4" />}
              title="Where it appears"
              description="Random choices are rerolled every day."
            >
              <ChoiceCards
                label="Sector"
                value={sectorType}
                onChange={setSectorType}
                options={SECTOR_OPTIONS}
              />
              {sectorType === "specific" && (
                <IntegerField control={form.control} name="sector" label="Sector" />
              )}
              {sectorType === "from_list" && (
                <FormItem>
                  <FormLabel>Sectors to choose from</FormLabel>
                  <div className="flex gap-2">
                    <NumberInput
                      optional
                      placeholder="Add sector number"
                      value={sectorInput}
                      onTextChange={setSectorInput}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addSector();
                        }
                      }}
                    />
                    <Button type="button" variant="secondary" onClick={addSector}>
                      Add
                    </Button>
                  </div>
                  {watchedSectorList.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {watchedSectorList.map((s) => (
                        <Badge key={s} variant="secondary" className="gap-1">
                          {String(s)}
                          <button
                            type="button"
                            aria-label={`Remove sector ${s}`}
                            className="text-red-500 hover:text-red-700"
                            onClick={() => removeSector(s)}
                          >
                            ×
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                  {errors.sectorList?.message && (
                    <p className="text-destructive text-sm">
                      {errors.sectorList.message}
                    </p>
                  )}
                </FormItem>
              )}
              {sectorType === "random" && (
                <FormItem>
                  <FormLabel>Habitats</FormLabel>
                  <div className="flex flex-wrap gap-2">
                    {OverworldHabitats.map((habitat) => {
                      const selected = habitats.includes(habitat);
                      return (
                        <button
                          key={habitat}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => toggleHabitat(habitat)}
                          className={cn(
                            "rounded-full border px-3 py-1 text-sm transition-colors",
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border hover:bg-muted",
                          )}
                        >
                          {HABITAT_LABELS[habitat]}
                          {habitatSectors && (
                            <span className="ml-1 opacity-70">
                              {habitatSectors[habitat]}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <FormDescription>
                    {habitats.length === 0
                      ? "Any land sector. Pick habitats to keep this AI in its climate."
                      : `Only ${habitats.map((h) => HABITAT_LABELS[h].toLowerCase()).join(" and ")} sectors.`}
                  </FormDescription>
                  {errors.habitats?.message && (
                    <p className="text-destructive text-sm">
                      {errors.habitats.message}
                    </p>
                  )}
                </FormItem>
              )}
              <ChoiceCards
                label="Tile"
                value={locationType}
                onChange={(value) => form.setValue("locationType", value)}
                options={LOCATION_OPTIONS}
              />
              {locationType === "specific" && (
                <div className="flex gap-4">
                  <IntegerField
                    control={form.control}
                    name="longitude"
                    label="Longitude"
                    className="flex-1"
                  />
                  <IntegerField
                    control={form.control}
                    name="latitude"
                    label="Latitude"
                    className="flex-1"
                  />
                </div>
              )}
              <SwitchRow
                control={form.control}
                name="wildOnly"
                label="Keep to the wild"
                description="Spawn and roam only on wilderness tiles, away from villages and roads."
              />
            </Section>

            <Section
              icon={<Footprints className="h-4 w-4" />}
              title="Movement"
              description="Roaming follows a shared timeline, so every player sees the AI in the same place."
            >
              <RangeField
                control={form.control}
                name="wanderRadius"
                label="Roaming radius"
                min={0}
                max={OVERWORLD_MAX_WANDER_RADIUS}
                display={
                  wanderRadius === 0
                    ? "Stationary"
                    : `${wanderRadius} hex${wanderRadius === 1 ? "" : "es"}`
                }
                description="How far it wanders from its tile. Quests that point at a building need it stationary."
              />
              <RangeField
                control={form.control}
                name="mapScale"
                label="Size on the map"
                min={OVERWORLD_MAP_SCALE_RANGE[0]}
                max={OVERWORLD_MAP_SCALE_RANGE[1]}
                step={5}
                display={`${mapScale}%`}
                description="Height relative to a standard NPC; small animals read best around 40%."
              />
            </Section>

            <Section
              icon={<Users className="h-4 w-4" />}
              title="Population"
              description="Copies spread across the world; each copy appears as a group."
            >
              <div className="grid gap-4 sm:grid-cols-3">
                <BoundedIntegerField
                  control={form.control}
                  name="spawnCount"
                  label="Copies"
                  min={1}
                  max={OVERWORLD_MAX_SPAWN_COUNT}
                />
                <BoundedIntegerField
                  control={form.control}
                  name="groupMin"
                  label="Smallest group"
                  min={1}
                  max={OVERWORLD_MAX_GROUP_SIZE}
                />
                <BoundedIntegerField
                  control={form.control}
                  name="groupMax"
                  label="Largest group"
                  min={1}
                  max={OVERWORLD_MAX_GROUP_SIZE}
                />
              </div>
              <PopulationSummary
                values={watched}
                habitatSectors={habitatSectors}
                habitats={habitats}
              />
              {errors.spawnCount?.message && (
                <p className="text-destructive text-sm">{errors.spawnCount.message}</p>
              )}
            </Section>

            {interactionType === "FRIENDLY" && (
              <Section
                icon={<Leaf className="h-4 w-4" />}
                title="Quest pool"
                description="Chance of granting each quest when a player asks for a mission."
              >
                <MultiSelect
                  options={questOptions}
                  selected={selectedQuestIds}
                  onChange={setSelectedQuestIds}
                  placeholder="Select quests..."
                />
                {watchedQuests.length > 0 && (
                  <div className="space-y-1">
                    {watchedQuests.map((q) => {
                      const quest = questNames?.find((n) => n.id === q.questId);
                      return (
                        <div
                          key={q.questId}
                          className="bg-muted flex items-center gap-2 rounded px-2 py-1 text-sm"
                        >
                          <span className="flex-1 truncate">
                            {quest?.name ?? q.questId}
                          </span>
                          <NumberInput
                            min={0}
                            max={100}
                            className="h-8 w-20"
                            value={q.chance}
                            onValueChange={(value) => setQuestChance(q.questId, value)}
                          />
                          <span className="text-muted-foreground">%</span>
                        </div>
                      );
                    })}
                    <p className="text-muted-foreground text-xs">
                      Σ assigned: {questChanceSum}% · nothing: {100 - questChanceSum}%
                    </p>
                    {questChanceSum === 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-500">
                        All chances are 0 — this NPC will never grant a quest.
                      </p>
                    )}
                  </div>
                )}
                {errors.quests?.message && (
                  <p className="text-destructive text-sm">{errors.quests.message}</p>
                )}
              </Section>
            )}

            <div className="flex gap-2">
              <Button type="submit" disabled={isLoading}>
                {editingId ? "Update placement" : "Create placement"}
              </Button>
              {editingId && (
                <Button type="button" variant="secondary" onClick={resetEditor}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </Form>
      </ContentBox>

      {placements.length > 0 && (
        <ContentBox
          title="Existing Placements"
          subtitle={`${placements.length} placement(s)`}
          initialBreak={true}
        >
          <div className="space-y-3">
            {placements.map((p) => (
              <PlacementCard
                key={p.id}
                placement={p}
                isEditing={p.id === editingId}
                isLoading={isLoading}
                onEdit={() => onEdit(p)}
                onRemove={() => remove({ id: p.id })}
              />
            ))}
          </div>
        </ContentBox>
      )}
    </>
  );
};

/** A titled group of related fields. */
const Section = ({
  icon,
  title,
  description,
  aside,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <fieldset className="space-y-3 rounded-lg border p-3 sm:p-4">
    <div className="flex items-start justify-between gap-3">
      <div>
        <legend className="flex items-center gap-2 font-semibold">
          {icon}
          {title}
        </legend>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      {aside}
    </div>
    {children}
  </fieldset>
);

/** Mutually exclusive options shown as selectable cards, each with a one-line explanation. */
const ChoiceCards = <T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly ChoiceOption<T>[];
}) => (
  <fieldset className="space-y-1">
    <legend className="text-sm font-medium">{label}</legend>
    <div className="grid gap-2 sm:grid-cols-3">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <label
            key={option.value}
            className={cn(
              "has-[:focus-visible]:ring-ring flex cursor-pointer items-start gap-2 rounded-md border p-2 transition-colors has-[:focus-visible]:ring-2",
              selected
                ? "border-primary bg-primary/10 ring-primary ring-1"
                : "border-border hover:bg-muted",
            )}
          >
            <input
              type="radio"
              name={label}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.icon && <span className="mt-0.5 shrink-0">{option.icon}</span>}
            <span>
              <span className="block text-sm font-medium">{option.label}</span>
              {option.description && (
                <span className="text-muted-foreground block text-xs">
                  {option.description}
                </span>
              )}
            </span>
          </label>
        );
      })}
    </div>
  </fieldset>
);

/** A labelled switch with an explanation, for boolean placement settings. */
const SwitchRow = ({
  control,
  name,
  label,
  description,
}: {
  control: Control<OverworldPlacementInput>;
  name: "wildOnly";
  label: string;
  description: string;
}) => (
  <FormField
    control={control}
    name={name}
    render={({ field }) => (
      <FormItem className="bg-muted/50 flex items-center justify-between gap-3 space-y-0 rounded-md p-2">
        <div>
          <FormLabel>{label}</FormLabel>
          <FormDescription>{description}</FormDescription>
        </div>
        <FormControl>
          <Switch
            checked={field.value as boolean}
            onCheckedChange={field.onChange}
            aria-label={label}
          />
        </FormControl>
      </FormItem>
    )}
  />
);

/** A range slider with its current value spelled out beside the label. */
const RangeField = ({
  control,
  name,
  label,
  min,
  max,
  step = 1,
  display,
  description,
}: {
  control: Control<OverworldPlacementInput>;
  name: "wanderRadius" | "mapScale";
  label: string;
  min: number;
  max: number;
  step?: number;
  display: string;
  description: string;
}) => (
  <FormField
    control={control}
    name={name}
    render={({ field }) => (
      <FormItem>
        <div className="flex items-center justify-between text-sm">
          <FormLabel>{label}</FormLabel>
          <output className="font-medium tabular-nums">{display}</output>
        </div>
        <FormControl>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={Number(field.value)}
            onChange={(event) => field.onChange(Number(event.target.value))}
            aria-label={label}
            aria-valuetext={display}
            className="h-5 w-full cursor-pointer accent-orange-800"
          />
        </FormControl>
        <FormDescription>{description}</FormDescription>
        <FormMessage />
      </FormItem>
    )}
  />
);

/** A plain-language estimate of how often players will meet the AI. */
const PopulationSummary = ({
  values,
  habitats,
  habitatSectors,
}: {
  values: OverworldPlacementInput;
  habitats: OverworldHabitat[];
  habitatSectors: Record<OverworldHabitat, number> | undefined;
}) => {
  const copies = Number(values.spawnCount ?? 1);
  const low = Number(values.groupMin ?? 1),
    high = Number(values.groupMax ?? 1);
  const group = low === high ? `${low}` : `${low}–${high}`;
  const members = low === high && low === 1 ? "on its own" : `in groups of ${group}`;
  const pool =
    values.sectorType === "random" && habitatSectors
      ? habitats.length
        ? habitats.reduce((sum, h) => sum + habitatSectors[h], 0)
        : OverworldHabitats.reduce((sum, h) => sum + habitatSectors[h], 0)
      : values.sectorType === "from_list"
        ? ((values.sectorList as number[] | undefined)?.length ?? 0)
        : 1;
  const density =
    pool > 1 && copies > 0
      ? copies >= pool
        ? `about ${(copies / pool).toFixed(1)} per sector`
        : `one in every ${(pool / copies).toFixed(1)} sectors`
      : null;
  return (
    <p className="bg-muted/50 rounded-md p-2 text-sm">
      {copies === 1 ? "One copy" : `${copies} copies`} {members}
      {density ? `, ${density}` : ""}.
    </p>
  );
};

/** One saved placement, summarised with badges for scanning a long list. */
const PlacementCard = ({
  placement: p,
  isEditing,
  isLoading,
  onEdit,
  onRemove,
}: {
  placement: Placement;
  isEditing: boolean;
  isLoading: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) => {
  const option = INTERACTION_OPTIONS.find((o) => o.value === p.interactionType);
  const where =
    p.sectorType === "specific"
      ? `Sector ${p.sector}`
      : p.sectorType === "from_list"
        ? `Sectors ${((p.sectorList as number[] | null) ?? []).join(", ")}`
        : p.habitats.length
          ? `Random ${p.habitats.map((h) => HABITAT_LABELS[h].toLowerCase()).join(" / ")} sector`
          : "Random sector";
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 rounded-lg border p-3",
        isEditing && "border-primary ring-primary ring-1",
      )}
    >
      <div className="min-w-0 space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge className={cn("gap-1 border-transparent text-white", option?.badge)}>
            <span className="[&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-white">
              {option?.icon}
            </span>
            {option?.label}
          </Badge>
          <Badge variant={p.isActive ? "secondary" : "outline"}>
            {p.isActive ? "Active" : "Hidden"}
          </Badge>
          <Badge variant="outline">
            {p.wanderRadius ? `Roams ${p.wanderRadius} hexes` : "Stationary"}
          </Badge>
          {p.spawnCount > 1 && <Badge variant="outline">{p.spawnCount} copies</Badge>}
          {p.groupMax > 1 && (
            <Badge variant="outline">
              {p.groupMin === p.groupMax
                ? `Herds of ${p.groupMax}`
                : `Herds of ${p.groupMin}–${p.groupMax}`}
            </Badge>
          )}
          {p.wildOnly && <Badge variant="outline">Wild only</Badge>}
          {p.mapScale !== 100 && <Badge variant="outline">{p.mapScale}% size</Badge>}
        </div>
        <p className="text-muted-foreground">
          {where} ·{" "}
          {p.locationType === "specific"
            ? `tile (${p.longitude}, ${p.latitude})`
            : "random tile"}
          {p.interactionType === "FRIENDLY" &&
            ` · ${p.questPool.length} quest(s), ${p.questPool.reduce((s, q) => s + q.chance, 0)}% assigned`}
        </p>
        <p className="text-muted-foreground flex items-center gap-1 font-mono text-xs">
          id: {p.id}
          <button
            type="button"
            title="Copy id"
            aria-label="Copy placement id"
            className="hover:text-orange-500"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(p.id);
                showMutationToast({ success: true, message: "Placement id copied" });
              } catch {
                showMutationToast({
                  success: false,
                  message: "Could not copy placement id",
                });
              }
            }}
          >
            <Copy className="h-3 w-3" />
          </button>
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={onEdit}
          disabled={isLoading}
          aria-label="Edit placement"
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Confirm
          title="Delete Placement"
          button={
            <Button
              variant="ghost"
              size="icon"
              disabled={isLoading}
              aria-label="Delete placement"
            >
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
          }
          onAccept={onRemove}
        >
          Deleting this placement will permanently remove it and fail any player quest
          objectives that are bound to this placement. Are you sure?
        </Confirm>
      </div>
    </div>
  );
};

/** Integer coordinate input for a placement's sector, longitude, or latitude. */
const IntegerField = ({
  control,
  name,
  label,
  className,
}: {
  control: Control<OverworldPlacementInput>;
  name: "sector" | "longitude" | "latitude";
  label: string;
  className?: string;
}) => (
  <FormField
    control={control}
    name={name}
    render={({ field }) => (
      <FormItem className={className}>
        <FormLabel>{label}</FormLabel>
        <FormControl>
          <NumberInput
            {...field}
            value={field.value as number}
            onValueChange={field.onChange}
          />
        </FormControl>
        <FormMessage />
      </FormItem>
    )}
  />
);

/** Integer input clamped to the setting's allowed range. */
const BoundedIntegerField = ({
  control,
  name,
  label,
  min,
  max,
}: {
  control: Control<OverworldPlacementInput>;
  name: "spawnCount" | "groupMin" | "groupMax";
  label: string;
  min: number;
  max: number;
}) => (
  <FormField
    control={control}
    name={name}
    render={({ field }) => (
      <FormItem>
        <FormLabel>{label}</FormLabel>
        <FormControl>
          <NumberInput
            {...field}
            min={min}
            max={max}
            value={field.value as number}
            onValueChange={field.onChange}
          />
        </FormControl>
        <FormMessage />
      </FormItem>
    )}
  />
);

/** Creates a clean placement form state for the given AI template. */
const defaultFormValues = (aiId: string): OverworldPlacementInput => ({
  aiTemplateUserId: aiId,
  interactionType: "HOSTILE",
  sectorType: "specific",
  locationType: "specific",
  sector: 0,
  longitude: 0,
  latitude: 0,
  sectorList: [],
  quests: [],
  isActive: true,
  wanderRadius: OVERWORLD_DEFAULT_WANDER_RADIUS,
  spawnCount: 1,
  groupMin: 1,
  groupMax: 1,
  habitats: [],
  wildOnly: false,
  mapScale: 100,
});

const HABITAT_LABELS: Record<OverworldHabitat, string> = {
  grassland: "Grassland",
  desert: "Desert",
  snow: "Snow & ice",
};

const INTERACTION_OPTIONS: readonly (ChoiceOption<OverworldInteractionType> & {
  badge: string;
})[] = [
  {
    value: "FRIENDLY",
    label: "Friendly",
    description: "Talks, hands out missions and quest steps.",
    icon: <Handshake className="h-4 w-4 text-green-700" />,
    badge: "bg-green-700",
  },
  {
    value: "HOSTILE",
    label: "Hostile",
    description: "Players can attack it for a fight.",
    icon: <Swords className="h-4 w-4 text-red-700" />,
    badge: "bg-red-700",
  },
  {
    value: "AMBIENT",
    label: "Ambient",
    description: "Scenery such as wildlife; roams with no interaction.",
    icon: <Leaf className="h-4 w-4 text-sky-700" />,
    badge: "bg-sky-700",
  },
];

const SECTOR_OPTIONS: readonly ChoiceOption<
  OverworldPlacementInput["sectorType"] & string
>[] = [
  { value: "specific", label: "Fixed sector" },
  { value: "random", label: "Random sector" },
  { value: "from_list", label: "From a list" },
];

const LOCATION_OPTIONS: readonly ChoiceOption<
  OverworldPlacementInput["locationType"] & string
>[] = [
  { value: "specific", label: "Fixed tile" },
  { value: "random", label: "Random tile" },
];

type ChoiceOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
  icon?: React.ReactNode;
};

type Placement = OverworldAiPlacement & { questPool: OverworldAiPlacementQuest[] };

interface PlacementsManagerProps {
  aiId: string;
  placements: Placement[];
}
