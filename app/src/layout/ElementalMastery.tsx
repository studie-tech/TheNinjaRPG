"use client";

import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type BasicElement,
  BasicElementName,
  ELEMENTAL_MASTERY_BOOST,
  ELEMENTAL_MASTERY_CAP,
  type TrainingSpeed,
  TrainingSpeeds,
} from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import Link from "@/layout/Link";
import { showTrainingCapcha } from "@/libs/captcha";
import {
  activeTrainedElement,
  elementalGainRoom,
  providedElements,
} from "@/libs/elementalMastery";
import { showMutationToast } from "@/libs/toast";
import { masteryTrainingBlockMessage, trainingSpeedSeconds } from "@/libs/train";
import { useRequiredUserData } from "@/utils/UserContext";

export const ElementalMastery = ({
  mode = "training",
  timeDiff = 0,
}: {
  mode?: "training" | "experience" | "settings";
  timeDiff?: number;
}) => {
  const { data: user } = useRequiredUserData();
  const utils = api.useUtils();
  const [speed, setSpeed] = useState<TrainingSpeed>("1hr");
  const [amounts, setAmounts] = useState<Partial<Record<BasicElement, string>>>({});
  const [guess, setGuess] = useState("");
  const [message, setMessage] = useState("");
  const needsCaptcha = !!user && showTrainingCapcha(user);
  const { data: captcha } = api.misc.getCaptcha.useQuery(undefined, {
    enabled: needsCaptcha && mode === "training",
  });
  const onSuccess = async (result: { success: boolean; message: string }) => {
    setMessage(result.message);
    showMutationToast(result);
    await utils.profile.getUser.invalidate();
    await utils.profile.getPublicUser.invalidate();
    await utils.misc.getCaptcha.invalidate();
  };
  const onError = () => {
    setMessage("Could not save. Please try again.");
    void utils.profile.getUser.invalidate();
  };
  const start = api.train.startElementalTraining.useMutation({ onSuccess, onError });
  const collect = api.train.collectElementalTraining.useMutation({
    onSuccess,
    onError,
  });
  const invest = api.train.investElementalExperience.useMutation({
    onSuccess,
    onError,
  });
  const select = api.train.selectTrainedElement.useMutation({ onSuccess, onError });
  const isPending =
    start.isPending || collect.isPending || invest.isPending || select.isPending;
  if (!user) return null;
  const active = activeTrainedElement(user);
  const blocked = providedElements(user);
  const startBlock = masteryTrainingBlockMessage({ ...user, trainingSpeed: speed });
  const unlocked = BasicElementName.filter(
    (element) =>
      (user.elementalMastery[element] ?? 0) >= ELEMENTAL_MASTERY_CAP &&
      !blocked.includes(element),
  );

  return (
    <ContentBox
      title="Elemental Mastery"
      subtitle={
        mode === "settings"
          ? "Choose your active trained element"
          : "Train an additional element"
      }
    >
      <p className="mb-3 text-sm text-muted-foreground">
        Each element caps at {ELEMENTAL_MASTERY_CAP.toLocaleString()} mastery and
        unlocks at its cap with a {ELEMENTAL_MASTERY_BOOST}% damage boost. One
        additional trained element can be active. Elemental progress adds no character
        XP and has its own cap.
      </p>
      {message && (
        <p role="status" className="mb-3 text-sm">
          {message}
        </p>
      )}
      {mode === "settings" ? (
        <div className="space-y-2">
          <label htmlFor="active-trained-element" className="text-sm font-semibold">
            Active trained element
          </label>
          <Select
            value={active ?? "none"}
            disabled={isPending || user.status !== "AWAKE"}
            onValueChange={(value) =>
              select.mutate({
                element: value === "none" ? null : (value as BasicElement),
              })
            }
          >
            <SelectTrigger id="active-trained-element">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {unlocked.map((element) => (
                <SelectItem key={element} value={element}>
                  {element} (+{ELEMENTAL_MASTERY_BOOST}% damage)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {user.activeTrainedElement && !active && (
            <p className="text-sm">
              Your saved element is now provided by your innate elements or bloodline.
              Choose another mastered element.
            </p>
          )}
          {unlocked.length === 0 && (
            <p className="text-sm">
              Fully train an element at the{" "}
              <Link href="/traininggrounds" className="underline">
                Training Grounds
              </Link>{" "}
              to select it here.
            </p>
          )}
        </div>
      ) : (
        <>
          {mode === "training" && (
            <div className="mb-4 space-y-3">
              <label
                htmlFor="elemental-training-speed"
                className="text-sm font-semibold"
              >
                Training interval
              </label>
              <Select
                value={speed}
                onValueChange={(value) => setSpeed(value as TrainingSpeed)}
                disabled={isPending}
              >
                <SelectTrigger id="elemental-training-speed">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TrainingSpeeds.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {user.currentlyTrainingElement &&
                user.elementalTrainingStartedAt &&
                user.elementalTrainingSpeed && (
                  <div className="space-y-2 rounded border p-3">
                    <p>
                      Training {user.currentlyTrainingElement}:{" "}
                      <Countdown
                        targetDate={
                          new Date(
                            user.elementalTrainingStartedAt.getTime() +
                              trainingSpeedSeconds(user.elementalTrainingSpeed) * 1000,
                          )
                        }
                        timeDiff={timeDiff}
                        onEndShow="Ready to collect"
                      />
                    </p>
                    {needsCaptcha && captcha && (
                      <>
                        {/* biome-ignore lint/performance/noImgElement: SVG captcha requires img element */}
                        <img
                          alt="Training captcha"
                          src={`data:image/svg+xml;utf8,${encodeURIComponent(captcha.svg)}`}
                        />
                        <Input
                          aria-label="Training captcha answer"
                          value={guess}
                          onChange={(event) => setGuess(event.target.value)}
                        />
                      </>
                    )}
                    <Button
                      disabled={
                        isPending || user.status !== "AWAKE" || (needsCaptcha && !guess)
                      }
                      onClick={() =>
                        collect.mutate({
                          element: user.currentlyTrainingElement!,
                          startedAt: user.elementalTrainingStartedAt!,
                          guess,
                        })
                      }
                    >
                      Stop and collect
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Stopping early collects partial progress. Full gains stop at the
                      end of the interval.
                    </p>
                  </div>
                )}
              {startBlock && (
                <p className="text-sm text-muted-foreground">{startBlock}</p>
              )}
              <Link href="/profile/experience" className="text-sm underline">
                Invest unused experience
              </Link>
            </div>
          )}
          {mode === "experience" && (
            <p className="mb-3 text-sm">
              Available unused XP: {user.earnedExperience.toLocaleString()}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {BasicElementName.map((element) => {
              const progress = user.elementalMastery[element] ?? 0;
              const room = elementalGainRoom(user, element);
              const amount = Number(amounts[element] ?? "");
              return (
                <div key={element} className="space-y-2 rounded border p-3">
                  <p className="font-semibold">
                    {element}
                    {active === element ? " · Active" : ""}
                  </p>
                  <p className="text-sm">
                    {progress.toLocaleString(undefined, { maximumFractionDigits: 2 })} /{" "}
                    {ELEMENTAL_MASTERY_CAP.toLocaleString()}
                  </p>
                  <Progress
                    value={(progress / ELEMENTAL_MASTERY_CAP) * 100}
                    aria-label={`${element} mastery progress`}
                  />
                  <p className="text-xs text-muted-foreground">
                    {blocked.includes(element)
                      ? "Provided by innate elements or bloodline"
                      : progress >= ELEMENTAL_MASTERY_CAP
                        ? "Mastered — select in profile combat preferences"
                        : "Unlocks when fully mastered"}
                  </p>
                  {mode === "training" ? (
                    <Button
                      disabled={
                        isPending ||
                        !!startBlock ||
                        !!user.currentlyTrainingElement ||
                        room <= 0
                      }
                      onClick={() => start.mutate({ element, speed })}
                    >
                      Train {element}
                    </Button>
                  ) : (
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        min={1}
                        max={Math.min(Math.ceil(room), user.earnedExperience)}
                        aria-label={`${element} unused XP`}
                        placeholder="Unused XP"
                        value={amounts[element] ?? ""}
                        disabled={isPending || room <= 0}
                        onChange={(event) =>
                          setAmounts({ ...amounts, [element]: event.target.value })
                        }
                      />
                      <Button
                        disabled={
                          isPending ||
                          user.status !== "AWAKE" ||
                          room <= 0 ||
                          !Number.isInteger(amount) ||
                          amount <= 0 ||
                          amount > Math.min(Math.ceil(room), user.earnedExperience)
                        }
                        onClick={() => invest.mutate({ element, amount })}
                      >
                        Invest
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </ContentBox>
  );
};
