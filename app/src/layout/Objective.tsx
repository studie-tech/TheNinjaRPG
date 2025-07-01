import React, { useState } from "react";
import Image from "next/image";
import StatusBar from "@/layout/StatusBar";
import Countdown from "@/layout/Countdown";
import Modal2 from "@/layout/Modal2";
import { CircleHelp, RotateCcw } from "lucide-react";
import { getObjectiveImage } from "@/libs/objectives";
import { X, Check, Gift } from "lucide-react";
import { hasReward } from "@/validators/objectives";
import { useRequiredUserData } from "@/utils/UserContext";
import { getObjectiveSchema } from "@/validators/objectives";
import { isObjectiveComplete } from "@/libs/objectives";
import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";
import { Button } from "@/components/ui/button";
import type { Quest } from "@/drizzle/schema";
import type { AllObjectivesType, ObjectiveRewardType } from "@/validators/objectives";
import type { QuestTrackerType } from "@/validators/objectives";

interface ObjectiveProps {
  titlePrefix?: string | number;
  objective: AllObjectivesType;
  tracker: QuestTrackerType;
  checkRewards: () => void;
  tier?: number;
  grayedOut?: boolean;
  hideIfNoRewards?: boolean | null;
}
export const Objective: React.FC<ObjectiveProps> = (props) => {
  const [modalOpen, setModalOpen] = useState(false);
  const { data: userData } = useRequiredUserData();
  const { objective, tier, tracker, titlePrefix, checkRewards } = props;
  const { image, title } = getObjectiveImage(objective);

  // Parse objective
  const objectiveSchema = getObjectiveSchema(objective.task as string);
  const parsed = objectiveSchema.parse(objective);

  // Derived status of the objective
  const { done, value, canCollect } = isObjectiveComplete(tracker, parsed);

  // Check if this is a start_battle objective with recentlyDied flag
  const status = tracker?.goals.find((g) => g.id === objective.id);
  const isStartBattleWithRecentlyDied =
    objective.task === "start_battle" && status?.recentlyDied;

  // Retry battle mutation
  const { mutate: retryBattle, isPending: isRetrying } =
    api.quests.retryBattle.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        // Refresh user data to update quest state
        window.location.reload();
      },
    });

  // Indicator icon
  const indicatorIcons = done ? (
    <div className="flex flex-col items-center gap-1">
      <Check className="h-10 w-10 stroke-green-500" />
      {hasReward(parsed) &&
        (canCollect && userData?.status === "AWAKE" ? (
          <Gift
            className="h-7 w-7 cursor-pointer hover:text-orange-500"
            onClick={checkRewards}
          />
        ) : (
          <Gift className="h-7 w-7 fill-slate-500" />
        ))}
    </div>
  ) : (
    <X className="h-10 w-10 stroke-red-500" />
  );

  // If future objectives are hidden, hide future objectives
  if (props.hideIfNoRewards && !canCollect) return null;

  // Show the objective
  return (
    <div className={`flex flex-row ${props.grayedOut ? "grayscale opacity-30" : ""}`}>
      <Image
        className="self-start basis-1/4"
        alt={parsed.task}
        src={image}
        width={60}
        height={60}
      />
      <div className="basis-3/4">
        <div className="flex flex-row">
          <p className="font-bold pl-2 grow">
            {titlePrefix}
            {title}
          </p>
          {objective.description && objective.description !== "" && (
            <>
              <CircleHelp
                className="h-5 w-5 hover:text-orange-500 hover:cursor-pointer"
                onClick={() => setModalOpen(true)}
              />
              {modalOpen && (
                <Modal2
                  title="Objective Details"
                  setIsOpen={() => setModalOpen(false)}
                  isOpen={modalOpen}
                >
                  <div dangerouslySetInnerHTML={{ __html: objective.description }} />
                </Modal2>
              )}
            </>
          )}
        </div>
        <hr className="my-0" />
        <div className="pl-2">
          {"value" in parsed && (
            <div className="pr-3 flex flex-row items-center">
              <div className="grow">
                <StatusBar
                  title="Goal"
                  tooltip="Status points"
                  color={getStatusColor(tier, done)}
                  showText={true}
                  current={value > parsed.value ? parsed.value : value}
                  total={parsed.value}
                />
              </div>
              {indicatorIcons}
            </div>
          )}
          {"sector" in parsed && (
            <div className="flex flex-row items-center">
              <div className="grow">
                {!("hideLocation" in parsed && parsed.hideLocation) && (
                  <>
                    <div>
                      <b>Sector: </b> {parsed.sector}
                    </div>
                    <div>
                      <b>Position:</b> [{parsed.longitude}, {parsed.latitude}]
                    </div>
                  </>
                )}
                {"hideLocation" in parsed && parsed.hideLocation && (
                  <div>
                    <b>Location:</b> hidden
                  </div>
                )}
                <Reward info={parsed} />
              </div>
              <div>{indicatorIcons}</div>
            </div>
          )}
          {/* Retry button for start_battle objectives with recentlyDied flag */}
          {isStartBattleWithRecentlyDied && (
            <div className="flex flex-row items-center justify-end mt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => retryBattle({ questId: tracker.id })}
                disabled={isRetrying}
                className="flex items-center gap-2"
              >
                <RotateCcw className="h-4 w-4" />
                {isRetrying ? "Retrying..." : "Retry Battle"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface RewardProps {
  info?: AllObjectivesType | ObjectiveRewardType | null;
  rewardMultiplier?: number;
}

export const Reward: React.FC<RewardProps> = (props) => {
  const { info, rewardMultiplier } = props;
  let rewards = `${info?.reward_money ? `${info.reward_money} Ryo` : ""}`;
  if (info?.reward_tokens) {
    rewards += `${rewards ? ", " : ""} ${info.reward_tokens} Tokens`;
  }
  if (info?.reward_clanpoints) {
    rewards += `${rewards ? ", " : ""} ${info.reward_clanpoints} Clan Points`;
  }
  if (info?.reward_exp) {
    rewards += `${rewards ? ", " : ""} ${info.reward_exp} Exp`;
  }
  if (info?.reward_prestige) {
    rewards += `${rewards ? ", " : ""} ${info.reward_prestige} Prestige`;
  }
  if (info?.reward_reputation) {
    rewards += `${rewards ? ", " : ""} ${info.reward_reputation} Reputation Points`;
  }
  if (info?.reward_seichi_silver) {
    rewards += `${rewards ? ", " : ""} ${info.reward_seichi_silver} Seichi Silver`;
  }
  return (
    <>
      {rewards && (
        <p>
          <b>Rewards</b>: {rewards}
          {rewardMultiplier && rewardMultiplier !== 1.0 && (
            <>
              <br />
              <span className="text-sm text-red-500">
                Will only give {rewardMultiplier * 100}% Rewards
              </span>
            </>
          )}
        </p>
      )}
    </>
  );
};

interface EventTimerProps {
  quest: Quest;
  tracker: QuestTrackerType;
}

export const EventTimer: React.FC<EventTimerProps> = (props) => {
  const { quest } = props;

  // If the quest is permanent
  if (!quest.endsAt && !quest.startsAt) return <></>;

  const now = new Date();
  const startDate = quest.startsAt ? new Date(quest.startsAt) : null;
  const endDate = quest.endsAt ? new Date(quest.endsAt) : null;

  // If event hasn't started yet
  if (startDate && now < startDate) {
    return (
      <div>
        <b>Starts in: </b> <Countdown targetDate={startDate} />
      </div>
    );
  }

  // If event has started but not ended
  if (endDate && now < endDate) {
    return (
      <div>
        <b>Time Left: </b> <Countdown targetDate={endDate} />
      </div>
    );
  }

  // If event has ended
  return (
    <div>
      <b>Event Ended</b>
    </div>
  );
};

const getStatusColor = (tier: number | undefined, done: boolean) => {
  if (done) return "bg-green-500";
  switch (tier) {
    case 1:
      return "bg-green-500";
    case 2:
      return "bg-yellow-500";
    case 2:
      return "bg-red-500";
    default:
      return "bg-blue-500";
  }
};
