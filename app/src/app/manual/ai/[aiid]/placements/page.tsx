"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
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

export default function ManualAiPlacements(props: {
  params: Promise<{ aiid: string }>;
}) {
  const params = use(props.params);
  const aiId = params.aiid;
  const router = useRouter();
  const { data: userData } = useRequiredUserData();

  // Queries
  const { data: placements, isPending } = api.overworldAi.getPlacementsForAi.useQuery(
    { aiTemplateUserId: aiId },
    { enabled: !!aiId },
  );

  // Redirect to profile if not content or admin
  useEffect(() => {
    if (userData && !canChangeContent(userData.role)) {
      router.push("/profile");
    }
  }, [userData]);

  // Prevent unauthorized access
  if (isPending || !userData || !canChangeContent(userData.role)) {
    return <Loader explanation="Loading data" />;
  }

  return <PlacementsManager aiId={aiId} placements={placements ?? []} />;
}

type Placement = OverworldAiPlacement & { questPool: OverworldAiPlacementQuest[] };

interface PlacementsManagerProps {
  aiId: string;
  placements: Placement[];
}

const defaultFormValues = (aiId: string): OverworldPlacementInput => ({
  aiTemplateUserId: aiId,
  interactionType: OverworldInteractionTypes[1],
  sectorType: "specific",
  locationType: "specific",
  sector: 0,
  longitude: 0,
  latitude: 0,
  sectorList: [],
  questGiveChance: 0,
  questIds: [],
  isActive: true,
});

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

  // Watched fields for conditional rendering — all hooks before any early returns
  const interactionType = useWatch({
    control: form.control,
    name: "interactionType",
    defaultValue: OverworldInteractionTypes[1],
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
  const watchedQuestIds = useWatch({
    control: form.control,
    name: "questIds",
    defaultValue: [],
  }) as string[];
  const watchedSectorList = useWatch({
    control: form.control,
    name: "sectorList",
    defaultValue: [],
  }) as number[];

  // Upsert mutation
  const { mutate: upsert, isPending: isUpserting } =
    api.overworldAi.upsertPlacement.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.overworldAi.getPlacementsForAi.invalidate({
            aiTemplateUserId: aiId,
          });
          setEditingId(undefined);
          form.reset(defaultFormValues(aiId));
          setQuestSearch("");
          setSectorInput("");
        }
      },
    });

  // Delete mutation
  const { mutate: remove, isPending: isRemoving } =
    api.overworldAi.deletePlacement.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.overworldAi.getPlacementsForAi.invalidate({
            aiTemplateUserId: aiId,
          });
          setEditingId(undefined);
          form.reset(defaultFormValues(aiId));
          setQuestSearch("");
          setSectorInput("");
        }
      },
    });

  const onSubmit = (values: OverworldPlacementInput) => {
    upsert({ id: editingId, data: values });
  };

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
      questGiveChance: placement.questGiveChance,
      questIds: placement.questPool.map((q) => q.questId),
      isActive: placement.isActive,
    });
    setQuestSearch("");
    setSectorInput("");
  };

  const onCancelEdit = () => {
    setEditingId(undefined);
    form.reset(defaultFormValues(aiId));
    setQuestSearch("");
    setSectorInput("");
  };

  const addQuestId = (questId: string) => {
    if (!questId || watchedQuestIds.includes(questId)) return;
    form.setValue("questIds", [...watchedQuestIds, questId]);
    setQuestSearch("");
  };

  const removeQuestId = (questId: string) => {
    form.setValue(
      "questIds",
      watchedQuestIds.filter((id) => id !== questId),
    );
  };

  const addSector = () => {
    const num = parseInt(sectorInput, 10);
    if (Number.isNaN(num) || watchedSectorList.includes(num)) return;
    form.setValue("sectorList", [...watchedSectorList, num]);
    setSectorInput("");
  };

  const removeSector = (sector: number) => {
    form.setValue(
      "sectorList",
      watchedSectorList.filter((s) => s !== sector),
    );
  };

  const filteredQuests = (questNames ?? []).filter(
    (q) =>
      q.name.toLowerCase().includes(questSearch.toLowerCase()) &&
      !watchedQuestIds.includes(q.id),
  );

  const isLoading = isUpserting || isRemoving;

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
              <FormField
                control={form.control}
                name="sector"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sector</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        value={field.value as number}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
                <FormField
                  control={form.control}
                  name="longitude"
                  render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormLabel>Longitude</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          value={field.value as number}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="latitude"
                  render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormLabel>Latitude</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          value={field.value as number}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {/* Quest Give Chance + Quest Pool — only when interactionType === "FRIENDLY" */}
            {interactionType === "FRIENDLY" && (
              <>
                <FormField
                  control={form.control}
                  name="questGiveChance"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Quest Give Chance (0–100 %)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={field.value as number}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Quest Pool */}
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
                  {watchedQuestIds.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {watchedQuestIds.map((id) => {
                        const quest = questNames?.find((q) => q.id === id);
                        return (
                          <span
                            key={id}
                            className="flex items-center gap-1 rounded bg-slate-200 px-2 py-0.5 text-sm dark:bg-slate-700"
                          >
                            {quest?.name ?? id}
                            <button
                              type="button"
                              className="text-red-500 hover:text-red-700"
                              onClick={() => removeQuestId(id)}
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {form.formState.errors.questIds?.message && (
                    <p className="text-destructive text-sm">
                      {form.formState.errors.questIds.message}
                    </p>
                  )}
                </FormItem>
              </>
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
                      <span className="font-semibold">Quest chance:</span>{" "}
                      {p.questGiveChance}% · {p.questPool.length} quest(s) in pool
                    </p>
                  )}
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
