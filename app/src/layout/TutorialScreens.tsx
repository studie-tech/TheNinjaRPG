"use client";

import { CalendarClock, Coins, Dumbbell, Landmark, Swords } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { GENIN_EXAM_LEVEL, USER_CAPS } from "@/drizzle/constants";
import Image from "@/layout/Image";
import { getEnergyQueue } from "@/libs/queue";
import { cn } from "@/libs/shadui";
import { showMutationToast, triggerConfetti } from "@/libs/toast";
import type { TutorialScreenKind } from "@/libs/tutorialSteps";
import { getTimeLeftStr, nextUtcDayAt } from "@/utils/time";
import { useRequiredUserDataSelector } from "@/utils/UserContext";
import type { StreakDayRewardType } from "@/validators/activityStreak";

/** Full-screen moments of the Academy Trials, drawn above the page and the dock. */
export const TutorialScreen: React.FC<{
  kind: TutorialScreenKind;
  onContinue: () => void;
}> = ({ kind, onContinue }) => (
  <FullScreenDialog>
    <div className="@container mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center gap-6 px-4 py-8 text-center">
      {kind === "rankUp" ? <RankUpContent /> : <TomorrowContent />}
      <Button
        id="tutorial-screen-continue"
        size="xl"
        decoration="gold"
        className="w-full"
        onClick={onContinue}
      >
        Continue
      </Button>
    </div>
  </FullScreenDialog>
);

/**
 * A modal covering the whole viewport. Focus moves inside on open, Tab stays inside, the
 * page behind is hidden from assistive technology, and focus returns on close. Escape and
 * outside presses do nothing: each screen leaves through its own buttons.
 */
export const FullScreenDialog: React.FC<{
  id?: string;
  children: React.ReactNode;
}> = ({ id, children }) => {
  // Opened without a Radix trigger, so the control focused before it takes focus back.
  const [returnFocus] = useState(() =>
    typeof document === "undefined" ? null : document.activeElement,
  );
  return (
    <Dialog open modal>
      <DialogContent
        id={id}
        aria-describedby={undefined}
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocus instanceof HTMLElement && returnFocus.isConnected) {
            returnFocus.focus();
          }
        }}
        className="inset-0 top-0 left-0 z-[70] block h-auto max-h-none w-auto max-w-none translate-x-0 translate-y-0 rounded-none border-0 p-0 shadow-none data-[state=open]:animate-none sm:rounded-none md:max-w-none"
      >
        {children}
      </DialogContent>
    </Dialog>
  );
};

/** The heading a full-screen dialog is announced by, in the page's heading style. */
export const FullScreenDialogTitle: React.FC<{
  className?: string;
  children: React.ReactNode;
}> = ({ className, children }) => (
  <DialogTitle className={cn("tracking-normal", className)}>{children}</DialogTitle>
);

/** The Genin promotion: the new village, its colours and what the rank opens up. */
const RankUpContent: React.FC = () => {
  const { data: user } = useRequiredUserDataSelector((u) => ({
    username: u.username,
    rank: u.rank,
    village: u.village,
  }));
  useEffect(() => {
    void triggerConfetti();
  }, []);
  const village = user?.village;
  return (
    <>
      {village?.villageGraphic && (
        <div
          className="relative aspect-[16/9] w-full max-w-xl overflow-hidden rounded-xl border-4"
          style={{ borderColor: village.hexColor ?? undefined }}
        >
          <Image
            src={village.villageGraphic}
            alt={village.name}
            fill
            className="object-cover"
          />
        </div>
      )}
      <div className="flex flex-col gap-2">
        <p className="font-semibold text-muted-foreground text-sm uppercase tracking-widest">
          Promotion
        </p>
        <FullScreenDialogTitle className="text-4xl font-bold">
          Genin of {village?.name ?? "your village"}
        </FullScreenDialogTitle>
        <p className="text-lg">
          {user?.username}, the proctor ties the headband of {village?.name} on your
          brow. You are a shinobi now.
        </p>
      </div>
      <ul className="grid w-full grid-cols-1 gap-3 text-left @lg:grid-cols-3">
        <ScreenFact icon={<Swords className="h-5 w-5" />} title="Real missions">
          Your village&apos;s mission hall now gives you D-rank missions.
        </ScreenFact>
        <ScreenFact icon={<Dumbbell className="h-5 w-5" />} title="Higher caps">
          You can now grow far past the Academy&apos;s level {USER_CAPS.STUDENT.LVL_CAP}{" "}
          limit.
        </ScreenFact>
        <ScreenFact icon={<Landmark className="h-5 w-5" />} title="The case file">
          Lemu has news about that shard. She&apos;ll meet you at the Academy.
        </ScreenFact>
      </ul>
    </>
  );
};

/** What is waiting tomorrow, so the first evening ends with a reason to return. */
const TomorrowContent: React.FC = () => {
  const { data: user } = useRequiredUserDataSelector((u) => ({
    bank: u.bank,
    queue: u.queue,
    energyQueueHead: u.energyQueueHead,
    masteryQueueHead: u.masteryQueueHead,
    elementalQueueHead: u.elementalQueueHead,
  }));
  const { data: streaks } = api.activityStreak.getUserStreaks.useQuery(undefined, {
    staleTime: 60_000,
  });
  const recurring =
    streaks?.streaks.find((streak) => streak.streakType === "RECURRING") ?? null;
  const rewards = recurring?.allRewards ?? streaks?.activeRecurringConfig?.rewards;
  const dayTwo = rewards?.find((reward) => reward.dayNumber === 2);
  const queued = user ? getEnergyQueue(user) : [];
  const queuedEnergy = queued.reduce((sum, entry) => sum + entry.energy, 0);
  const now = new Date();
  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="font-semibold text-muted-foreground text-sm uppercase tracking-widest">
          Before you rest
        </p>
        <FullScreenDialogTitle className="text-4xl font-bold">
          Tomorrow
        </FullScreenDialogTitle>
        <p className="text-lg">
          A shinobi&apos;s day starts with a few small habits. Here is what will be
          waiting for you.
        </p>
      </div>
      <ul className="grid w-full grid-cols-1 gap-3 text-left @lg:grid-cols-2">
        <ScreenFact icon={<CalendarClock className="h-5 w-5" />} title="Streak day 2">
          {dayTwo
            ? `Claim ${describeStreakReward(dayTwo)} on your Dashboard.`
            : "Come back to claim the next day of your daily streak."}
        </ScreenFact>
        <ScreenFact icon={<Swords className="h-5 w-5" />} title="Daily duties reset">
          New daily duties in{" "}
          {getTimeLeftStr(nextUtcDayAt(now).getTime() - now.getTime())}.
        </ScreenFact>
        <ScreenFact icon={<Dumbbell className="h-5 w-5" />} title="Training">
          {queuedEnergy > 0
            ? `Your queue trains ${queuedEnergy.toLocaleString()} Energy as it refills, even while you're offline.`
            : "Your Energy refills overnight. Queue it at the training grounds to train while you're away."}
        </ScreenFact>
        <ScreenFact icon={<Coins className="h-5 w-5" />} title="Bank">
          {user && user.bank > 0
            ? `Your ${user.bank.toLocaleString()} ryo in the bank earn interest every day.`
            : "Ryo kept in the bank earn interest every day. You'll open an account soon."}
        </ScreenFact>
      </ul>
    </>
  );
};

const ScreenFact: React.FC<{
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}> = ({ icon, title, children }) => (
  <li className="flex gap-3 rounded-lg border bg-card p-3">
    <span className="mt-0.5 text-primary">{icon}</span>
    <span className="flex flex-col">
      <b className="text-base">{title}</b>
      <span className="text-muted-foreground text-sm">{children}</span>
    </span>
  </li>
);

/** The headline of a streak day's reward: ryo, experience or items. */
const describeStreakReward = (day: StreakDayRewardType) => {
  const reward = day.rewards;
  const parts = [
    reward.reward_money
      ? `${Math.floor(reward.reward_money).toLocaleString()} ryo`
      : "",
    reward.reward_exp ? `${Math.floor(reward.reward_exp).toLocaleString()} XP` : "",
    reward.reward_items?.length
      ? `${reward.reward_items.length} item${reward.reward_items.length > 1 ? "s" : ""}`
      : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" and ") : "its reward";
};

/**
 * Express Trials, offered to players who said they have played before: skip the Academy
 * Trials with the experience they would have paid, and pick up at graduation, where the
 * player assigns it, levels up and takes the Genin exam in full. Declining plays the
 * Academy Trials.
 */
export const ExpressTrialsScreen: React.FC<{
  examStep: number;
  onDecline: () => void;
}> = ({ examStep, onDecline }) => {
  const { updateUser, prepareUserUpdate } = useRequiredUserDataSelector((u) => ({
    userId: u.userId,
  }));
  const { mutate: start, isPending } = api.profile.startExpressTrials.useMutation({
    onMutate: () => ({ userRevision: prepareUserUpdate() }),
    onSuccess: async (result, _variables, context) => {
      showMutationToast(result);
      if (!result.success) return;
      // A withheld patch reads the profile again, Road to Genin included.
      await updateUser(result.userPatch, {
        revision: context?.userRevision,
        achievementProgress: result.achievementProgress,
      });
    },
  });
  return (
    <FullScreenDialog>
      <div className="@container mx-auto flex min-h-full max-w-3xl flex-col justify-center gap-5 px-4 py-8">
        <header className="flex flex-col gap-2 text-center">
          <p className="font-semibold text-muted-foreground text-sm uppercase tracking-widest">
            Welcome back
          </p>
          <FullScreenDialogTitle className="text-3xl font-bold">
            Express Trials
          </FullScreenDialogTitle>
          <p className="text-base">
            You know the ropes. Skip the Academy Trials and pick up at graduation with
            the experience they pay.
          </p>
        </header>
        {/* Side by side from @2xl (504px), where both lists keep their lines short. */}
        <div className="grid gap-3 @2xl:grid-cols-2">
          <ExpressList
            title="Skipped"
            items={[
              "The arena, training, shop and travel lessons",
              "The missing pup and its fight",
              "The Bondkeeper companion",
            ]}
          />
          <ExpressList
            title="Still yours to do"
            items={[
              `Assign your experience and reach level ${GENIN_EXAM_LEVEL}`,
              "The Genin exam and its practical test",
              "Choosing your village",
            ]}
          />
        </div>
        <div className="grid gap-2 @lg:grid-cols-2">
          <Button
            size="xl"
            decoration="gold"
            className="w-full"
            disabled={isPending}
            onClick={() => start({ step: examStep })}
          >
            {isPending ? "Skipping..." : "Skip to the Genin exam"}
          </Button>
          <Button
            size="xl"
            variant="outline"
            className="w-full"
            disabled={isPending}
            onClick={onDecline}
          >
            Play the Academy Trials
          </Button>
        </div>
      </div>
    </FullScreenDialog>
  );
};

/** One column of the Express Trials summary. */
const ExpressList: React.FC<{ title: string; items: string[] }> = ({
  title,
  items,
}) => (
  <section className="rounded-lg border bg-card p-3">
    <h3 className="mb-2 text-base font-semibold">{title}</h3>
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  </section>
);
