"use client";

import { Clock, FastForward, Hand, ScanHeart } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { IMG_BUILDING_HOSPITAL, MEDNIN_MIN_RANK } from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import {
  currentChakra,
  currentHealCapacity,
  HEAL_PERCENTAGES,
  HealPercentageButtons,
} from "@/layout/HealPercentageButtons";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import StatusBar from "@/layout/StatusBar";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import { WarTornRevival } from "@/layout/WarTornRevival";
import {
  calcHealCost,
  calcMedninHealablePool,
  calcMedninRank,
  calcUserHealFinish,
  snapToThresholds,
} from "@/libs/hospital";
import { showUserRank } from "@/libs/profile";
import { hasRequiredRank } from "@/libs/rank";
import { showMutationToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import { capitalizeFirstLetter } from "@/utils/string";
import type { ArrayElement } from "@/utils/typeutils";
import { useRequiredUserData, useRequireInVillage } from "@/utils/UserContext";

export default function Hospital() {
  // Settings
  const { userData, access, timeDiff, prepareUserUpdate, updateUser } =
    useRequireInVillage("/hospital");
  const isHospitalized = userData?.status === "HOSPITALIZED";

  // Mutations
  const { mutate: heal, isPending } = api.hospital.npcHeal.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (result, _variables, revision) => {
      showMutationToast(result);
      if (result.success && result.data) {
        await updateUser(
          {
            curHealth: result.data.curHealth,
            curEnergy: result.data.curEnergy,
            maxEnergy: result.data.maxEnergy,
            money: result.data.money,
            regenAt: result.data.regenAt,
            status: "AWAKE",
          },
          { revision },
        );
      }
    },
  });

  // Heal finish time
  const healFinishAt = userData && calcUserHealFinish(userData, timeDiff);
  const healCost = userData && calcHealCost(userData);
  const canAfford = userData && healCost && userData.money >= healCost;
  const canHealOthers = hasRequiredRank(userData?.rank, MEDNIN_MIN_RANK);
  // If user is fully healed, allow immediate checkout
  const isFullyHealed = userData && userData.curHealth >= userData.maxHealth;

  // Heal finish time
  if (!userData) return <Loader explanation="Loading userdata" />;
  if (!access) return <Loader explanation="Accessing Hospital" />;

  // Hospital name
  const ownVillage = userData.sector === userData.village?.sector;
  const outlawOut = userData.isOutlaw && !ownVillage;
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
      <WarTornRevival />
      {!isPending && isHospitalized && userData && healFinishAt && (
        <div className="p-3">
          <p>
            {isFullyHealed
              ? "You are fully healed. You can check out now."
              : "You are hospitalized, either wait or pay to expedite treatment."}
          </p>
          <div className="grid grid-cols-2 gap-2 py-3" id="tutorial-hospital-buttons">
            <Button
              id="hospital-check-out"
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
              id="hospital-pay"
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
        <HealOthersComponent userData={userData} timeDiff={timeDiff} />
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
}

/** Heal eligible players with the healer's available chakra and reconcile confirmed costs. */
export const HealOthersComponent: React.FC<HealOthersComponentProps> = (props) => {
  // Settings
  const { userData, timeDiff } = props;
  const { prepareUserUpdate, updateUser } = useRequiredUserData();

  const pools = calcMedninHealablePool(userData);
  const medninRank = calcMedninRank(userData);

  // tRPC utility
  const utils = api.useUtils();

  // Mutations
  const { mutate: userHeal, isPending } = api.hospital.userHeal.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _variables, revision) => {
      showMutationToast(data);
      if (data.userRecovery && (!data.success || !data.healer))
        await updateUser(data, { revision });
      void utils.hospital.getHospitalizedUsers.invalidate();
      if (data.success && data.healer) {
        await updateUser(data.healer, { revision, userRecovery: data.userRecovery });
      }
    },
  });

  // Queries
  const { data: hospitalized } = api.hospital.getHospitalizedUsers.useQuery(undefined, {
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
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
  const allHospitalized = hospitalized?.map((user) => {
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
            lastRegenAt={user.userId === userData.userId ? userData.regenAt : undefined}
            regen={user.userId === userData.userId ? userData.regeneration : undefined}
            status={user.status}
            current={user.curHealth}
            total={user.maxHealth}
            timeDiff={timeDiff}
          />
        </div>
      ),
      btns: (
        <HealPercentageButtons
          className="gap-1"
          buttonProps={{ role: "combobox" }}
          maxHealth={user.maxHealth}
          missingHealth={missingHealth}
          maxHeal={maxHeal}
          disabled={missingHealth <= 0}
          onHeal={(healPercentage) => userHeal({ userId: user.userId, healPercentage })}
        />
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
