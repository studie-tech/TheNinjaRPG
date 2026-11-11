"use client";

import { sendGTMEvent } from "@next/third-parties/google";
import {
  DoorOpen,
  Eye,
  Fingerprint,
  Flame,
  Handshake,
  Info,
  Loader2,
  Medal,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Star,
  Swords,
  Timer,
  UserRoundCheck,
  XCircle,
  Zap,
} from "lucide-react";
import {
  type Dispatch,
  type SetStateAction,
  startTransition,
  useEffect,
  useRef,
  useState,
} from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import type {
  CombatStatName,
  MasteryQueueKind,
  TimedMasteryName,
  TrainingSpeed,
} from "@/drizzle/constants";
import {
  BasicElementName,
  CombatStatNames,
  ELEMENTAL_MASTERY_BOOST,
  ELEMENTAL_MASTERY_CAP,
  ELITE_JONIN_JUTSU_TRAIN_TIME_MULTIPLIER,
  IMG_TRAIN_BUKI_DEF,
  IMG_TRAIN_BUKI_OFF,
  IMG_TRAIN_GEN_DEF,
  IMG_TRAIN_GEN_OFF,
  IMG_TRAIN_INTELLIGENCE,
  IMG_TRAIN_NIN_DEF,
  IMG_TRAIN_NIN_OFF,
  IMG_TRAIN_SPEED,
  IMG_TRAIN_STRENGTH,
  IMG_TRAIN_TAI_DEF,
  IMG_TRAIN_TAI_OFF,
  IMG_TRAIN_WILLPOWER,
  JUTSU_LEVEL_CAP,
  MASTERY_QUEUE_KIND_LABELS,
  MASTERY_RANK_CAPS,
  MAX_DAILY_TRAININGS,
  MAX_JUTSU_TRAIN_TIME_MS,
  MasteryNames,
  SENSEI_JUTSU_TRAINING_BOOST_PERC,
  SENSEI_REQUIRED_RANK,
  SENSEI_STUDENT_RYO_PER_MISSION,
  STATS_PER_ENERGY,
  STEALTH_SENSORY_CAP,
  STEALTH_TRAIN_GAIN_PER_MINUTE,
  TOTAL_MASTERY_CAP,
  TRAINING_CAPTCHA_SOLVED_GRACE_MINUTES,
  TrainingSpeeds,
  TUTORIAL_JUTSU_ID,
} from "@/drizzle/constants";
import type { Jutsu } from "@/drizzle/schema";
import { useTutorialStep } from "@/hooks/tutorial";
import { useJutsuTrainingCacheUpdate } from "@/hooks/useJutsuTrainingCacheUpdate";
import { useMasteryTrainingQueue } from "@/hooks/useMasteryTrainingQueue";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import { ActionSelector } from "@/layout/CombatActions";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import { CovertStatCard } from "@/layout/CovertStatCard";
import { getElementImg } from "@/layout/ElementImage";
import {
  EnergyTrainingQueue,
  useEnergyTrainingQueue,
} from "@/layout/EnergyTrainingQueue";
import Image from "@/layout/Image";
import ItemWithEffects from "@/layout/ItemWithEffects";
import JutsuFiltering, {
  getFilter,
  JutsuStatQuickFilters,
  useFiltering,
} from "@/layout/JutsuFiltering";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { MasteryTrainingQueue } from "@/layout/MasteryTrainingQueue";
import Modal from "@/layout/Modal";
import NavTabs from "@/layout/NavTabs";
import PublicUserComponent from "@/layout/PublicUser";
import QuestPicker from "@/layout/QuestPicker";
import { TimedQueue } from "@/layout/TimedQueue";
import { UserAvatarTile } from "@/layout/UserAvatarTile";
import UserRequestSystem from "@/layout/UserRequestSystem";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { showActionReadinessToast } from "@/libs/actionFeedback";
import {
  actionPrerequisiteUser,
  actionStatusMessage,
  canAttemptAwakeAction,
} from "@/libs/actionReadiness";
import { showTrainingCapcha } from "@/libs/captcha";
import { providedElements } from "@/libs/elementalMastery";
import {
  canTrainJutsu,
  canUseJutsu,
  checkJutsuBloodline,
  checkJutsuRank,
  checkJutsuVillage,
  isJutsuTrainToLearnRestricted,
} from "@/libs/jutsuRequirements";
import { effectiveMasteries } from "@/libs/mastery";
import { getMasteryRank, masteryTotal } from "@/libs/masteryProgression";
import { useInfinitePagination } from "@/libs/pagination";
import { getEnergyQueue, getMasteryQueue } from "@/libs/queue";
import { availableRanks, hasRequiredRank } from "@/libs/rank";
import { calcCurrent } from "@/libs/regeneration";
import { cn } from "@/libs/shadui";
import { getStealthStatus } from "@/libs/stealth";
import { showMutationToast } from "@/libs/toast";
import {
  calcJutsuTrainCost,
  calcJutsuTrainTime,
  findJutsuInTraining,
  getMasteryTrainingState,
  getTrainingSections,
  isJutsuInTraining,
  isStatTrainingCapped,
  masteryTrainingBlockMessage,
  masteryTrainingGainRoom,
  queuedMasteryStartBlockMessage,
  statTrainingBlockMessage,
  trainEfficiency,
  trainingEnergyMessage,
} from "@/libs/train";
import { isTutorialJutsuPickStep } from "@/libs/tutorial";
import type { UserWithRelations } from "@/routers/profile";
import { isInArray } from "@/utils/array";
import { getQueueTotalCapacity, getQueueWaitingSlots } from "@/utils/paypal";
import { useUserPicker } from "@/utils/search";
import { safeLocalStorageSetItem } from "@/utils/storage";
import { capitalizeFirstLetter } from "@/utils/string";
import { getTimeLeftStr } from "@/utils/time";
import { useRequiredUserData, useRequireInVillage } from "@/utils/UserContext";
import type { BaseServerResponse } from "@/validators/base";

// Favorites live on the ranked loadout, whose cleanup drops jutsu ranked cannot use
const isRankedFavoritable = (j: Jutsu) =>
  !j.requiredSkillId && j.battleUsageType !== "PVE" && !j.villageId;

export default function Training() {
  // Ensure user is in village
  const { userData, timeDiff, access } = useRequireInVillage("/traininggrounds");
  const { currentStep } = useTutorialStep();
  // The tutorial selects the panel containing its highlighted training action.
  const focusJutsuTraining = isTutorialJutsuPickStep(currentStep);
  // Null until NavTabs restores the last visited section (or falls back to the first).
  const [section, setSection] = useState<string | null>(null);
  const { data: sidebarTimers } = api.profile.getSidebarTimers.useQuery(undefined, {
    enabled: !!userData && access,
  });

  // While loading userdata
  if (!userData) return <Loader explanation="Loading userdata" />;
  if (!access) return <Loader explanation="Accessing Training Grounds" />;

  // Show sensei component
  const showSenseiSystem =
    userData.rank === "GENIN" || hasRequiredRank(userData.rank, SENSEI_REQUIRED_RANK);
  const energyQueueLength = getEnergyQueue(userData).length;
  const trainingSections = getTrainingSections(showSenseiSystem);

  // Tutorial steps select the panel containing their highlighted action.
  const activeSection = focusJutsuTraining
    ? "Jutsu"
    : currentStep?.advanceOn === "trainStats"
      ? "Stats"
      : section;

  // Every user-driven section change is remembered, including Radix keyboard navigation,
  // which bypasses the NavTabs click handler.
  const sectionStorageKey = `trainingTab:${userData.userId}`;
  const selectSection = (value: string) => {
    safeLocalStorageSetItem(sectionStorageKey, value);
    startTransition(() => setSection(value));
  };

  return (
    <Tabs value={activeSection ?? ""} onValueChange={selectSection}>
      <ContentBox
        title="Training Grounds"
        subtitle="Choose a training activity"
        defaultBackHref="/village"
      >
        <div className="overflow-x-auto overflow-y-hidden">
          <div className="mx-auto w-max min-w-full">
            <NavTabs
              id={sectionStorageKey}
              accessibleTabs
              label="Training activities"
              current={activeSection}
              onChange={setSection}
              options={trainingSections.options}
              aliases={trainingSections.aliases}
              counts={{
                Stats: energyQueueLength,
                Masteries:
                  getMasteryQueue(userData).length +
                  (userData.currentlyTrainingMastery ? 1 : 0),
                Elements:
                  getMasteryQueue(userData, "ELEMENT").length +
                  (userData.currentlyTrainingElement ? 1 : 0),
                Jutsu:
                  (sidebarTimers?.jutsuQueue.count ?? 0) +
                  (sidebarTimers?.jutsuTraining &&
                  isJutsuInTraining(sidebarTimers.jutsuTraining, Date.now() - timeDiff)
                    ? 1
                    : 0),
              }}
              countLabel="in queue"
              iconOnlyOptions={trainingSections.options}
              labelClassName={(option) =>
                option === activeSection ? "not-sr-only" : "sm:not-sr-only"
              }
              icons={{
                Stats: <Swords aria-hidden="true" className="h-4 w-4" />,
                Masteries: <Medal aria-hidden="true" className="h-4 w-4" />,
                Elements: <Flame aria-hidden="true" className="h-4 w-4" />,
                Jutsu: <Zap aria-hidden="true" className="h-4 w-4" />,
                [trainingSections.covertSection]: (
                  <Eye aria-hidden="true" className="h-4 w-4" />
                ),
              }}
              className="min-h-11 whitespace-nowrap px-3 py-2.5 text-sm sm:text-base"
            />
          </div>
        </div>
      </ContentBox>
      <TabsContent value={activeSection ?? ""} className="mt-0">
        {(activeSection === "Stats" ||
          activeSection === "Masteries" ||
          activeSection === "Elements") && (
          <StatsTraining
            userData={userData}
            timeDiff={timeDiff}
            section={activeSection}
          />
        )}
        {activeSection === "Jutsu" && (
          <JutsuTraining userData={userData} timeDiff={timeDiff} />
        )}
        {activeSection === trainingSections.covertSection && (
          <>
            <CovertTraining userData={userData} timeDiff={timeDiff} />
            {showSenseiSystem && <SenseiSystem userData={userData} />}
          </>
        )}
      </TabsContent>
    </Tabs>
  );
}

interface TrainingProps {
  userData: NonNullable<UserWithRelations>;
  timeDiff: number;
}

/** Component for sensei system */
const SenseiSystem: React.FC<Pick<TrainingProps, "userData">> = (props) => {
  const { prepareUserUpdate, updateUser } = useRequiredUserData();
  // Settings
  const { userData } = props;

  // tRPC useUtils
  const utils = api.useUtils();

  // User search
  const maxUsers = 1;
  const { methods: userSearchMethods, user: targetUser } = useUserPicker(maxUsers);

  // Queries
  const { data: students, isFetching } = api.sensei.getStudents.useQuery(
    { userId: userData.userId },
    { enabled: hasRequiredRank(userData.rank, SENSEI_REQUIRED_RANK) },
  );

  const { data: requests } = api.sensei.getRequests.useQuery(undefined, {
    staleTime: 5000,
  });

  /** Report a sensei request change and refresh the open requests. */
  const onRequestChange = async (data: BaseServerResponse) => {
    showMutationToast(data);
    if (data.success) await utils.sensei.getRequests.invalidate();
  };

  // Mutations
  const { mutate: remove, isPending: isRemoving } =
    api.sensei.removeStudent.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.sensei.getRequests.invalidate(),
            utils.sensei.getStudents.invalidate(),
          ]);
        }
      },
    });

  const { mutate: create, isPending: isCreating } =
    api.sensei.createRequest.useMutation({ onSuccess: onRequestChange });

  const { mutate: accept, isPending: isAccepting } =
    api.sensei.acceptRequest.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            updateUser(data, { revision }),
            utils.sensei.getRequests.invalidate(),
            utils.sensei.getStudents.invalidate(),
          ]);
        }
      },
    });

  const { mutate: reject, isPending: isRejecting } =
    api.sensei.rejectRequest.useMutation({ onSuccess: onRequestChange });

  const { mutate: cancel, isPending: isCancelling } =
    api.sensei.cancelRequest.useMutation({ onSuccess: onRequestChange });

  const { mutate: leaveSensei, isPending: isLeaving } =
    api.sensei.leaveSensei.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success) {
          await updateUser(data, { revision });
        }
      },
    });

  // Derived features
  const isPending =
    isFetching ||
    isCreating ||
    isLeaving ||
    isAccepting ||
    isRejecting ||
    isCancelling ||
    isRemoving;
  const canSensei = hasRequiredRank(userData.rank, SENSEI_REQUIRED_RANK);
  const message = canSensei
    ? "Search for Genin to take in as students."
    : "Search for Jonin to be your sensei. ";
  const reward = canSensei
    ? `You receive ${SENSEI_STUDENT_RYO_PER_MISSION} ryo (more with PvP boosts) every time a student completes a mission.`
    : `Jutsu training will be sped up by ${SENSEI_JUTSU_TRAINING_BOOST_PERC}%.`;
  const showRequestSystem = canSensei || !userData.senseiId;
  const showSensei = userData.rank === "GENIN" && userData.senseiId;
  const showStudents = canSensei && students && students.length > 0;

  // Render
  return (
    <div className="relative">
      <div inert={isPending}>
        {/* Show Students */}
        {showStudents && (
          <ContentBox
            title="Students"
            subtitle={`Past and present`}
            initialBreak={true}
          >
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5">
              {students.map((user) => (
                <div className="relative" key={user.userId}>
                  <UserAvatarTile user={user} className="text-center">
                    {user.rank === "GENIN" && (
                      <Confirm
                        title="Remove Student"
                        button={
                          <XCircle className="absolute top-[3%] right-[13%] h-9 w-9 cursor-pointer rounded-full bg-slate-300 p-1 hover:text-orange-500" />
                        }
                        onAccept={(e) => {
                          e.preventDefault();
                          remove({ studentId: user.userId });
                        }}
                      >
                        You are about to remove this user as your student. Confirm?
                      </Confirm>
                    )}
                  </UserAvatarTile>
                </div>
              ))}
            </div>
          </ContentBox>
        )}
        {/* Show Sensei */}
        {showSensei && (
          <div className="flex flex-col gap-2">
            <PublicUserComponent initialBreak userId={showSensei} title="Your Sensei" />
            <Button onClick={() => leaveSensei()}>
              <DoorOpen className="mr-2 h-6 w-6" />
              Leave Sensei
            </Button>
          </div>
        )}
        {/* Show Requests */}
        {showRequestSystem && (
          <ContentBox
            title="Sensei"
            subtitle="Requests from and to"
            initialBreak={true}
            padding={false}
          >
            <div className="p-3">
              <p className="pb-2">{message}</p>
              <p className="pb-2">{reward}</p>
              <UserSearchSelect
                useFormMethods={userSearchMethods}
                showYourself={false}
                showAi={false}
                inline={true}
                maxUsers={maxUsers}
              />
              {targetUser && (
                <Button
                  id="send"
                  className="mt-2 w-full"
                  onClick={() => create({ targetId: targetUser.userId })}
                >
                  <Handshake className="mr-2 h-5 w-5" />
                  Send Request
                </Button>
              )}
            </div>
            {requests && requests.length > 0 && (
              <UserRequestSystem
                isLoading={isAccepting || isRejecting || isCancelling}
                requests={requests}
                userId={userData.userId}
                onAccept={accept}
                onReject={reject}
                onCancel={cancel}
              />
            )}
          </ContentBox>
        )}
      </div>
      {/* Overlay rather than replace the sections, so nothing around them moves */}
      {isPending && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/10 backdrop-blur-sm">
          <Loader explanation="Processing..." />
        </div>
      )}
    </div>
  );
};

/** Interval tabs carry their efficiency, so intervals compare before one is picked. */
const TRAINING_SPEED_LABELS = Object.fromEntries(
  TrainingSpeeds.map((speed) => [
    speed,
    <span key={speed} className="flex flex-col leading-tight">
      <span>{speed}</span>
      <span className="font-normal text-muted-foreground text-xs">
        {trainEfficiency({ trainingSpeed: speed })}%
        <span className="sr-only"> efficiency</span>
      </span>
    </span>,
  ]),
);

/** Timed stat, mastery and element training sessions. */
const StatsTraining: React.FC<
  TrainingProps & { section: "Stats" | "Masteries" | "Elements" }
> = (props) => {
  // Settings
  const { userData, timeDiff } = props;
  const { prepareUserUpdate, updateUser } = useRequiredUserData();
  const kind = props.section === "Elements" ? "ELEMENT" : "MASTERY";
  const session = getMasteryTrainingState(userData, kind);
  const [energy, setEnergy] = useState<number | null>(null);
  const [statTrainingMode, setStatTrainingMode] = useState<"Custom" | "Max" | "Queue">(
    "Max",
  );
  const isQueueingStats = statTrainingMode === "Queue";
  const [queuedMasterySpeeds, setQueuedMasterySpeeds] = useState<
    Partial<Record<MasteryQueueKind, TrainingSpeed>>
  >({});
  const [availableEnergy, setAvailableEnergy] = useState(() =>
    currentTrainingEnergy(userData, timeDiff),
  );
  const trainingEnergy =
    statTrainingMode === "Max"
      ? availableEnergy
      : (energy ?? (isQueueingStats ? userData.maxEnergy : availableEnergy));
  const energyQueueLength = getEnergyQueue(userData).length;
  useEffect(() => {
    const update = () => setAvailableEnergy(currentTrainingEnergy(userData, timeDiff));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [userData, timeDiff]);
  const showCaptcha = showTrainingCapcha(userData);

  // tRPC useUtils
  const utils = api.useUtils();

  // Query
  const { data: captcha } = api.misc.getCaptcha.useQuery(undefined, {
    staleTime: 5000,
    enabled: showCaptcha,
  });
  // A recent solve covers training for a while; the server then returns no image.
  const needsCaptcha = showCaptcha && captcha?.svg !== null;

  // Tutorial management hook
  const { completeTutorialAction } = useTutorialStep();

  // Mutations
  const { mutate: startTraining, isPending: isStarting } =
    api.train.startTraining.useMutation({
      onMutate: () => ({ revision: prepareUserUpdate() }),
      onSuccess: async (result, _variables, context) => {
        showMutationToast(result);
        await Promise.all([
          utils.misc.getCaptcha.invalidate(),
          updateUser(result, {
            revision: context?.revision,
            achievementProgress: result?.achievementProgress,
          }),
        ]);
        if (result.success) {
          sendGTMEvent({ event: "stats_training" });
          void completeTutorialAction("trainStats");
        }
      },
      onError: async () => {
        await Promise.all([
          utils.profile.getUser.invalidate(),
          utils.misc.getCaptcha.invalidate(),
        ]);
      },
    });

  const {
    saveQueue: queueStatTraining,
    isPending: isQueueingEnergy,
    error: energyQueueError,
  } = useEnergyTrainingQueue(async () => {
    await utils.misc.getCaptcha.invalidate();
  });

  const { mutate: startMasteryTraining, isPending: isStartingMastery } =
    api.train.startMasteryTraining.useMutation({
      onMutate: () => ({ revision: prepareUserUpdate() }),
      onSuccess: async (result, _variables, context) => {
        showMutationToast(result);
        await updateUser(result, {
          revision: context?.revision,
          achievementProgress: result?.achievementProgress,
        });
        if (result.success) {
          sendGTMEvent({ event: "mastery_training" });
        }
      },
      onError: () => utils.profile.getUser.invalidate(),
    });

  const { saveQueue: queueMasteryTraining, isPending: isQueueingMastery } =
    useMasteryTrainingQueue();

  const { mutate: stopMasteryTraining, isPending: isStoppingMastery } =
    api.train.stopMasteryTraining.useMutation({
      onMutate: () => ({ revision: prepareUserUpdate() }),
      onSuccess: async (result, _variables, context) => {
        showMutationToast(result);
        await Promise.all([
          utils.misc.getCaptcha.invalidate(),
          updateUser(result, {
            revision: context?.revision,
            achievementProgress: result?.achievementProgress,
          }),
        ]);
      },
      onError: async () => {
        await Promise.all([
          utils.profile.getUser.invalidate(),
          utils.misc.getCaptcha.invalidate(),
        ]);
      },
    });

  const { mutate: changeSpeed, isPending: isChanging } =
    api.train.updateTrainingSpeed.useMutation({
      onSuccess: async (data, variables) => {
        showMutationToast(data);
        if (data.success) {
          await updateUser({ trainingSpeed: variables.speed });
        }
      },
    });

  // A solved captcha covers stat, Energy queue and mastery actions for the grace window,
  // so the training actions themselves send no guess.
  const collectMasteryTraining = () => {
    const { stat, startedAt } = session;
    if (stat && startedAt) stopMasteryTraining({ stat, startedAt });
  };

  const isPending =
    isStarting ||
    isQueueingEnergy ||
    isStartingMastery ||
    isQueueingMastery ||
    isStoppingMastery ||
    isChanging;

  // Convenience definitions
  const trainItemClassName = "hover:opacity-50 hover:cursor-pointer relative";
  const iconClassName = "w-5 h-5 absolute top-1 right-1 text-blue-500";

  const masteryEntries = getMasteryQueue(userData, kind);
  const selectedMasterySpeed =
    session.stat || kind === "ELEMENT"
      ? (queuedMasterySpeeds[kind] ?? session.speed)
      : session.speed;
  const efficiency = trainEfficiency({
    ...userData,
    trainingSpeed: selectedMasterySpeed,
  });

  const renderCaptchaStop = () => {
    if (!needsCaptcha) {
      return (
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Collect and stop ${MASTERY_QUEUE_KIND_LABELS[kind].toLowerCase()} training`}
          disabled={isPending}
          onClick={() => collectMasteryTraining()}
        >
          <XCircle className="h-4 w-4 text-red-600" />
        </Button>
      );
    }
    if (!captcha?.svg) return <Loader explanation="Loading captcha" />;
    return (
      <Popover>
        <PopoverTrigger
          aria-label={`Collect and stop ${MASTERY_QUEUE_KIND_LABELS[kind].toLowerCase()} training`}
          disabled={isPending}
          className="flex h-9 w-9 items-center justify-center"
        >
          <XCircle className="h-4 w-4 text-red-600" />
        </PopoverTrigger>
        <PopoverContent className="w-72">
          <TrainingCaptchaGate
            className="border-0 bg-transparent p-0 shadow-none"
            svg={captcha.svg}
            onVerified={collectMasteryTraining}
          />
        </PopoverContent>
      </Popover>
    );
  };

  // Overlay rather than replace each box, so the sections below keep their place
  const pendingOverlay = isPending && (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/10 backdrop-blur-sm">
      <Loader explanation="Processing..." />
    </div>
  );

  return (
    <>
      {props.section === "Stats" && energyQueueLength > 0 && (
        <EnergyTrainingQueue
          user={userData}
          availableEnergy={availableEnergy}
          refreshCaptcha={async () => {
            await utils.misc.getCaptcha.invalidate();
          }}
        />
      )}
      {props.section === "Stats" && (
        <ContentBox
          title="Combat stats"
          subtitle={isQueueingStats ? "Train as Energy recovers" : "Instant training"}
          initialBreak
          topRightContent={
            // The Energy controls only matter once the captcha check is out of the way
            needsCaptcha ? undefined : (
              <div className="my-2 ml-2 flex flex-col gap-1">
                <div className="flex items-center justify-end gap-1">
                  <Popover>
                    <PopoverTrigger
                      aria-label="About Energy training"
                      className="flex h-9 w-9 items-center justify-center text-violet-500"
                    >
                      <Zap className="h-5 w-5" />
                    </PopoverTrigger>
                    <PopoverContent className="max-w-64 text-sm">
                      Custom trains immediately with the entered Energy amount. Max
                      keeps the amount synced with available Energy. Queue adds training
                      for when the entered Energy threshold recovers, starting with your
                      capacity. Select a stat image to train or add a queue entry. Each
                      Energy gives {STATS_PER_ENERGY} stats before training bonuses.
                    </PopoverContent>
                  </Popover>
                  <div className="flex">
                    <NumberInput
                      id="training-energy"
                      aria-label={isQueueingStats ? "Queued Energy" : "Energy to spend"}
                      min={1}
                      step={1}
                      value={trainingEnergy}
                      disabled={isPending}
                      onValueChange={(value) => {
                        setEnergy(value);
                        if (statTrainingMode === "Max") setStatTrainingMode("Custom");
                      }}
                      className="w-20 rounded-r-none"
                    />
                    <fieldset aria-label="Energy training mode" className="flex">
                      {(["Custom", "Max", "Queue"] as const).map((mode, index) => (
                        <Button
                          key={mode}
                          variant={statTrainingMode === mode ? "default" : "outline"}
                          size="sm"
                          className={cn(
                            "h-9 rounded-none border-l-0 px-2 sm:px-3",
                            index === 2 && "rounded-r-md",
                          )}
                          aria-pressed={statTrainingMode === mode}
                          disabled={isPending}
                          onClick={() => {
                            if (statTrainingMode === mode) return;
                            if (mode === "Custom") setEnergy(trainingEnergy);
                            else if (mode === "Queue") setEnergy(userData.maxEnergy);
                            setStatTrainingMode(mode);
                          }}
                        >
                          {mode}
                        </Button>
                      ))}
                    </fieldset>
                  </div>
                </div>
              </div>
            )
          }
        >
          {userData.status === "ASLEEP" && (
            <p className="mb-4 text-muted-foreground text-sm">
              Actions can wake you up when automatic waking is enabled. Existing queues
              continue while asleep.
            </p>
          )}
          {needsCaptcha ? (
            captcha?.svg ? (
              <TrainingCaptchaGate
                className="mx-auto my-6 max-w-sm"
                svg={captcha.svg}
              />
            ) : (
              <Loader explanation="Loading captcha" />
            )
          ) : (
            /* Inert while pending: the overlay hides the controls from pointers only */
            <div inert={isPending}>
              <div className="grid grid-cols-3 text-center font-bold">
                {CombatStatNames.map((stat, i) => {
                  const label = getTrainingLabel(stat);
                  const overCap = isStatTrainingCapped(userData, stat);
                  const icon =
                    stat === "offence" ? (
                      <Swords className={iconClassName} />
                    ) : stat === "defence" ? (
                      <ShieldAlert className={iconClassName} />
                    ) : (
                      <Fingerprint className={iconClassName} />
                    );
                  return (
                    <button
                      type="button"
                      id={`tutorial-traininggrounds-${stat.toLowerCase()}`}
                      key={`${stat}-${i}`}
                      onClick={() => {
                        const block =
                          statTrainingBlockMessage(actionPrerequisiteUser(userData)) ??
                          (overCap ? "Already capped" : null) ??
                          (isQueueingStats
                            ? energyQueueLength >= getQueueTotalCapacity(userData)
                              ? "Energy queue is full"
                              : !Number.isInteger(trainingEnergy) ||
                                  trainingEnergy <= 0 ||
                                  trainingEnergy > userData.maxEnergy
                                ? "Enter a whole Energy amount between 1 and your capacity."
                                : null
                            : trainingEnergyMessage(trainingEnergy, availableEnergy));
                        if (block)
                          showMutationToast({ success: false, message: block });
                        else if (isQueueingStats) {
                          const entries = getEnergyQueue(userData);
                          queueStatTraining({
                            expectedEntries: entries,
                            entries: [...entries, { stat, energy: trainingEnergy }],
                          });
                        } else
                          startTraining({
                            stat,
                            energy: trainingEnergy,
                          });
                      }}
                      className="relative"
                    >
                      <div
                        className={cn(
                          trainItemClassName,
                          overCap ? "opacity-50 grayscale" : "",
                        )}
                      >
                        <Image
                          src={getTrainingImage(stat)}
                          alt={label}
                          width={256}
                          height={256}
                        />
                        {icon}
                        {label}
                      </div>
                      {overCap && (
                        <UserRoundCheck className="absolute top-[50%] left-[50%] h-10 w-10 translate-x-[-50%] translate-y-[-50%] text-slate-100 hover:cursor-pointer" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {energyQueueError && (
            <p role="alert" className="mt-2 text-destructive text-sm">
              {energyQueueError}
            </p>
          )}
          {pendingOverlay}
        </ContentBox>
      )}
      {props.section !== "Stats" && (
        <MasteryTrainingQueue
          kind={kind}
          user={userData}
          timeDiff={timeDiff}
          getLabel={getTrainingLabel}
          stopControl={renderCaptchaStop()}
          isProcessing={isPending}
        />
      )}
      {props.section !== "Stats" && (
        <ContentBox
          title={props.section}
          subtitle="Timed training · No Energy cost"
          initialBreak={true}
          topRightContent={
            <div className="my-2 ml-2 overflow-x-auto overflow-y-hidden">
              <NavTabs
                current={selectedMasterySpeed}
                options={TrainingSpeeds}
                labels={TRAINING_SPEED_LABELS}
                setValue={(value) => {
                  if (isPending) return;
                  if (session.stat || kind === "ELEMENT") {
                    setQueuedMasterySpeeds((speeds) => ({
                      ...speeds,
                      [kind]: value as TrainingSpeed,
                    }));
                    return;
                  }
                  changeSpeed({ speed: value as TrainingSpeed });
                }}
              />
            </div>
          }
        >
          <div className="mb-3 space-y-2">
            <p className="text-muted-foreground text-xs">
              {efficiency}% efficiency · {userData.dailyTrainings} /{" "}
              {MAX_DAILY_TRAININGS} daily sessions
            </p>
            <p className="text-muted-foreground text-xs">
              {userData.status === "ASLEEP"
                ? "Actions can wake you up when automatic waking is enabled. Existing queues continue while asleep."
                : session.stat
                  ? `Choose an interval, then select ${props.section === "Elements" ? "an element" : "a mastery"} image to add a session to the queue.`
                  : `Choose an interval, then select ${props.section === "Elements" ? "an element" : "a mastery"} image to start training.`}
            </p>
          </div>
          <div inert={isPending}>
            <div className="grid grid-cols-3 text-center font-bold">
              {(props.section === "Elements" ? BasicElementName : MasteryNames).map(
                (stat, i) => {
                  const label = getTrainingLabel(stat);
                  const overCap = masteryTrainingGainRoom(userData, stat) <= 0;
                  const isElement = isInArray(stat, BasicElementName);
                  const masteryRank = !isElement
                    ? getMasteryRank(userData, stat)
                    : null;
                  const value = isElement
                    ? (userData.elementalMastery[stat] ?? 0)
                    : userData[stat];
                  const cap = masteryRank
                    ? MASTERY_RANK_CAPS[masteryRank]
                    : ELEMENTAL_MASTERY_CAP;
                  const tile = (
                    <button
                      type="button"
                      id={`tutorial-traininggrounds-${stat.toLowerCase()}`}
                      key={`${stat}-${i}`}
                      onClick={() => {
                        const entry = { stat, speed: selectedMasterySpeed };
                        const block = !canAttemptAwakeAction(userData)
                          ? actionStatusMessage(userData.status)
                          : session.stat
                            ? (queuedMasteryStartBlockMessage(userData, entry) ??
                              (masteryEntries.length >= getQueueWaitingSlots(userData)
                                ? `${MASTERY_QUEUE_KIND_LABELS[kind]} queue is full`
                                : null))
                            : masteryTrainingBlockMessage(
                                actionPrerequisiteUser(userData),
                                {
                                  ...session,
                                  speed: selectedMasterySpeed,
                                },
                              );
                        if (block)
                          showMutationToast({ success: false, message: block });
                        else if (overCap)
                          showMutationToast({
                            success: false,
                            message: isElement
                              ? providedElements(userData).includes(stat)
                                ? "Already provided by your innate elements or bloodline"
                                : "Elemental mastery is fully capped"
                              : "Mastery capped. Complete its rank-up exam or free space under the total cap.",
                          });
                        else if (session.stat)
                          queueMasteryTraining({
                            kind,
                            expectedEntries: masteryEntries,
                            entries: [...masteryEntries, entry],
                          });
                        else
                          startMasteryTraining({ stat, speed: selectedMasterySpeed });
                      }}
                      className="relative"
                    >
                      <div
                        className={cn(
                          trainItemClassName,
                          overCap ? "opacity-50 grayscale" : "",
                        )}
                      >
                        <Image
                          src={getTrainingImage(stat)}
                          alt={label}
                          width={256}
                          height={256}
                        />
                        <Medal className={iconClassName} />
                        {label}
                        <div className="font-normal text-xs">
                          {isElement && providedElements(userData).includes(stat)
                            ? "Already provided · "
                            : masteryRank && `${capitalizeFirstLetter(masteryRank)} · `}
                          {value.toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })}{" "}
                          / {cap.toLocaleString()}
                        </div>
                      </div>
                      {overCap && (
                        <UserRoundCheck className="absolute top-[50%] left-[50%] h-10 w-10 translate-x-[-50%] translate-y-[-50%] text-slate-100 hover:cursor-pointer" />
                      )}
                    </button>
                  );
                  if (stat !== "sageMastery") return tile;
                  // The info button sits beside the tile, not inside it, so opening
                  // it can never start training.
                  return (
                    <div key={`${stat}-${i}`} className="relative">
                      {tile}
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute top-0 left-0 size-7"
                            aria-label="About Sage training"
                          >
                            <Info className="size-4" aria-hidden="true" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="max-w-64 text-sm">
                          Trains Sage Mastery for jutsu and item requirements. Sage Mode
                          rank comes from rewards, including quests.
                        </PopoverContent>
                      </Popover>
                    </div>
                  );
                },
              )}
            </div>
          </div>
          <p className="mt-3 text-sm">
            {props.section === "Elements" ? (
              <>
                Each element has its own cap and adds no character XP. Fully mastering
                it unlocks an additional element with a {ELEMENTAL_MASTERY_BOOST}%
                damage boost; select one in{" "}
                <Link href="/profile/edit" className="underline">
                  Combat Preferences
                </Link>
                .{" "}
                <Link href="/profile/experience" className="underline">
                  Invest unused experience
                </Link>
                .
              </>
            ) : (
              <>
                Earned mastery total: {masteryTotal(userData).toLocaleString()} /{" "}
                {TOTAL_MASTERY_CAP.toLocaleString()}. Rank-up exams use earned mastery;
                equipment and bloodline bonuses do not count.
              </>
            )}
          </p>
          {pendingOverlay}
        </ContentBox>
      )}
      {props.section === "Masteries" && (
        <QuestPicker
          questType="mastery"
          title="Mastery Rank-Up Exams"
          subtitle="Complete an available exam to advance your mastery rank"
          unavailableText="No exams available. Published exams unlock when you meet their earned mastery and previous rank requirements."
          initialBreak
        />
      )}
    </>
  );
};

/** Component for jutsu training */
const JutsuTraining: React.FC<TrainingProps> = (props) => {
  // Settings
  const { userData, timeDiff } = props;
  const { prepareUserUpdate, updateUser } = useRequiredUserData();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [jutsu, setJutsu] = useState<Jutsu | undefined>(undefined);
  // Successive levels of the selected jutsu to buy in one go
  const [levelCount, setLevelCount] = useState<number>(1);
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  // finishTraining is a server timestamp; compare it on the server clock, the same one
  // the countdown and the server's training guards use. The clock is state so typing in
  // the confirm dialog reuses the sorted list; it moves when a training ends or the rows
  // change, since the refetch after a finished countdown can return the same rows.
  const [clientNow, setClientNow] = useState(() => Date.now());
  const serverNow = clientNow - timeDiff;

  // tRPC useUtils
  const utils = api.useUtils();

  // Two-level filtering
  const [initialRanks] = useState(() => availableRanks(userData.rank));
  const state = useFiltering(initialRanks);
  const previousRank = useRef(userData.rank);

  // Rank changes update only ranks, preserving other filters and mount-time defaults.
  useEffect(() => {
    if (previousRank.current === userData.rank) return;
    previousRank.current = userData.rank;
    state.setRank(availableRanks(userData.rank));
  }, [userData.rank, state.setRank]);

  // Favorites are shared with the ranked loadout builder (same stored list & star)
  const { data: rankedLoadout, isError: isLoadoutUnavailable } =
    api.pvpRank.getRankedLoadout.useQuery(undefined);
  // Ownership and queue data also determine the catalogue's opening priority.
  const {
    data: userJutsus,
    isPending: isRefetchingUserJutsu,
    isError: isOwnershipUnavailable,
  } = api.jutsu.getUserJutsus.useQuery({});
  useEffect(() => {
    if (userJutsus) setClientNow(Date.now());
  }, [userJutsus]);
  useRefreshAt(
    (userJutsus ?? []).map((owned) => owned.finishTraining),
    () => setClientNow(Date.now()),
    timeDiff,
  );
  const userJutsuById = new Map(
    (userJutsus ?? []).map((owned) => [owned.jutsuId, owned]),
  );
  const { data: trainingQueue, isError: isQueueUnavailable } =
    api.jutsu.getTrainingQueue.useQuery(undefined);
  // Keep priorities fixed across offset pages; later favorite/training changes re-sort
  // loaded rows locally. Ownership-level changes reconcile the catalogue in the cache hook.
  const [listPriorities, setListPriorities] = useState<{
    favoriteIds: string[];
    trainingIds: string[];
  } | null>(null);
  useEffect(() => {
    if (listPriorities !== null) return;
    if (!rankedLoadout && !isLoadoutUnavailable) return;
    if (!userJutsus && !isOwnershipUnavailable) return;
    if (!trainingQueue && !isQueueUnavailable) return;
    setListPriorities({
      favoriteIds: rankedLoadout?.loadout.favoriteJutsuIds ?? [],
      trainingIds: [
        ...(userJutsus ?? [])
          .filter((owned) => isJutsuInTraining(owned, Date.now() - timeDiff))
          .map((owned) => owned.jutsuId),
        ...(trainingQueue?.waiting ?? []).map((job) => job.jutsuId),
      ],
    });
  }, [
    listPriorities,
    rankedLoadout,
    isLoadoutUnavailable,
    userJutsus,
    isOwnershipUnavailable,
    trainingQueue,
    isQueueUnavailable,
    timeDiff,
  ]);

  // Jutsus
  const {
    data: jutsus,
    isFetching,
    fetchNextPage,
    hasNextPage,
  } = api.jutsu.getAll.useInfiniteQuery(
    // Favorites and learned jutsu come first, so later pages only add new ones below them.
    {
      limit: 100,
      hideAi: true,
      ownedFirst: true,
      favoriteIds: listPriorities?.favoriteIds.slice(0, 500),
      trainingIds: listPriorities?.trainingIds.slice(0, 500),
      ...getFilter(state),
    },
    {
      enabled: listPriorities !== null,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  // Get user students
  const { data: students } = api.sensei.getStudents.useQuery({
    userId: userData.userId,
  });

  // Worn gear and activated skills raise masteries, as the server's training gate counts
  const { data: userItems } = api.item.getUserItems.useQuery(undefined);
  const masteries = effectiveMasteries({
    ...userData,
    items: userItems ?? [],
  });

  const userJutsuCounts = userJutsus?.map((userJutsu) => {
    return {
      id: userJutsu.jutsuId,
      quantity: isJutsuInTraining(userJutsu, serverNow)
        ? userJutsu.level - 1
        : userJutsu.level,
    };
  });

  // Tutorial management hook
  const { currentStep, completeTutorialAction } = useTutorialStep();
  const isJutsuPickStep = isTutorialJutsuPickStep(currentStep);

  const { data: tutorialJutsu } = api.jutsu.get.useQuery(
    { id: TUTORIAL_JUTSU_ID },
    { enabled: isJutsuPickStep },
  );

  const { prepareTrainingUpdate, updateTraining, refreshTraining } =
    useJutsuTrainingCacheUpdate();
  // Mutations
  const { mutate: train, isPending: isStartingTrain } =
    api.jutsu.startTraining.useMutation({
      onMutate: () => ({
        revision: prepareUserUpdate(),
        training: prepareTrainingUpdate(),
      }),
      onSuccess: async (result, variables, context) => {
        showMutationToast(result);
        if (!result.success && result.userRecovery)
          await updateUser(result, { revision: context.revision, refetch: false });
        if (result.success && result.data) {
          sendGTMEvent({ event: "jutsu_training" });
          await updateUser(result, { revision: context.revision, refetch: false });
          if (variables.jutsuId === TUTORIAL_JUTSU_ID) {
            void completeTutorialAction("trainJutsu");
          }
        }
        await updateTraining(result, context.training);
      },
      onError: async (error, _input, context) => {
        showMutationToast({ success: false, message: error.message });
        await updateTraining(undefined, context?.training ?? prepareTrainingUpdate());
      },
      onSettled: () => {
        setIsOpen(false);
        setJutsu(undefined);
      },
    });

  const { mutate: cancel, isPending: isStoppingTrain } =
    api.jutsu.stopTraining.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await refreshTraining();
      },
      onSettled: () => {
        setIsOpen(false);
        setJutsu(undefined);
      },
    });

  const { mutate: cancelQueued, isPending: isCancellingQueued } =
    api.jutsu.cancelQueuedTraining.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        await refreshTraining();
        if (data.success) {
          await updateUser(undefined, { revision, delta: data.userDelta });
        }
      },
    });

  // Mutation loading
  const isPending = isStartingTrain || isStoppingTrain || isCancellingQueued;

  const favoriteJutsuIds = rankedLoadout?.loadout.favoriteJutsuIds ?? [];
  const { mutate: saveFavorites, isPending: isSavingFavorite } =
    api.pvpRank.updateRankedLoadout.useMutation({
      onSuccess: async (data) => {
        if (!data.success) showMutationToast(data);
        await utils.pvpRank.getRankedLoadout.invalidate();
      },
    });
  const toggleFavorite = (jutsuId: string) => {
    if (!rankedLoadout || isSavingFavorite) return;
    saveFavorites({
      ...rankedLoadout.loadout,
      favoriteJutsuIds: favoriteJutsuIds.includes(jutsuId)
        ? favoriteJutsuIds.filter((id) => id !== jutsuId)
        : [...favoriteJutsuIds, jutsuId],
    });
  };

  // Jutsu in active training or waiting in the queue, shown right after favorites
  const trainingJutsuIds = new Set([
    ...(userJutsus ?? [])
      .filter((uj) => isJutsuInTraining(uj, serverNow))
      .map((uj) => uj.jutsuId),
    ...(trainingQueue?.waiting ?? []).map((job) => job.jutsuId),
  ]);

  // Selecting a jutsu restyles every tile of the grid and mounts or unmounts the confirm
  // modal; as a transition, that render does not block the tap's next paint.
  const setJutsuConfirmOpen: Dispatch<SetStateAction<boolean>> = (open) => {
    const next = typeof open === "function" ? open(isOpen) : open;
    startTransition(() => {
      setIsOpen(next);
      if (!next) setJutsu(undefined);
      setLevelCount(1);
    });
  };

  // Collect all ancestor jutsu IDs that the user has evolved past
  const evolvedAncestorIds = new Set<string>();
  for (const uj of userJutsus ?? []) {
    for (const id of uj.ancestorIds) evolvedAncestorIds.add(id);
  }

  // Filtering jutsus
  const alljutsus =
    jutsus?.pages
      .flatMap((page) => page.data)
      .filter((j) => {
        if (j.parentJutsuId)
          return (
            // Training/leveling is item-free, so ignore the bloodline item requirement here
            canUseJutsu(j, userData, true, masteries, true) && userJutsuById.has(j.id)
          );
        return canTrainJutsu(j, userData, masteries);
      })
      .filter((j) => !evolvedAncestorIds.has(j.id))
      .filter(
        (j) => userJutsuById.has(j.id) || !isJutsuTrainToLearnRestricted(j.jutsuType),
      )
      .map((j) => {
        const uj = userJutsuById.get(j.id);
        return {
          ...j,
          level: uj?.level || 0,
          highlight: isJutsuPickStep && j.id === TUTORIAL_JUTSU_ID,
          isFavorite: favoriteJutsuIds.includes(j.id),
        };
      })
      .filter((j) => j.level < JUTSU_LEVEL_CAP)
      // Favorites first, then jutsu in training/queued, then highest level
      .sort(
        (a, b) =>
          Number(b.isFavorite) - Number(a.isFavorite) ||
          Number(trainingJutsuIds.has(b.id)) - Number(trainingJutsuIds.has(a.id)) ||
          b.level - a.level,
      ) ?? [];

  const tutorialJutsuLevel =
    userJutsus?.find((uj) => uj.jutsuId === TUTORIAL_JUTSU_ID)?.level || 0;
  if (
    isJutsuPickStep &&
    tutorialJutsu &&
    canTrainJutsu(tutorialJutsu, userData, masteries) &&
    // The list drops capped jutsu; pinning one back would show a tile whose
    // confirm modal can only say "Level capped".
    tutorialJutsuLevel < JUTSU_LEVEL_CAP &&
    !alljutsus.some((j) => j.id === tutorialJutsu.id)
  ) {
    alljutsus.unshift({
      // jutsu.get carries no relations, unlike the paginated jutsu.getAll rows
      bloodline: null,
      ...tutorialJutsu,
      level: tutorialJutsuLevel,
      highlight: true,
      isFavorite: favoriteJutsuIds.includes(tutorialJutsu.id),
    });
  } else if (isJutsuPickStep) {
    const pinnedIdx = alljutsus.findIndex((j) => j.id === TUTORIAL_JUTSU_ID);
    if (pinnedIdx > 0) {
      const [pinned] = alljutsus.splice(pinnedIdx, 1);
      if (pinned) alljutsus.unshift(pinned);
    }
  }

  // Training time
  const finishTrainingAt = findJutsuInTraining(userJutsus, serverNow);

  // Derived calculations. Behind an active training the level is queued: it builds on
  // the stored level plus the levels of this jutsu already waiting.
  const queuedJobs = trainingQueue?.waiting ?? [];
  const isQueueing = !!finishTrainingAt?.finishTraining || queuedJobs.length > 0;
  const isQueueFull =
    isQueueing &&
    (finishTrainingAt?.finishTraining ? 1 : 0) + queuedJobs.length >=
      (trainingQueue?.capacity ?? 1);
  const level = isQueueing
    ? (queuedJobs.filter((job) => job.jutsuId === jutsu?.id).at(-1)?.level ??
      userJutsus?.find((uj) => uj.jutsuId === jutsu?.id)?.level ??
      0)
    : userJutsuCounts?.find((entry) => entry.id === jutsu?.id)?.quantity || 0;
  // The same jutsu can be bought several levels at once, up to the free queue slots
  // (all of them, the active one included, when nothing is training) and the level cap.
  const freeSlots =
    (trainingQueue?.capacity ?? 1) -
    (finishTrainingAt?.finishTraining ? 1 : 0) -
    queuedJobs.length;
  const maxLevelCount = Math.max(1, Math.min(freeSlots, JUTSU_LEVEL_CAP - level));
  const count = Math.min(levelCount || 1, maxLevelCount);
  const countLevels = Array.from({ length: count }, (_, i) => level + i);
  const trainTimeLabel =
    jutsu &&
    getTimeLeftStr(
      countLevels.reduce(
        (sum, lvl) => sum + calcJutsuTrainTime(jutsu, lvl, userData),
        0,
      ),
    );
  const cost =
    (jutsu &&
      countLevels.reduce(
        (sum, lvl) => sum + calcJutsuTrainCost(jutsu, lvl, userData, students),
        0,
      )) ||
    0;
  const okRank = checkJutsuRank(jutsu?.jutsuRank, userData.rank);
  const okVillage = checkJutsuVillage(jutsu, userData);
  const okBloodline = checkJutsuBloodline(jutsu, userData);
  const canAfford = cost && userData.money >= cost;
  const isCapped = level >= JUTSU_LEVEL_CAP;
  const canTrain =
    okRank &&
    okVillage &&
    okBloodline &&
    !isCapped &&
    canAfford &&
    !isQueueFull &&
    Number.isFinite(levelCount);

  // Label for proceed button
  let proceed_label: string | undefined;
  if (!isPending && !isCapped) {
    if (!Number.isFinite(levelCount)) {
      proceed_label = "Enter a number of levels";
    } else if (!canAfford) {
      proceed_label = `Need ${cost - userData.money} more ryo`;
    } else if (isCapped) {
      proceed_label = `Level capped`;
    } else if (!okRank) {
      proceed_label = `Cannot train ${jutsu?.jutsuRank} rank`;
    } else if (!okVillage) {
      proceed_label = `Wrong village`;
    } else if (!okBloodline) {
      proceed_label = `Wrong bloodline`;
    } else if (isQueueFull) {
      proceed_label = `Training queue full`;
    } else if (trainTimeLabel && cost) {
      proceed_label = `${isQueueing ? "Queue" : "Train"}${count > 1 ? ` ${count} levels` : ""} [${trainTimeLabel}, ${cost} ryo]`;
    }
  }

  const activeTraining = finishTrainingAt?.finishTraining
    ? {
        title: finishTrainingAt.jutsu?.name ?? "Jutsu",
        detail: `level ${finishTrainingAt.level}`,
        finishesAt: finishTrainingAt.finishTraining,
        stopControl: isRefetchingUserJutsu ? undefined : (
          <Confirm
            title="Stop jutsu training"
            disabled={isPending}
            triggerLabel="Stop training (no refund)"
            button={
              <span className="flex h-9 w-9 items-center justify-center">
                <XCircle className="h-4 w-4 text-red-600" aria-hidden />
              </span>
            }
            proceed_label="Stop training"
            proceed_loading_label="Stopping"
            confirmClassName="bg-red-600 text-white hover:bg-red-700"
            isLoading={isStoppingTrain}
            keepOpenOnAccept
            onAccept={(_e, { close }) =>
              cancel(undefined, {
                onSuccess: (data) => {
                  if (data.success) close();
                },
              })
            }
          >
            <p>
              Stop training {finishTrainingAt.jutsu?.name ?? "this jutsu"} to level{" "}
              {finishTrainingAt.level}? It has{" "}
              <Countdown
                targetDate={finishTrainingAt.finishTraining}
                timeDiff={timeDiff}
              />{" "}
              left. The level is not gained, and the ryo paid for it is not refunded.
            </p>
          </Confirm>
        ),
      }
    : null;

  return (
    <>
      {(activeTraining || queuedJobs.length > 0) && (
        <TimedQueue
          title="Jutsu training queue"
          subtitle="Levels that start when the active training ends"
          capacity={trainingQueue?.capacity ?? 1}
          help="Select a jutsu while another is training to queue its next level. Its ryo is paid when queued and refunded if you cancel it before it starts. Queued levels start one after another, also while you are offline; a level that became cheaper by then refunds the difference."
          active={activeTraining}
          waiting={queuedJobs.map((job) => ({
            id: job.id,
            title: job.name,
            detail: `to level ${job.level}, ${job.reservedRyo.toLocaleString()} ryo`,
            startsAt: job.startsAt,
            finishesAt: job.finishesAt,
          }))}
          cancelLabel="Cancel and refund"
          onCancel={(queueId) => cancelQueued({ queueId })}
          isPending={isPending}
          timeDiff={timeDiff}
          emptyText="Nothing in training. Select a jutsu below to start."
          onActiveFinish={async () => {
            setClientNow(Date.now());
            await refreshTraining();
          }}
        />
      )}
      <ContentBox
        title="Techniques"
        subtitle="Jutsu Techniques"
        initialBreak
        topRightContent={
          <JutsuFiltering state={state} fixedBloodline={userData.bloodlineId} />
        }
      >
        <JutsuStatQuickFilters state={state} />
        {/* Bound the selector's scroll area; retain its height while jutsu load. */}
        <div className={cn("pt-3", !jutsus && "min-h-[320px]")}>
          <div
            id="jutsu-training-picker"
            className="max-h-[min(60vh,32rem)] overflow-y-auto overscroll-contain pr-1"
          >
            <ActionSelector
              gridClassNameOverwrite="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))]"
              items={alljutsus}
              counts={userJutsuCounts}
              selectedId={jutsu?.id}
              labelSingles={true}
              emptyText="No jutsu available for your rank"
              onClick={(id) => {
                if (id === jutsu?.id) {
                  setJutsuConfirmOpen(false);
                } else {
                  const selected = alljutsus?.find((jutsu) => jutsu.id === id);
                  startTransition(() => {
                    setJutsu(selected);
                    setLevelCount(1);
                    setIsOpen(true);
                  });
                }
              }}
              showBgColor={false}
              showLabels={true}
              setLastElement={setLastElement}
            />
          </div>
          {isOpen && jutsu && (
            <Modal
              id="tutorial-traininggrounds-trainJutsu"
              title="Confirm Purchase"
              proceed_label={proceed_label}
              proceedDisabled={!Number.isFinite(levelCount)}
              isOpen={isOpen}
              setIsOpen={setJutsuConfirmOpen}
              keepOpenOnAccept
              onClose={() => startTransition(() => setJutsu(undefined))}
              onAccept={() => {
                if (canTrain && !isPending) {
                  train({ jutsuId: jutsu.id, levels: count });
                } else {
                  setJutsuConfirmOpen(false);
                }
              }}
              confirmClassName={
                canTrain
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "bg-red-600 text-white hover:bg-red-700"
              }
            >
              <div className="relative">
                <p className="pb-3">
                  You have {userData.money.toLocaleString()} ryo in your pocket
                </p>
                {jutsu.requiredRank === "ELITE JONIN" && (
                  <p className="pb-3 text-muted-foreground text-sm">
                    Elite Jonin jutsu take {ELITE_JONIN_JUTSU_TRAIN_TIME_MULTIPLIER}× as
                    long to train, up to{" "}
                    {(MAX_JUTSU_TRAIN_TIME_MS *
                      ELITE_JONIN_JUTSU_TRAIN_TIME_MULTIPLIER) /
                      3_600_000}{" "}
                    hours per level. Training Grounds cap: level {JUTSU_LEVEL_CAP}.
                  </p>
                )}
                {!isPending && maxLevelCount > 1 && (
                  <div className="mb-3 rounded-lg bg-slate-100 p-3 dark:bg-slate-800">
                    <label
                      htmlFor="jutsu-level-count"
                      className="mb-2 block font-medium text-sm"
                    >
                      Levels to {isQueueing ? "queue" : "train"} (Max: {maxLevelCount})
                    </label>
                    <NumberInput
                      id="jutsu-level-count"
                      inputMode="numeric"
                      min={1}
                      max={maxLevelCount}
                      value={levelCount}
                      onValueChange={setLevelCount}
                      emptyFallback={1}
                      className="w-full"
                    />
                    <p className="mt-2 text-muted-foreground text-xs">
                      {count > 1
                        ? `Levels ${level + 1}-${level + count}, trained one after another. Each level is priced at the level it trains.`
                        : `Level ${level + 1}. Raise this to queue further levels of the same jutsu.`}
                    </p>
                  </div>
                )}
                {!isPending && isRankedFavoritable(jutsu) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mb-3 flex items-center gap-2"
                    disabled={!rankedLoadout || isSavingFavorite}
                    onClick={() => toggleFavorite(jutsu.id)}
                  >
                    {isSavingFavorite ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Saving
                      </>
                    ) : (
                      <>
                        <Star
                          className={`h-4 w-4 ${favoriteJutsuIds.includes(jutsu.id) ? "fill-yellow-400 text-yellow-400" : "text-gray-400"}`}
                        />
                        {favoriteJutsuIds.includes(jutsu.id)
                          ? "Unfavorite"
                          : "Favorite"}
                      </>
                    )}
                  </Button>
                )}
                {!isPending && (
                  <ItemWithEffects
                    item={jutsu}
                    key={jutsu.id}
                    showStatistic="jutsu"
                    showEvolutions
                  />
                )}
                {isPending && <Loader explanation={`Training ${jutsu.name}`} />}
              </div>
            </Modal>
          )}
        </div>
        {/* The list can be taller than the screen, so the loader sticks in view */}
        {(isFetching || listPriorities === null) && (
          <div className="absolute inset-0 z-10 bg-slate-950/10 backdrop-blur-sm">
            <div className="sticky top-24 flex justify-center py-16">
              <Loader explanation="Loading jutsu" />
            </div>
          </div>
        )}
      </ContentBox>
    </>
  );
};

/** Component for covert operations training (stealth & sensory) */
const CovertTraining: React.FC<TrainingProps> = (props) => {
  const { userData, timeDiff } = props;
  const { prepareUserUpdate, updateUser } = useRequiredUserData();

  // Stealth status derived from userData
  const stealthStatus = getStealthStatus(
    userData,
    STEALTH_SENSORY_CAP,
    STEALTH_TRAIN_GAIN_PER_MINUTE,
    timeDiff,
  );

  // Training mutation
  const { mutate: trainCovert, isPending: isTrainingCovert } =
    api.stealth.trainCovert.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, variables, revision) => {
        showActionReadinessToast(data);
        if (data.success && data.data) {
          // Derive start time from server-provided finish time to avoid clock-skew issues
          const covertTrainingStartedAt = new Date(
            data.data.covertTrainingFinishAt.getTime() - variables.minutes * 60_000,
          );
          await updateUser(
            {
              covertTrainingType: variables.type,
              covertTrainingStartedAt,
              covertTrainingMinutes: variables.minutes,
            },
            { revision, refetch: false, userRecovery: data.userRecovery },
          );
        } else {
          if (data.userRecovery) await updateUser(data, { revision });
          showMutationToast(data);
        }
      },
    });

  const { mutate: stopTraining, isPending: isStoppingTraining } =
    api.stealth.stopCovertTraining.useMutation({
      onSuccess: async (data) => {
        if (data.success && data.data) {
          const statUpdate =
            stealthStatus.covertTrainingType === "stealth"
              ? { stealth: data.data.newValue }
              : { sensory: data.data.newValue };
          await updateUser({
            covertTrainingType: null,
            covertTrainingStartedAt: null,
            covertTrainingMinutes: null,
            ...statUpdate,
          });
        } else {
          showMutationToast(data);
        }
      },
    });

  const { mutate: cancelTraining, isPending: isCancellingTraining } =
    api.stealth.cancelCovertTraining.useMutation({
      onSuccess: async (data) => {
        if (data.success) {
          await updateUser({
            covertTrainingType: null,
            covertTrainingStartedAt: null,
            covertTrainingMinutes: null,
          });
        } else {
          showMutationToast(data);
        }
      },
    });

  // Check if currently training
  const isTraining = !!stealthStatus.covertTrainingType;
  const trainingType = stealthStatus.covertTrainingType;
  const trainingFinishAt = stealthStatus.covertTrainingFinishAt;
  const trainingGain = stealthStatus.covertTrainingGain;

  return (
    <ContentBox
      title="Covert Operations"
      subtitle="Stealth & Sensory Training"
      initialBreak={true}
    >
      <div className="space-y-6">
        {/* Training Overlay - shown when training is in progress */}
        {isTraining && trainingFinishAt && (
          <div className="relative rounded-lg border bg-background p-6">
            <div className="flex flex-col items-center justify-center space-y-4 text-center">
              <div className="font-semibold text-lg">
                Training {trainingType === "stealth" ? "Stealth" : "Sensory"}
              </div>
              <div className="font-bold text-3xl">
                <Countdown targetDate={trainingFinishAt} timeDiff={timeDiff} />
              </div>
              {trainingGain && (
                <div className="text-muted-foreground text-sm">
                  Expected gain: +{trainingGain.toFixed(0)} points
                </div>
              )}
              <div className="flex gap-2">
                <Button onClick={() => stopTraining()} disabled={isStoppingTraining}>
                  {isStoppingTraining ? "Collecting..." : "Collect Reward"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => cancelTraining()}
                  disabled={isCancellingTraining}
                >
                  <XCircle className="mr-1 h-4 w-4" />
                  {isCancellingTraining ? "Cancelling..." : "Cancel"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Skill sections - hidden when training */}
        {!isTraining &&
          (["stealth", "sensory"] as const).map((type) => (
            <CovertStatCard
              key={type}
              kind={type}
              status={stealthStatus}
              actions={[10, 30].map((minutes) => (
                <Button
                  key={minutes}
                  onClick={() => trainCovert({ type, minutes })}
                  disabled={
                    isTrainingCovert ||
                    (stealthStatus[type] / STEALTH_SENSORY_CAP) * 100 >= 100
                  }
                  className="w-full"
                >
                  <Timer className="mr-1 h-4 w-4" />
                  {isTrainingCovert ? "Starting..." : `Train ${minutes} min`}
                </Button>
              ))}
            />
          ))}

        {/* Info Box */}
        <div className="rounded-lg border border-border bg-muted p-4 text-sm">
          <h4 className="mb-2 font-bold">How Covert Operations Work</h4>
          <ul className="list-inside list-disc space-y-1 text-muted-foreground">
            <li>
              <b>Stealth:</b> Go undetected in enemy territory. Higher stat = longer
              duration and better chance to stay hidden when performing actions.
            </li>
            <li>
              <b>Sensory:</b> Detect stealthed enemies. Higher stat = better detection
              chance and shorter cooldown.
            </li>
            <li>Actions like attacking or robbing may break your stealth.</li>
            <li>Being attacked will always break your stealth.</li>
          </ul>
        </div>
      </div>
    </ContentBox>
  );
};

/**
 * Training captcha check: the server-rendered image, a control that swaps it for a new
 * one, and an answer field. A correct answer covers training for the grace window.
 */
const TrainingCaptchaGate: React.FC<{
  svg: string;
  className?: string;
  onVerified?: () => void;
}> = ({ svg, className, onVerified }) => {
  const utils = api.useUtils();
  const [guess, setGuess] = useState("");
  const { mutate: refreshCaptcha, isPending: isRefreshing } =
    api.misc.refreshCaptcha.useMutation({
      onSuccess: async (result) => {
        if (!result.success) {
          showMutationToast(result);
          return;
        }
        await utils.misc.getCaptcha.invalidate();
        setGuess("");
      },
    });
  const { mutate: verifyCaptcha, isPending: isVerifying } =
    api.misc.verifyCaptcha.useMutation({
      onSuccess: async (result) => {
        // A wrong answer consumes the captcha, so either way a fresh state is fetched
        await utils.misc.getCaptcha.invalidate();
        setGuess("");
        if (!result.success) {
          showMutationToast(result);
          return;
        }
        onVerified?.();
      },
    });
  return (
    <div
      className={cn("bg-card rounded-xl border p-4 text-center shadow-sm", className)}
    >
      <div className="flex items-center justify-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <p className="font-semibold">Quick check</p>
      </div>
      <p className="mt-1 text-muted-foreground text-sm">
        Type the characters below to keep training. One check covers the next{" "}
        {TRAINING_CAPTCHA_SOLVED_GRACE_MINUTES} minutes.
      </p>
      <div className="mt-3 flex items-center justify-center gap-2">
        {/* biome-ignore lint/performance/noImgElement: SVG captcha requires img element for data URI */}
        <img
          alt="Captcha: type these characters into the field below"
          className="h-auto min-w-0 max-w-full rounded-lg border"
          src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
        />
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="shrink-0"
          aria-label="New captcha"
          title="New captcha"
          disabled={isRefreshing || isVerifying}
          onClick={() => refreshCaptcha()}
        >
          <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
        </Button>
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (guess.trim()) verifyCaptcha({ guess });
        }}
      >
        <Input
          aria-label="Captcha answer"
          placeholder="Your answer"
          className="text-center font-mono uppercase tracking-[0.3em] placeholder:font-sans placeholder:normal-case placeholder:tracking-normal"
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={20}
          value={guess}
          onChange={(e) => setGuess(e.target.value)}
        />
        <Button type="submit" disabled={!guess.trim() || isVerifying}>
          {isVerifying ? "Checking…" : "Verify"}
        </Button>
      </form>
    </div>
  );
};

/** Each tile gets its own art; the per-type images are matched by look, not by name */
const getTrainingImage = (stat: CombatStatName | TimedMasteryName) => {
  if (isInArray(stat, BasicElementName)) return getElementImg(stat);
  switch (stat) {
    case "intelligence":
      return IMG_TRAIN_INTELLIGENCE;
    case "willpower":
      return IMG_TRAIN_WILLPOWER;
    case "strength":
      return IMG_TRAIN_STRENGTH;
    case "speed":
      return IMG_TRAIN_SPEED;
    case "offence":
      return IMG_TRAIN_TAI_DEF;
    case "defence":
      return IMG_TRAIN_NIN_DEF;
    case "ninjutsuMastery":
      return IMG_TRAIN_NIN_OFF;
    case "genjutsuMastery":
      return IMG_TRAIN_GEN_OFF;
    case "taijutsuMastery":
      return IMG_TRAIN_TAI_OFF;
    case "bukijutsuMastery":
      return IMG_TRAIN_BUKI_OFF;
    case "bloodlineMastery":
      return IMG_TRAIN_GEN_DEF;
    case "sageMastery":
      return IMG_TRAIN_BUKI_DEF;
  }
};

const currentTrainingEnergy = (
  userData: NonNullable<UserWithRelations>,
  timeDiff: number,
) =>
  Math.floor(
    calcCurrent(
      userData.curEnergy,
      userData.maxEnergy,
      ["BATTLE", "HOSPITALIZED", "TRAVEL"].includes(userData.status)
        ? "AWAKE"
        : userData.status,
      userData.status === "BATTLE" ? 0 : userData.regeneration,
      userData.regenAt,
      timeDiff,
    ).current,
  );

const getTrainingLabel = (stat: CombatStatName | TimedMasteryName) => {
  switch (stat) {
    case "offence":
      return "Offence";
    case "defence":
      return "Defence";
    case "ninjutsuMastery":
      return "Ninjutsu";
    case "genjutsuMastery":
      return "Genjutsu";
    case "taijutsuMastery":
      return "Taijutsu";
    case "bukijutsuMastery":
      return "Bukijutsu";
    case "bloodlineMastery":
      return "Bloodline";
    case "sageMastery":
      return "Sage";
    default:
      return stat.charAt(0).toUpperCase() + stat.slice(1);
  }
};
