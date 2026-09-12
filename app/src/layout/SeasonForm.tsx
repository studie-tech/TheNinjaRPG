"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useForm, useWatch } from "react-hook-form";
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
  createRankedSeasonDetailsSchema,
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
  seasonRevision?: Date;
  onSuccess?: () => void;
  onPendingChange?: (pending: boolean) => void;
}

type CreateSeasonSubmission = {
  requestId: string;
  season: FormValues;
};

type UpdateSeasonSubmission = CreateSeasonSubmission & {
  seasonId: string;
  expectedUpdatedAt: Date;
  identity: string;
};

const copySeason = (season: FormValues): FormValues =>
  Object.freeze({
    ...season,
    startDate: new Date(season.startDate),
    endDate: new Date(season.endDate),
    rewards: structuredClone(season.rewards),
  });

const seasonsMatch = (left: FormValues, right: FormValues) =>
  left.name === right.name &&
  left.description === right.description &&
  left.startDate.getTime() === right.startDate.getTime() &&
  left.endDate.getTime() === right.endDate.getTime() &&
  left.paused === right.paused &&
  JSON.stringify(left.rewards) === JSON.stringify(right.rewards);

export default function SeasonForm({
  initialData,
  seasonId,
  seasonRevision,
  onSuccess,
  onPendingChange,
}: SeasonFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingDivisionIndex, setEditingDivisionIndex] = useState<number | null>(null);
  // React mutation state is not synchronous. This ref closes the same-tick click/Enter gap,
  // while retrySubmissionRef keeps an uncertain request key durable after a lost response.
  const createInFlightRef = useRef<CreateSeasonSubmission | null>(null);
  const retrySubmissionRef = useRef<CreateSeasonSubmission | null>(null);
  const updateInFlightRef = useRef<UpdateSeasonSubmission | null>(null);
  const updateRetrySubmissionRef = useRef<UpdateSeasonSubmission | null>(null);
  const utils = api.useUtils();

  // Get user data for permission checks
  const { data: userData, userId } = useUserData();
  const userRole = userData?.role ?? "USER";
  const hasReputationPermission = canAwardReputation(userRole);
  const updateIdentity = `${userId ?? "unknown"}:${seasonId ?? "create"}:${
    seasonRevision?.getTime() ?? "unversioned"
  }`;
  const updateIdentityRef = useRef(updateIdentity);
  updateIdentityRef.current = updateIdentity;

  // Queries used in reward editor dialogs
  const { data: items } = api.item.getAllNames.useQuery(undefined);
  const { data: jutsus } = api.jutsu.getAllNames.useQuery(undefined);
  const { data: bloodlines } = api.bloodline.getAllNames.useQuery(undefined);
  const { data: badges } = api.badge.getAll.useQuery(undefined);

  const form = useForm<FormValuesInput, unknown, FormValues>({
    resolver: zodResolver(
      seasonId ? rankedSeasonSchema : createRankedSeasonDetailsSchema,
    ),
    defaultValues: initialData || {
      name: "",
      description: "",
      startDate: new Date(),
      endDate: new Date(),
      rewards: [],
      paused: false,
    },
  });
  const createSeason = api.pvpRank.createSeason.useMutation();

  const updateSeason = api.pvpRank.updateSeason.useMutation();

  const onSubmit = async (data: FormValues) => {
    if (!seasonId && createInFlightRef.current) return;

    if (!seasonId) {
      const season = copySeason(data);
      const previousRetry = retrySubmissionRef.current;
      const submission =
        previousRetry && seasonsMatch(previousRetry.season, season)
          ? previousRetry
          : { requestId: crypto.randomUUID(), season };

      createInFlightRef.current = submission;
      retrySubmissionRef.current = submission;
      setIsSubmitting(true);
      onPendingChange?.(true);
      try {
        // The creation resolver already produced this shape; parsing again gives the mutation
        // the creation-only narrowed division type without narrowing legacy update-season data.
        const validatedSeason = createRankedSeasonDetailsSchema.parse(
          submission.season,
        );
        const result = await createSeason.mutateAsync({
          ...validatedSeason,
          requestId: submission.requestId,
        });
        if (createInFlightRef.current !== submission) return;

        if (!result.success) {
          showMutationToast(result);
          return;
        }

        const verified =
          result.requestId === submission.requestId &&
          result.submittedSeason !== undefined &&
          result.createdSeason !== undefined &&
          result.createdSeason.id.length > 0 &&
          seasonsMatch(result.submittedSeason, submission.season);
        if (!verified) {
          showMutationToast({
            success: false,
            message:
              "The server response could not be matched to this season. Your draft is still available; please retry.",
          });
          return;
        }

        retrySubmissionRef.current = null;
        showMutationToast(result);
        void utils.pvpRank.getSeasons.invalidate();
        onSuccess?.();
      } catch {
        // The shared tRPC handler owns transport-error reporting. Keep the exact submitted
        // snapshot and UUID so retry is safe if the first response was lost after commit.
      } finally {
        if (createInFlightRef.current === submission) {
          createInFlightRef.current = null;
          setIsSubmitting(false);
          onPendingChange?.(false);
        }
      }
      return;
    }

    if (updateInFlightRef.current) return;
    if (!seasonRevision) {
      showMutationToast({
        success: false,
        message: "This season has no revision. Refresh it before saving.",
      });
      return;
    }

    const season = copySeason(data);
    const previousRetry = updateRetrySubmissionRef.current;
    const submission =
      previousRetry &&
      previousRetry.identity === updateIdentity &&
      seasonsMatch(previousRetry.season, season)
        ? previousRetry
        : {
            requestId: crypto.randomUUID(),
            seasonId,
            expectedUpdatedAt: new Date(seasonRevision),
            season,
            identity: updateIdentity,
          };

    updateInFlightRef.current = submission;
    updateRetrySubmissionRef.current = submission;
    setIsSubmitting(true);
    onPendingChange?.(true);
    try {
      const result = await updateSeason.mutateAsync({
        id: submission.seasonId,
        ...submission.season,
        expectedUpdatedAt: submission.expectedUpdatedAt,
        requestId: submission.requestId,
      });
      if (
        updateInFlightRef.current !== submission ||
        updateIdentityRef.current !== submission.identity
      ) {
        return;
      }
      if (!result.success) {
        showMutationToast(result);
        return;
      }

      const verified =
        result.requestId === submission.requestId &&
        result.seasonId === submission.seasonId &&
        result.expectedUpdatedAt?.getTime() ===
          submission.expectedUpdatedAt.getTime() &&
        result.submittedSeason !== undefined &&
        seasonsMatch(result.submittedSeason, submission.season) &&
        result.previousSeason?.id === submission.seasonId &&
        result.previousSeason.updatedAt.getTime() ===
          submission.expectedUpdatedAt.getTime() &&
        result.committedSeason?.id === submission.seasonId &&
        seasonsMatch(result.committedSeason, submission.season) &&
        result.committedSeason.updatedAt.getTime() >
          submission.expectedUpdatedAt.getTime();
      if (!verified || !result.committedSeason) {
        showMutationToast({
          success: false,
          message:
            "The server response could not be matched to this season. Your draft is still available; please retry.",
        });
        return;
      }

      const committedSeason = result.committedSeason;
      utils.pvpRank.getSeasons.setData(undefined, (seasons) =>
        seasons?.map((entry) =>
          entry.id === submission.seasonId ? { ...entry, ...committedSeason } : entry,
        ),
      );
      updateRetrySubmissionRef.current = null;
      showMutationToast(result);
      await utils.pvpRank.getSeasons.invalidate();
      onSuccess?.();
    } catch {
      // The shared tRPC handler reports transport failures. Keep the exact immutable snapshot,
      // original revision, and UUID so a retry can safely recover a lost success response.
    } finally {
      if (updateInFlightRef.current === submission) {
        updateInFlightRef.current = null;
        setIsSubmitting(false);
        onPendingChange?.(false);
      }
    }
  };

  const addDivisionReward = () => {
    const currentRewards = form.getValues("rewards");
    void form.setValue("rewards", [
      ...currentRewards,
      {
        division: "Unranked",
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
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <fieldset
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          className="space-y-8 disabled:cursor-wait"
        >
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
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                          disabled={isSubmitting}
                        >
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
                      {getRewardArray(division.rewards as RankedSeasonReward).join(
                        " • ",
                      )}
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
                      onOpenChange={() => {
                        if (!isSubmitting) setEditingDivisionIndex(null);
                      }}
                      divisionIndex={divisionIndex}
                      parentForm={form}
                      buildRewardFormData={buildRewardFormData}
                      disabled={isSubmitting}
                      pendingText={seasonId ? "Saving" : "Creating"}
                    />
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isSubmitting
              ? seasonId
                ? "Saving"
                : "Creating"
              : seasonId
                ? "Update Season"
                : "Create Season"}
          </Button>
          {isSubmitting && (
            <p
              className="text-muted-foreground text-sm"
              role="status"
              aria-live="polite"
            >
              {seasonId ? "Saving" : "Creating"}
            </p>
          )}
        </fieldset>
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
  disabled: boolean;
  pendingText: string;
}

const RewardDialog: React.FC<RewardDialogProps> = ({
  open,
  onOpenChange,
  divisionIndex,
  parentForm,
  buildRewardFormData,
  disabled,
  pendingText,
}) => {
  const parentReward = useWatch({
    control: parentForm.control,
    name: `rewards.${divisionIndex}.rewards`,
  });
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
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!disabled) onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="max-h-screen max-w-3xl overflow-y-auto"
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
          schema={rewardSchema}
          form={rewardForm as UseFormReturn<RankedSeasonReward, unknown>}
          formData={buildRewardFormData()}
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
