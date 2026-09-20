"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActivityStreakTypes, IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import type { ActivityStreakConfig, ActivityStreakReward } from "@/drizzle/schema";
import Accordion from "@/layout/Accordion";
import ContentBox from "@/layout/ContentBox";
import ContentImageSelector from "@/layout/ContentImageSelector";
import type { FormEntry } from "@/layout/EditContent";
import { EditContent, RewardFormWrapper } from "@/layout/EditContent";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import { getRewardArray } from "@/libs/objectives";
import { showFormErrorsToast, showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";
import { activityStreakFormSchema } from "@/validators/activityStreak";

// Type aliases for form handling with z.coerce fields
type ActivityStreakFormInput = z.input<typeof activityStreakFormSchema>;
type ActivityStreakFormOutput = z.output<typeof activityStreakFormSchema>;

import type { ObjectiveRewardType } from "@/validators/rewards";
import { ObjectiveReward } from "@/validators/rewards";

type ConfigWithRewards = ActivityStreakConfig & {
  rewards: ActivityStreakReward[];
};

export default function ActivityStreakEditPage(props: {
  params: Promise<{ configid: string }>;
}) {
  const params = use(props.params);
  const configId = params.configid;
  const router = useRouter();
  const { data: userData } = useRequiredUserData();

  const { data, isPending, refetch } = api.activityStreak.getConfig.useQuery(
    { id: configId },
    { enabled: !!configId && !!userData },
  );

  useEffect(() => {
    if (userData && !canChangeContent(userData.role)) {
      router.push("/profile");
    }
  }, [userData, router]);

  if (isPending || !userData || !canChangeContent(userData.role) || !data) {
    return <Loader explanation="Loading data" />;
  }

  return <SingleEditConfig config={data} refetch={refetch} />;
}

interface SingleEditConfigProps {
  config: ConfigWithRewards;
  refetch: () => void;
}

const SingleEditConfig: React.FC<SingleEditConfigProps> = ({ config, refetch }) => {
  const [rewards, setRewards] = useState<
    Array<{
      id: string;
      dayNumber: number;
      rewards: ObjectiveRewardType;
      image?: string | null;
    }>
  >(
    config.rewards.map((r) => ({
      id: r.id,
      dayNumber: r.dayNumber,
      rewards: r.rewards,
      image: r.image,
    })),
  );
  const [openDay, setOpenDay] = useState<string>("");

  const form = useForm<ActivityStreakFormInput, unknown, ActivityStreakFormOutput>({
    mode: "all",
    criteriaMode: "all",
    defaultValues: {
      name: config.name,
      description: config.description,
      image: config.image,
      totalDays: config.totalDays,
      streakType: config.streakType,
      isActive: config.isActive,
      ryoCost: config.ryoCost,
      repsCost: config.repsCost,
      seichiSilverCost: config.seichiSilverCost,
      startDate: config.startDate,
      endDate: config.endDate,
    },
    resolver: zodResolver(activityStreakFormSchema),
  });

  const streakType = useWatch({ control: form.control, name: "streakType" });
  const imageUrl = useWatch({ control: form.control, name: "image" });

  const { mutate: updateConfig, isPending } =
    api.activityStreak.updateConfig.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
        refetch();
      },
    });

  const handleSubmit = form.handleSubmit(
    (data: ActivityStreakFormOutput) => {
      updateConfig({
        id: config.id,
        ...data,
        rewards: rewards.sort((a, b) => a.dayNumber - b.dayNumber),
      });
    },
    (errors) => showFormErrorsToast(errors),
  );

  const addReward = () => {
    const existingDays = rewards.map((r) => r.dayNumber);
    let nextDay = 1;
    while (existingDays.includes(nextDay)) {
      nextDay++;
    }
    setRewards([
      ...rewards,
      { id: nanoid(), dayNumber: nextDay, rewards: ObjectiveReward.parse({}) },
    ]);
    setOpenDay(`Day ${nextDay}`);
  };

  const removeReward = (index: number) => {
    setRewards(rewards.filter((_, i) => i !== index));
  };

  const updateRewardDay = (index: number, dayNumber: number) => {
    const newRewards = [...rewards];
    const existing = newRewards[index];
    if (existing) {
      newRewards[index] = { ...existing, dayNumber };
      setRewards(newRewards);
    }
  };

  const updateRewardImage = (index: number, newImage: string) => {
    const newRewards = [...rewards];
    const existing = newRewards[index];
    if (existing) {
      newRewards[index] = { ...existing, image: newImage };
      setRewards(newRewards);
    }
  };

  const formData: FormEntry<keyof ActivityStreakFormOutput>[] = [
    { id: "name", label: "Name", type: "text" },
    {
      id: "description",
      label: "Description",
      type: "text",
      doubleWidth: true,
    },
    { id: "image", label: "Image", type: "avatar", href: imageUrl },
    { id: "totalDays", label: "Total Days", type: "number" },
    {
      id: "streakType",
      label: "Type",
      type: "str_array",
      values: ActivityStreakTypes,
    },
    { id: "isActive", label: "Active", type: "boolean" },
    ...(streakType === "EVENT_PASS"
      ? ([
          { id: "ryoCost", label: "Ryo Cost", type: "number" },
          { id: "repsCost", label: "Reputation Cost", type: "number" },
          {
            id: "seichiSilverCost",
            label: "Seichi Silver Cost",
            type: "number",
          },
          { id: "startDate", label: "Start Date", type: "date" },
          { id: "endDate", label: "End Date", type: "date" },
        ] as FormEntry<keyof ActivityStreakFormOutput>[])
      : []),
  ];

  return (
    <ContentBox
      title="Edit Activity Streak"
      subtitle={config.name}
      defaultBackHref="/manual/activityStreak"
    >
      <EditContent
        schema={activityStreakFormSchema}
        form={form as UseFormReturn<ActivityStreakFormOutput>}
        formData={formData}
        showSubmit={false}
        type="activityStreak"
        allowImageUpload={true}
      />

      <div className="mt-6 border-t pt-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-lg">Day Rewards</h3>
          <Button type="button" onClick={addReward} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Add Day
          </Button>
        </div>

        <div className="space-y-1">
          {rewards
            .sort((a, b) => a.dayNumber - b.dayNumber)
            .map((reward) => {
              const originalIndex = rewards.findIndex((r) => r.id === reward.id);
              const rewardSummary = getRewardArray(reward.rewards).join(" • ");
              const dayKey = `day-${reward.dayNumber}`;

              const displayImage = reward.image || IMG_AVATAR_DEFAULT;

              return (
                <Accordion
                  key={dayKey}
                  title={`Day ${reward.dayNumber}`}
                  selectedTitle={openDay}
                  onClick={setOpenDay}
                  options={
                    <Image
                      src={displayImage}
                      alt={`Day ${reward.dayNumber} reward`}
                      width={40}
                      height={40}
                      className="mr-2 rounded"
                      unoptimized
                    />
                  }
                  unselectedSubtitle={
                    <span className="text-muted-foreground text-sm">
                      {rewardSummary || "No rewards configured"}
                    </span>
                  }
                >
                  <div className="space-y-4 py-4">
                    {/* Day number and remove button */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Label>Day</Label>
                        <Input
                          type="number"
                          min={1}
                          max={60}
                          value={reward.dayNumber}
                          onChange={(e) =>
                            updateRewardDay(
                              originalIndex,
                              parseInt(e.target.value, 10) || 1,
                            )
                          }
                          className="w-20"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeReward(originalIndex)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>

                    {/* Reward image */}
                    <ContentImageSelector
                      label="Reward Image"
                      imageUrl={reward.image}
                      id={reward.id}
                      prompt={`Day ${reward.dayNumber} reward icon, treasure chest, gold coins, glowing item`}
                      allowImageUpload={true}
                      type="activityStreak"
                      onUploadComplete={(newImage) =>
                        updateRewardImage(originalIndex, newImage)
                      }
                      size="square"
                      maxDim={256}
                    />

                    {/* Reward fields using RewardFormWrapper */}
                    <RewardFormWrapper
                      idx={originalIndex}
                      reward={reward.rewards}
                      rewards={rewards.map((r) => r.rewards)}
                      setRewards={(newRewardsList) => {
                        const newRewards = rewards.map((r, i) => ({
                          ...r,
                          rewards: newRewardsList[i] ?? r.rewards,
                        }));
                        setRewards(newRewards);
                      }}
                      type="activityStreak"
                      hideFields={[
                        "reward_hunter_items",
                        "reward_hunter_items_ids",
                        "reward_gathering_items",
                        "reward_gathering_items_ids",
                        "reward_war_damage",
                        "reward_war_healing",
                        "reward_tokens",
                      ]}
                    />
                  </div>
                </Accordion>
              );
            })}

          {rewards.length === 0 && (
            <p className="py-4 text-center text-muted-foreground">
              No rewards configured. Click &quot;Add Day&quot; to add a reward.
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 flex gap-2 border-t pt-6">
        <Button onClick={handleSubmit} disabled={isPending}>
          {isPending ? "Saving..." : "Save Configuration"}
        </Button>
      </div>
    </ContentBox>
  );
};
