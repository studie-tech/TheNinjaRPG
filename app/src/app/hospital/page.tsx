"use client";
import { Clock, FastForward, Hand, ScanHeart } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { IMG_BUILDING_HOSPITAL, MEDNIN_MIN_RANK } from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import StatusBar, { calcCurrent } from "@/layout/StatusBar";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import {
  calcChakraToPools,
  calcHealCost,
  calcHealFinish,
  calcMedninHealablePool,
  calcMedninRank,
  snapToThresholds,
} from "@/libs/hospital";
import { showUserRank } from "@/libs/profile";
import { showMutationToast } from "@/libs/toast";
import { hasRequiredRank } from "@/libs/train";
import { calcIsInVillage } from "@/libs/travel";
import type { UserWithRelations } from "@/routers/profile";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import type { ArrayElement } from "@/utils/typeutils";
import { useRequireInVillage } from "@/utils/UserContext";
import { getStrucBoost } from "@/utils/village";

export default function Hospital() {
  // Settings
  const { userData, notifications, access, timeDiff, updateUser, updateNotifications } =
    useRequireInVillage("/hospital");
  const isHospitalized = userData?.status === "HOSPITALIZED";

  // Current interest
  const boost = getStrucBoost("hospitalSpeedupPerLvl", userData?.village?.structures);

  // Mutations
  const { mutate: heal, isPending } = api.hospital.npcHeal.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      if (result.success && result.data) {
        await updateNotifications(notifications?.filter((n) => n.href !== "/hospital"));
        await updateUser({
          curHealth: result.data.curHealth,
          money: result.data.money,
          regenAt: result.data.regenAt,
          status: "AWAKE",
        });
      }
    },
  });

  // Heal finish time
  const healFinishAt = userData && calcHealFinish({ user: userData, timeDiff, boost });
  const healCost = userData && calcHealCost(userData);
  const canAfford = userData && healCost && userData.money >= healCost;
  const canHealOthers = hasRequiredRank(userData?.rank, MEDNIN_MIN_RANK);
  // If user is fully healed, allow immediate checkout
  const isFullyHealed = userData && userData.curHealth >= userData.maxHealth;

  // Heal finish time
  if (!userData) return <Loader explanation="Loading userdata" />;
  if (!access) return <Loader explanation="Accessing Hospital" />;

  // Hospital name
  const inVillage = calcIsInVillage({
    x: userData.longitude,
    y: userData.latitude,
  });
  const ownVillage = userData.sector === userData.village?.sector;
  const outlawOut = userData.isOutlaw && inVillage && !ownVillage;
  const hospitalName = outlawOut
    ? "Battlefield Healing"
    : `${userData.village?.name} Hospital`;
  const hospitalSubtitle = outlawOut
    ? "Fallen outlaws from all factions"
    : "Emergency Department";

  return (
    <ContentBox
      title={hospitalName}
      subtitle={hospitalSubtitle}
      defaultBackHref="/village"
      padding={false}
    >
      <Image
        alt="hospital-image"
        src={IMG_BUILDING_HOSPITAL}
        width={512}
        height={195}
        className="w-full"
        priority={true}
      />
      {!isPending && isHospitalized && userData && healFinishAt && (
        <div className="p-3">
          <p>
            {isFullyHealed
              ? "You are fully healed. You can check out now."
              : "You are hospitalized, either wait or pay to expedite treatment."}
          </p>
          <div className="grid grid-cols-2 gap-2 py-3" id="tutorial-hospital-buttons">
            <Button
              id="check"
              className="w-full"
              disabled={!isFullyHealed && healFinishAt && healFinishAt > new Date()}
              onClick={() => heal({ villageId: userData.villageId })}
            >
              <Clock className="mr-2 h-6 w-6" />
              <div>
                {isFullyHealed ? (
                  "Check Out"
                ) : (
                  <>Wait ({<Countdown targetDate={healFinishAt} />})</>
                )}
              </div>
            </Button>
            <Button
              id="check"
              className="w-full"
              color={canAfford ? "default" : "red"}
              disabled={isFullyHealed || (healFinishAt && healFinishAt <= new Date())}
              onClick={() => heal({ villageId: userData.villageId })}
            >
              {canAfford ? (
                <FastForward className="mr-3 h-6 w-6" />
              ) : (
                <Hand className="mr-3 h-6 w-6" />
              )}
              <div>Pay {healCost && <span>({healCost} ryo)</span>}</div>
            </Button>
          </div>
        </div>
      )}
      {!isPending && !isHospitalized && userData && !canHealOthers && (
        <p className="p-3">You are not hospitalized.</p>
      )}
      {!isPending && !isHospitalized && canHealOthers && (
        <HealOthersComponent
          userData={userData}
          timeDiff={timeDiff}
          updateUser={updateUser}
        />
      )}
      {isPending && <Loader explanation="Healing User" />}
    </ContentBox>
  );
}

/**
 * HealOthersComponent is a React functional component that allows users to heal other users in a hospital setting.
 * It calculates the maximum healing capacity based on the user's current chakra and updates it periodically.
 * The component also fetches the list of hospitalized users and provides buttons to heal them by different percentages.
 *
 */
interface HealOthersComponentProps {
  userData: NonNullable<UserWithRelations>;
  timeDiff: number;
  updateUser: (data: Partial<UserWithRelations>) => Promise<void>;
}

const HealOthersComponent: React.FC<HealOthersComponentProps> = (props) => {
  // Settings
  const { userData, timeDiff, updateUser } = props;

  const pools = calcMedninHealablePool(userData);
  const medninRank = calcMedninRank(userData);

  // tRPC utility
  const utils = api.useUtils();

  // Mutations
  const { mutate: userHeal, isPending } = api.hospital.userHeal.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      void utils.hospital.getHospitalizedUsers.invalidate();
      if (data.success && userData) {
        await updateUser({
          curChakra: userData.curChakra - (data.chakraCost || 0),
          medicalExperience: userData.medicalExperience + (data.expGain || 0),
        });
      }
    },
  });

  // Queries
  const { data: hospitalized } = api.hospital.getHospitalizedUsers.useQuery(undefined, {
    refetchInterval: 15000,
    enabled: !!userData,
  });

  const healThresholds = useMemo(
    () =>
      (hospitalized ?? []).flatMap((user) =>
        HEAL_PERCENTAGES.map((percentage) => user.maxHealth * percentage),
      ),
    [hospitalized],
  );
  // What the buttons compare against, read fresh: a refetch can replace patients, so a threshold
  // can arrive that falls between a stored sample and the real capacity, and an affordable button
  // would render disabled until an effect caught up.
  const maxHeal = currentHealCapacity(userData, timeDiff);
  // The sample is not rendered — it exists to schedule a re-render, and only when the answer to
  // one of those threshold questions changes, so regenerating chakra repaints this table when a
  // button becomes usable rather than once a second.
  const [, setCapacitySample] = useState(() => currentHealCapacity(userData, timeDiff));
  useEffect(() => {
    const sync = () => {
      const next = currentHealCapacity(userData, timeDiff);
      setCapacitySample((previous) =>
        snapToThresholds(next, healThresholds) ===
        snapToThresholds(previous, healThresholds)
          ? previous
          : next,
      );
    };
    // Spending chakra has to land straight away; only regeneration waits for a tick
    sync();
    if (hasFullChakra(userData, timeDiff)) return;
    const interval = setInterval(() => {
      sync();
      if (hasFullChakra(userData, timeDiff)) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [userData, timeDiff, healThresholds]);
  const allHospitalized = hospitalized
    ?.filter(
      (user) => calcIsInVillage({ x: user.longitude, y: user.latitude }) === true,
    )
    .map((user) => {
      const missingHealth = user.maxHealth - user.curHealth;
      return {
        ...user,
        info: (
          <div>
            {user.username}
            <span className="hidden sm:inline">
              , Lvl. {user.level} {showUserRank(user)}
            </span>
            <StatusBar
              key={`${user.curHealth}-${user.userId}`}
              title="HP"
              tooltip="Health"
              color="bg-red-500"
              showText={true}
              lastRegenAt={
                user.userId === userData.userId ? userData.regenAt : undefined
              }
              regen={
                user.userId === userData.userId ? userData.regeneration : undefined
              }
              status={user.status}
              current={user.curHealth}
              total={user.maxHealth}
              timeDiff={timeDiff}
            />
          </div>
        ),
        btns: (
          <div className="grid grid-cols-2 gap-1">
            <Button
              role="combobox"
              disabled={user.maxHealth * 0.25 > maxHeal}
              onClick={() => userHeal({ userId: user.userId, healPercentage: 25 })}
            >
              25%
            </Button>
            <Button
              role="combobox"
              disabled={
                user.maxHealth * 0.5 > maxHeal || missingHealth <= 0.25 * user.maxHealth
              }
              onClick={() => userHeal({ userId: user.userId, healPercentage: 50 })}
            >
              50%
            </Button>
            <Button
              role="combobox"
              disabled={
                user.maxHealth * 0.75 > maxHeal || missingHealth <= 0.5 * user.maxHealth
              }
              onClick={() => userHeal({ userId: user.userId, healPercentage: 75 })}
            >
              75%
            </Button>
            <Button
              role="combobox"
              disabled={
                user.maxHealth * 1.0 > maxHeal || missingHealth <= 0.75 * user.maxHealth
              }
              onClick={() => userHeal({ userId: user.userId, healPercentage: 100 })}
            >
              100%
            </Button>
          </div>
        ),
      };
    });
  type HospitalizedUser = ArrayElement<typeof allHospitalized>;

  // Table setup
  const columns: ColumnDefinitionType<HospitalizedUser, keyof HospitalizedUser>[] = [
    { key: "avatar", header: "", type: "avatar" },
    { key: "info", header: "Info", type: "jsx" },
    { key: "btns", header: "Heal", type: "jsx" },
  ];

  // Render
  return (
    <div>
      <div className="p-2">
        <Alert>
          <ScanHeart className="h-6 w-6" />
          <AlertTitle>Healing Capacity</AlertTitle>
          <AlertDescription>
            Your current medicial rank is {capitalizeFirstLetter(medninRank)}. You can
            heal up to <HealCapacity userData={userData} timeDiff={timeDiff} />{" "}
            {pools.join(", ")} at a time.
          </AlertDescription>
        </Alert>
      </div>
      {allHospitalized && allHospitalized.length > 0 ? (
        <Table data={allHospitalized} columns={columns} />
      ) : (
        <p className="p-3">There are nobody injured for you to heal</p>
      )}
      {isPending && <Loader explanation="Healing User" />}
    </div>
  );
};

/**
 * The shares of a target's health the heal buttons offer. The capacity above is tracked snapped to
 * these, so a percentage added to the buttons has to be added here too or its button will not
 * notice the healer regenerating past it.
 */
const HEAL_PERCENTAGES = [0.25, 0.5, 0.75, 1.0];

/** How much the healer can heal right now, with the chakra they will have regenerated by now. */
const currentChakra = (userData: NonNullable<UserWithRelations>, timeDiff: number) =>
  calcCurrent(
    userData.curChakra,
    userData.maxChakra,
    userData.status,
    userData.regeneration,
    userData.regenAt,
    timeDiff,
  ).current;

const currentHealCapacity = (
  userData: NonNullable<UserWithRelations>,
  timeDiff: number,
) => calcChakraToPools(userData, currentChakra(userData, timeDiff));

/**
 * Chakra regenerates past the snapshot `userData` was fetched with, so a timer started while it
 * was low has to notice the pool filling up on its own — the snapshot never changes underneath it.
 */
const hasFullChakra = (userData: NonNullable<UserWithRelations>, timeDiff: number) =>
  currentChakra(userData, timeDiff) >= userData.maxChakra;

/**
 * The exact healing capacity, which climbs with every regenerated point of chakra. It owns its
 * own second so the number ticking re-renders this sentence rather than the table of everyone
 * waiting to be healed.
 */
const HealCapacity: React.FC<{
  userData: NonNullable<UserWithRelations>;
  timeDiff: number;
}> = ({ userData, timeDiff }) => {
  const [capacity, setCapacity] = useState(() =>
    currentHealCapacity(userData, timeDiff),
  );
  useEffect(() => {
    const update = () => setCapacity(currentHealCapacity(userData, timeDiff));
    update();
    if (hasFullChakra(userData, timeDiff)) return;
    const interval = setInterval(() => {
      update();
      if (hasFullChakra(userData, timeDiff)) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [userData, timeDiff]);
  return <>{capacity.toFixed(2)}</>;
};
