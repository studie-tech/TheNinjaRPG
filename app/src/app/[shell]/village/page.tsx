"use client";

import type { LucideIcon } from "lucide-react";
import {
  Bot,
  BrickWall,
  DoorOpen,
  LockKeyhole,
  MapPinHouse,
  Pencil,
  ReceiptJapaneseYen,
  Users,
} from "lucide-react";
import type React from "react";
import { api } from "@/app/_trpc/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  VILLAGE_LEAVE_REQUIRED_RANK,
  VILLAGE_REDUCED_GAINS_DAYS,
  WAR_FACTION_MAX_SECTORS,
  WAR_VILLAGE_MAX_SECTORS,
} from "@/drizzle/constants";
import { useTutorialStep } from "@/hooks/tutorial";
import Building, { structureRewardEntries } from "@/layout/Building";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import { GroupOrders } from "@/layout/GroupOrders";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { hasRequiredRank } from "@/libs/rank";
import { showMutationToast } from "@/libs/toast";
import { prettyNumber } from "@/utils/string";
import { useRequiredUserInfo, useRequireInVillage } from "@/utils/UserContext";

export default function VillageOverview() {
  // State
  const { userData, sectorVillage } = useRequireInVillage();
  const { prepareUserUpdate, updateUser } = useRequiredUserInfo();
  const { currentStep } = useTutorialStep();

  // Queries
  // Background refetches keep showing the loaded village; only the first load shows a loader.
  const { data } = api.village.get.useQuery(
    { id: sectorVillage?.id ?? "" },
    { enabled: !!sectorVillage },
  );

  // tRPC utility
  const utils = api.useUtils();

  // Derived
  const villageData =
    userData?.isOutlaw && data?.villageData
      ? { ...data.villageData, tokens: userData.clan?.points || 0 }
      : data?.villageData;
  const ownSector = userData?.village?.sector === sectorVillage?.sector;
  const notice = villageData?.notice?.content ?? "No notice at this point";
  const isKage = villageData?.kageId === userData?.userId;
  const title = villageData
    ? `${villageData.name}`
    : userData?.isOutlaw
      ? "Faction"
      : "Village";
  const subtitle = ownSector ? "Your Community" : `Ally of ${userData?.village?.name}`;
  const href = villageData ? `/users/village/${villageData.id}` : "/users";

  // Determine sector cap
  const maxSectors = userData?.isOutlaw
    ? WAR_FACTION_MAX_SECTORS
    : WAR_VILLAGE_MAX_SECTORS;

  // Specific structures
  const walls = villageData?.structures.find((s) => s.name === "Walls");
  const protectors = villageData?.structures.find((s) => s.name === "Protectors");

  // Mutations
  const { mutateAsync: upsertNotice, isPending: isUpdating } =
    api.kage.upsertNotice.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.village.get.invalidate();
        }
      },
    });

  const { mutate: leaveVillage, isPending: isLeaving } =
    api.village.leaveVillage.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success || data.userRecovery) await updateUser(data, { revision });
      },
    });

  // Loading states
  if (!userData) return <Loader explanation="Loading userdata" />;
  if (!villageData) return <Loader explanation="Loading village" />;

  const canLeave = hasRequiredRank(userData.rank, VILLAGE_LEAVE_REQUIRED_RANK);

  const shownStructures = villageData?.structures
    .filter((s) => s.hasPage !== 0)
    .filter((s) => s.showInVillagePage)
    .filter((s) => ownSector || s.allyAccess)
    .sort((a, v) => {
      // The building the tutorial points at comes first, so it is never below the fold.
      const highlighted = currentStep?.elementIds ?? [];
      if (highlighted.includes(`tutorial-${a.route.replace("/", "")}`)) return -1;
      if (highlighted.includes(`tutorial-${v.route.replace("/", "")}`)) return 1;
      return 0;
    });

  return (
    <>
      <ContentBox
        title={title}
        subtitle={subtitle}
        topRightContent={
          <div className="flex flex-row items-center">
            <div className="grid grid-cols-3 gap-1">
              <VillageStat
                icon={MapPinHouse}
                label="Sectors"
                value={`${data?.sectorCount ?? "?"} / ${maxSectors}`}
              >
                Number of sectors owned (max {maxSectors})
              </VillageStat>
              <VillageStat
                icon={BrickWall}
                label="Walls"
                value={`lvl. ${walls?.level ?? "?"}`}
              >
                {walls ? structureRewardEntries(walls) : "No walls built"}
              </VillageStat>
              <VillageStat
                icon={Bot}
                label="Protectors"
                value={`lvl. ${protectors?.level ?? "?"}`}
              >
                {protectors
                  ? structureRewardEntries(protectors)
                  : "No protectors built"}
              </VillageStat>
              <Link
                href={href}
                aria-label={`${prettyNumber(villageData?.populationCount ?? 0)} ${userData?.isOutlaw ? "faction" : "village"} population`}
                className="flex flex-row hover:cursor-pointer hover:text-orange-500"
              >
                <Users aria-hidden className="mr-2 h-6 w-6" />
                {prettyNumber(villageData?.populationCount ?? 0)}
              </Link>
              <VillageStat
                icon={ReceiptJapaneseYen}
                label="Tokens"
                value={String(prettyNumber(villageData?.tokens ?? 0))}
              >
                Tokens earned through PvP and quests can be used to improve{" "}
                {userData?.isOutlaw ? "faction" : "village"}. Current tokens:{" "}
                {villageData?.tokens.toLocaleString()}.
              </VillageStat>
            </div>

            {!userData.isOutlaw && canLeave && ownSector && (
              <Confirm
                title="Leave Village"
                proceed_label="Submit"
                button={
                  <Button
                    className="ml-2"
                    aria-label="Leave village"
                    loading={isLeaving}
                  >
                    <DoorOpen className="h-6 w-6" />
                  </Button>
                }
                disabled={isLeaving}
                isLoading={isLeaving}
                keepOpenOnAccept
                onAccept={(_, { close }) =>
                  leaveVillage(undefined, { onSettled: close })
                }
              >
                Do you confirm that you wish to leave your village? Your prestige will
                be reset to 0. Please be aware that if you join another village your
                training benefits & regen will be reduced for{" "}
                {VILLAGE_REDUCED_GAINS_DAYS} days, and your village loyalty bonuses will
                restart from day 0.
              </Confirm>
            )}
          </div>
        }
      >
        {isKage && villageData.structureMaintenanceDue > 0 && (
          <Alert className="mb-4" role="status">
            <LockKeyhole aria-hidden="true" />
            <AlertTitle>Structure upgrades are paused</AlertTitle>
            <AlertDescription className="gap-3">
              <p>
                Pay {villageData.structureMaintenanceDue.toLocaleString()} village
                tokens in outstanding maintenance to unlock upgrades.
              </p>
              <Button asChild size="sm">
                <Link href="/townhall#Village%20Mission">Manage maintenance</Link>
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {/* Keep mobile building tiles compact to reduce scrolling. */}
        <div className="grid grid-cols-3 items-start sm:grid-cols-4">
          {shownStructures?.map((structure, index) => (
            <div
              key={structure.id}
              className="p-2"
              id={`tutorial-${structure.route.replace("/", "")}`}
            >
              <Building
                structure={structure}
                village={villageData}
                eager={index < 3}
                showBar
                showUpgrade
              />
            </div>
          ))}
        </div>
      </ContentBox>

      {["OUTLAW", "VILLAGE"].includes(sectorVillage?.type || "unknown") && (
        <GroupOrders
          title="Notice Board"
          subtitle={`Information from ${sectorVillage?.type === "OUTLAW" ? "Leader" : "Kage"}`}
          content={notice}
          draft={villageData.notice?.content ?? ""}
          canPost={isKage}
          dialogTitle="Update Notice"
          inputLabel="Contents of your thread"
          isPending={isUpdating}
          onSubmit={upsertNotice}
          renderTrigger={(open) => (
            <Button id="create" onClick={open}>
              <Pencil className="h-6 w-6" />
            </Button>
          )}
        >
          {isUpdating && <Loader explanation="Updating notice" />}
        </GroupOrders>
      )}
    </>
  );
}

/** A header figure whose explanation opens on tap as well as click. */
const VillageStat: React.FC<VillageStatProps> = ({
  icon: Icon,
  label,
  value,
  children,
}) => (
  <Popover>
    <PopoverTrigger asChild>
      <button
        type="button"
        aria-label={`${label}: ${value}`}
        className="flex flex-row rounded-sm hover:cursor-pointer hover:text-orange-500 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Icon aria-hidden className="mr-2 h-6 w-6" />
        {value}
      </button>
    </PopoverTrigger>
    <PopoverContent className="w-auto max-w-72 p-3 text-sm">
      <p className="mb-1 font-semibold">{label}</p>
      {children}
    </PopoverContent>
  </Popover>
);

interface VillageStatProps {
  icon: LucideIcon;
  label: string;
  value: string;
  children: React.ReactNode;
}
