"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Clock, Gift, Pencil, Plus, Shield, Trash2 } from "lucide-react";
import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import Confirm from "@/layout/Confirm";
import { EffectFormWrapper } from "@/layout/EditContent";
import Modal from "@/layout/Modal";
import {
  REWARD_DIALOG_AMOUNT_FIELDS,
  RewardDialog,
  useRewardDialogFormData,
} from "@/layout/RewardDialog";
import { getRewardArray } from "@/libs/objectives";
import { showMutationToast } from "@/libs/toast";
import type { ZodAllTags } from "@/validators/combat";
import { getTagSchema, tagTypes } from "@/validators/combat";
import {
  type ThresholdFormData,
  type ThresholdFormDataInput,
  thresholdFormSchema,
} from "@/validators/raids";
import type { ObjectiveRewardType } from "@/validators/rewards";

interface RaidThresholdEditorProps {
  questId: string;
}

export const RaidThresholdEditor: React.FC<RaidThresholdEditorProps> = ({
  questId,
}) => {
  const util = api.useUtils();

  // State for modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [effects, setEffects] = useState<ZodAllTags[]>([]);
  const [rewardDialogOpen, setRewardDialogOpen] = useState(false);

  const rewardFormData = useRewardDialogFormData(RAID_REWARD_AMOUNT_FIELDS);

  // Query for thresholds
  const { data: thresholdsData } = api.raids.getQuestThresholds.useQuery(
    { questId },
    { enabled: !!questId },
  );

  const thresholds = thresholdsData?.thresholds ?? [];

  // Mutations
  const { mutate: createThreshold, isPending: createPending } =
    api.raids.createDamageThreshold.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
        if (data.success) {
          closeModal();
          void util.raids.getQuestThresholds.invalidate({ questId });
        }
      },
    });

  const { mutate: updateThreshold, isPending: updatePending } =
    api.raids.updateDamageThreshold.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
        if (data.success) {
          closeModal();
          void util.raids.getQuestThresholds.invalidate({ questId });
        }
      },
    });

  const { mutate: deleteThreshold, isPending: deletePending } =
    api.raids.deleteDamageThreshold.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
        void util.raids.getQuestThresholds.invalidate({ questId });
      },
    });

  // Form
  const form = useForm<ThresholdFormDataInput, unknown, ThresholdFormData>({
    resolver: zodResolver(thresholdFormSchema),
    defaultValues: {
      damageRequired: 1000,
      sortOrder: 0,
      effectDurationMinutes: 60,
      rewards: {},
    },
  });

  // Handlers
  const openCreateModal = () => {
    form.reset({
      damageRequired: 1000,
      sortOrder: thresholds.length,
      effectDurationMinutes: 60,
      rewards: {},
    });
    setEffects([]);
    setEditingId(null);
    setIsModalOpen(true);
  };

  const openEditModal = (threshold: (typeof thresholds)[number]) => {
    form.reset({
      damageRequired: threshold.damageRequired,
      sortOrder: threshold.sortOrder,
      effectDurationMinutes: threshold.effectDurationMinutes,
      rewards: threshold.rewards,
    });
    setEffects(threshold.effects ?? []);
    setEditingId(threshold.id);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setEffects([]);
    form.reset();
  };

  const handleSubmit = (data: ThresholdFormData) => {
    if (editingId) {
      updateThreshold({
        thresholdId: editingId,
        damageRequired: data.damageRequired,
        sortOrder: data.sortOrder,
        rewards: data.rewards,
        effects,
        effectDurationMinutes: data.effectDurationMinutes,
      });
    } else {
      createThreshold({
        questId,
        damageRequired: data.damageRequired,
        sortOrder: data.sortOrder,
        rewards: data.rewards,
        effects,
        effectDurationMinutes: data.effectDurationMinutes,
      });
    }
  };

  const addEffect = () => {
    const tagSchema = getTagSchema("damage");
    const parsed = tagSchema.safeParse({ type: "damage" });
    if (parsed.success) {
      setEffects([...effects, parsed.data]);
    }
  };

  const removeEffect = (idx: number) => {
    const newEffects = [...effects];
    newEffects.splice(idx, 1);
    setEffects(newEffects);
  };

  const isPending = createPending || updatePending;

  // Format rewards for display
  const formatRewards = (rewards: ObjectiveRewardType) => {
    const rewardList = getRewardArray(rewards);
    return rewardList.length > 0 ? rewardList.join(", ") : "No rewards";
  };

  // Watch rewards for reactive display
  const watchedRewards = useWatch({ control: form.control, name: "rewards" });

  return (
    <div className="space-y-4">
      {/* Threshold List */}
      {thresholds.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground">
          <Gift className="mx-auto mb-2 h-12 w-12 opacity-50" />
          <p>No damage thresholds configured yet.</p>
          <p className="text-sm">
            Add thresholds to reward players based on damage dealt.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {thresholds.map((threshold, idx) => (
            <div
              key={threshold.id}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    Tier {idx + 1}: {threshold.damageRequired.toLocaleString()} damage
                  </span>
                  {threshold.effects && threshold.effects.length > 0 && (
                    <>
                      <span className="flex items-center gap-1 rounded bg-blue-100 px-2 py-0.5 text-blue-800 text-xs dark:bg-blue-900 dark:text-blue-200">
                        <Shield className="h-3 w-3" />
                        {threshold.effects.length} effect(s)
                      </span>
                      <span className="flex items-center gap-1 rounded bg-purple-100 px-2 py-0.5 text-purple-800 text-xs dark:bg-purple-900 dark:text-purple-200">
                        <Clock className="h-3 w-3" />
                        {threshold.effectDurationMinutes}min
                      </span>
                    </>
                  )}
                </div>
                <p className="text-muted-foreground text-sm">
                  {formatRewards(threshold.rewards)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openEditModal(threshold)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Confirm
                  title="Delete Threshold"
                  proceed_label="Delete"
                  confirmClassName="bg-red-600 text-white hover:bg-red-700"
                  disabled={deletePending}
                  triggerLabel={`Delete tier ${idx + 1}`}
                  button={
                    <Button variant="outline" size="sm" disabled={deletePending}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  }
                  onAccept={() => deleteThreshold({ thresholdId: threshold.id })}
                >
                  Are you sure you want to delete this threshold?
                </Confirm>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Button */}
      <Button onClick={openCreateModal} className="w-full">
        <Plus className="mr-2 h-4 w-4" />
        Add Damage Threshold
      </Button>

      {/* Edit/Create Modal */}
      <Modal
        title={editingId ? "Edit Damage Threshold" : "Add Damage Threshold"}
        isOpen={isModalOpen}
        setIsOpen={setIsModalOpen}
        onAccept={form.handleSubmit(handleSubmit)}
        proceed_label="Save"
        proceed_loading_label="Saving..."
        isLoading={isPending}
        keepOpenOnAccept
        confirmClassName="bg-blue-600 hover:bg-blue-700"
      >
        <Form {...form}>
          <form className="space-y-6">
            {/* Basic Settings */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="damageRequired"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Damage Required</FormLabel>
                    <FormControl>
                      <NumberInput
                        step="any"
                        min={1}
                        {...field}
                        value={field.value as number}
                        onValueChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="sortOrder"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sort Order</FormLabel>
                    <FormControl>
                      <NumberInput
                        step="any"
                        min={0}
                        max={255}
                        {...field}
                        value={field.value as number}
                        onValueChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Rewards Section */}
            <div className="space-y-4">
              <Label className="font-semibold text-base">Rewards</Label>

              <div className="flex items-center justify-between rounded-md border p-3">
                <span className="text-muted-foreground text-sm">
                  {formatRewards(watchedRewards as ObjectiveRewardType)}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRewardDialogOpen(true)}
                >
                  Edit Rewards
                </Button>
              </div>

              {/* Reward dialog */}
              {rewardDialogOpen && (
                <RewardDialog
                  open={rewardDialogOpen}
                  onOpenChange={setRewardDialogOpen}
                  value={watchedRewards}
                  onSave={(data) => {
                    void form.setValue("rewards", data, { shouldDirty: true });
                  }}
                  formData={rewardFormData}
                />
              )}
            </div>

            {/* Combat Effects Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="font-semibold text-base">
                  Combat Effects (Raid Buff)
                </Label>
                <Button type="button" variant="outline" size="sm" onClick={addEffect}>
                  <Plus className="mr-1 h-4 w-4" />
                  Add Effect
                </Button>
              </div>

              {effects.length > 0 && (
                <FormField
                  control={form.control}
                  name="effectDurationMinutes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Effect Duration (minutes)</FormLabel>
                      <FormControl>
                        <NumberInput
                          step="any"
                          min={1}
                          max={10080}
                          placeholder="60"
                          {...field}
                          value={field.value as number}
                          onValueChange={field.onChange}
                        />
                      </FormControl>
                      <p className="text-muted-foreground text-xs">
                        How long the combat buff lasts (1 min - 7 days)
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {effects.length === 0 ? (
                <p className="py-4 text-center text-muted-foreground text-sm">
                  No combat effects. Add effects to grant temporary combat buffs when
                  claiming this reward.
                </p>
              ) : (
                <div className="space-y-4">
                  {effects.map((effect, idx) => (
                    <div
                      key={`effect-${effect.type}-${idx}`}
                      className="relative rounded-lg border p-4"
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute top-2 right-2"
                        onClick={() => removeEffect(idx)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                      <EffectFormWrapper
                        idx={idx}
                        type="jutsu"
                        availableTags={tagTypes}
                        tag={effect}
                        effects={effects}
                        setEffects={setEffects}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </form>
        </Form>
      </Modal>
    </div>
  );
};

/** Raids also pay skill points, profession XP and war effort. */
const RAID_REWARD_AMOUNT_FIELDS = [
  ...REWARD_DIALOG_AMOUNT_FIELDS,
  "reward_skillpoints",
  "reward_medical_experience",
  "reward_hunting_experience",
  "reward_crafting_experience",
  "reward_gathering_experience",
  "reward_war_damage",
  "reward_war_healing",
] as const;

export default RaidThresholdEditor;
