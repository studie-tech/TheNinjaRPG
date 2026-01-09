"use client";

import React, { useState, useEffect } from "react";
import Image from "@/layout/Image";
import Link from "next/link";
import ContentBox from "@/layout/ContentBox";
import BanInfo from "@/layout/BanInfo";
import Confirm2 from "@/layout/Confirm2";
import Loader from "@/layout/Loader";
import Countdown from "@/layout/Countdown";
import NavTabs from "@/layout/NavTabs";
import AvatarImage from "@/layout/Avatar";
import PublicUserComponent from "@/layout/PublicUser";
import UserRequestSystem from "@/layout/UserRequestSystem";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { Handshake, LandPlot, DoorOpen, Swords } from "lucide-react";
import { CircleArrowUp, Lock, LockOpen, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { showMutationToast } from "@/libs/toast";
import { secondsPassed, secondsFromDate } from "@/utils/time";
import { DoorClosed, ShieldPlus } from "lucide-react";
import { api } from "@/app/_trpc/client";
import { useRequiredUserData } from "@/utils/UserContext";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import { canTakeKage } from "@/utils/permissions";
import { canChallengeKage } from "@/utils/kage";
import { findRelationship } from "@/utils/alliance";
import { KAGE_PRESTIGE_REQUIREMENT } from "@/drizzle/constants";
import { KAGE_CHALLENGE_SECS, KAGE_CHALLENGE_MINS } from "@/drizzle/constants";
import {
  KAGE_RANK_REQUIREMENT,
  WAR_FUNDS_COST,
  KAGE_DELAY_SECS,
} from "@/drizzle/constants";
import { KAGE_PRESTIGE_COST } from "@/drizzle/constants";
import { KAGE_MIN_DAYS_IN_VILLAGE } from "@/drizzle/constants";
import { KAGE_CHALLENGE_MAX_DAILY_LOCKED_HOURS } from "@/drizzle/constants";
import { getSearchValidator } from "@/validators/register";
import { useForm, useWatch } from "react-hook-form";
import { useLocalStorage } from "@/hooks/localstorage";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Village, VillageAlliance } from "@/drizzle/schema";
import type { UserWithRelations } from "@/routers/profile";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Modal2 from "@/layout/Modal2";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { calculateEnemyConsequences } from "@/utils/alliance";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { WarRoom } from "@/layout/WarSystem";
import { ShrineHall } from "@/layout/ShrineHall";

export default function TownHall() {
  const { data: userData } = useRequiredUserData();
  const availableTabs = userData?.isOutlaw
    ? ["Alliance", "Wars", "Shrines"]
    : ["Alliance", "Kage", "Elders", "Wars", "Shrines"];
  const [tab, setTab] = useLocalStorage<(typeof availableTabs)[number] | null>(
    "townhallTab",
    null,
    true,
  );

  if (!userData) return <Loader explanation="Loading userdata" />;
  if (userData.isBanned) return <BanInfo />;

  const NavBarBlock = (
    <NavTabs
      id={`townhallSelection-${userData.villageId}`}
      current={tab}
      options={availableTabs}
      setValue={setTab}
    />
  );

  if (tab === "Alliance" || !tab) {
    return <AllianceHall user={userData} navTabs={NavBarBlock} />;
  } else if (tab === "Kage") {
    return <KageHall user={userData} navTabs={NavBarBlock} />;
  } else if (tab === "Elders") {
    return <ElderHall user={userData} navTabs={NavBarBlock} />;
  } else if (tab === "Wars") {
    return <WarRoom user={userData} navTabs={NavBarBlock} />;
  } else if (tab === "Shrines") {
    return <ShrineHall user={userData} navTabs={NavBarBlock} />;
  }
}

const ElderHall: React.FC<{
  user: NonNullable<UserWithRelations>;
  navTabs: React.ReactNode;
}> = ({ user, navTabs }) => {
  // API utility
  const utils = api.useUtils();

  // Fetch elders
  const { data: elders, isPending } = api.kage.getElders.useQuery(
    { villageId: user.villageId ?? "" },
    { staleTime: 10000, enabled: !!user.villageId },
  );

  // Mutations for promoting & resigning elders
  const { mutate: toggleElder } = api.kage.toggleElder.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.kage.getElders.invalidate();
      }
    },
  });

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

  // Derived
  const isKage = user.userId === user.village?.kageId;

  return (
    <>
      {/* MAIN INFORMATION */}
      <ContentBox
        title="Town Hall"
        subtitle="Elders Council"
        defaultBackHref="/village"
        topRightContent={navTabs}
      >
        <p className="pb-2">
          The Elder Council, composed of respected individuals, advises the Kage and
          ensures the village&apos;s prosperity. Known for their wisdom and leadership,
          they guide crucial decisions, maintain order, and uphold traditions. Chosen
          for their skills and dedication, these experienced ninjas play a vital role in
          shaping the village&apos;s future and its continued success.
        </p>
      </ContentBox>
      {/* SHOW ELDERS */}
      {elders && elders.length > 0 && (
        <ContentBox
          title="Current Elders"
          initialBreak={true}
          subtitle={`Currently elected elders in the village`}
        >
          {isPending && <Loader explanation="Loading Elders" />}
          <div className="grid grid-cols-3 pt-3">
            {elders?.map((elder, i) => (
              <div key={i} className="relative">
                <Link href={`/userid/${elder.userId}`} className="text-center">
                  <AvatarImage
                    href={elder.avatar}
                    alt={elder.username}
                    userId={elder.userId}
                    hover_effect={true}
                    priority={true}
                    size={100}
                  />
                  <div>
                    <div className="font-bold">{elder.username}</div>
                    <div>
                      Lvl. {elder.level} {capitalizeFirstLetter(elder.rank)}
                    </div>
                  </div>
                  {isKage &&
                    (() => {
                      const threeDaysAgo = new Date(
                        Date.now() - KAGE_DELAY_SECS * 1000,
                      );
                      const canRemove =
                        user.village?.leaderUpdatedAt &&
                        new Date(user.village.leaderUpdatedAt) <= threeDaysAgo;
                      return canRemove ? (
                        <Confirm2
                          title="Confirm Demotion"
                          button={
                            <Ban className="absolute right-[13%] top-[3%] h-9 w-9 cursor-pointer rounded-full bg-slate-300 p-1 hover:text-orange-500" />
                          }
                          onAccept={(e) => {
                            e.preventDefault();
                            toggleElder({
                              userId: elder.userId,
                              villageId: elder.villageId,
                            });
                          }}
                        >
                          You are about to remove this user as a village elder. Are you
                          sure?
                        </Confirm2>
                      ) : (
                        <div className="absolute right-[13%] top-[3%] h-9 w-9 rounded-full bg-gray-200 p-1 flex items-center justify-center">
                          <span className="text-xs text-gray-500">3d</span>
                        </div>
                      );
                    })()}
                </Link>
              </div>
            ))}
          </div>
        </ContentBox>
      )}
      {/* KAGE CONTROL */}
      {isKage && (
        <ContentBox
          title="Appoint Elder"
          initialBreak={true}
          subtitle="Search for someone to promote to elder"
        >
          <p className="pb-2"></p>
          <UserSearchSelect
            useFormMethods={userSearchMethods}
            label="Search for receiver"
            selectedUsers={[]}
            showYourself={false}
            showAi={false}
            inline={true}
            maxUsers={maxUsers}
          />
          {targetUser && (
            <div>
              {targetUser.rank !== "JONIN" && targetUser.rank !== "ELITE JONIN" && (
                <p className="text-red-500 font-bold text-center pt-2">
                  User must be at least Jonin!
                </p>
              )}
              {(targetUser.rank === "JONIN" || targetUser.rank === "ELITE JONIN") && (
                <Button
                  id="promote"
                  className="mt-2 w-full"
                  onClick={() =>
                    toggleElder({
                      userId: targetUser.userId,
                      villageId: user.villageId,
                    })
                  }
                >
                  <CircleArrowUp className="h-5 w-5 mr-2" />
                  Promote
                </Button>
              )}
            </div>
          )}
        </ContentBox>
      )}
    </>
  );
};

/**
 * Kage Overview Component
 */
const KageHall: React.FC<{
  user: NonNullable<UserWithRelations>;
  navTabs: React.ReactNode;
}> = ({ user, navTabs }) => {
  // Ability to update user
  const { updateUser } = useRequiredUserData();

  // tRPC utility
  const utils = api.useUtils();

  // Query
  const { data: village, isPending } = api.village.get.useQuery(
    { id: user.villageId ?? "" },
    { staleTime: 10000, enabled: !!user.villageId },
  );

  const { mutate: resign, isPending: isResigning } = api.kage.resignKage.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.village.get.invalidate();
      }
    },
  });

  const { mutate: sendKagePrestige, isPending: isSendingPrestige } =
    api.kage.sendKagePrestige.useMutation({
      onSuccess: async (data, variables) => {
        showMutationToast(data);
        if (data.success) {
          await updateUser({
            villagePrestige: user.villagePrestige - variables.amount,
          });
        }
      },
    });

  // Derived
  const isKage = user.userId === village?.villageData.kageId;
  const isElder = user.rank === "ELDER";

  // Schema for prestige sending
  const prestigeSchema = z.object({
    amount: z.coerce
      .number()
      .int()
      .positive()
      .max(user.villagePrestige ?? 0)
      .optional(),
  });

  // Form for prestige sending
  const prestigeForm = useForm<z.infer<typeof prestigeSchema>>({
    resolver: zodResolver(prestigeSchema),
  });

  // Submit handler for prestige
  const onSendPrestige = prestigeForm.handleSubmit((data) => {
    sendKagePrestige({
      kageId: village?.villageData.kageId ?? "",
      amount: data.amount ?? 0,
    });
    prestigeForm.reset();
  });

  // Checks
  if (!user.villageId) return <Loader explanation="Join a village first" />;
  if (isPending || !village) return <Loader explanation="Loading village" />;
  if (isResigning) return <Loader explanation="Resigning as Kage" />;
  if (isSendingPrestige) return <Loader explanation="Sending prestige" />;

  // Render
  return (
    <>
      <ContentBox
        title="Town Hall"
        subtitle="Kage Challenge"
        defaultBackHref="/village"
        topRightContent={navTabs}
      >
        <p>
          The &quot;Kage&quot; is the village&apos;s most potent and skilled ninja,
          given the esteemed responsibility of safeguarding its people. As the
          highest-ranking authority in the village, the Kage carries the burden of
          making critical decisions and ensures the village&apos;s prosperity. Their
          duty includes defending the village from external threats, maintaining order
          within, deciding missions for their fellow ninjas, and training the next
          generation of warriors. The Kage is a symbol of strength, wisdom, and dignity,
          known to have the power to shape the destiny of the village.
        </p>
        {isKage && (
          <Button
            id="challenge"
            className="my-2 w-full"
            onClick={() => resign({ villageId: village.villageData.id })}
          >
            <DoorClosed className="h-6 w-6 mr-2" />
            Resign as Kage
          </Button>
        )}

        {isElder && (
          <Form {...prestigeForm}>
            <form onSubmit={onSendPrestige} className="relative my-2">
              <FormField
                control={prestigeForm.control}
                name="amount"
                render={({ field }) => (
                  <FormItem className="w-full flex flex-col">
                    <FormControl>
                      <Input
                        id="amount"
                        placeholder={`Send prestige (max ${user.villagePrestige})`}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button className="absolute top-0 right-0" type="submit">
                <CircleArrowUp className="h-5 w-5" />
              </Button>
            </form>
          </Form>
        )}
      </ContentBox>
      <PublicUserComponent
        userId={village.villageData.kageId}
        title={user.isOutlaw ? "Faction Kage" : "Village Kage"}
        initialBreak
      />
      <KageChallenge user={user} />
      {village.defendedChallenges && village.defendedChallenges.length > 0 && (
        <ContentBox
          title="Challenge Record"
          subtitle="Kage Challenges & Outcomes"
          initialBreak={true}
        >
          <div className="grid grid-cols-4 lggrid-cols-5">
            {village.defendedChallenges.map((challenge, i) => (
              <div key={i} className="p-2 text-center">
                <Link href={`/userid/${challenge.userId}`}>
                  <AvatarImage
                    href={challenge.user.avatar}
                    alt={challenge.user.username}
                    hover_effect={true}
                    size={200}
                  />
                  {challenge.didWin > 0 ? (
                    <p className="font-bold text-green-500 text-sm">
                      Won, {challenge.rounds} rounds
                    </p>
                  ) : (
                    <p className="font-bold text-red-500 text-sm">
                      Lost, {challenge.rounds} rounds
                    </p>
                  )}
                  <p className="italic text-xs">
                    {challenge.createdAt.toLocaleDateString()}
                  </p>
                  <p className="italic text-xs">
                    {challenge.createdAt.toLocaleTimeString()}
                  </p>
                </Link>
              </div>
            ))}
          </div>
        </ContentBox>
      )}
    </>
  );
};

/**
 * Kage challenge component
 */
const KageChallenge: React.FC<{
  user: NonNullable<UserWithRelations>;
}> = ({ user }) => {
  // tRPC utility
  const utils = api.useUtils();

  // Modal state
  const [showTakeKageModal, setShowTakeKageModal] = useState(false);
  const [takeKageReason, setTakeKageReason] = useState("");

  // Queries
  const { data: requests, isPending: isPendingRequests } =
    api.kage.getUserChallenges.useQuery(undefined, {
      staleTime: 10000,
    });

  const { data: activeWars } = api.war.getActiveWars.useQuery(
    { villageId: user.villageId ?? "" },
    { staleTime: 10000, enabled: !!user.villageId },
  );

  // Derived
  const isKage = user.userId === user.village?.kageId;

  const { data: dailyLockedTimeData } = api.kage.getDailyLockedTime.useQuery(
    undefined,
    {
      staleTime: 30000, // Cache for 30 seconds since this is calculated from actionLog
      enabled: isKage, // Only fetch if user is kage
    },
  );

  // Derived
  const activeVillageWars = activeWars?.filter((w) => w.type === "VILLAGE_WAR");
  const openForChallenges = user.village?.openForChallenges;
  const pendingRequests = requests?.filter((r) => r.status === "PENDING");
  const nPendingRequests = pendingRequests?.length ?? 0;
  const activeRequest = pendingRequests?.[0];
  const expiredRequest = pendingRequests?.find(
    (r) => secondsPassed(r.createdAt) > KAGE_CHALLENGE_SECS,
  );
  const isAtWar = activeVillageWars && activeVillageWars.length > 0;

  // Calculate daily locked time information
  const dailyLockedTimeSeconds = dailyLockedTimeData?.dailyLockedTimeSeconds ?? 0;
  const maxDailySeconds = KAGE_CHALLENGE_MAX_DAILY_LOCKED_HOURS * 60 * 60;
  const usedHours = Math.floor(dailyLockedTimeSeconds / 3600);
  const usedMinutes = Math.floor((dailyLockedTimeSeconds % 3600) / 60);

  // Mutations
  const { mutate: create, isPending: isSendingChallenge } =
    api.kage.createChallenge.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.kage.getUserChallenges.invalidate();
        }
      },
    });

  const { mutate: accept, isPending: isAccepting } =
    api.kage.acceptChallenge.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.kage.getUserChallenges.invalidate();
        }
      },
    });

  const { mutate: reject, isPending: isRejecting } =
    api.kage.rejectChallenge.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.kage.getUserChallenges.invalidate();
        }
      },
    });

  const { mutate: cancel, isPending: isCancelling } =
    api.kage.cancelChallenge.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.kage.getUserChallenges.invalidate(),
            utils.profile.getUser.invalidate(),
          ]);
        }
      },
    });

  const { mutate: take, isPending: isTaking } = api.kage.takeKage.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await Promise.all([
          utils.village.get.invalidate(),
          utils.profile.getUser.invalidate(),
        ]);
        setShowTakeKageModal(false);
        setTakeKageReason("");
      }
    },
  });

  const { mutate: toggleChallenges, isPending: isToggling } =
    api.kage.toggleOpenForChallenges.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.village.get.invalidate(),
            utils.profile.getUser.invalidate(),
          ]);
        }
      },
    });

  // If challenge if over the limit, execute the AI vs AI battle
  useEffect(() => {
    if (expiredRequest && !isKage) {
      cancel({ id: expiredRequest.id });
    }
  }, [cancel, expiredRequest, isKage]);

  // Render
  return (
    <ContentBox
      title="Kage Challenges"
      subtitle="The strongest shall rule"
      initialBreak={true}
      padding={false}
    >
      {isAtWar ? (
        <p className="p-3 text-red-500 font-bold text-center">
          Kage challenges are disabled while the village is at war
        </p>
      ) : (
        <>
          <p className="p-3">
            <Button
              className="w-full"
              disabled={!isKage}
              loading={isToggling}
              onClick={() => toggleChallenges({ villageId: user.villageId ?? "" })}
            >
              {openForChallenges ? (
                <LockOpen className="h-6 w-6 mr-2" />
              ) : (
                <Lock className="h-6 w-6 mr-2" />
              )}
              {openForChallenges ? "Accepting Challenges" : "Not Accepting Challenges"}
            </Button>
          </p>
          {isKage && (
            <div className="p-3 text-sm text-gray-600">
              <p>
                <span className="font-bold">Daily Lock Time Used: </span>
                <span
                  className={
                    dailyLockedTimeSeconds >= maxDailySeconds
                      ? "text-red-500 font-bold"
                      : ""
                  }
                >
                  {usedHours}h {usedMinutes}m / {KAGE_CHALLENGE_MAX_DAILY_LOCKED_HOURS}h
                </span>
              </p>
              {dailyLockedTimeSeconds >= maxDailySeconds ? (
                <p className="text-red-500 font-bold">
                  Daily limit reached! Challenges will be automatically unlocked at the
                  start of the next day.
                </p>
              ) : (
                <p>
                  <span className="font-bold">Remaining Lock Time: </span>
                  <Countdown
                    targetDate={new Date(new Date().setHours(24, 0, 0, 0))}
                    className="font-mono"
                  />
                </p>
              )}
            </div>
          )}
          {requests && requests.length > 0 && openForChallenges && (
            <UserRequestSystem
              isLoading={
                isAccepting ||
                isRejecting ||
                isCancelling ||
                isSendingChallenge ||
                isPendingRequests
              }
              requests={requests}
              userId={user.userId}
              onAccept={accept}
              onReject={reject}
              onCancel={cancel}
            />
          )}
          {requests && requests.length === 0 && isKage && openForChallenges && (
            <p className="p-3">No current challenge requests</p>
          )}
          {activeRequest && (
            <div className="p-3 flex flex-col items-center">
              <p>If not accepted by kage, challenge will execute as Ai vs Ai in:</p>
              <Countdown
                targetDate={secondsFromDate(
                  KAGE_CHALLENGE_SECS,
                  activeRequest.createdAt,
                )}
              />
            </div>
          )}
          {!isKage && openForChallenges && !activeRequest && (
            <div className="p-3">
              {canChallengeKage(user) && !nPendingRequests && (
                <>
                  <Button
                    id="challenge"
                    className="my-2 w-full"
                    onClick={() => {
                      if (user.village) {
                        create({
                          kageId: user.village.kageId,
                          villageId: user.village.id,
                        });
                      }
                    }}
                  >
                    <Swords className="h-6 w-6 mr-2" />
                    Send Kage Challenge Request
                  </Button>
                  <p>
                    <span className="font-bold">Note 1: </span>
                    <span>
                      Kage has {KAGE_CHALLENGE_MINS}mins to accept the challenge
                    </span>
                  </p>
                  <p>
                    <span className="font-bold">Note 2: </span>
                    <span>
                      If challenge is not accepted, it is executed as AI vs AI
                    </span>
                  </p>
                  <p>
                    <span className="font-bold">Note 3: </span>
                    <span>
                      Losing the challenge costs {KAGE_PRESTIGE_COST} village prestige
                    </span>
                  </p>
                  {user.rank === "ELDER" && (
                    <p>
                      <span className="font-bold">Note 4: </span>
                      <span>You will lose the rank of Elder in the village</span>
                    </p>
                  )}
                </>
              )}
              <p className="pt-3">
                <span className="font-bold">Challenge Requirements: </span>
                <span>
                  {KAGE_PRESTIGE_REQUIREMENT} village prestige,{" "}
                  {capitalizeFirstLetter(KAGE_RANK_REQUIREMENT)} rank and{" "}
                  {KAGE_MIN_DAYS_IN_VILLAGE} days in village.
                </span>
              </p>
            </div>
          )}
        </>
      )}
      {!isKage && canTakeKage(user.role) && (
        <div className="p-3">
          <Button
            id="challenge"
            variant="destructive"
            className="my-2 w-full"
            onClick={() => setShowTakeKageModal(true)}
            loading={isTaking}
          >
            <ShieldPlus className="h-6 w-6 mr-2" />
            Take kage as Staff
          </Button>
        </div>
      )}

      {/* Take Kage Modal */}
      {showTakeKageModal && (
        <Modal2
          title="Take Kage as Staff"
          isOpen={showTakeKageModal}
          setIsOpen={setShowTakeKageModal}
          proceed_label="Take Kage"
          confirmClassName="bg-red-600 hover:bg-red-700"
          onAccept={() => {
            if (takeKageReason.trim().length >= 10) {
              take({ reason: takeKageReason.trim() });
            } else {
              showMutationToast({
                success: false,
                message: "Reason must be at least 10 characters long",
              });
            }
          }}
          isValid={takeKageReason.trim().length >= 10}
        >
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              You are about to take the kage position as staff. This action will be
              logged and should only be used for administrative purposes.
            </p>

            <div className="space-y-2">
              <Label htmlFor="reason">Reason *</Label>
              <Input
                id="reason"
                value={takeKageReason}
                onChange={(e) => setTakeKageReason(e.target.value)}
                placeholder="Enter reason for taking kage position (minimum 10 characters)..."
              />
              <p className="text-xs text-muted-foreground">
                This reason will be logged in the action log. Minimum 10 characters
                required.
              </p>
            </div>
          </div>
        </Modal2>
      )}
    </ContentBox>
  );
};

/**
 * Alliance Overview Component
 */
const AllianceHall: React.FC<{
  user: NonNullable<UserWithRelations>;
  navTabs: React.ReactNode;
}> = ({ user, navTabs }) => {
  // Queries
  const { data, isPending } = api.village.getAlliances.useQuery(undefined, {
    staleTime: 10000,
  });

  // tRPC utility
  const utils = api.useUtils();

  // Mutations
  const { mutate: accept, isPending: isAccepting } =
    api.village.acceptRequest.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.village.getAlliances.invalidate();
        }
      },
    });

  const { mutate: reject, isPending: isRejecting } =
    api.village.rejectRequest.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.village.getAlliances.invalidate();
        }
      },
    });

  const { mutate: cancel, isPending: isCancelling } =
    api.village.cancelRequest.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.village.getAlliances.invalidate();
        }
      },
    });

  if (isPending || !data) return <Loader explanation="Loading alliances" />;

  // All villages and factions with alliance system enabled
  const allVillages = data.villages.filter((v) => v.allianceSystem);
  const relationships = data.relationships;
  const requests = data.requests;

  return (
    <>
      <ContentBox
        id="tutorial-townhall-alliance"
        title={user.isOutlaw ? "Rumours" : "Town Hall"}
        subtitle="Alliances & Relations"
        defaultBackHref="/village"
        topRightContent={navTabs}
      >
        <AllianceList
          user={user}
          villages={allVillages}
          relationships={relationships}
        />
      </ContentBox>
      {requests && requests.length > 0 && (
        <ContentBox
          title="Current Requests"
          subtitle="Sent to or from you"
          initialBreak={true}
          padding={false}
        >
          <UserRequestSystem
            isLoading={isAccepting || isRejecting || isCancelling}
            requests={requests}
            userId={user.userId}
            onAccept={accept}
            onReject={reject}
            onCancel={cancel}
          />
        </ContentBox>
      )}
    </>
  );
};

/**
 * Alliance List Component
 * Displays a searchable/filterable list of all villages and factions with alliance actions
 */
const AllianceList: React.FC<{
  user: NonNullable<UserWithRelations>;
  villages: Village[];
  relationships: VillageAlliance[];
}> = ({ user, villages, relationships }) => {
  const utils = api.useUtils();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "ALL" | "ALLY" | "ENEMY" | "NEUTRAL"
  >("ALL");
  const [typeFilter, setTypeFilter] = useState<"ALL" | "VILLAGE" | "FACTION">("ALL");

  // Filter all villages/factions (exclude user's own)
  const allEntities = villages.filter(
    (v) => v.allianceSystem && v.id !== user.villageId,
  );

  // Apply search, status, and type filters
  const filteredEntities = allEntities
    .filter((entity) => {
      // Search filter
      const matchesSearch = entity.name.toLowerCase().includes(search.toLowerCase());
      if (!matchesSearch) return false;

      // Type filter
      if (typeFilter === "VILLAGE" && !["VILLAGE", "OUTLAW"].includes(entity.type)) {
        return false;
      }
      if (typeFilter === "FACTION" && !["HIDEOUT", "TOWN"].includes(entity.type)) {
        return false;
      }

      // Status filter
      if (statusFilter === "ALL") return true;
      const relationship = findRelationship(relationships, user.villageId, entity.id);
      const status = relationship?.status || "NEUTRAL";
      return status === statusFilter;
    })
    // Sort: villages first, then factions, alphabetically within each group
    .sort((a, b) => {
      const aIsVillage = ["VILLAGE", "OUTLAW"].includes(a.type);
      const bIsVillage = ["VILLAGE", "OUTLAW"].includes(b.type);
      if (aIsVillage && !bIsVillage) return -1;
      if (!aIsVillage && bIsVillage) return 1;
      return a.name.localeCompare(b.name);
    });

  // Mutations
  const { mutate: create, isPending: isCreating } =
    api.village.createRequest.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.village.getAlliances.invalidate();
        }
      },
    });

  const { mutate: leave, isPending: isLeaving } = api.village.leaveAlliance.useMutation(
    {
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.village.getAlliances.invalidate();
        }
      },
    },
  );

  const { mutate: attack, isPending: isAttacking } =
    api.village.declareEnemy.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.village.getAlliances.invalidate();
        }
      },
    });

  const isKage = user.userId === user.village?.kageId;
  const isLoading = isCreating || isLeaving || isAttacking;

  return (
    <div className="space-y-4">
      {/* Search and Filters */}
      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Search villages & factions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[150px]"
        />
        <Select
          value={typeFilter}
          onValueChange={(v) => setTypeFilter(v as "ALL" | "VILLAGE" | "FACTION")}
        >
          <SelectTrigger className="w-[110px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Types</SelectItem>
            <SelectItem value="VILLAGE">Villages</SelectItem>
            <SelectItem value="FACTION">Factions</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(v) =>
            setStatusFilter(v as "ALL" | "ALLY" | "ENEMY" | "NEUTRAL")
          }
        >
          <SelectTrigger className="w-[110px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Status</SelectItem>
            <SelectItem value="ALLY">Allies</SelectItem>
            <SelectItem value="ENEMY">Enemies</SelectItem>
            <SelectItem value="NEUTRAL">Neutral</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Entity List */}
      <div className="space-y-2">
        {filteredEntities.map((entity) => (
          <AllianceCard
            key={entity.id}
            entity={entity}
            user={user}
            relationships={relationships}
            villages={villages}
            isKage={isKage}
            onCreate={create}
            onLeave={leave}
            onAttack={attack}
            isLoading={isLoading}
          />
        ))}
        {filteredEntities.length === 0 && (
          <p className="text-center text-muted-foreground py-4">
            No villages or factions found
          </p>
        )}
      </div>
    </div>
  );
};

/**
 * Alliance Card Component
 * Displays a single village or faction with its alliance status and actions
 */
const AllianceCard: React.FC<{
  entity: Village;
  user: NonNullable<UserWithRelations>;
  relationships: VillageAlliance[];
  villages: Village[];
  isKage: boolean;
  onCreate: (params: { targetId: string; type: "ALLIANCE" | "SURRENDER" }) => void;
  onLeave: (params: { allianceId: string }) => void;
  onAttack: (params: { villageId: string }) => void;
  isLoading: boolean;
}> = ({
  entity,
  user,
  relationships,
  villages,
  isKage,
  onCreate,
  onLeave,
  onAttack,
  isLoading,
}) => {
  const relationship = findRelationship(relationships, user.villageId, entity.id);
  const status = relationship?.status || "NEUTRAL";
  const { ally, enemy, newEnemies, newNeutrals } = calculateEnemyConsequences(
    relationships,
    villages,
    user.villageId ?? "",
    entity.id,
  );

  // Determine entity type display
  const isVillage = ["VILLAGE", "OUTLAW"].includes(entity.type);
  const typeLabel = isVillage ? "Village" : "Faction";
  const typeColors = isVillage
    ? "text-blue-600 bg-blue-100"
    : "text-purple-600 bg-purple-100";

  const statusColors: Record<string, string> = {
    ALLY: "text-green-600 bg-green-100",
    ENEMY: "text-red-600 bg-red-100",
    NEUTRAL: "text-slate-600 bg-slate-100",
  };

  return (
    <div className="flex items-center justify-between p-3 border rounded-lg">
      <div className="flex items-center gap-3">
        <Image
          src={entity.villageGraphic}
          alt={entity.name}
          width={40}
          height={40}
          className="rounded"
        />
        <div>
          <p className="font-bold">{entity.name}</p>
          <div className="flex gap-1">
            <span className={`text-xs px-2 py-0.5 rounded ${typeColors}`}>
              {typeLabel}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded ${statusColors[status]}`}>
              {capitalizeFirstLetter(status)}
            </span>
          </div>
        </div>
      </div>

      {isKage && !isLoading && (
        <div className="flex gap-2">
          {ally.success && status === "NEUTRAL" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onCreate({ targetId: entity.id, type: "ALLIANCE" })}
              title="Request Alliance"
            >
              <Handshake className="h-4 w-4" />
            </Button>
          )}
          {status === "ALLY" && relationship && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onLeave({ allianceId: relationship.id })}
              title="Leave Alliance"
            >
              <DoorOpen className="h-4 w-4" />
            </Button>
          )}
          {enemy.success && status !== "ENEMY" && (
            <Confirm2
              title="Declare Enemy"
              onAccept={(e) => {
                e.preventDefault();
                onAttack({ villageId: entity.id });
              }}
              button={
                <Button size="sm" variant="outline" title="Declare Enemy">
                  <Swords className="h-4 w-4" />
                </Button>
              }
            >
              <p>
                Declare {entity.name} as enemy? Cost: {WAR_FUNDS_COST.toLocaleString()}{" "}
                tokens.
              </p>
              {newEnemies.length > 0 && (
                <p className="text-red-500">
                  Additional enemies: {newEnemies.map((v) => v.name).join(", ")}
                </p>
              )}
              {newNeutrals.length > 0 && (
                <p className="text-yellow-500">
                  Broken alliances: {newNeutrals.map((v) => v.name).join(", ")}
                </p>
              )}
            </Confirm2>
          )}
          {status === "ENEMY" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onCreate({ targetId: entity.id, type: "SURRENDER" })}
              title="Request Surrender"
            >
              <LandPlot className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
      {isLoading && <Loader explanation="" />}
    </div>
  );
};
