"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useForm } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { RANKED_DIVISIONS, STARTER_VILLAGES, UserRanks } from "@/drizzle/constants";
import { EditContent, type FormEntry } from "@/layout/EditContent";
import { getRewardArray } from "@/libs/objectives";
import { showMutationToast } from "@/libs/toast";
import { canAwardReputation } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";
import {
  type RankedSeason,
  type RankedSeasonInput,
  type RankedSeasonReward,
  type RankedSeasonRewardInput,
  rankedSeasonSchema,
  rewardSchema,
} from "@/validators/pvpRank";

type FormValues = RankedSeason;
type FormValuesInput = RankedSeasonInput;

interface SeasonFormProps {
  initialData?: FormValues;
  seasonId?: string;
  onSuccess?: () => void;
}

export default function SeasonForm({
  initialData,
  seasonId,
  onSuccess,
}: SeasonFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingDivisionIndex, setEditingDivisionIndex] = useState<number | null>(null);
  const utils = api.useUtils();

  // Get user data for permission checks
  const { data: userData } = useUserData();
  const userRole = userData?.role ?? "USER";
  const hasReputationPermission = canAwardReputation(userRole);

  // Queries used in reward editor dialogs
  const { data: items } = api.item.getAllNames.useQuery(undefined);
  const { data: jutsus } = api.jutsu.getAllNames.useQuery(undefined);
  const { data: bloodlines } = api.bloodline.getAllNames.useQuery(undefined);
  const { data: badges } = api.badge.getAll.useQuery(undefined);

  const form = useForm<FormValuesInput, unknown, FormValues>({
    resolver: zodResolver(rankedSeasonSchema),
    defaultValues: initialData || {
      name: "",
      description: "",
      startDate: new Date(),
      endDate: new Date(),
      rewards: [],
      paused: false,
    },
  });

  const createSeason = api.pvpRank.createSeason.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      if (data.success) {
        void utils.pvpRank.getSeasons.invalidate();
        onSuccess?.();
      }
    },
  });

  const updateSeason = api.pvpRank.updateSeason.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      if (data.success) {
        void utils.pvpRank.getSeasons.invalidate();
        onSuccess?.();
      }
    },
  });

  const onSubmit = async (data: FormValues) => {
    setIsSubmitting(true);
    try {
      if (seasonId) {
        await updateSeason.mutateAsync({ id: seasonId, ...data });
      } else {
        await createSeason.mutateAsync(data);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const addDivisionReward = () => {
    const currentRewards = form.getValues("rewards");
    void form.setValue("rewards", [
      ...currentRewards,
      {
        division: "UNRANKED",
        rewards: rewardSchema.parse({}),
      },
    ]);
  };

  const removeDivisionReward = (index: number) => {
    const currentRewards = form.getValues("rewards");
    void form.setValue(
      "rewards",
      currentRewards.filter((_, i) => i !== index),
    );
  };

  // Build formData for reward edit dialog
  const buildRewardFormData = () => {
    const data: FormEntry<keyof RankedSeasonReward>[] = [
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

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Season Name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="startDate"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>Start Date</FormLabel>
                <FormControl>
                  <Input
                    type="date"
                    value={field.value ? format(field.value, "yyyy-MM-dd") : ""}
                    max={
                      form.getValues("endDate")
                        ? format(form.getValues("endDate"), "yyyy-MM-dd")
                        : undefined
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      field.onChange(val ? new Date(val) : undefined);
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="endDate"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>End Date</FormLabel>
                <FormControl>
                  <Input
                    type="date"
                    value={field.value ? format(field.value, "yyyy-MM-dd") : ""}
                    min={
                      form.getValues("startDate")
                        ? format(form.getValues("startDate"), "yyyy-MM-dd")
                        : undefined
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      field.onChange(val ? new Date(val) : undefined);
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="paused"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
              <FormControl>
                <Checkbox checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel>Pause Season</FormLabel>
                <p className="text-muted-foreground text-sm">
                  When paused, players cannot queue for ranked battles in this season.
                </p>
              </div>
            </FormItem>
          )}
        />

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-lg">Division Rewards</h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addDivisionReward}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Division
            </Button>
          </div>

          {form.watch("rewards").map((division, divisionIndex) => (
            <Card key={`division-${division.division}-${divisionIndex}`}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Division {divisionIndex + 1}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeDivisionReward(divisionIndex)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name={`rewards.${divisionIndex}.division`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Division</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a division" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {RANKED_DIVISIONS.map((division) => (
                            <SelectItem key={division.name} value={division.name}>
                              {division.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Rewards summary and edit button */}
                <div className="flex items-center justify-between rounded-md border p-3">
                  <span className="text-muted-foreground text-sm">
                    {getRewardArray(division.rewards as RankedSeasonReward).join(" • ")}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingDivisionIndex(divisionIndex)}
                  >
                    Edit Rewards
                  </Button>
                </div>

                {/* Reward dialog for this division */}
                {editingDivisionIndex === divisionIndex && (
                  <RewardDialog
                    open={true}
                    onOpenChange={() => setEditingDivisionIndex(null)}
                    divisionIndex={divisionIndex}
                    parentForm={form}
                    buildRewardFormData={buildRewardFormData}
                  />
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : seasonId ? "Update Season" : "Create Season"}
        </Button>
      </form>
    </Form>
  );
}

interface RewardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  divisionIndex: number;
  parentForm: UseFormReturn<FormValuesInput, unknown, FormValues>;
  buildRewardFormData: () => FormEntry<keyof RankedSeasonReward>[];
}

const RewardDialog: React.FC<RewardDialogProps> = ({
  open,
  onOpenChange,
  divisionIndex,
  parentForm,
  buildRewardFormData,
}) => {
  const parentReward = parentForm.watch(`rewards.${divisionIndex}.rewards`);
  const rewardForm = useForm<RankedSeasonRewardInput, unknown, RankedSeasonReward>({
    resolver: zodResolver(rewardSchema),
    values: parentReward ?? rewardSchema.parse({}),
    defaultValues: parentReward ?? rewardSchema.parse({}),
    mode: "all",
  });

  const handleSave = rewardForm.handleSubmit((data) => {
    const currentRewards = [...parentForm.getValues("rewards")];
    const prev = currentRewards[divisionIndex];
    if (!prev) return;

    currentRewards[divisionIndex] = {
      ...prev,
      rewards: data,
    };

    void parentForm.setValue("rewards", currentRewards, { shouldDirty: true });
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-screen max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Rewards</DialogTitle>
        </DialogHeader>
        <EditContent
          schema={rewardSchema}
          form={rewardForm as UseFormReturn<RankedSeasonReward, unknown>}
          formData={buildRewardFormData()}
          showSubmit={true}
          buttonTxt="Save Rewards"
          onAccept={handleSave}
        />
      </DialogContent>
    </Dialog>
  );
};
