"use client";

import { useState, useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import RichInput from "@/layout/RichInput";
import Post from "@/layout/Post";
import AvatarImage from "@/layout/Avatar";
import { parseHtml } from "@/utils/parse";
import UserSearchSelect from "@/layout/UserSearchSelect";
import SliderField from "@/layout/SliderField";
import { Button } from "@/components/ui/button";
import { showMutationToast } from "@/libs/toast";
import { getSearchValidator } from "@/validators/register";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "@/app/_trpc/client";
import { useRequiredUserData } from "@/utils/UserContext";
import { canSubmitNotification } from "@/utils/permissions";
import { canModifyEventGains } from "@/utils/permissions";
import { mutateContentSchema, type MutateContentSchema } from "@/validators/comments";
import { changeSettingSchema, type ChangeSettingSchema } from "@/validators/misc";
import { canUseMonitoringTests } from "@/utils/permissions";
import { useInfinitePagination } from "@/libs/pagination";
import { GAME_SETTING_GAINS_MULTIPLIER } from "@/drizzle/constants";
import { secondsPassed } from "@/utils/time";
import type { z } from "zod";

export default function NotifyUsers() {
  return (
    <>
      <RegenGainSystem />
      <TrainingGainSystem />
      <BattleArenaExpSystem />
      <MissionExpSystem />
      <JutsuExpSystem />
      <TestErrorMonitoring />
      <NotificationSystem />
    </>
  );
}

const TestErrorMonitoring: React.FC = () => {
  // Invalid state
  const [state, setState] = useState<string | null>("test");

  // Query data
  const { data: userData } = useRequiredUserData();

  // Trpc error trigger
  const trpcErrorMutation = api.staff.throwError.useMutation();
  const trpcTrpcErrorMutation = api.staff.throwTrpcError.useMutation();

  // Guard
  if (!userData) return null;
  if (!canUseMonitoringTests(userData.role)) return null;

  return (
    <ContentBox
      title="Monitoring Tests"
      subtitle="Test error monitoring"
      initialBreak={true}
    >
      <div className="flex flex-col gap-2">
        <span className="hidden">{state!.toString()}</span>
        <div className="flex flex-row gap-2">
          <Button
            className="basis-1/2"
            onClick={() => {
              throw new Error("Test error");
            }}
          >
            Throw Error on Frontend
          </Button>
          <Button className="basis-1/2" onClick={() => setState(null)}>
            Render Error on Frontend
          </Button>
        </div>
        <div className="flex flex-row gap-2">
          <Button className="basis-1/2" onClick={() => trpcErrorMutation.mutate()}>
            Throw Error on Backend
          </Button>
          <Button className="basis-1/2" onClick={() => trpcTrpcErrorMutation.mutate()}>
            Throw TRPC Error on Backend
          </Button>
        </div>
      </div>
    </ContentBox>
  );
};

/**
 * Regen Gain System for setting regen multiplier for all users
 */
const RegenGainSystem: React.FC = () => {
  // utils
  const utils = api.useUtils();

  // Query data
  const { data: userData, timeDiff } = useRequiredUserData();
  const { data: setting } = api.misc.getSetting.useQuery(
    { name: "regenGainMultiplier" },
    { enabled: !!userData },
  );

  // Mutate
  const { mutate: setEventGameSetting, isPending } =
    api.misc.setEventGameSetting.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await utils.misc.getSetting.invalidate();
        await utils.profile.getUser.invalidate();
      },
    });

  // Form control
  const regenForm = useForm<ChangeSettingSchema>({
    resolver: zodResolver(changeSettingSchema),
  });
  const watchedDays = useWatch({
    control: regenForm.control,
    name: "days",
    defaultValue: 2,
  });

  // When setting loaded, update the slider value
  useEffect(() => {
    if (setting) {
      const daysLeft = Math.round(secondsPassed(setting.time, timeDiff) / (24 * 3600));
      if (daysLeft < 0) regenForm.setValue("days", -daysLeft);
    }
  }, [setting, timeDiff, regenForm]);

  // Guard
  if (!userData) return null;
  const canChange = canModifyEventGains(userData.role);
  if (!canChange) return null;

  return (
    <ContentBox title="Regen Multiplier" subtitle="Modify regen gains globally">
      {isPending && <Loader explanation="Changing setting" />}
      {!isPending && (
        <div className="grid grid-cols-1">
          <SliderField
            id="days"
            default={0}
            min={0}
            max={31}
            unit="days"
            label="Select duration in days"
            register={regenForm.register}
            setValue={regenForm.setValue}
            watchedValue={watchedDays}
            error={regenForm.formState.errors.days?.message}
          />
          <div className="flex flex-row gap-2">
            {GAME_SETTING_GAINS_MULTIPLIER.map((multiplier, i) => (
              <Button
                id={`multiply-${multiplier}`}
                className={`w-full ${setting?.value === parseInt(multiplier) ? "bg-green-700" : ""}`}
                key={i}
                onClick={() =>
                  setEventGameSetting({
                    setting: "regenGainMultiplier",
                    multiplier,
                    days: watchedDays,
                  })
                }
              >
                {multiplier}X
              </Button>
            ))}
          </div>
        </div>
      )}
    </ContentBox>
  );
};

/**
 * Training Gain System for setting training gains for all users
 */
const TrainingGainSystem: React.FC = () => {
  // utils
  const utils = api.useUtils();

  // Query data
  const { data: userData, timeDiff } = useRequiredUserData();
  const { data: setting } = api.misc.getSetting.useQuery(
    { name: "trainingGainMultiplier" },
    { enabled: !!userData },
  );

  // Mutate
  const { mutate: setEventGameSetting, isPending } =
    api.misc.setEventGameSetting.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await utils.misc.getSetting.invalidate();
        await utils.profile.getUser.invalidate();
      },
    });

  // Form control
  const trainingForm = useForm<ChangeSettingSchema>({
    resolver: zodResolver(changeSettingSchema),
  });
  const watchedDays = useWatch({
    control: trainingForm.control,
    name: "days",
    defaultValue: 2,
  });

  // When setting loaded, update the slider value
  useEffect(() => {
    if (setting) {
      const daysLeft = secondsPassed(setting.time, timeDiff) / (24 * 3600);
      if (daysLeft < 0) trainingForm.setValue("days", -daysLeft);
    }
  }, [setting, timeDiff, trainingForm]);

  // Guard
  if (!userData) return null;
  const canChange = canModifyEventGains(userData.role);
  if (!canChange) return null;

  return (
    <ContentBox
      title="Training Multiplier"
      subtitle="Modify training gains globally"
      initialBreak={true}
    >
      {isPending && <Loader explanation="Changing setting" />}
      {!isPending && (
        <div className="grid grid-cols-1">
          <SliderField
            id="days"
            default={0}
            min={0}
            max={31}
            unit="days"
            label="Select duration in days"
            register={trainingForm.register}
            setValue={trainingForm.setValue}
            watchedValue={watchedDays}
            error={trainingForm.formState.errors.days?.message}
          />
          <div className="flex flex-row gap-2">
            {GAME_SETTING_GAINS_MULTIPLIER.map((multiplier, i) => (
              <Button
                id={`multiply-${multiplier}`}
                className={`w-full ${setting?.value === parseInt(multiplier) ? "bg-green-700" : ""}`}
                key={i}
                onClick={() =>
                  setEventGameSetting({
                    setting: "trainingGainMultiplier",
                    multiplier,
                    days: watchedDays,
                  })
                }
              >
                {multiplier}X
              </Button>
            ))}
          </div>
        </div>
      )}
    </ContentBox>
  );
};

/**
 * Battle Arena Experience System for setting battle arena exp multiplier for all users
 */
const BattleArenaExpSystem: React.FC = () => {
  // utils
  const utils = api.useUtils();

  // Query data
  const { data: userData, timeDiff } = useRequiredUserData();
  const { data: setting } = api.misc.getSetting.useQuery(
    { name: "battleExpMultiplier" },
    { enabled: !!userData },
  );

  // Mutate
  const { mutate: setEventGameSetting, isPending } =
    api.misc.setEventGameSetting.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await utils.misc.getSetting.invalidate();
        await utils.profile.getUser.invalidate();
      },
    });

  // Form control
  const battleArenaForm = useForm<ChangeSettingSchema>({
    resolver: zodResolver(changeSettingSchema),
  });
  const watchedDays = useWatch({
    control: battleArenaForm.control,
    name: "days",
    defaultValue: 2,
  });

  // When setting loaded, update the slider value
  useEffect(() => {
    if (setting) {
      const daysLeft = secondsPassed(setting.time, timeDiff) / (24 * 3600);
      if (daysLeft < 0) battleArenaForm.setValue("days", -daysLeft);
    }
  }, [setting, timeDiff, battleArenaForm]);

  // Guard
  if (!userData) return null;
  const canChange = canModifyEventGains(userData.role);
  if (!canChange) return null;

  return (
    <ContentBox
      title="Battle Experience Multiplier"
      subtitle="Modify battle experience gains globally (Arena & PvP)"
      initialBreak={true}
    >
      {isPending && <Loader explanation="Changing setting" />}
      {!isPending && (
        <div className="grid grid-cols-1">
          <SliderField
            id="days"
            default={0}
            min={0}
            max={31}
            unit="days"
            label="Select duration in days"
            register={battleArenaForm.register}
            setValue={battleArenaForm.setValue}
            watchedValue={watchedDays}
            error={battleArenaForm.formState.errors.days?.message}
          />
          <div className="flex flex-row gap-2">
            {GAME_SETTING_GAINS_MULTIPLIER.map((multiplier, i) => (
              <Button
                id={`multiply-${multiplier}`}
                className={`w-full ${setting?.value === parseInt(multiplier) ? "bg-green-700" : ""}`}
                key={i}
                onClick={() =>
                  setEventGameSetting({
                    setting: "battleExpMultiplier",
                    multiplier,
                    days: watchedDays,
                  })
                }
              >
                {multiplier}X
              </Button>
            ))}
          </div>
        </div>
      )}
    </ContentBox>
  );
};

/**
 * Mission Experience System for setting mission/quest experience multiplier for all users
 */
const MissionExpSystem: React.FC = () => {
  // utils
  const utils = api.useUtils();

  // Query data
  const { data: userData, timeDiff } = useRequiredUserData();
  const { data: setting } = api.misc.getSetting.useQuery(
    { name: "missionExpMultiplier" },
    { enabled: !!userData },
  );

  // Mutate
  const { mutate: setEventGameSetting, isPending } =
    api.misc.setEventGameSetting.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await utils.misc.getSetting.invalidate();
        await utils.profile.getUser.invalidate();
      },
    });

  // Form control
  const missionForm = useForm<ChangeSettingSchema>({
    resolver: zodResolver(changeSettingSchema),
  });
  const watchedDays = useWatch({
    control: missionForm.control,
    name: "days",
    defaultValue: 2,
  });

  // When setting loaded, update the slider value
  useEffect(() => {
    if (setting) {
      const daysLeft = secondsPassed(setting.time, timeDiff) / (24 * 3600);
      if (daysLeft < 0) missionForm.setValue("days", -daysLeft);
    }
  }, [setting, timeDiff, missionForm]);

  // Guard
  if (!userData) return null;
  const canChange = canModifyEventGains(userData.role);
  if (!canChange) return null;

  return (
    <ContentBox
      title="Mission Experience Multiplier"
      subtitle="Modify mission/quest experience gains globally"
      initialBreak={true}
    >
      {isPending && <Loader explanation="Changing setting" />}
      {!isPending && (
        <div className="grid grid-cols-1">
          <SliderField
            id="days"
            default={0}
            min={0}
            max={31}
            unit="days"
            label="Select duration in days"
            register={missionForm.register}
            setValue={missionForm.setValue}
            watchedValue={watchedDays}
            error={missionForm.formState.errors.days?.message}
          />
          <div className="flex flex-row gap-2">
            {GAME_SETTING_GAINS_MULTIPLIER.map((multiplier, i) => (
              <Button
                id={`multiply-${multiplier}`}
                className={`w-full ${setting?.value === parseInt(multiplier) ? "bg-green-700" : ""}`}
                key={i}
                onClick={() =>
                  setEventGameSetting({
                    setting: "missionExpMultiplier",
                    multiplier,
                    days: watchedDays,
                  })
                }
              >
                {multiplier}X
              </Button>
            ))}
          </div>
        </div>
      )}
    </ContentBox>
  );
};

/**
 * Jutsu Experience System for setting jutsu experience multiplier for all users
 */
const JutsuExpSystem: React.FC = () => {
  // utils
  const utils = api.useUtils();

  // Query data
  const { data: userData, timeDiff } = useRequiredUserData();
  const { data: setting } = api.misc.getSetting.useQuery(
    { name: "jutsuExpMultiplier" },
    { enabled: !!userData },
  );

  // Mutate
  const { mutate: setEventGameSetting, isPending } =
    api.misc.setEventGameSetting.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await utils.misc.getSetting.invalidate();
        await utils.profile.getUser.invalidate();
      },
    });

  // Form control
  const jutsuForm = useForm<ChangeSettingSchema>({
    resolver: zodResolver(changeSettingSchema),
  });
  const watchedDays = useWatch({
    control: jutsuForm.control,
    name: "days",
    defaultValue: 2,
  });

  // When setting loaded, update the slider value
  useEffect(() => {
    if (setting) {
      const daysLeft = secondsPassed(setting.time, timeDiff) / (24 * 3600);
      if (daysLeft < 0) jutsuForm.setValue("days", -daysLeft);
    }
  }, [setting, timeDiff, jutsuForm]);

  // Guard
  if (!userData) return null;
  const canChange = canModifyEventGains(userData.role);
  if (!canChange) return null;

  return (
    <ContentBox
      title="Jutsu Experience Multiplier"
      subtitle="Modify jutsu experience gains globally"
      initialBreak={true}
    >
      {isPending && <Loader explanation="Changing setting" />}
      {!isPending && (
        <div className="grid grid-cols-1">
          <SliderField
            id="days"
            default={0}
            min={0}
            max={31}
            unit="days"
            label="Select duration in days"
            register={jutsuForm.register}
            setValue={jutsuForm.setValue}
            watchedValue={watchedDays}
            error={jutsuForm.formState.errors.days?.message}
          />
          <div className="flex flex-row gap-2">
            {GAME_SETTING_GAINS_MULTIPLIER.map((multiplier, i) => (
              <Button
                id={`multiply-${multiplier}`}
                className={`w-full ${setting?.value === parseInt(multiplier) ? "bg-green-700" : ""}`}
                key={i}
                onClick={() =>
                  setEventGameSetting({
                    setting: "jutsuExpMultiplier",
                    multiplier,
                    days: watchedDays,
                  })
                }
              >
                {multiplier}X
              </Button>
            ))}
          </div>
        </div>
      )}
    </ContentBox>
  );
};

/**
 * Notification System for sending out messages to all users
 */
const NotificationSystem: React.FC = () => {
  // User state
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  const { data: userData } = useRequiredUserData();

  // utils
  const utils = api.useUtils();

  // Fetch historical notifications
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isPending: l1,
  } = api.misc.getPreviousNotifications.useInfiniteQuery(
    { limit: 20 },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  const notifications = data?.pages.map((page) => page.data).flat();

  // Mutations
  const { mutate: submitNotification, isPending: l2 } =
    api.misc.submitNotification.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await utils.profile.getUser.invalidate();
        await utils.misc.getPreviousNotifications.invalidate();
      },
    });

  // Pagination
  useInfinitePagination({
    fetchNextPage,
    hasNextPage,
    lastElement,
  });

  // Form control
  const {
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<MutateContentSchema>({
    resolver: zodResolver(mutateContentSchema),
  });

  // User search
  const maxUsers = 1;
  const userSearchSchema = getSearchValidator({ max: maxUsers });
  const userSearchMethods = useForm<z.infer<typeof userSearchSchema>>({
    resolver: zodResolver(userSearchSchema),
    defaultValues: { username: "", users: [] },
  });
  const watchedUsers = useWatch({
    control: userSearchMethods.control,
    name: "users",
    defaultValue: [],
  });
  const targetUser = watchedUsers?.[0];

  useEffect(() => {
    if (userData && userData.username && watchedUsers.length === 0) {
      userSearchMethods.setValue("users", [userData]);
    }
  }, [userData, userSearchMethods, watchedUsers]);

  // Handling submit
  const onSubmit = handleSubmit((data) => {
    if (targetUser) {
      submitNotification({ ...data, senderId: targetUser.userId });
      reset();
    }
  });

  // Show loading indicator when loading user data
  if (!userData) {
    return <Loader explanation="Loading user data" />;
  }

  const canSubmit = canSubmitNotification(userData.role);

  return (
    <>
      {canSubmit && (
        <ContentBox
          title="Submit New"
          subtitle="Push notifications to all users"
          initialBreak={true}
        >
          {l2 && <Loader explanation="Submitting notification" />}
          {!l2 && (
            <div className="grid grid-cols-1">
              <form onSubmit={onSubmit}>
                <UserSearchSelect
                  useFormMethods={userSearchMethods}
                  label="Sender (AI, or yourself)"
                  selectedUsers={[]}
                  showYourself={true}
                  inline={true}
                  maxUsers={maxUsers}
                />
                <RichInput
                  id="content"
                  height="200"
                  control={control}
                  onSubmit={onSubmit}
                  error={errors.content?.message}
                />
              </form>
            </div>
          )}
        </ContentBox>
      )}
      <ContentBox
        title="Notifications"
        subtitle="All Previous Notifications"
        initialBreak={true}
      >
        {l1 && <Loader explanation="Submitting notification" />}
        {!l1 && (
          <div className="grid grid-cols-1">
            {notifications?.map((entry, i) => {
              return (
                <div
                  key={i}
                  ref={i === notifications.length - 1 ? setLastElement : null}
                >
                  <Post align_middle={true}>
                    <div className="flex flex-row">
                      <div className="w-20 grow-0 shrink-0">
                        {entry.user && (
                          <AvatarImage
                            href={entry.user.avatar}
                            userId={entry.user.userId}
                            alt={entry.user.username}
                            size={100}
                          />
                        )}
                      </div>
                      <div className="ml-2">
                        {parseHtml(entry.content)}
                        <div className="mt-2 italic">
                          By {entry?.user?.username || "Unknown"} on{" "}
                          {entry.createdAt.toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  </Post>
                </div>
              );
            })}
          </div>
        )}
      </ContentBox>
    </>
  );
};
