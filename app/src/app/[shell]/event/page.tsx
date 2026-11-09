"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { GAME_SETTING_GAINS_MULTIPLIER } from "@/drizzle/constants";
import AvatarImage from "@/layout/Avatar";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import Post from "@/layout/Post";
import RichInput from "@/layout/RichInput";
import SliderField from "@/layout/SliderField";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { useInfinitePagination } from "@/libs/pagination";
import { showMutationToast } from "@/libs/toast";
import { parseHtml } from "@/utils/parse";
import {
  canModifyEventGains,
  canSubmitNotification,
  canUseMonitoringTests,
} from "@/utils/permissions";
import { useRecipientPicker } from "@/utils/search";
import { DAY_S, secondsPassed } from "@/utils/time";
import { useRequiredUserData } from "@/utils/UserContext";
import { type MutateContentSchema, mutateContentSchema } from "@/validators/comments";
import { type ChangeSettingSchema, changeSettingSchema } from "@/validators/misc";

export default function NotifyUsers() {
  return (
    <>
      <EventGainMultiplierPanel
        setting="regenGainMultiplier"
        title="Regen Multiplier"
        subtitle="Modify regen gains globally"
      />
      <EventGainMultiplierPanel
        setting="trainingGainMultiplier"
        title="Training Multiplier"
        subtitle="Modify training gains globally"
        initialBreak
      />
      <EventGainMultiplierPanel
        setting="battleExpMultiplier"
        title="Battle Experience Multiplier"
        subtitle="Modify battle experience gains globally (Arena & PvP)"
        initialBreak
      />
      <EventGainMultiplierPanel
        setting="missionExpMultiplier"
        title="Mission Experience Multiplier"
        subtitle="Modify mission/quest experience gains globally"
        initialBreak
      />
      <EventGainMultiplierPanel
        setting="jutsuExpMultiplier"
        title="Jutsu Experience Multiplier"
        subtitle="Modify jutsu experience gains globally"
        initialBreak
      />
      <EventGainMultiplierPanel
        setting="itemExpMultiplier"
        title="Item Experience Multiplier"
        subtitle="Modify item experience gains globally (PvP)"
        initialBreak
      />
      <TestErrorMonitoring />
      <NotificationSystem />
    </>
  );
}

const EventGainMultiplierPanel: React.FC<{
  setting: ChangeSettingSchema["setting"];
  title: string;
  subtitle: string;
  initialBreak?: boolean;
}> = ({ setting, title, subtitle, initialBreak }) => {
  const utils = api.useUtils();
  const {
    data: userData,
    timeDiff,
    prepareUserUpdate,
    updateUser,
  } = useRequiredUserData();
  const { data: settingData } = api.misc.getSetting.useQuery(
    { name: setting },
    { enabled: !!userData },
  );

  const { mutate: setEventGameSetting, isPending } =
    api.misc.setEventGameSetting.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.misc.getSetting.invalidate(),
            updateUser(data, { revision }),
          ]);
        }
      },
    });

  const form = useForm<ChangeSettingSchema>({
    resolver: zodResolver(changeSettingSchema),
    defaultValues: { setting, multiplier: "2", days: 0 },
  });
  const watchedDays = useWatch({
    control: form.control,
    name: "days",
    defaultValue: 2,
  });

  useEffect(() => {
    if (settingData) {
      const daysLeft = remainingEventDays(settingData.time, timeDiff);
      if (daysLeft < 0) form.setValue("days", -daysLeft);
    }
  }, [settingData, timeDiff, form]);

  if (!userData) return null;
  if (!canModifyEventGains(userData.role)) return null;

  return (
    <ContentBox title={title} subtitle={subtitle} initialBreak={initialBreak}>
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
            register={form.register}
            setValue={form.setValue}
            watchedValue={watchedDays}
            error={form.formState.errors.days?.message}
          />
          <div className="flex flex-row gap-2">
            {GAME_SETTING_GAINS_MULTIPLIER.map((multiplier) => (
              <Button
                id={`multiply-${setting}-${multiplier}`}
                className={`w-full ${settingData?.value === parseInt(multiplier, 10) ? "bg-green-700" : ""}`}
                key={`${setting}-${multiplier}`}
                onClick={() =>
                  setEventGameSetting({
                    setting,
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

const TestErrorMonitoring: React.FC = () => {
  // Set to throw during the next render
  const [shouldThrow, setShouldThrow] = useState(false);

  // Query data
  const { data: userData } = useRequiredUserData();

  // Trpc error trigger
  const trpcErrorMutation = api.staff.throwError.useMutation();
  const trpcTrpcErrorMutation = api.staff.throwTrpcError.useMutation();

  // Guard
  if (!userData) return null;
  if (!canUseMonitoringTests(userData.role)) return null;
  if (shouldThrow) throw new Error("Test render error");

  return (
    <ContentBox
      title="Monitoring Tests"
      subtitle="Test error monitoring"
      initialBreak={true}
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-row gap-2">
          <Button
            className="basis-1/2"
            onClick={() => {
              throw new Error("Test error");
            }}
          >
            Throw Error on Frontend
          </Button>
          <Button className="basis-1/2" onClick={() => setShouldThrow(true)}>
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
 * Notification System for sending out messages to all users
 */
const NotificationSystem: React.FC = () => {
  // User state
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  const { data: userData, prepareUserUpdate, updateUser } = useRequiredUserData();

  // utils
  const utils = api.useUtils();

  // Fetch historical notifications
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isPending: isLoadingNotifications,
  } = api.misc.getPreviousNotifications.useInfiniteQuery(
    { limit: 20 },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  const notifications = data?.pages.flatMap((page) => page.data);

  // Mutations
  const { mutate: submitNotification, isPending: isSubmitting } =
    api.misc.submitNotification.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        await Promise.all([
          ...(data.success ? [updateUser(data, { revision })] : []),
          utils.misc.getPreviousNotifications.invalidate(),
        ]);
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
    defaultValues: { content: "" },
  });

  // User search
  const maxUsers = 1;
  const { methods: userSearchMethods, user: targetUser } = useRecipientPicker(userData);

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
          {isSubmitting && <Loader explanation="Submitting notification" />}
          {!isSubmitting && (
            <div className="grid grid-cols-1">
              <form onSubmit={onSubmit}>
                <UserSearchSelect
                  useFormMethods={userSearchMethods}
                  label="Sender (AI, or yourself)"
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
        {isLoadingNotifications && <Loader explanation="Loading notifications" />}
        {!isLoadingNotifications && (
          <div className="grid grid-cols-1">
            {notifications?.map((entry, idx) => {
              return (
                <div
                  key={entry.id}
                  ref={idx === notifications.length - 1 ? setLastElement : null}
                >
                  <Post align_middle={true}>
                    <div className="flex flex-row">
                      <div className="w-20 shrink-0 grow-0">
                        {entry.user && (
                          <AvatarImage
                            href={entry.user.avatar}
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

/** Whole days since `settingTime`; negative while that time is still ahead. */
const remainingEventDays = (settingTime: Date, timeDiff?: number) =>
  Math.round(secondsPassed(settingTime, timeDiff) / DAY_S);
