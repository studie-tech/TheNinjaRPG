"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Modal2 from "@/layout/Modal2";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import Countdown from "@/layout/Countdown";
import NavTabs from "@/layout/NavTabs";
import Confirm2 from "@/layout/Confirm2";
import AvatarImage from "@/layout/Avatar";
import UserSearchSelect from "@/layout/UserSearchSelect";
import PublicUserComponent from "@/layout/PublicUser";
import UserRequestSystem from "@/layout/UserRequestSystem";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import { getSearchValidator } from "@/validators/register";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import JutsuFiltering, { useFiltering, getFilter } from "@/layout/JutsuFiltering";
import { Button } from "@/components/ui/button";
import { trainingSpeedSeconds } from "@/libs/train";
import { trainEfficiency } from "@/libs/train";
import { JUTSU_LEVEL_CAP } from "@/drizzle/constants";
import { MAX_DAILY_TRAININGS } from "@/drizzle/constants";
import { showTrainingCapcha } from "@/libs/captcha";
import { canTrainJutsu } from "@/libs/train";
import { ActionSelector } from "@/layout/CombatActions";
import { getDaysHoursMinutesSeconds, getTimeLeftStr } from "@/utils/time";
import { secondsFromDate } from "@/utils/time";
import { calcJutsuTrainTime, calcJutsuTrainCost } from "@/libs/train";
import { checkJutsuRank, checkJutsuVillage, checkJutsuBloodline } from "@/libs/train";
import { useInfinitePagination } from "@/libs/pagination";
import { useRequireInVillage } from "@/utils/UserContext";
import { api } from "@/app/_trpc/client";
import { sendGTMEvent } from "@next/third-parties/google";
import { showMutationToast } from "@/libs/toast";
import { Swords, ShieldAlert, XCircle, Fingerprint } from "lucide-react";
import { CheckCheck, DoorOpen } from "lucide-react";
import { UserStatNames } from "@/drizzle/constants";
import { TrainingSpeeds } from "@/drizzle/constants";
import { Handshake, UserRoundCheck } from "lucide-react";
import { SENSEI_RANKS } from "@/drizzle/constants";
import {
  IMG_TRAIN_INTELLIGENCE,
  IMG_TRAIN_WILLPOWER,
  IMG_TRAIN_STRENGTH,
  IMG_TRAIN_SPEED,
  IMG_TRAIN_GEN_OFF,
  IMG_TRAIN_GEN_DEF,
  IMG_TRAIN_TAI_DEF,
  IMG_TRAIN_TAI_OFF,
  IMG_TRAIN_BUKI_OFF,
  IMG_TRAIN_BUKI_DEF,
  IMG_TRAIN_NIN_OFF,
  IMG_TRAIN_NIN_DEF,
} from "@/drizzle/constants";
import { USER_CAPS } from "@/drizzle/constants";
import { cn } from "src/libs/shadui";
import { captchaVerifySchema } from "@/validators/misc";
import type { UserStatName } from "@/drizzle/constants";
import type { CaptchaVerifySchema } from "@/validators/misc";
import type { z } from "zod";
import type { TrainingSpeed } from "@/drizzle/constants";
import type { Jutsu } from "@/drizzle/schema";
import type { UserWithRelations } from "@/routers/profile";

export default function Training() {
  // Ensure user is in village
  const { userData, timeDiff, access, updateUser } =
    useRequireInVillage("/traininggrounds");

  // While loading userdata
  if (!userData) return <Loader explanation="Loading userdata" />;
  if (!access) return <Loader explanation="Accessing Training Grounds" />;

  // Show sensei component
  const showSenseiSystem = [...SENSEI_RANKS, "GENIN"].includes(userData.rank);

  // Show components if we have user
  return (
    <>
      <StatsTraining userData={userData} timeDiff={timeDiff} updateUser={updateUser} />
      <JutsuTraining userData={userData} timeDiff={timeDiff} updateUser={updateUser} />
      {showSenseiSystem && (
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
            {students.map((user, i) => (
              <div className="relative" key={i}>
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
                        <XCircle className="absolute right-[13%] top-[3%] h-9 w-9 cursor-pointer rounded-full bg-slate-300 p-1 hover:text-orange-500" />
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
            <DoorOpen className="w-6 h-6 mr-2" />
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
                <Handshake className="h-5 w-5 mr-2" />
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

  // tRPC useUtils
  const utils = api.useUtils();

  // Query
  const { data: captcha } = api.misc.getCaptcha.useQuery(undefined, {
    staleTime: 5000,
    enabled: showCaptcha,
  });

  // Mutations
  const { mutate: startTraining, isPending: isStarting } =
    api.train.startTraining.useMutation({
      onSuccess: async (result) => {
        showMutationToast(result);
        if (result.success && result.data) {
          await updateUser(result.data);
          sendGTMEvent({ event: "stats_training" });
        }
      },
    });

  const { mutate: stopTraining, isPending: isStopping } =
    api.train.stopTraining.useMutation({
      onSuccess: async (result) => {
        showMutationToast(result);
        await utils.misc.getCaptcha.invalidate();
        if (result.success && result.data) {
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

  const isPending = isStarting || isStopping || isChaning;

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
      <div className="grid grid-cols-4 text-center font-bold">
        {UserStatNames.map((stat, i) => {
          const part = stat.match(/[a-z]+/g)?.[0] ?? "";
          const label = part.charAt(0).toUpperCase() + part.slice(1);
          const cap =
            stat.includes("Offence") || stat.includes("Defence")
              ? USER_CAPS[userData.rank].STATS_CAP
              : USER_CAPS[userData.rank].GENS_CAP;
          const overCap = userData[stat] >= cap;
          const icon = stat.includes("Offence") ? (
            <Swords className={iconClassName} />
          ) : stat.includes("Defence") ? (
            <ShieldAlert className={iconClassName} />
          ) : (
            <Fingerprint className={iconClassName} />
          );

          return (
            <div
              key={i}
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
                  overCap ? "grayscale opacity-50" : "",
                )}
              >
                <Image src={getImage(stat)} alt={label} width={256} height={256} />
                {icon}
                {label}
              </div>
              {overCap && (
                <UserRoundCheck className="w-10 h-10 text-slate-100 absolute left-[50%] translate-x-[-50%] top-[50%] translate-y-[-50%] hover:cursor-pointer" />
              )}
            </div>
          );
        })}
      </div>
      {userData.currentlyTraining && (
        <div className="absolute bottom-0 left-0 right-0 top-0 z-20 m-auto bg-black opacity-95">
          <div className="m-auto text-center text-white flex flex-col items-center">
            <p className="p-5  text-2xl">Training {userData.currentlyTraining}</p>
            <Image
              src={getImage(userData.currentlyTraining)}
              alt={userData.currentlyTraining}
              width={128}
              height={128}
            />
            <div className="w-2/3">
              {userData.trainingStartedAt && (
                <p className="text-2xl">
                  Time Left:{" "}
                  <Countdown
                    targetDate={secondsFromDate(
                      trainingSpeedSeconds(userData.trainingSpeed),
                      userData.trainingStartedAt,
                    )}
                    timeDiff={timeDiff}
                  />
                </p>
              )}
              {!showCaptcha && (
                <XCircle
                  className="w-10 h-10 m-auto mt-5 fill-red-500 cursor-pointer hover:text-orange-500"
                  onClick={() => stopTraining({ villageId: userData.villageId })}
                />
              )}
              {showCaptcha && !captcha && <Loader explanation="Loading captcha" />}
              {showCaptcha && captcha && (
                <Popover>
                  <PopoverTrigger>
                    <XCircle className="w-10 h-10 m-auto mt-5 fill-red-500 cursor-pointer hover:text-orange-500" />
                  </PopoverTrigger>
                  <PopoverContent>
                    <p className="font-bold text-lg">Verify Humanity</p>
                    {/* eslint-disable-next-line */}
                    <img
                      alt="captcha"
                      className="mb-2"
                      src={`data:image/svg+xml;utf8,${encodeURIComponent(captcha.svg)}`}
                    />
                    <Form {...captchaForm}>
                      <form className="relative" onSubmit={onSubmit}>
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
                        <Button className="absolute top-0 right-0" type="submit">
                          <CheckCheck className="h-5 w-5" />
                        </Button>
                      </form>
                    </Form>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>
        </div>
      )}
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
  const userJutsuCounts = userJutsus?.map((userJutsu) => {
    return {
      id: userJutsu.jutsuId,
      quantity:
        userJutsu.finishTraining && userJutsu.finishTraining > now
          ? userJutsu.level - 1
          : userJutsu.level,
    };
  });

  // Mutations
  const { mutate: train, isPending: isStartingTrain } =
    api.jutsu.startTraining.useMutation({
      onSuccess: async (result) => {
        showMutationToast(result);
        if (result.success && result.data) {
          sendGTMEvent({ event: "jutsu_training" });
          await updateUser(result.data);
        }
        await utils.jutsu.getUserJutsus.invalidate();
      },
      onSettled: () => {
        document.body.style.cursor = "default";
        setIsOpen(false);
        setJutsu(undefined);
      },
    });

  const { mutate: cancel, isPending: isStoppingTrain } =
    api.jutsu.stopTraining.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await utils.jutsu.getUserJutsus.invalidate();
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

  // Filtering jutsus
  const alljutsus = jutsus?.pages
    .map((page) => page.data)
    .flat()
    .filter((j) => canTrainJutsu(j, userData))
    .filter((j) => {
      const userJutsu = userJutsus?.find((uj) => uj.jutsuId === j.id);
      return userJutsu || !["EVENT", "LOYALTY", "SPECIAL"].includes(j.jutsuType);
    })
    .map((j) => {
      const uj = userJutsus?.find((uj) => uj.jutsuId === j.id);
      return { ...j, level: uj?.level || 0 };
    })
    .filter((j) => j.level < JUTSU_LEVEL_CAP)
    .sort((a, b) => b.level - a.level);

  // Training time
  const finishTrainingAt = userJutsus?.find(
    (jutsu) => jutsu.finishTraining && jutsu.finishTraining > now,
  );

  // Derived calculations
  const level = userJutsuCounts?.find((entry) => entry.id === jutsu?.id)?.quantity || 0;
  const trainSeconds =
    jutsu &&
    getTimeLeftStr(
      ...getDaysHoursMinutesSeconds(calcJutsuTrainTime(jutsu, level, userData)),
    );
  const cost = (jutsu && calcJutsuTrainCost(jutsu, level, userData, students)) || 0;
  const okRank = checkJutsuRank(jutsu?.jutsuRank, userData.rank);
  const okVillage = checkJutsuVillage(jutsu, userData);
  const okBloodline = checkJutsuBloodline(jutsu, userData);
  const canAfford = userData && cost && userData.money >= cost;
  const isCapped = level >= JUTSU_LEVEL_CAP;
  const canTrain = okRank && okVillage && okBloodline && !isCapped && canAfford;

  // Label for proceed button
  let proceed_label: string | undefined = undefined;
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
      proceed_label = `Train [${trainSeconds}, ${cost} ryo]`;
    }
  }

  return (
    <>
      <ContentBox
        title="Techniques"
        subtitle="Jutsu Techniques"
        defaultBackHref="/village"
        initialBreak={true}
        topRightContent={
          <JutsuFiltering state={state} fixedBloodline={userData.bloodlineId} />
        }
      >
        {userData && (
          <div className="max-h-[320px] overflow-y-scroll">
            <ActionSelector
              items={alljutsus}
              counts={userJutsuCounts}
              selectedId={jutsu?.id}
              labelSingles={true}
              emptyText="No jutsu available for your rank"
              onClick={(id) => {
                if (id == jutsu?.id) {
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
                  <p className="pb-3">You have {userData.money} ryo in your pocket</p>
                  {!isPending && (
                    <ItemWithEffects
                      item={jutsu}
                      key={jutsu.id}
                      showStatistic="jutsu"
                    />
                  )}
                  {isPending && <Loader explanation={`Training ${jutsu.name}`} />}
                </div>
              </Modal2>
            )}
          </div>
        )}
        {isFetching && <Loader explanation="Loading jutsu" />}
        {finishTrainingAt?.finishTraining && (
          <div className="min-h-36">
            <div className="absolute bottom-0 left-0 right-0 top-0 z-20 m-auto flex flex-col justify-center bg-black opacity-90">
              <div className="m-auto text-center text-white">
                <p className="p-5  text-3xl">Training</p>
                <p className="text-2xl">
                  Time Left:{" "}
                  <Countdown
                    targetDate={finishTrainingAt.finishTraining}
                    timeDiff={timeDiff}
                    onFinish={async () => {
                      await utils.jutsu.getUserJutsus.invalidate();
                    }}
                  />
                </p>
                {!isRefetchingUserJutsu && (
                  <XCircle
                    className="w-10 h-10 m-auto mt-5 fill-red-500 cursor-pointer hover:text-orange-500"
                    onClick={() => {
                      cancel();
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </ContentBox>
    </>
  );
};
