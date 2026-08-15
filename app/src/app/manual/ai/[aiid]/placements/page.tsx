"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";
import { type Control, useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { OverworldInteractionTypes } from "@/drizzle/constants";
import type { OverworldAiPlacement, OverworldAiPlacementQuest } from "@/drizzle/schema";
import Confirm2 from "@/layout/Confirm2";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";
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
  const router = useRouter();
  const { data: userData } = useRequiredUserData();
  const canManagePlacements = !!userData && canChangeContent(userData.role);

  // Queries
  const { data: placements, isPending } = api.overworldAi.getPlacementsForAi.useQuery(
    { aiTemplateUserId: aiId },
    { enabled: !!aiId && canManagePlacements },
  );

  // Redirect to profile if not content or admin
  useEffect(() => {
    if (userData && !canChangeContent(userData.role)) {
      router.push("/profile");
    }
  }, [router, userData]);

  // Prevent unauthorized access
  if (!userData || !canManagePlacements || isPending) {
    return <Loader explanation="Loading data" />;
  }

  return <PlacementsManager aiId={aiId} placements={placements ?? []} />;
}

type Placement = OverworldAiPlacement & { questPool: OverworldAiPlacementQuest[] };

interface PlacementsManagerProps {
  aiId: string;
  placements: Placement[];
}

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
});

/** Manages creation, editing, and deletion of an AI template's overworld placements. */
const PlacementsManager: React.FC<PlacementsManagerProps> = ({ aiId, placements }) => {
  const utils = api.useUtils();
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [questSearch, setQuestSearch] = useState("");
  const [sectorInput, setSectorInput] = useState("");

  // Quest names for the pool selector
  const { data: questNames } = api.quests.getAllNames.useQuery(undefined, {
    staleTime: 60_000,
  });

  // Form
  const form = useForm<OverworldPlacementInput>({
    resolver: zodResolver(OverworldPlacementSchema),
    defaultValues: defaultFormValues(aiId),
  });

  /** Leaves edit mode and restores an empty placement form for the current AI template. */
  const resetEditor = useCallback(() => {
    setEditingId(undefined);
    form.reset(defaultFormValues(aiId));
    setQuestSearch("");
    setSectorInput("");
  }, [aiId, form]);

  // Watched fields for conditional rendering — all hooks before any early returns
  const interactionType = useWatch({
    control: form.control,
    name: "interactionType",
    defaultValue: "HOSTILE",
  });
  const sectorType = useWatch({
    control: form.control,
    name: "sectorType",
    defaultValue: "specific",
  });
  const locationType = useWatch({
    control: form.control,
    name: "locationType",
    defaultValue: "specific",
  });
  const watchedQuests = useWatch({
    control: form.control,
    name: "quests",
    defaultValue: [],
  }) as { questId: string; chance: number }[];
  const watchedSectorList = useWatch({
    control: form.control,
    name: "sectorList",
    defaultValue: [],
  }) as number[];

  // Upsert mutation
  const { mutate: upsert, isPending: isUpserting } =
    api.overworldAi.upsertPlacement.useMutation({
      /** Refreshes the placement list and clears the editor after a successful upsert. */
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.overworldAi.getPlacementsForAi.invalidate({
            aiTemplateUserId: aiId,
          });
          resetEditor();
        }
      },
    });

  // Delete mutation
  const { mutate: remove, isPending: isRemoving } =
    api.overworldAi.deletePlacement.useMutation({
      /** Refreshes the placement list and clears the editor after a successful deletion. */
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.overworldAi.getPlacementsForAi.invalidate({
            aiTemplateUserId: aiId,
          });
          resetEditor();
        }
      },
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
      quests: placement.questPool.map((q) => ({
        questId: q.questId,
        chance: q.chance,
      })),
      isActive: placement.isActive,
    });
    setQuestSearch("");
    setSectorInput("");
  };

  /** Cancels the current edit and restores the blank placement form. */
  const onCancelEdit = () => {
    resetEditor();
  };

  /** Adds a quest to the placement pool unless it is empty or already selected. */
  const addQuestId = (questId: string) => {
    if (!questId || watchedQuests.some((q) => q.questId === questId)) return;
    form.setValue("quests", [...watchedQuests, { questId, chance: 0 }]);
    setQuestSearch("");
  };

  /** Removes a quest and its configured chance from the placement pool. */
  const removeQuestId = (questId: string) => {
    form.setValue(
      "quests",
      watchedQuests.filter((q) => q.questId !== questId),
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
    const num = parseInt(sectorInput, 10);
    if (Number.isNaN(num) || watchedSectorList.includes(num)) return;
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

  const filteredQuests = (questNames ?? []).filter(
    (q) =>
      q.name.toLowerCase().includes(questSearch.toLowerCase()) &&
      !watchedQuests.some((w) => w.questId === q.id),
  );

  const isLoading = isUpserting || isRemoving;
  const questChanceSum = watchedQuests.reduce((s, q) => s + (q.chance || 0), 0);

  return (
    <>
      <ContentBox
        title="Overworld Placements"
        subtitle={editingId ? "Editing placement" : "Create new placement"}
        defaultBackHref={`/manual/ai/edit/${aiId}`}
      >
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Interaction Type */}
            <FormField
              control={form.control}
              name="interactionType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Interaction Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select interaction type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {OverworldInteractionTypes.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Sector Type */}
            <FormField
              control={form.control}
              name="sectorType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sector Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select sector type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="specific">Specific</SelectItem>
                      <SelectItem value="random">Random</SelectItem>
                      <SelectItem value="from_list">From List</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Fixed sector — only when sectorType === "specific" */}
            {sectorType === "specific" && (
              <IntegerField control={form.control} name="sector" label="Sector" />
            )}

            {/* Sector list — only when sectorType === "from_list" */}
            {sectorType === "from_list" && (
              <FormItem>
                <FormLabel>Sector List</FormLabel>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="Add sector number"
                    value={sectorInput}
                    onChange={(e) => setSectorInput(e.target.value)}
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
                    {watchedSectorList.map((s, idx) => (
                      <span
                        key={`sector-${idx}-${s}`}
                        className="flex items-center gap-1 rounded bg-slate-200 px-2 py-0.5 text-sm dark:bg-slate-700"
                      >
                        {String(s)}
                        <button
                          type="button"
                          className="text-red-500 hover:text-red-700"
                          onClick={() => removeSector(s)}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {form.formState.errors.sectorList?.message && (
                  <p className="text-destructive text-sm">
                    {form.formState.errors.sectorList.message}
                  </p>
                )}
              </FormItem>
            )}

            {/* Location Type */}
            <FormField
              control={form.control}
              name="locationType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Location Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select location type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="specific">Specific</SelectItem>
                      <SelectItem value="random">Random</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Fixed longitude/latitude — only when locationType === "specific" */}
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

            {/* Quest Pool with per-quest grant chances — only when interactionType === "FRIENDLY" */}
            {interactionType === "FRIENDLY" && (
              <FormItem>
                <FormLabel>Quest Pool</FormLabel>
                <div className="flex gap-2">
                  <Input
                    placeholder="Search quests…"
                    value={questSearch}
                    onChange={(e) => setQuestSearch(e.target.value)}
                  />
                </div>
                {questSearch && filteredQuests.length > 0 && (
                  <div className="mt-1 max-h-40 overflow-y-auto rounded border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                    {filteredQuests.slice(0, 20).map((q) => (
                      <button
                        key={q.id}
                        type="button"
                        className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                        onClick={() => addQuestId(q.id)}
                      >
                        {q.name}
                      </button>
                    ))}
                  </div>
                )}
                {watchedQuests.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {watchedQuests.map((q) => {
                      const quest = questNames?.find((n) => n.id === q.questId);
                      return (
                        <div
                          key={q.questId}
                          className="flex items-center gap-2 rounded bg-slate-200 px-2 py-1 text-sm dark:bg-slate-700"
                        >
                          <span className="flex-1 truncate">
                            {quest?.name ?? q.questId}
                          </span>
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            className="h-8 w-20"
                            value={q.chance}
                            onChange={(e) =>
                              setQuestChance(q.questId, Number(e.target.value))
                            }
                          />
                          <span className="text-muted-foreground">%</span>
                          <button
                            type="button"
                            className="text-red-500 hover:text-red-700"
                            onClick={() => removeQuestId(q.questId)}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                    <p className="text-muted-foreground text-xs">
                      Σ assigned: {questChanceSum}% · nothing: {100 - questChanceSum}%
                    </p>
                    {questChanceSum === 0 && (
                      <p className="text-amber-600 text-xs dark:text-amber-500">
                        All chances are 0 — this NPC will never grant a quest.
                      </p>
                    )}
                  </div>
                )}
                {form.formState.errors.quests?.message && (
                  <p className="text-destructive text-sm">
                    {form.formState.errors.quests.message}
                  </p>
                )}
              </FormItem>
            )}

            {/* Is Active */}
            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex items-center gap-3">
                  <FormLabel className="mt-2">Active</FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value as boolean}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex gap-2">
              <Button type="submit" disabled={isLoading}>
                {editingId ? "Update Placement" : "Create Placement"}
              </Button>
              {editingId && (
                <Button type="button" variant="secondary" onClick={onCancelEdit}>
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
              <div
                key={p.id}
                className="flex items-start justify-between rounded border border-slate-200 p-3 dark:border-slate-700"
              >
                <div className="space-y-0.5 text-sm">
                  <p>
                    <span className="font-semibold">Type:</span> {p.interactionType}
                    {" · "}
                    <span className={p.isActive ? "text-green-600" : "text-slate-400"}>
                      {p.isActive ? "Active" : "Inactive"}
                    </span>
                  </p>
                  <p>
                    <span className="font-semibold">Sector:</span> {p.sectorType}
                    {p.sectorType === "specific" && ` #${p.sector}`}
                    {p.sectorType === "from_list" &&
                      ` [${((p.sectorList as number[] | null) ?? []).join(", ")}]`}
                    {" · "}
                    <span className="font-semibold">Location:</span> {p.locationType}
                    {p.locationType === "specific" &&
                      ` (${p.longitude}, ${p.latitude})`}
                  </p>
                  {p.interactionType === "FRIENDLY" && (
                    <p>
                      <span className="font-semibold">Quest pool:</span>{" "}
                      {p.questPool.length} quest(s) ·{" "}
                      {p.questPool.reduce((s, q) => s + q.chance, 0)}% assigned
                    </p>
                  )}
                  <p className="flex items-center gap-1 font-mono text-muted-foreground text-xs">
                    id: {p.id}
                    <button
                      type="button"
                      title="Copy id"
                      className="hover:text-orange-500"
                      onClick={() => {
                        void navigator.clipboard.writeText(p.id);
                        showMutationToast({
                          success: true,
                          message: "Placement id copied",
                        });
                      }}
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onEdit(p)}
                    disabled={isLoading}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Confirm2
                    title="Delete Placement"
                    button={
                      <Button variant="ghost" size="icon" disabled={isLoading}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    }
                    onAccept={() => remove({ id: p.id })}
                  >
                    Deleting this placement will permanently remove it and fail any
                    player quest objectives that are bound to this placement. Are you
                    sure?
                  </Confirm2>
                </div>
              </div>
            ))}
          </div>
        </ContentBox>
      )}
    </>
  );
};

/** Integer coordinate input (sector/longitude/latitude). Stores a parsed number, stripping
 *  the leading zero so a 0-valued field can be typed over; empty clears to "". */
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
          <Input
            type="number"
            value={field.value as number}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              field.onChange(Number.isNaN(n) ? "" : n);
            }}
            onBlur={field.onBlur}
            name={field.name}
            ref={field.ref}
          />
        </FormControl>
        <FormMessage />
      </FormItem>
    )}
  />
);
