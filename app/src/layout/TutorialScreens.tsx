"use client";

import { Bot, CalendarClock, Coins, Dumbbell, Landmark, Swords } from "lucide-react";
import { useEffect, useState } from "react";
import type { RouterOutputs } from "@/app/_trpc/client";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  EXPRESS_TRIALS_SHURIKEN,
  GENIN_EXAM_LEVEL,
  USER_CAPS,
} from "@/drizzle/constants";
import Image from "@/layout/Image";
import { getEnergyQueue } from "@/libs/queue";
import { cn } from "@/libs/shadui";
import { showMutationToast, triggerConfetti } from "@/libs/toast";
import type { TutorialScreenKind } from "@/libs/tutorialSteps";
import { getTimeLeftStr, nextUtcDayAt } from "@/utils/time";
import { useRequiredUserDataSelector } from "@/utils/UserContext";
import type { StreakDayRewardType } from "@/validators/activityStreak";

/** Moments of the Academy Trials, shown in a wide dialog above the page and the dock. */
export const TutorialScreen: React.FC<{
  kind: TutorialScreenKind;
  onContinue: () => void;
}> = ({ kind, onContinue }) => (
  // 960px at the 12px root: two readable columns on desktop, one on phones.
  <WideDialog className="md:max-w-7xl">
    <div className="@container flex w-full flex-col justify-center px-4 py-8">
      {kind === "rankUp" ? (
        <RankUpContent onContinue={onContinue} />
      ) : (
        <TomorrowContent onContinue={onContinue} />
      )}
    </div>
  </WideDialog>
);

/**
 * A modal nearly as wide as the screen, over the dimmed page and dock, scrolling within itself
 * when its content is taller than the screen. Focus moves inside on open, Tab stays inside,
 * the page behind is hidden from assistive technology, and focus returns on close. Escape
 * and outside presses do nothing: each screen leaves through its own buttons.
 */
export const WideDialog: React.FC<{
  id?: string;
  /** A narrower cap for content that reads best at a set width, such as `md:max-w-7xl`. */
  className?: string;
  children: React.ReactNode;
}> = ({ id, className, children }) => {
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
        // The page and the lesson dock (layer 61) dim together behind the dialog.
        overlayClassName="z-[70]"
        className={cn(
          "z-[70] block max-h-[calc(100dvh-1rem)] w-[99%] max-w-[99%] rounded-lg p-0 md:max-w-[99%]",
          className,
        )}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
};

/** The heading a wide dialog is announced by, in the page's heading style. */
export const WideDialogTitle: React.FC<{
  className?: string;
  children: React.ReactNode;
}> = ({ className, children }) => (
  <DialogTitle className={cn("tracking-normal", className)}>{children}</DialogTitle>
);

/** The Genin promotion: the new village, its colours and what the rank opens up. */
const RankUpContent: React.FC<{ onContinue: () => void }> = ({ onContinue }) => {
  const { data: user } = useRequiredUserDataSelector((u) => ({
    username: u.username,
    rank: u.rank,
    village: u.village,
    defaultAutoCombat: u.defaultAutoCombat,
  }));
  useEffect(() => {
    void triggerConfetti();
  }, []);
  const village = user?.village;
  const hasGraphic = !!village?.villageGraphic;
  return (
    // The village art and the text sit side by side from @5xl (768px), stacked below it.
    // The art takes the right column, where the quest reward toast opens over this screen,
    // so the headline stays readable while the toast shows.
    <div
      className={cn(
        "grid items-center gap-6 text-center",
        hasGraphic
          ? "@5xl:grid-cols-2 @5xl:gap-10 @5xl:text-left"
          : "mx-auto w-full max-w-2xl",
      )}
    >
      {village?.villageGraphic && (
        <div
          className="relative aspect-[16/9] w-full overflow-hidden rounded-xl border-4 @5xl:order-last @5xl:aspect-[4/3]"
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
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm font-semibold tracking-widest uppercase">
            Promotion
          </p>
          <WideDialogTitle className="text-4xl font-bold @5xl:text-5xl">
            Genin of {village?.name ?? "your village"}
          </WideDialogTitle>
          <p className="text-lg">
            {user?.username}, the proctor ties the headband of {village?.name} on your
            brow. You are a shinobi now.
          </p>
        </div>
        {/* Two facts a row from @lg (384px), which the text column keeps on desktop. */}
        <ul className="grid grid-cols-1 gap-3 text-left @lg:grid-cols-2">
          <ScreenFact icon={<Swords className="h-6 w-6" />} title="Real missions">
            Your village&apos;s mission hall now gives you D-rank missions.
          </ScreenFact>
          <ScreenFact icon={<Dumbbell className="h-6 w-6" />} title="Higher caps">
            You can now grow far past the Academy&apos;s level{" "}
            {USER_CAPS.STUDENT.LVL_CAP} limit.
          </ScreenFact>
          <ScreenFact icon={<Bot className="h-6 w-6" />} title="Auto combat">
            {user?.defaultAutoCombat === false
              ? "Your AI profile can fight non-PvP battles for you. Switch on Auto combat in Battle setup at the arena."
              : "Your AI profile now fights your non-PvP battles. Tap Auto combat on the battlefield to take over."}
          </ScreenFact>
          <ScreenFact icon={<Landmark className="h-6 w-6" />} title="The case file">
            The academy archives have turned up something you should see. Find Lemu at
            the Academy.
          </ScreenFact>
        </ul>
        <ContinueButton onContinue={onContinue} />
      </div>
    </div>
  );
};

/** What is waiting tomorrow, so the first evening ends with a reason to return. */
const TomorrowContent: React.FC<{ onContinue: () => void }> = ({ onContinue }) => {
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
  const { today, tomorrow } = streakDaysAhead(streaks);
  const queued = user ? getEnergyQueue(user) : [];
  const queuedEnergy = queued.reduce((sum, entry) => sum + entry.energy, 0);
  const now = new Date();
  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div className="flex max-w-2xl flex-col gap-2">
        <p className="text-muted-foreground text-sm font-semibold tracking-widest uppercase">
          Before you rest
        </p>
        <WideDialogTitle className="text-4xl font-bold @5xl:text-5xl">
          Tomorrow
        </WideDialogTitle>
        <p className="text-lg">
          A shinobi&apos;s day starts with a few small habits. Here is what will be
          waiting for you.
        </p>
      </div>
      <ul className="grid w-full grid-cols-1 gap-4 text-left @lg:grid-cols-2">
        <ScreenFact icon={<CalendarClock className="h-6 w-6" />} title="Daily streak">
          {today && tomorrow
            ? `Claim day ${today.dayNumber} (${describeStreakReward(today)}) on your Dashboard now, then day ${tomorrow.dayNumber} (${describeStreakReward(tomorrow)}) tomorrow.`
            : tomorrow
              ? `Day ${tomorrow.dayNumber} of your streak (${describeStreakReward(tomorrow)}) waits on your Dashboard tomorrow.`
              : "Claim one day of your streak on your Dashboard every day."}
        </ScreenFact>
        <ScreenFact icon={<Swords className="h-6 w-6" />} title="Daily quest">
          A new daily quest arrives in{" "}
          {getTimeLeftStr(nextUtcDayAt(now).getTime() - now.getTime())}. Find it under
          Quests.
        </ScreenFact>
        <ScreenFact icon={<Dumbbell className="h-6 w-6" />} title="Training">
          {queuedEnergy > 0
            ? `Your queue trains ${queuedEnergy.toLocaleString()} Energy as it refills, even while you're offline.`
            : "Your Energy refills overnight. Queue it at the training grounds to train while you're away."}
        </ScreenFact>
        <ScreenFact icon={<Coins className="h-6 w-6" />} title="Bank">
          {user && user.bank > 0
            ? `You start with ${user.bank.toLocaleString()} ryo in the bank. It earns interest once a day; when it has, press Collect on your Dashboard to take it.`
            : "Ryo in the bank earn interest once a day; when they have, press Collect on your Dashboard to take it."}
        </ScreenFact>
      </ul>
      <ContinueButton onContinue={onContinue} className="@2xl:max-w-sm" />
    </div>
  );
};

/** The single way out of a tutorial screen. */
const ContinueButton: React.FC<{ onContinue: () => void; className?: string }> = ({
  onContinue,
  className,
}) => (
  <Button
    id="tutorial-screen-continue"
    size="xl"
    decoration="gold"
    className={cn("w-full", className)}
    onClick={onContinue}
  >
    Continue
  </Button>
);

const ScreenFact: React.FC<{
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}> = ({ icon, title, children }) => (
  <li className="bg-card flex gap-4 rounded-xl border p-4 @5xl:p-5">
    <span className="bg-primary/10 text-primary h-fit shrink-0 rounded-full p-2">
      {icon}
    </span>
    <span className="flex flex-col gap-1">
      <b className="text-lg">{title}</b>
      <span className="text-muted-foreground text-base">{children}</span>
    </span>
  </li>
);

/** Today's and tomorrow's streak rewards: day 1 is still unclaimed when the screen first shows. */
export const streakDaysAhead = (
  data: RouterOutputs["activityStreak"]["getUserStreaks"] | undefined,
) => {
  const recurring =
    data?.streaks.find((streak) => streak.streakType === "RECURRING") ?? null;
  const rewards = recurring?.allRewards ?? data?.activeRecurringConfig?.rewards ?? [];
  const todayDay = recurring
    ? recurring.canClaimToday
      ? recurring.nextDayNumber
      : null
    : rewards.length
      ? 1
      : null;
  const tomorrowDay = recurring?.alreadyClaimedToday
    ? recurring.nextDayNumber
    : todayDay
      ? todayDay + 1
      : null;
  const find = (day: number | null) =>
    day ? rewards.find((reward) => reward.dayNumber === day) : undefined;
  return { today: find(todayDay), tomorrow: find(tomorrowDay) };
};

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
 * Trials with the experience they would have paid and the jutsu and shuriken their lessons
 * hand out, and pick up at graduation, where the player assigns it, levels up and takes the
 * Genin exam in full. Declining plays the Academy Trials.
 */
export const ExpressTrialsScreen: React.FC<{
  examStep: number;
  onDecline: () => void;
}> = ({ examStep, onDecline }) => {
  const utils = api.useUtils();
  const { updateUser, prepareUserUpdate } = useRequiredUserDataSelector((u) => ({
    userId: u.userId,
  }));
  const { mutate: start, isPending } = api.profile.startExpressTrials.useMutation({
    onMutate: () => ({ userRevision: prepareUserUpdate() }),
    onSuccess: async (result, _variables, context) => {
      showMutationToast(result);
      if (!result.success) return;
      // The granted jutsu and shuriken join the player's jutsu, loadout and item lists.
      void utils.jutsu.getUserJutsus.invalidate();
      void utils.jutsu.getLoadouts.invalidate();
      void utils.item.getUserItems.invalidate();
      // A withheld patch reads the profile again, Road to Genin included.
      await updateUser(result.userPatch, {
        revision: context?.userRevision,
        achievementProgress: result.achievementProgress,
      });
    },
  });
  return (
    <WideDialog className="md:max-w-6xl">
      <div className="@container flex flex-col justify-center gap-5 px-4 py-8">
        <header className="flex flex-col gap-2 text-center">
          <p className="font-semibold text-muted-foreground text-sm uppercase tracking-widest">
            Welcome back
          </p>
          <WideDialogTitle className="text-3xl font-bold">
            Express Trials
          </WideDialogTitle>
          <p className="mx-auto max-w-2xl text-base">
            You know the ropes. Skip the Academy Trials and pick up at graduation with
            the experience they pay and the jutsu and tools they teach.
          </p>
        </header>
        {/* Two columns from @2xl (504px) under the full-width grants, three from @5xl
            (768px), where every list keeps its lines short. */}
        <div className="grid gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3">
          <ExpressList
            title="You receive"
            className="@2xl:col-span-2 @5xl:col-span-1"
            items={[
              `The experience the trials pay, enough for level ${GENIN_EXAM_LEVEL}`,
              "Sonic Slash, learned and equipped",
              `${EXPRESS_TRIALS_SHURIKEN} shuriken in a free item slot`,
            ]}
          />
          <ExpressList
            title="Skipped"
            items={[
              "The arena, training, shop and travel lessons",
              "The missing pup and its fight",
              "The Bondkeeper companion",
              "The trials' other rewards, such as ryo and their badge",
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
        <div className="mx-auto grid w-full max-w-3xl gap-2 @lg:grid-cols-2">
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
    </WideDialog>
  );
};

/** One column of the Express Trials summary. */
const ExpressList: React.FC<{ title: string; items: string[]; className?: string }> = ({
  title,
  items,
  className,
}) => (
  <section className={cn("bg-card rounded-lg border p-3", className)}>
    <h3 className="mb-2 text-base font-semibold">{title}</h3>
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  </section>
);
