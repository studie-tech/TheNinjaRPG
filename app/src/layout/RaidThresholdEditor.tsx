"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Trash2, Pencil, Gift, Shield, Clock } from "lucide-react";
import Modal2 from "@/layout/Modal2";
import { ObjectiveReward } from "@/validators/rewards";
import { EffectFormWrapper, EditContent, type FormEntry } from "@/layout/EditContent";
import { getTagSchema, tagTypes } from "@/validators/combat";
import { getRewardArray } from "@/libs/objectives";
import { useUserData } from "@/utils/UserContext";
import { canAwardReputation } from "@/utils/permissions";
import { UserRanks, STARTER_VILLAGES } from "@/drizzle/constants";
import type { ZodAllTags } from "@/validators/combat";
import type { ObjectiveRewardType } from "@/validators/rewards";
import type { UseFormReturn } from "react-hook-form";

interface RaidThresholdEditorProps {
  questId: string;
}

// Schema for threshold form
const ThresholdFormSchema = z.object({
  damageRequired: z.coerce.number().min(1, "Damage must be at least 1"),
  sortOrder: z.coerce.number().min(0).max(255).default(0),
  effectDurationMinutes: z.coerce.number().min(1).max(10080).default(60),
  rewards: ObjectiveReward,
});

type ThresholdFormData = z.infer<typeof ThresholdFormSchema>;

export const RaidThresholdEditor: React.FC<RaidThresholdEditorProps> = ({
  questId,
}) => {
  const util = api.useUtils();

  // State for modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [effects, setEffects] = useState<ZodAllTags[]>([]);
  const [rewardDialogOpen, setRewardDialogOpen] = useState(false);

  // Queries for reward editor
  const { data: items } = api.item.getAllNames.useQuery(undefined);
  const { data: jutsus } = api.jutsu.getAllNames.useQuery(undefined);
  const { data: bloodlines } = api.bloodline.getAllNames.useQuery(undefined);
  const { data: badges } = api.badge.getAll.useQuery(undefined);
  const { data: userData } = useUserData();
  const hasReputationPermission = canAwardReputation(userData?.role ?? "USER");

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
  const form = useForm<ThresholdFormData>({
    resolver: zodResolver(ThresholdFormSchema),
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

  const handleDelete = (thresholdId: string) => {
    if (confirm("Are you sure you want to delete this threshold?")) {
      deleteThreshold({ thresholdId });
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

  // Build formData for reward edit dialog
  const buildRewardFormData = () => {
    const data: FormEntry<keyof ObjectiveRewardType>[] = [
      { id: "reward_money", type: "number" },
      { id: "reward_seichi_silver", type: "number" },
      { id: "reward_clanpoints", type: "number" },
      { id: "reward_anbupoints", type: "number" },
      { id: "reward_exp", type: "number" },
      { id: "reward_tokens", type: "number" },
      { id: "reward_prestige", type: "number" },
      {
        id: "reward_reputation",
        type: "number",
        readonly: !hasReputationPermission,
      },
      { id: "reward_skillpoints", type: "number" },
      { id: "reward_medical_experience", type: "number" },
      { id: "reward_hunting_experience", type: "number" },
      { id: "reward_crafting_experience", type: "number" },
      { id: "reward_gathering_experience", type: "number" },
      { id: "reward_war_damage", type: "number" },
      { id: "reward_war_healing", type: "number" },
      { id: "reward_rank", type: "str_array", values: UserRanks },
      { id: "reward_village_membership", type: "str_array", values: STARTER_VILLAGES },
    ];

    if (items) {
      data.push({
        id: "reward_items",
        type: "db_values_with_number",
        values: items,
        multiple: true,
        doubleWidth: true,
        label: "Reward Items [and drop chance%]",
      });
    }

    if (jutsus) {
      data.push({
        id: "reward_jutsus",
        type: "db_values",
        values: jutsus,
        multiple: true,
      });
    }

    if (bloodlines) {
      data.push({
        id: "reward_bloodlines",
        type: "db_values",
        values: bloodlines,
        multiple: true,
      });
    }

    if (badges?.data) {
      data.push({
        id: "reward_badges",
        type: "db_values",
        values: badges.data,
        multiple: true,
      });
    }

    return data;
  };

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
        <div className="text-center py-8 text-muted-foreground">
          <Gift className="h-12 w-12 mx-auto mb-2 opacity-50" />
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
              className="flex items-center justify-between p-3 border rounded-lg"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    Tier {idx + 1}: {threshold.damageRequired.toLocaleString()} damage
                  </span>
                  {threshold.effects && threshold.effects.length > 0 && (
                    <span className="flex items-center gap-1 text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-0.5 rounded">
                      <Shield className="h-3 w-3" />
                      {threshold.effects.length} effect(s)
                    </span>
                  )}
                  {threshold.effects && threshold.effects.length > 0 && (
                    <span className="flex items-center gap-1 text-xs bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 px-2 py-0.5 rounded">
                      <Clock className="h-3 w-3" />
                      {threshold.effectDurationMinutes}min
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDelete(threshold.id)}
                  disabled={deletePending}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Button */}
      <Button onClick={openCreateModal} className="w-full">
        <Plus className="h-4 w-4 mr-2" />
        Add Damage Threshold
      </Button>

      {/* Edit/Create Modal */}
      <Modal2
        title={editingId ? "Edit Damage Threshold" : "Add Damage Threshold"}
        isOpen={isModalOpen}
        setIsOpen={setIsModalOpen}
        onAccept={form.handleSubmit(handleSubmit)}
        proceed_label={isPending ? "Saving..." : "Save"}
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
                      <Input type="number" min={1} {...field} />
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
                      <Input type="number" min={0} max={255} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Rewards Section */}
            <div className="space-y-4">
              <Label className="text-base font-semibold">Rewards</Label>

              <div className="flex items-center justify-between border rounded-md p-3">
                <span className="text-sm text-muted-foreground">
                  {formatRewards(watchedRewards)}
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
                  parentForm={form}
                  buildRewardFormData={buildRewardFormData}
                />
              )}
            </div>

            {/* Combat Effects Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">
                  Combat Effects (Raid Buff)
                </Label>
                <Button type="button" variant="outline" size="sm" onClick={addEffect}>
                  <Plus className="h-4 w-4 mr-1" />
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
                        <Input
                          type="number"
                          min={1}
                          max={10080}
                          placeholder="60"
                          {...field}
                        />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        How long the combat buff lasts (1 min - 7 days)
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {effects.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No combat effects. Add effects to grant temporary combat buffs when
                  claiming this reward.
                </p>
              ) : (
                <div className="space-y-4">
                  {effects.map((effect, idx) => (
                    <div key={idx} className="border rounded-lg p-4 relative">
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
      </Modal2>
    </div>
  );
};

interface RewardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentForm: UseFormReturn<ThresholdFormData>;
  buildRewardFormData: () => FormEntry<keyof ObjectiveRewardType>[];
}

const RewardDialog: React.FC<RewardDialogProps> = ({
  open,
  onOpenChange,
  parentForm,
  buildRewardFormData,
}) => {
  const parentReward = useWatch({ control: parentForm.control, name: "rewards" });
  const rewardForm = useForm<ObjectiveRewardType>({
    resolver: zodResolver(ObjectiveReward),
    values: parentReward ?? ObjectiveReward.parse({}),
    defaultValues: parentReward ?? ObjectiveReward.parse({}),
    mode: "all",
  });

  const handleSave = rewardForm.handleSubmit((data) => {
    void parentForm.setValue("rewards", data, { shouldDirty: true });
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl overflow-y-auto max-h-screen">
        <DialogHeader>
          <DialogTitle>Edit Rewards</DialogTitle>
        </DialogHeader>
        <EditContent
          schema={ObjectiveReward}
          form={rewardForm}
          formData={buildRewardFormData()}
          showSubmit={true}
          buttonTxt="Save Rewards"
          onAccept={handleSave}
        />
      </DialogContent>
    </Dialog>
  );
};

export default RaidThresholdEditor;
