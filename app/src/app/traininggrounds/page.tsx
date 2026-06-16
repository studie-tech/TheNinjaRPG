"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { sendGTMEvent } from "@next/third-parties/google";
import {
  CheckCheck,
  DoorOpen,
  Eye,
  Fingerprint,
  Handshake,
  Search,
  ShieldAlert,
  Swords,
  Timer,
  UserRoundCheck,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import type { TrainingSpeed, UserStatName } from "@/drizzle/constants";
import {
  getUserCaps,
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
  MAX_DAILY_TRAININGS,
  SENSEI_RANKS,
  STEALTH_SENSORY_CAP,
  STEALTH_SENSORY_DEFAULT,
  STEALTH_TRAIN_GAIN_PER_MINUTE,
  TrainingSpeeds,
  UserStatNames,
} from "@/drizzle/constants";
import type { Jutsu } from "@/drizzle/schema";
import { useLocalStorage } from "@/hooks/localstorage";
import { TUTORIAL_JUTSU_TRAIN_QUEUE_STEP_ID, useTutorialStep } from "@/hooks/tutorial";
import ActivityQueuePanel from "@/layout/ActivityQueuePanel";
import AvatarImage from "@/layout/Avatar";
import { ActionSelector } from "@/layout/CombatActions";
import Confirm2 from "@/layout/Confirm2";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import Image from "@/layout/Image";
import ItemWithEffects from "@/layout/ItemWithEffects";
import JutsuFiltering, { getFilter, useFiltering } from "@/layout/JutsuFiltering";
import Loader from "@/layout/Loader";
import Modal2 from "@/layout/Modal2";
import NavTabs from "@/layout/NavTabs";
import PublicUserComponent from "@/layout/PublicUser";
import UserRequestSystem from "@/layout/UserRequestSystem";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { showTrainingCapcha } from "@/libs/captcha";
import { getDisplayJutsuLevel, getJutsuQueueCostBasis } from "@/libs/jutsu";
import { useInfinitePagination } from "@/libs/pagination";
import { cn } from "@/libs/shadui";
import { getStealthStatus } from "@/libs/stealth";
import { showMutationToast } from "@/libs/toast";
import {
  availableRanks,
  calcJutsuTrainCost,
  calcJutsuTrainTime,
  canTrainJutsu,
  canUseJutsu,
  checkJutsuBloodline,
  checkJutsuRank,
  checkJutsuVillage,
  trainEfficiency,
  trainingSpeedSeconds,
} from "@/libs/train";
import type { UserWithRelations } from "@/routers/profile";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import {
  getDaysHoursMinutesSeconds,
  getTimeLeftStr,
  secondsFromDate,
} from "@/utils/time";
import { useRequireInVillage } from "@/utils/UserContext";
import type { CaptchaVerifySchema } from "@/validators/misc";
import { captchaVerifySchema } from "@/validators/misc";
import { getSearchValidator } from "@/validators/register";

const getJutsuLevelCap = (_jutsu: { parentJutsuId?: string | null }) => JUTSU_LEVEL_CAP;

export default function Training() {
  const { userData, timeDiff, access, updateUser } =
    useRequireInVillage("/traininggrounds");
  const { currentStep } = useTutorialStep();

  const [activeTab, setActiveTab] = useLocalStorage<string>(
    "TrainingGroundsTab",
    "Stats",
  );

  useEffect(() => {
    if (currentStep?.title === "Training") {
      setActiveTab("Stats");
    }
  }, [currentStep?.title, setActiveTab]);

  if (!userData) return <Loader explanation="Loading userdata" />;
  if (!access) return <Loader explanation="Accessing Training Grounds" />;

  const showSenseiSystem = [...SENSEI_RANKS, "GENIN"].includes(userData.rank);
  const tabs = ["Stats", "Jutsu", "Covert", ...(showSenseiSystem ? ["Sensei"] : [])];

  return (
    <>
      <ContentBox
        title="Training Grounds"
        subtitle="Train stats, jutsu, and covert skills"
        defaultBackHref="/village"
        topRightContent={
          <NavTabs current={activeTab} options={tabs} setValue={setActiveTab} />
        }
      >
        <p className="text-muted-foreground text-sm">
          Use the tabs above to switch between training types. Queue additional
          trainings while one is in progress — Fed supporters get extra queue slots.
        </p>
      </ContentBox>
      {activeTab === "Stats" && (
        <StatsTraining
          userData={userData}
          timeDiff={timeDiff}
          updateUser={updateUser}
        />
      )}
      {activeTab === "Jutsu" && (
        <JutsuTraining
          userData={userData}
          timeDiff={timeDiff}
          updateUser={updateUser}
        />
      )}
      {activeTab === "Covert" && (
        <CovertTraining
          userData={userData}
          timeDiff={timeDiff}
          updateUser={updateUser}
        />
      )}
      {activeTab === "Sensei" && showSenseiSystem && (
        <SenseiSystem userData={userData} timeDiff={timeDiff} updateUser={updateUser} />
      )}
    </>
  );
}

interface TrainingProps {
  userData: NonNullable<UserWithRelations>;
  timeDiff: number;
  updateUser: (data: Partial<UserWithRelations>) => Promise<void>;
}

/**
 * Component for sensei system
 * @param props
 * @returns
 */
const SenseiSystem: React.FC<TrainingProps> = (props) => {
  // Settings
  const { userData } = props;

  // tRPC useUtils
  const utils = api.useUtils();

  // User search
  const maxUsers = 1;
  const userSearchSchema = getSearchValidator({ max: maxUsers });
  const userSearchMethods = useForm<z.infer<typeof userSearchSchema>>({
    resolver: zodResolver(userSearchSchema),
    defaultValues: { username: "", users: [] },
  });
  const targetUser = useWatch({
    control: userSearchMethods.control,
    name: "users",
    defaultValue: [],
  })?.[0];

  // Queries
  const { data: students, isFetching } = api.sensei.getStudents.useQuery(
    { userId: userData.userId },
    { enabled: SENSEI_RANKS.includes(userData.rank) },
  );

  const { data: requests } = api.sensei.getRequests.useQuery(undefined, {
    staleTime: 5000,
    enabled: !!userData,
  });

  // Mutations
  const { mutate: remove, isPending: isRemoving } =
    api.sensei.removeStudent.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.profile.getUser.invalidate();
          await utils.sensei.getRequests.invalidate();
          await utils.sensei.getStudents.invalidate();
        }
      },
    });

  const { mutate: create, isPending: isCreating } =
    api.sensei.createRequest.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.profile.getUser.invalidate();
          await utils.sensei.getRequests.invalidate();
        }
      },
    });

  const { mutate: accept, isPending: isAccepting } =
    api.sensei.acceptRequest.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.profile.getUser.invalidate();
          await utils.sensei.getRequests.invalidate();
          await utils.sensei.getStudents.invalidate();
        }
      },
    });

  const { mutate: reject, isPending: isRejecting } =
    api.sensei.rejectRequest.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.sensei.getRequests.invalidate();
        }
      },
    });

  const { mutate: cancel, isPending: isCancelling } =
    api.sensei.cancelRequest.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.sensei.getRequests.invalidate();
        }
      },
    });

  const { mutate: leaveSensei, isPending: isLeaving } =
    api.sensei.leaveSensei.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.profile.getUser.invalidate();
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
  const canSensei = SENSEI_RANKS.includes(userData.rank);
  const message = canSensei
    ? "Search for Genin to take in as students."
    : "Search for Jonin to be your sensei. ";
  const reward = canSensei
    ? "You receive 1000 ryo every time a student completes a mission."
    : "Jutsu training will be sped up by 5%.";
  const showRequestSystem = canSensei || !userData.senseiId;
  const showSensei = userData.rank === "GENIN" && userData.senseiId;
  const showStudents = canSensei && students && students.length > 0;

  // If loading
  if (isPending) return <Loader explanation="Processing..." />;

  // Render
  return (
    <>
      {/* Show Students */}
      {showStudents && (
        <ContentBox title="Students" subtitle={`Past and present`} initialBreak={true}>
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5">
            {students.map((user) => (
              <div className="relative" key={user.userId}>
                <Link href={`/userid/${user.userId}`} className="text-center">
                  <AvatarImage
                    href={user.avatar}
                    alt={user.username}
                    userId={user.userId}
                    hover_effect={true}
                    priority={true}
                    size={100}
                  />
                  {user.rank === "GENIN" && (
                    <Confirm2
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
                    </Confirm2>
                  )}
                  <div>
                    <div className="font-bold">{user.username}</div>
                    <div>
                      Lvl. {user.level} {capitalizeFirstLetter(user.rank)}
                    </div>
                  </div>
                </Link>
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
              selectedUsers={[]}
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
    </>
  );
};

/**
 * Component for stats training
 * @param props
 * @returns
 */
const StatsTraining: React.FC<TrainingProps> = (props) => {
  // Settings
  const { userData, updateUser, timeDiff } = props;
  const efficiency = trainEfficiency(userData);
  const showCaptcha = userData && showTrainingCapcha(userData);
  const [captchaStopOpen, setCaptchaStopOpen] = useState(false);

  // tRPC useUtils
  const utils = api.useUtils();

  // Tutorial management hook
  const { currentStep, handleNextStep } = useTutorialStep();

  // Query
  const { data: statQueue, refetch: refetchStatQueue } =
    api.train.getStatQueue.useQuery(undefined, { enabled: !!userData });
  const { data: captcha } = api.misc.getCaptcha.useQuery(undefined, {
    staleTime: 5000,
    enabled: showCaptcha,
  });

  // Mutations
  const { mutate: startTraining, isPending: isStarting } =
    api.train.enqueueStatTraining.useMutation({
      onSuccess: async (result) => {
        showMutationToast(result);
        if (result.success && result.data) {
          await updateUser(result.data);
          sendGTMEvent({ event: "stats_training" });
          if (currentStep?.title === "Training") {
            handleNextStep();
          }
        }
        await refetchStatQueue();
      },
    });

  const { mutate: cancelStatQueue, isPending: isCancellingStatQueue } =
    api.train.cancelStatQueueEntry.useMutation({
      onSuccess: async (result) => {
        showMutationToast(result);
        await refetchStatQueue();
      },
    });

  const { mutate: stopTraining, isPending: isStopping } =
    api.train.stopTraining.useMutation({
      onSuccess: async (result) => {
        showMutationToast(result);
        await utils.misc.getCaptcha.invalidate();
        if (result.success && result.data) {
          setCaptchaStopOpen(false);
          if (currentStep?.title === "Training") {
            handleNextStep();
          }
          await updateUser({
            currentlyTraining: null,
            trainingStartedAt: null,
            experience: userData.experience + result.data.experience,
            dailyTrainings: userData.dailyTrainings + 1,
            [result.data.currentlyTraining]:
              userData[result.data.currentlyTraining] + result.data.experience,
            questData: result.data.questData,
          });
        }
        await refetchStatQueue();
      },
    });

  const { mutate: changeSpeed, isPending: isChaning } =
    api.train.updateTrainingSpeed.useMutation({
      onSuccess: async (data, variables) => {
        showMutationToast(data);
        if (data.success) {
          await updateUser({ trainingSpeed: variables.speed });
        }
      },
    });

  // Captcha form
  const captchaForm = useForm<CaptchaVerifySchema>({
    resolver: zodResolver(captchaVerifySchema),
    defaultValues: { guess: "" },
  });

  // Form handlers
  const onSubmit = captchaForm.handleSubmit((data) => {
    stopTraining({ ...data, villageId: userData.villageId });
  });

  const isPending = isStarting || isStopping || isChaning || isCancellingStatQueue;

  if (!userData) return <Loader explanation="Loading userdata" />;
  if (isPending) return <Loader explanation="Processing..." />;

  // Convenience definitions
  const trainItemClassName = "hover:opacity-50 hover:cursor-pointer relative";
  const iconClassName = "w-5 h-5 absolute top-1 right-1 text-blue-500";

  const getImage = (stat: UserStatName) => {
    switch (stat) {
      case "intelligence":
        return IMG_TRAIN_INTELLIGENCE;
      case "willpower":
        return IMG_TRAIN_WILLPOWER;
      case "strength":
        return IMG_TRAIN_STRENGTH;
      case "speed":
        return IMG_TRAIN_SPEED;
      case "genjutsuOffence":
        return IMG_TRAIN_GEN_OFF;
      case "genjutsuDefence":
        return IMG_TRAIN_GEN_DEF;
      case "taijutsuDefence":
        return IMG_TRAIN_TAI_DEF;
      case "taijutsuOffence":
        return IMG_TRAIN_TAI_OFF;
      case "bukijutsuOffence":
        return IMG_TRAIN_BUKI_OFF;
      case "bukijutsuDefence":
        return IMG_TRAIN_BUKI_DEF;
      case "ninjutsuOffence":
        return IMG_TRAIN_NIN_OFF;
      case "ninjutsuDefence":
        return IMG_TRAIN_NIN_DEF;
    }
  };

  return (
    <ContentBox
      title="Training"
      subtitle={`${efficiency}% efficiency [${userData.dailyTrainings} / ${MAX_DAILY_TRAININGS}]`}
      defaultBackHref="/village"
      topRightContent={
        <NavTabs
          current={userData.trainingSpeed}
          options={TrainingSpeeds}
          setValue={(value) => changeSpeed({ speed: value as TrainingSpeed })}
        />
      }
    >
      <ActivityQueuePanel
        queue={statQueue}
        timeDiff={timeDiff}
        onCancel={(id) => cancelStatQueue({ queueId: id })}
        isCancelling={isCancellingStatQueue}
        onActiveFinish={() => void refetchStatQueue()}
        onStopActive={() => {
          if (showCaptcha) {
            setCaptchaStopOpen(true);
          } else {
            stopTraining({ villageId: userData.villageId });
          }
        }}
        isStoppingActive={isStopping}
        stopButtonId="tutorial-traininggrounds-stopTraining"
      />
      {showCaptcha && captcha && captchaStopOpen && userData.currentlyTraining && (
        <div className="mb-4 rounded-lg border p-4">
          <p className="font-bold text-lg">Verify Humanity to stop training</p>
          {/* biome-ignore lint/performance/noImgElement: SVG captcha requires img element for data URI */}
          <img
            alt="captcha"
            className="mb-2"
            src={`data:image/svg+xml;utf8,${encodeURIComponent(captcha.svg)}`}
          />
          <Form {...captchaForm}>
            <form onSubmit={onSubmit} className="space-y-2">
              <FormField
                control={captchaForm.control}
                name="guess"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input placeholder="Enter captcha" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex gap-2">
                <Button type="submit">Verify & Stop</Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setCaptchaStopOpen(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Form>
        </div>
      )}
      <div className="grid grid-cols-4 text-center font-bold">
        {UserStatNames.map((stat, i) => {
          const part = stat.match(/[a-z]+/g)?.[0] ?? "";
          const label = part.charAt(0).toUpperCase() + part.slice(1);
          const { stats_cap, gens_cap } = getUserCaps(userData.rank);
          const cap =
            stat.includes("Offence") || stat.includes("Defence") ? stats_cap : gens_cap;
          const overCap = userData[stat] >= cap;
          const icon = stat.includes("Offence") ? (
            <Swords className={iconClassName} />
          ) : stat.includes("Defence") ? (
            <ShieldAlert className={iconClassName} />
          ) : (
            <Fingerprint className={iconClassName} />
          );

          return (
            <button
              type="button"
              id={`tutorial-traininggrounds-${stat.toLowerCase()}`}
              key={`${stat}-${i}`}
              onClick={() =>
                overCap
                  ? showMutationToast({ success: false, message: "Already capped" })
                  : startTraining({ stat })
              }
              className="relative"
            >
              <div
                className={cn(
                  trainItemClassName,
                  overCap ? "opacity-50 grayscale" : "",
                )}
              >
                <Image src={getImage(stat)} alt={label} width={256} height={256} />
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
    </ContentBox>
  );
};

/**
 * Component for jutsu training
 * @param props
 * @returns
 */
const JutsuTraining: React.FC<TrainingProps> = (props) => {
  // Settings
  const { userData, updateUser, timeDiff } = props;
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [jutsu, setJutsu] = useState<Jutsu | undefined>(undefined);
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  const now = new Date();

  // tRPC useUtils
  const utils = api.useUtils();

  // Two-level filtering
  const state = useFiltering();

  // Set the default selected ranks
  useEffect(() => {
    state.setRank(availableRanks(userData.rank));
  }, [userData.rank]);

  // Jutsus
  const {
    data: jutsus,
    isFetching,
    fetchNextPage,
    hasNextPage,
  } = api.jutsu.getAll.useInfiniteQuery(
    { limit: 100, hideAi: true, ...getFilter(state) },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
      enabled: userData !== undefined,
    },
  );
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  // Get user students
  const { data: students } = api.sensei.getStudents.useQuery(
    { userId: userData?.userId || "" },
    { enabled: !!userData },
  );

  // User Jutsus
  const { data: userJutsus, isPending: isRefetchingUserJutsu } =
    api.jutsu.getUserJutsus.useQuery(getFilter(state), {
      enabled: !!userData,
    });
  // Lightweight unfiltered ownership set — used to check evolution ownership
  // regardless of active search filters. Only includes jutsuId + ancestorIds
  // so we don't transfer the full userJutsu rows over the wire.
  const { data: userJutsuOwnership } = api.jutsu.getUserJutsuOwnership.useQuery(
    undefined,
    {
      enabled: !!userData,
    },
  );
  const { data: jutsuQueue, refetch: refetchJutsuQueue } =
    api.jutsu.getJutsuQueue.useQuery(undefined, { enabled: !!userData });
  const userJutsuCounts = userJutsus?.map((userJutsu) => ({
    id: userJutsu.jutsuId,
    quantity: getDisplayJutsuLevel(userJutsu, now),
  }));

  // Tutorial management hook
  const { currentStep, handleNextStep } = useTutorialStep();

  // Mutations
  const { mutate: train, isPending: isStartingTrain } =
    api.jutsu.startTraining.useMutation({
      onSuccess: async (result) => {
        showMutationToast(result);
        if (result.success && result.data) {
          sendGTMEvent({ event: "jutsu_training" });
          await updateUser(result.data);
          if (currentStep?.id === TUTORIAL_JUTSU_TRAIN_QUEUE_STEP_ID) {
            handleNextStep();
          }
        }
        await utils.jutsu.getUserJutsus.invalidate();
        await refetchJutsuQueue();
      },
      onSettled: () => {
        document.body.style.cursor = "default";
        setIsOpen(false);
        setJutsu(undefined);
      },
    });

  const { mutate: cancelJutsuQueue, isPending: isCancellingJutsuQueue } =
    api.jutsu.cancelJutsuQueueEntry.useMutation({
      onSuccess: async (result) => {
        showMutationToast(result);
        await Promise.all([refetchJutsuQueue(), utils.jutsu.getUserJutsus.refetch()]);
      },
    });

  const { mutate: cancel, isPending: isStoppingTrain } =
    api.jutsu.stopTraining.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await Promise.all([utils.jutsu.getUserJutsus.refetch(), refetchJutsuQueue()]);
      },
      onSettled: () => {
        document.body.style.cursor = "default";
        setIsOpen(false);
        setJutsu(undefined);
      },
    });

  // Mutation loading
  const isPending = isStartingTrain || isStoppingTrain;

  // While loading userdata
  if (!userData) return <Loader explanation="Loading userdata" />;

  // Collect all ancestor jutsu IDs that the user has evolved past
  const evolvedAncestorIds = new Set<string>();
  for (const uj of userJutsuOwnership ?? []) {
    for (const id of uj.ancestorIds) evolvedAncestorIds.add(id);
  }

  // Filtering jutsus
  const alljutsus = jutsus?.pages
    .flatMap((page) => page.data)
    .filter((j) => {
      if (j.parentJutsuId)
        return (
          // Training/leveling is item-free, so ignore the bloodline item requirement here
          canUseJutsu(j, userData, true) &&
          (userJutsuOwnership?.some((uj) => uj.jutsuId === j.id) ?? false)
        );
      return canTrainJutsu(j, userData);
    })
    .filter((j) => !evolvedAncestorIds.has(j.id))
    .filter((j) => {
      const userJutsu = userJutsus?.find((uj) => uj.jutsuId === j.id);
      return userJutsu || !["EVENT", "LOYALTY", "SPECIAL"].includes(j.jutsuType);
    })
    .map((j) => {
      const uj = userJutsus?.find((uj) => uj.jutsuId === j.id);
      return { ...j, level: uj ? getDisplayJutsuLevel(uj, now) : 0 };
    })
    .filter((j) => j.level < getJutsuLevelCap(j))
    .sort((a, b) => b.level - a.level);

  // Training time
  const finishTrainingAt = userJutsus?.find(
    (jutsu) => jutsu.finishTraining && jutsu.finishTraining > now,
  );

  // Derived calculations — live from queue + DB level (matches enqueue logic)
  const userJutsuObj = userJutsus?.find((uj) => uj.jutsuId === jutsu?.id);
  const sameJutsuQueuedCount =
    jutsuQueue?.queued.filter((e) => e.jutsuId === jutsu?.id).length ?? 0;
  const costBasisLevel = getJutsuQueueCostBasis(
    userJutsuObj?.level ?? 0,
    sameJutsuQueuedCount,
  );
  const targetLevel = costBasisLevel + 1;
  const trainTimeMs = jutsu ? calcJutsuTrainTime(jutsu, costBasisLevel, userData) : 0;
  const cost =
    (jutsu && calcJutsuTrainCost(jutsu, costBasisLevel, userData, students)) || 0;
  const trainSeconds =
    jutsu && trainTimeMs
      ? getTimeLeftStr(...getDaysHoursMinutesSeconds(trainTimeMs))
      : "";
  const level = userJutsuCounts?.find((entry) => entry.id === jutsu?.id)?.quantity || 0;
  const okRank = checkJutsuRank(jutsu?.jutsuRank, userData.rank);
  const okVillage = checkJutsuVillage(jutsu, userData);
  const okBloodline = checkJutsuBloodline(jutsu, userData);
  const canAfford = userData && cost && userData.money >= cost;
  const isCapped = targetLevel > (jutsu ? getJutsuLevelCap(jutsu) : JUTSU_LEVEL_CAP);
  const canTrain = okRank && okVillage && okBloodline && !isCapped && canAfford;

  // Label for proceed button
  let proceed_label: string | undefined;
  if (!isPending && !isCapped) {
    if (!canAfford) {
      proceed_label = `Need ${cost - userData.money} more ryo`;
    } else if (isCapped) {
      proceed_label = `Level capped`;
    } else if (!okRank) {
      proceed_label = `Cannot train ${jutsu?.jutsuRank} rank`;
    } else if (!okVillage) {
      proceed_label = `Wrong village`;
    } else if (!okBloodline) {
      proceed_label = `Wrong bloodline`;
    } else if (trainSeconds && cost) {
      proceed_label = `Train → Lv.${targetLevel} [${trainSeconds}, ${cost.toLocaleString()} ryo]`;
    }
  }

  return (
    <ContentBox
      title="Techniques"
      subtitle="Jutsu Techniques"
      defaultBackHref="/village"
      initialBreak={true}
      topRightContent={
        <JutsuFiltering state={state} fixedBloodline={userData.bloodlineId} />
      }
    >
      <ActivityQueuePanel
        queue={jutsuQueue}
        timeDiff={timeDiff}
        onCancel={(id) => cancelJutsuQueue({ queueId: id })}
        isCancelling={isCancellingJutsuQueue}
        onActiveFinish={async () => {
          await utils.jutsu.getUserJutsus.invalidate();
          await refetchJutsuQueue();
        }}
        onStopActive={() => cancel()}
        isStoppingActive={isStoppingTrain}
      />
      {userData && (
        <div className="max-h-[320px] overflow-y-scroll">
          <ActionSelector
            items={alljutsus}
            counts={userJutsuCounts}
            selectedId={jutsu?.id}
            labelSingles={true}
            emptyText="No jutsu available for your rank"
            onClick={(id) => {
              if (id === jutsu?.id) {
                setJutsu(undefined);
                setIsOpen(false);
              } else {
                setJutsu(alljutsus?.find((jutsu) => jutsu.id === id));
                setIsOpen(true);
              }
            }}
            showBgColor={false}
            showLabels={true}
            lastElement={lastElement}
            setLastElement={setLastElement}
          />
          {isOpen && jutsu && (
            <Modal2
              id="tutorial-traininggrounds-trainJutsu"
              title="Confirm Purchase"
              proceed_label={proceed_label}
              isOpen={isOpen}
              setIsOpen={setIsOpen}
              isValid={false}
              onAccept={() => {
                if (canTrain && !isPending) {
                  train({ jutsuId: jutsu.id });
                } else {
                  setIsOpen(false);
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
            </Modal2>
          )}
        </div>
      )}
      {isFetching && <Loader explanation="Loading jutsu" />}
    </ContentBox>
  );
};

/**
 * Component for covert operations training (stealth & sensory)
 * @param props
 * @returns
 */
const CovertTraining: React.FC<TrainingProps> = (props) => {
  const { userData, timeDiff, updateUser } = props;

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
      onSuccess: async (data, variables) => {
        if (data.success && data.data) {
          // Derive start time from server-provided finish time to avoid clock-skew issues
          const covertTrainingStartedAt = new Date(
            data.data.covertTrainingFinishAt.getTime() - variables.minutes * 60_000,
          );
          await updateUser({
            covertTrainingType: variables.type,
            covertTrainingStartedAt,
            covertTrainingMinutes: variables.minutes,
          });
        } else {
          showMutationToast(data);
        }
      },
    });

  const { mutate: stopTraining, isPending: isStoppingTraining } =
    api.stealth.stopCovertTraining.useMutation({
      onSuccess: async (data) => {
        if (data.success && data.data) {
          const statUpdate =
            stealthStatus?.covertTrainingType === "stealth"
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

  const stealthProgress =
    ((stealthStatus?.stealth ?? STEALTH_SENSORY_DEFAULT) / STEALTH_SENSORY_CAP) * 100;
  const sensoryProgress =
    ((stealthStatus?.sensory ?? STEALTH_SENSORY_DEFAULT) / STEALTH_SENSORY_CAP) * 100;

  // Check if currently training
  const isTraining = !!stealthStatus?.covertTrainingType;
  const trainingType = stealthStatus?.covertTrainingType;
  const trainingFinishAt = stealthStatus?.covertTrainingFinishAt;
  const trainingGain = stealthStatus?.covertTrainingGain;

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

        {/* Stealth Section - hidden when training */}
        {!isTraining && (
          <div className="rounded-lg border p-4">
            <div className="mb-3 flex items-center gap-2">
              <Eye className="h-5 w-5 text-purple-600" />
              <h3 className="font-bold text-lg">Stealth</h3>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1 flex justify-between">
                  <span className="text-sm">Progress</span>
                  <span className="font-medium text-sm">
                    {Math.floor(
                      stealthStatus?.stealth ?? STEALTH_SENSORY_DEFAULT,
                    ).toLocaleString()}{" "}
                    / {STEALTH_SENSORY_CAP.toLocaleString()}
                  </span>
                </div>
                <Progress value={stealthProgress} className="h-2" />
                <div className="mt-3 space-y-1 text-muted-foreground text-sm">
                  <p>
                    Duration:{" "}
                    {Math.floor((stealthStatus?.stealthDurationMax ?? 60) / 60)} min
                  </p>
                  <p>
                    Keep Chance: {(stealthStatus?.stealthKeepChance ?? 5).toFixed(1)}%
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  onClick={() => trainCovert({ type: "stealth", minutes: 10 })}
                  disabled={isTrainingCovert || stealthProgress >= 100}
                  className="w-full"
                >
                  <Timer className="mr-1 h-4 w-4" />
                  {isTrainingCovert ? "Starting..." : "Train 10 min"}
                </Button>
                <Button
                  onClick={() => trainCovert({ type: "stealth", minutes: 30 })}
                  disabled={isTrainingCovert || stealthProgress >= 100}
                  className="w-full"
                >
                  <Timer className="mr-1 h-4 w-4" />
                  {isTrainingCovert ? "Starting..." : "Train 30 min"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Sensory Section - hidden when training */}
        {!isTraining && (
          <div className="rounded-lg border p-4">
            <div className="mb-3 flex items-center gap-2">
              <Search className="h-5 w-5 text-blue-600" />
              <h3 className="font-bold text-lg">Sensory</h3>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1 flex justify-between">
                  <span className="text-sm">Progress</span>
                  <span className="font-medium text-sm">
                    {Math.floor(
                      stealthStatus?.sensory ?? STEALTH_SENSORY_DEFAULT,
                    ).toLocaleString()}{" "}
                    / {STEALTH_SENSORY_CAP.toLocaleString()}
                  </span>
                </div>
                <Progress value={sensoryProgress} className="h-2" />
                <div className="mt-3 space-y-1 text-muted-foreground text-sm">
                  <p>
                    Detection Chance:{" "}
                    {(stealthStatus?.sensoryDetectChance ?? 5).toFixed(1)}%
                  </p>
                  <p>
                    Cooldown: {Math.floor(stealthStatus?.sensoryCooldown ?? 120)} sec
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  onClick={() => trainCovert({ type: "sensory", minutes: 10 })}
                  disabled={isTrainingCovert || sensoryProgress >= 100}
                  className="w-full"
                >
                  <Timer className="mr-1 h-4 w-4" />
                  {isTrainingCovert ? "Starting..." : "Train 10 min"}
                </Button>
                <Button
                  onClick={() => trainCovert({ type: "sensory", minutes: 30 })}
                  disabled={isTrainingCovert || sensoryProgress >= 100}
                  className="w-full"
                >
                  <Timer className="mr-1 h-4 w-4" />
                  {isTrainingCovert ? "Starting..." : "Train 30 min"}
                </Button>
              </div>
            </div>
          </div>
        )}

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
