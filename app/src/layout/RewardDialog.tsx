"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type React from "react";
import type { UseFormReturn } from "react-hook-form";
import { useForm } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { STARTER_VILLAGES, UserRanks } from "@/drizzle/constants";
import { EditContent, type FormEntry } from "@/layout/EditContent";
import { canAwardReputation } from "@/utils/permissions";
import { useUserDataSelector } from "@/utils/UserContext";
import {
  ObjectiveReward,
  type ObjectiveRewardInputType,
  type ObjectiveRewardType,
} from "@/validators/rewards";

/**
 * Staged reward editor: edits stay in the dialog until a valid save, so closing it
 * discards them and invalid input cannot reach the surrounding form.
 */
export const RewardDialog: React.FC<RewardDialogProps> = (props) => {
  const { open, onOpenChange, value, onSave, formData, disabled, pendingText } = props;
  const rewardForm = useForm<ObjectiveRewardInputType, unknown, ObjectiveRewardType>({
    resolver: zodResolver(ObjectiveReward),
    values: value ?? ObjectiveReward.parse({}),
    defaultValues: value ?? ObjectiveReward.parse({}),
    mode: "all",
  });

  const handleSave = rewardForm.handleSubmit((data) => {
    onSave(data);
    onOpenChange(false);
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!disabled) onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="max-w-3xl"
        closeDisabled={disabled}
        onEscapeKeyDown={(event) => {
          if (disabled) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (disabled) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Edit Rewards</DialogTitle>
        </DialogHeader>
        <EditContent
          schema={ObjectiveReward}
          form={rewardForm as UseFormReturn<ObjectiveRewardType, unknown>}
          formData={formData}
          showSubmit={true}
          buttonTxt="Save Rewards"
          onAccept={handleSave}
          submitDisabled={disabled}
          submitLoading={disabled}
          submitLoadingText={pendingText}
        />
      </DialogContent>
    </Dialog>
  );
};

/** Scalar fields every reward dialog offers, in display order. */
export const REWARD_DIALOG_AMOUNT_FIELDS = [
  "reward_money",
  "reward_seichi_silver",
  "reward_clanpoints",
  "reward_anbupoints",
  "reward_exp",
  "reward_pet_experience",
  "reward_tokens",
  "reward_prestige",
  "reward_reputation",
] as const satisfies readonly RewardField[];

/**
 * Form entries of a reward dialog. Each surface lists its own `amountFields`, because
 * what it may pay out is curated per surface. Catalog fields appear once loaded.
 */
export const useRewardDialogFormData = (amountFields: readonly RewardField[]) => {
  const { data: items } = api.item.getAllNames.useQuery(undefined);
  const { data: jutsus } = api.jutsu.getAllNames.useQuery(undefined);
  const { data: bloodlines } = api.bloodline.getAllNames.useQuery(undefined);
  const { data: badges } = api.badge.getAll.useQuery(undefined);
  const { data: titles } = api.title.getAllNames.useQuery();
  const { data: userData } = useUserDataSelector((u) => ({ role: u.role }));
  const hasReputationPermission = canAwardReputation(userData?.role ?? "USER");

  const data: FormEntry<RewardField>[] = [
    ...amountFields.map((id) => ({
      id,
      type: "number" as const,
      ...(id === "reward_reputation" ? { readonly: !hasReputationPermission } : {}),
    })),
    { id: "reward_rank", type: "str_array", values: UserRanks },
    { id: "reward_village_membership", type: "str_array", values: STARTER_VILLAGES },
  ];
  if (items) {
    data.push({
      id: "reward_items",
      type: "db_values_with_number",
      values: items,
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
  if (titles) {
    data.push({
      id: "reward_titles",
      label: "Give Title",
      type: "db_values",
      values: titles,
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

type RewardField = keyof ObjectiveRewardType;

interface RewardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: ObjectiveRewardType | ObjectiveRewardInputType | undefined;
  /** Commit the validated rewards; the dialog then closes. */
  onSave: (rewards: ObjectiveRewardType) => void;
  formData: FormEntry<RewardField>[];
  /** Locks the dialog open while the surrounding form submits. */
  disabled?: boolean;
  pendingText?: string;
}
