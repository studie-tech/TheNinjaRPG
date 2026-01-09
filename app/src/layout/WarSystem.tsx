"use client";

import React, { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import Image from "@/layout/Image";
import ContentBox from "@/layout/ContentBox";
import Modal2 from "@/layout/Modal2";
import Loader from "@/layout/Loader";
import NavTabs from "@/layout/NavTabs";
import UserRequestSystem from "@/layout/UserRequestSystem";
import Building from "@/layout/Building";
import Table from "@/layout/Table";
import { Handshake, LandPlot, Swords, Trophy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { showMutationToast } from "@/libs/toast";
import { DoorClosed } from "lucide-react";
import { api } from "@/app/_trpc/client";
import { useRequiredUserData } from "@/utils/UserContext";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import { canAdministrateWars } from "@/utils/permissions";
import { findRelationship } from "@/utils/alliance";
import { WAR_FUNDS_COST } from "@/drizzle/constants";
import { WAR_DECLARATION_COST } from "@/drizzle/constants";
import {
  WAR_DAILY_TOKEN_DECAY_PERCENT_BASE,
  WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_4,
  WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_10,
} from "@/drizzle/constants";
import { WAR_VICTORY_TOKEN_BONUS } from "@/drizzle/constants";
import { VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import { WAR_ALLY_OFFER_MIN } from "@/drizzle/constants";
import { WAR_SHRINE_IMAGE } from "@/drizzle/constants";
import { WAR_PURCHASE_SHRINE_TOKEN_COST } from "@/drizzle/constants";
import { MAP_RESERVED_SECTORS } from "@/drizzle/constants";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Village, VillageAlliance, VillageStructure } from "@/drizzle/schema";
import type { UserWithRelations } from "@/routers/profile";
import { Input } from "@/components/ui/input";
import { canJoinWar } from "@/libs/war";
import { calculateEnemyConsequences } from "@/utils/alliance";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import type { FetchActiveWarsReturnType } from "@/server/api/routers/war";
import { useMap } from "@/hooks/map";
import StatusBar from "@/layout/StatusBar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ColumnDefinitionType } from "@/layout/Table";
import type { ArrayElement } from "@/utils/typeutils";
import Confirm2 from "@/layout/Confirm2";
import MapError from "@/layout/MapError";

const GlobalMap = dynamic(() => import("@/layout/Map"), { ssr: false });

/**
 * Wars Component
 */
export const WarRoom: React.FC<{
  user: NonNullable<UserWithRelations>;
  navTabs?: React.ReactNode;
  initialBreak?: boolean;
}> = ({ user, navTabs, initialBreak }) => {
  // tRPC utility
  const utils = api.useUtils();

  // State
  const [warType, setWarType] = useState<"Active" | "Ended">("Active");

  // Queries
  const { data: activeWars } = api.war.getActiveWars.useQuery(
    { villageId: user.villageId ?? "" },
    { staleTime: 10000, enabled: !!user.villageId && warType === "Active" },
  );

  const { data: endedWars } = api.war.getEndedWars.useQuery(
    { villageId: user.villageId ?? "" },
    { staleTime: 10000, enabled: !!user.villageId && warType === "Ended" },
  );

  const { data: villageData } = api.village.getAlliances.useQuery(undefined, {
    staleTime: 10000,
  });

  const { data: requests } = api.war.getAllyOffers.useQuery(undefined, {
    staleTime: 30000,
  });

  // Mutations
  const { mutate: acceptAllyOffer, isPending: isHiring } =
    api.war.acceptAllyOffer.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.war.getActiveWars.invalidate();
          await utils.war.getEndedWars.invalidate();
          await utils.war.getAllyOffers.invalidate();
        }
      },
    });

  const { mutate: rejectAllyOffer, isPending: isRejectingOffer } =
    api.war.rejectAllyOffer.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.war.getAllyOffers.invalidate();
        }
      },
    });

  const { mutate: cancelAllyOffer, isPending: isCancelling } =
    api.war.cancelAllyOffer.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.war.getAllyOffers.invalidate();
        }
      },
    });

  // Derived
  const isLeader = user.userId === user.village?.kageId;
  const villages = villageData?.villages;
  const userVillage = villages?.find((v) => v.id === user.villageId);
  const relationships = villageData?.relationships || [];

  // Checks
  if (!user.villageId) return <Loader explanation="Join a village first" />;

  return (
    <>
      <ContentBox
        title="Wars"
        subtitle="Manage Wars"
        defaultBackHref="/village"
        topRightContent={navTabs}
        initialBreak={initialBreak}
      >
        <WarMap
          user={user}
          isKage={isLeader}
          villages={villages}
          relationships={relationships}
        />
      </ContentBox>

      {/* War Exhaustion Status */}
      {userVillage?.warExhaustionEndedAt &&
        userVillage.warExhaustionEndedAt > new Date() && (
          <ContentBox
            title="War Exhaustion"
            subtitle="Village is under war exhaustion"
            initialBreak={true}
          >
            <div className="text-center space-y-2">
              <p className="text-muted-foreground">
                Your village cannot declare war until the exhaustion period ends.
              </p>
              <p className="text-lg font-semibold">
                Exhaustion ends:{" "}
                {new Date(userVillage.warExhaustionEndedAt).toLocaleString()}
              </p>
            </div>
          </ContentBox>
        )}

      {userVillage && (
        <ContentBox
          title={`${warType} Wars`}
          subtitle={warType === "Active" ? "Current Conflicts" : "Past Conflicts"}
          initialBreak={true}
          topRightContent={
            <NavTabs
              id="warTypeSelection"
              current={warType}
              options={["Active", "Ended"]}
              setValue={setWarType}
            />
          }
        >
          <div className="grid grid-cols-1 gap-4">
            {warType === "Active" &&
              activeWars?.map((war) =>
                war.type === "SECTOR_WAR" ? (
                  <SectorWar key={war.id} war={war} user={user} isKage={isLeader} />
                ) : (
                  <VillageWar
                    key={war.id}
                    war={war}
                    user={user}
                    villages={villages}
                    relationships={relationships}
                    userVillage={userVillage}
                    isKage={isLeader}
                  />
                ),
              )}
            {warType === "Active" && activeWars && activeWars.length === 0 && (
              <p>No active wars</p>
            )}
            {warType === "Ended" &&
              endedWars?.map((war) =>
                war.type === "SECTOR_WAR" ? (
                  <SectorWar key={war.id} war={war} user={user} isKage={isLeader} />
                ) : (
                  <VillageWar
                    key={war.id}
                    war={war}
                    user={user}
                    villages={villages}
                    relationships={relationships}
                    userVillage={userVillage}
                    isKage={isLeader}
                  />
                ),
              )}
            {warType === "Ended" && endedWars && endedWars.length === 0 && (
              <p>No ended wars</p>
            )}
          </div>
        </ContentBox>
      )}
      {isLeader && warType === "Active" && (
        <ContentBox
          title="War Contract Offers"
          subtitle="Pending war participation requests"
          initialBreak={true}
          padding={false}
        >
          {requests && requests.length > 0 && (
            <UserRequestSystem
              isLoading={isHiring || isRejectingOffer || isCancelling}
              requests={requests}
              userId={user.userId}
              onAccept={({ id }) => acceptAllyOffer({ offerId: id })}
              onReject={({ id }) => rejectAllyOffer({ id })}
              onCancel={({ id }) => cancelAllyOffer({ offerId: id })}
            />
          )}
          {requests && requests.length === 0 && (
            <p className="p-4">No pending war participation requests</p>
          )}
        </ContentBox>
      )}
    </>
  );
};

/**
 * Sector Wars Component
 */
export const WarMap: React.FC<{
  user: NonNullable<UserWithRelations>;
  isKage: boolean;
  villages?: Village[];
  relationships: VillageAlliance[];
}> = ({ user, isKage, villages, relationships }) => {
  // Globe data
  const { globe, mapError } = useMap();
  const [showModal, setShowModal] = useState<boolean>(false);
  const [targetSector, setTargetSector] = useState<number | null>(null);
  const [structureRoute, setStructureRoute] = useState("/townhall");

  // Query data
  const { data: userData } = useRequiredUserData();
  const { data: allSectors } = api.travel.getAllSectors.useQuery();
  const utils = api.useUtils();

  // Derived
  const canWar = ["VILLAGE", "TOWN", "HIDEOUT"].includes(userData?.village?.type ?? "");
  const userOwnedSectors = allSectors?.find((s) => s.villageId === user.villageId);
  const canDeclareWar = isKage && canWar;
  const sectorVillage = villages?.find(
    (v) =>
      v.sector === targetSector &&
      ((v.type === "VILLAGE" && v.allianceSystem === true) ||
        ["HIDEOUT", "TOWN"].includes(v.type)),
  );
  const sectorClaimed = villages?.find((v) => v.sector === targetSector);
  const ownsTargetSector = userOwnedSectors?.sectors?.includes(targetSector ?? 0);
  const relationship = findRelationship(
    relationships ?? [],
    user.villageId ?? "",
    sectorVillage?.id ?? "",
  );
  const status =
    relationship?.status ||
    (user.isOutlaw || ["TOWN", "HIDEOUT", "OUTLAW"].includes(sectorVillage?.type ?? "")
      ? "ENEMY"
      : "NEUTRAL");
  let textColor = "text-slate-600";
  if (status === "ALLY") textColor = "text-green-600";
  if (status === "ENEMY") textColor = "text-red-600";
  const isReserved = MAP_RESERVED_SECTORS.includes(targetSector ?? 0);

  // Queries
  const { data: structures } = api.village.getVillageStructures.useQuery(
    { villageId: sectorVillage?.id ?? "" },
    { enabled: !!sectorVillage?.id },
  );

  // Mutations
  const { mutate: releaseSector, isPending: isReleasingSector } =
    api.village.releaseSector.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.village.getSectorOwnerships.invalidate(),
            utils.travel.getAllSectors.invalidate(),
          ]);
        }
      },
    });

  const { mutate: declareSectorWar, isPending: isDeclaringSectorWar } =
    api.war.declareSectorWar.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.war.getActiveWars.invalidate(),
            utils.village.getSectorOwnerships.invalidate(),
          ]);
          setShowModal(false);
        }
      },
    });

  // Mutations
  const { mutate: declareVillageWarOrRaid, isPending: isDeclaringVillageWar } =
    api.war.declareVillageWarOrRaid.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.war.getActiveWars.invalidate(),
            utils.village.getSectorOwnerships.invalidate(),
          ]);
          setShowModal(false);
        }
      },
    });

  const { mutate: leaveAlliance, isPending: isLeavingAlliance } =
    api.village.leaveAlliance.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.village.getAlliances.invalidate();
        }
      },
    });

  const { mutate: declareEnemy, isPending: isDeclaringEnemy } =
    api.village.declareEnemy.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.village.getAlliances.invalidate();
        }
      },
    });

  // Derived
  const isLoading =
    isDeclaringSectorWar ||
    isDeclaringVillageWar ||
    isDeclaringEnemy ||
    isLeavingAlliance ||
    isReleasingSector;

  // Dialog content props
  const dialogContentProps: DialogContentProps = {
    user,
    sectorVillage,
    status,
    textColor,
    relationships,
    villages,
    targetSector,
    structureRoute,
    structures,
    setStructureRoute,
  };

  // What to show in the modal
  let modalTitle = "Declare War";
  let proceedLabel: string | undefined = "Declare War";
  let onAccept: () => void = () => {};
  let modalContent: React.ReactNode | undefined = undefined;
  if (targetSector) {
    if (sectorVillage) {
      if (user.isOutlaw || ["TOWN", "HIDEOUT", "OUTLAW"].includes(sectorVillage.type)) {
        proceedLabel = "Start Raid";
        modalTitle = "Raid Sector";
        modalContent = <InitiateRaidDialogContent {...dialogContentProps} />;
        onAccept = () => {
          declareVillageWarOrRaid({
            targetVillageId: sectorVillage.id,
            targetStructureRoute: structureRoute,
          });
        };
      } else if (status === "ALLY" && relationship) {
        proceedLabel = "Break Alliance";
        modalTitle = "Break Alliance";
        modalContent = <BreakAllianceDialogContent {...dialogContentProps} />;
        onAccept = () => {
          leaveAlliance({ allianceId: relationship.id });
        };
      } else if (status === "NEUTRAL") {
        proceedLabel = "Declare Enemy";
        modalTitle = "Declare Enemy";
        modalContent = <DeclareEnemyDialogContent {...dialogContentProps} />;
        onAccept = () => {
          declareEnemy({ villageId: sectorVillage.id });
        };
      } else if (status === "ENEMY") {
        proceedLabel = "Declare War";
        modalTitle = "Declare War";
        modalContent = <InitiateVillageWarDialogContent {...dialogContentProps} />;
        onAccept = () => {
          declareVillageWarOrRaid({
            targetVillageId: sectorVillage.id,
            targetStructureRoute: structureRoute,
          });
        };
      }
    } else if (ownsTargetSector && targetSector) {
      proceedLabel = "Release Sector";
      modalTitle = "Your Sector";
      modalContent = <div>You own sector {targetSector}. Abandon this sector?</div>;
      onAccept = () => {
        releaseSector({ sector: targetSector });
      };
    } else if (sectorClaimed) {
      proceedLabel = undefined;
      modalTitle = "Sector Occupied";
      modalContent = <div>This sector is already occupied and cannot be claimed.</div>;
    } else if (isReserved) {
      proceedLabel = undefined;
      modalTitle = "Sector Reserved";
      modalContent = <div>This sector is reserved and cannot be claimed.</div>;
    } else {
      modalContent = <DeclareSectorWarDialogContent {...dialogContentProps} />;
      onAccept = () => {
        declareSectorWar({
          sectorId: targetSector,
          userVillageId: user.villageId,
        });
      };
    }
  }

  // Depending on which tile the user clicked, we're either declaring a sector war, village war, or faction raid
  return (
    <div className="relative">
      {villages && globe && (
        <GlobalMap
          intersection={true}
          highlights={villages}
          userLocation={true}
          showOwnership={true}
          onTileClick={(sector) => {
            if (!canDeclareWar) {
              showMutationToast({ success: false, message: "You are not the leader" });
            } else {
              setTargetSector(sector);
              setShowModal(true);
            }
          }}
          actionExplanation="Double click tile to declare war on sector"
          hexasphere={globe}
        />
      )}
      {mapError && <MapError />}
      {showModal && globe && userData && targetSector && (
        <Modal2
          title={modalTitle}
          isOpen={showModal}
          setIsOpen={setShowModal}
          proceed_label={!isLoading ? proceedLabel : undefined}
          onAccept={onAccept}
        >
          {isLoading && <Loader explanation="Execution Action" />}
          {!isLoading && modalContent}
        </Modal2>
      )}
    </div>
  );
};

/**
 * Sector War Component
 */
export const SectorWar: React.FC<{
  war: FetchActiveWarsReturnType;
  user: NonNullable<UserWithRelations>;
  isKage: boolean;
}> = ({ war, user, isKage }) => {
  // Only show active sector wars
  if (war.status !== "ACTIVE") return null;

  // tRPC utility
  const utils = api.useUtils();

  // Mutations
  const { mutate: buildShrine, isPending: isBuilding } =
    api.war.buildShrine.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.war.getActiveWars.invalidate(),
            utils.village.getSectorOwnerships.invalidate(),
          ]);
        }
      },
    });

  const { mutate: adminEndWar } = api.war.adminEndWar.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.war.getActiveWars.invalidate();
        await utils.war.getEndedWars.invalidate();
      }
    },
  });

  // Derived
  const canBuildShrine =
    isKage &&
    user.village?.tokens &&
    war.attackerVillageId === user.villageId &&
    war.shrineHp <= 0 &&
    user.village?.tokens >= WAR_PURCHASE_SHRINE_TOKEN_COST;

  // Render
  return (
    <div className="border p-4 rounded-lg">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-2">
          <div className="w-full flex justify-end">
            {canAdministrateWars(user.role) && (
              <Confirm2
                title="End War"
                button={
                  <Button variant="destructive" size="icon">
                    <Trash2 className="h-5 w-5" />
                  </Button>
                }
                onAccept={(e) => {
                  e.preventDefault();
                  adminEndWar({ warId: war.id });
                }}
              >
                <p>
                  As an admin you can end the war at any time. This will end the war and
                  remove all information about the war. No losses will be incurred for
                  either side.
                </p>
              </Confirm2>
            )}
          </div>
          <Image
            src={WAR_SHRINE_IMAGE}
            alt="War Shrine"
            width={200}
            height={200}
            className={war.shrineHp <= 0 ? "opacity-50 grayscale" : ""}
          />
          <div className="w-full max-w-md space-y-2">
            <div>
              <p className="text-sm font-medium">Shrine - Sector {war.sector}</p>
              {war.shrineHp > 0 && (
                <StatusBar
                  title="HP"
                  tooltip="Shrine Health"
                  color="bg-red-500"
                  showText={true}
                  status="AWAKE"
                  current={war.shrineHp}
                  total={war.shrineMaxHp}
                />
              )}
            </div>
            <div className="mt-2 rounded-md bg-popover p-3 text-sm text-popover-foreground">
              {war.shrineHp > 0 ? (
                <>
                  {war.defenderVillageId === VILLAGE_SYNDICATE_ID ? (
                    <p>
                      <strong>Note:</strong> To attack this shrine, you must travel to
                      sector {war.sector} and engage in combat with the shrine directly.
                    </p>
                  ) : (
                    <p>
                      <strong>Note:</strong> To damage this shrine, attack players from
                      the defending village. Each victory will reduce the shrine&apos;s
                      HP.
                    </p>
                  )}
                </>
              ) : (
                <p>
                  <strong>Note:</strong> This shrine has been destroyed, and your
                  leaders can chose to build a new shrine to claim this sector. The cost
                  of building a new shrine is{" "}
                  {WAR_PURCHASE_SHRINE_TOKEN_COST.toLocaleString()} tokens. Currently we
                  have {user.village?.tokens?.toLocaleString()} tokens.
                </p>
              )}
            </div>
            {canBuildShrine && (
              <Confirm2
                title="Build Shrine"
                button={
                  <Button className="w-full" loading={isBuilding}>
                    <LandPlot className="h-5 w-5 mr-2" />
                    Build Shrine ({WAR_PURCHASE_SHRINE_TOKEN_COST.toLocaleString()}{" "}
                    tokens)
                  </Button>
                }
                onAccept={(e) => {
                  e.preventDefault();
                  buildShrine({ warId: war.id });
                }}
              >
                <p>
                  You are about to build a shrine in sector {war.sector}. This will cost{" "}
                  {WAR_PURCHASE_SHRINE_TOKEN_COST.toLocaleString()} village tokens. Are
                  you sure?
                </p>
              </Confirm2>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Props passed to all dialog content components
 */
interface DialogContentProps {
  status: string;
  textColor: string;
  relationships: VillageAlliance[];
  targetSector: number | null;
  user: NonNullable<UserWithRelations>;
  villages?: Village[];
  sectorVillage?: Village;
  structureRoute: string;
  structures?: VillageStructure[];
  setStructureRoute: React.Dispatch<React.SetStateAction<string>>;
}

/**
 * Sector Village Dialog Content, Showing the village and its status
 */
export const SectorVillageDialogContent: React.FC<DialogContentProps> = (props) => {
  if (!props.sectorVillage) return null;
  return (
    <div>
      <p className="font-bold">{props.sectorVillage.name}</p>
      <Image
        src={props.sectorVillage.villageGraphic}
        alt={props.sectorVillage.name}
        width={100}
        height={100}
        className="mx-auto mb-2 aspect-square"
      />
      <p className={`text-sm mb-2 font-semibold ${props.textColor}`}>
        {capitalizeFirstLetter(props.status)}
      </p>
    </div>
  );
};

/**
 * Declare Sector War Dialog Content
 */
export const DeclareSectorWarDialogContent: React.FC<DialogContentProps> = (props) => {
  return (
    <div className="border p-4 rounded-lg text-center relative">
      <SectorVillageDialogContent {...props} />
      <p>You are about to declare war on sector {props.targetSector}.</p>
      <p className="py-2">
        This will initiate a war between your village and any village in sector{" "}
        {props.targetSector}.
      </p>
      <p className="py-2">
        The cost of declaring war is {WAR_DECLARATION_COST.toLocaleString()} Village
        Tokens. Each day at war reduces your tokens by{" "}
        {WAR_DAILY_TOKEN_DECAY_PERCENT_BASE}% (increasing to{" "}
        {WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_4}% after 4 days and{" "}
        {WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_10}% after 10 days).
      </p>
      <p>Do you confirm?</p>
    </div>
  );
};

/**
 * Break Alliance Dialog Content
 */
export const BreakAllianceDialogContent: React.FC<DialogContentProps> = (props) => {
  if (!props.sectorVillage) return null;
  return (
    <div className="border p-4 rounded-lg text-center relative">
      <SectorVillageDialogContent {...props} />
      <p>You will break your alliance with {props.sectorVillage.name}. Are you sure?</p>
    </div>
  );
};

/**
 * Declare Enemy Dialog Content
 */
export const DeclareEnemyDialogContent: React.FC<DialogContentProps> = (props) => {
  if (!props.sectorVillage) return null;
  return (
    <div className="border p-4 rounded-lg text-center relative">
      <SectorVillageDialogContent {...props} />
      <p>
        You are about to declare {props.sectorVillage.name} an enemy. Are you sure? The
        cost of declaring a village as enemy is {WAR_FUNDS_COST} village tokens.
      </p>
      {(() => {
        const { newEnemies, newNeutrals } = calculateEnemyConsequences(
          props.relationships,
          props.villages ?? [],
          props.user.villageId ?? "",
          props.sectorVillage.id,
        );
        return (
          <>
            {newEnemies && newEnemies.length > 0 && (
              <p>
                <span className="font-bold">Additional Enemies: </span>
                <span className="font-normal">
                  {newEnemies.map((v) => v.name).join(", ")} will become enemies
                </span>
              </p>
            )}
            {newNeutrals && newNeutrals.length > 0 && (
              <p>
                <span className="font-bold">Broken Alliances: </span>
                <span className="font-normal">
                  {newNeutrals.map((v) => v.name).join(", ")} will become neutral
                </span>
              </p>
            )}
          </>
        );
      })()}
    </div>
  );
};

/**
 * Initiate Village War Dialog Content
 */
export const InitiateVillageWarDialogContent: React.FC<DialogContentProps> = (
  props,
) => {
  if (!props.sectorVillage) return null;
  return (
    <div className="border p-4 rounded-lg text-center relative">
      <SectorVillageDialogContent {...props} />
      <p>
        You are about to declare war on {props.sectorVillage.name}. Are you sure? The
        cost of declaring war is {WAR_DECLARATION_COST.toLocaleString()} Village Tokens.
        Each day at war reduces your tokens by {WAR_DAILY_TOKEN_DECAY_PERCENT_BASE}%
        (increasing to {WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_4}% after 4 days and{" "}
        {WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_10}% after 10 days).
      </p>
    </div>
  );
};

/**
 * Raid Dialog Content
 */
export const InitiateRaidDialogContent: React.FC<DialogContentProps> = (props) => {
  return (
    <div className="border p-4 rounded-lg text-center relative">
      <SectorVillageDialogContent {...props} />
      <div>
        You have the option of initiating a raid in this sector, targeting a given
        structure. The cost of starting a raid is{" "}
        {WAR_DECLARATION_COST.toLocaleString()} tokens. Each day at war reduces your
        tokens by {WAR_DAILY_TOKEN_DECAY_PERCENT_BASE}% (increasing to{" "}
        {WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_4}% after 4 days and{" "}
        {WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_10}% after 10 days). If you win, the
        structure level will be reduced by 3 and you will receive{" "}
        {WAR_VICTORY_TOKEN_BONUS.toLocaleString()} tokens.
      </div>
      <div className="space-y-2">
        <p className="font-semibold">Select Target Structure:</p>
        <Select value={props.structureRoute} onValueChange={props.setStructureRoute}>
          <SelectTrigger>
            <SelectValue placeholder="Select a structure to raid" />
          </SelectTrigger>
          <SelectContent>
            {props.structures?.map((structure) => (
              <SelectItem key={structure.id} value={structure.route || structure.id}>
                {structure.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};

/**
 * War Component
 */
export const VillageWar: React.FC<{
  war: FetchActiveWarsReturnType;
  user: NonNullable<UserWithRelations>;
  villages?: Village[];
  relationships?: VillageAlliance[];
  userVillage?: Village;
  isKage: boolean;
}> = ({ war, user, villages, relationships, userVillage, isKage }) => {
  // Add state for dialog
  const [showKills, setShowKills] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [selectedStat, setSelectedStat] = useState<
    "townhallHpChange" | "shrineHpChange" | "totalKills"
  >("totalKills");

  // Add query for war kills
  const { data: warKills } = api.war.getWarKills.useQuery(
    { warId: war.id },
    { enabled: showKills },
  );

  // Add query for war kill stats
  const { data: warKillStats } = api.war.getWarKillStats.useQuery(
    { warId: war.id, aggregateBy: selectedStat },
    { enabled: showStats },
  );

  // Transform war kills data for table
  const tableData = useMemo(() => {
    if (!warKills) return [];
    return warKills.map((kill) => ({
      ...kill,
      killerAvatar: kill.killer.avatar,
      victimAvatar: kill.victim.avatar,
      killerInfo: (
        <div>
          <p className="font-bold">{kill.killer.username}</p>
          <p>{kill.killerVillage.name}</p>
        </div>
      ),
      victimInfo: (
        <div>
          <p className="font-bold">{kill.victim.username}</p>
          <p>{kill.victimVillage?.name || "Unknown"}</p>
        </div>
      ),
    }));
  }, [warKills]);

  // Transform war stats data for table
  const statsTableData = useMemo(() => {
    if (!warKillStats) return [];
    return warKillStats.map((stat, index) => ({
      ...stat,
      rank: index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : "",
      playerInfo: (
        <div>
          <p className="font-bold">{stat.killerUsername}</p>
          {stat.villageName && <p>{stat.villageName}</p>}
        </div>
      ),
      statValue: Math.abs(Number(stat.count)).toLocaleString(),
    }));
  }, [warKillStats]);

  type WarKill = ArrayElement<typeof tableData>;
  type WarStat = ArrayElement<typeof statsTableData>;

  // Define table columns
  const killColumns: ColumnDefinitionType<WarKill, keyof WarKill>[] = [
    { key: "killerAvatar", header: "", type: "avatar" },
    { key: "killerInfo", header: "Killer", type: "jsx" },
    { key: "victimAvatar", header: "", type: "avatar" },
    { key: "victimInfo", header: "Victim", type: "jsx" },
    { key: "sector", header: "Sector", type: "string" },
    { key: "shrineHpChange", header: "Shrine HP", type: "string" },
    { key: "townhallHpChange", header: "Townhall HP", type: "string" },
    { key: "killedAt", header: "Time", type: "date" },
  ];

  // Define stats table columns
  const statsColumns: ColumnDefinitionType<WarStat, keyof WarStat>[] = [
    { key: "rank", header: "", type: "string" },
    { key: "killerAvatar", header: "", type: "avatar" },
    { key: "playerInfo", header: "Player", type: "jsx" },
    {
      key: "statValue",
      header:
        selectedStat === "totalKills"
          ? "Kills"
          : selectedStat === "townhallHpChange"
            ? "Townhall Damage"
            : "Shrine Damage",
      type: "string",
    },
  ];

  // tRPC utility
  const utils = api.useUtils();

  // Form for token offer
  const offerSchema = z.object({
    amount: z.coerce
      .number()
      .int()
      .positive()
      .min(WAR_ALLY_OFFER_MIN)
      .max(userVillage?.tokens ?? 0),
  });

  const offerForm = useForm<z.infer<typeof offerSchema>>({
    resolver: zodResolver(offerSchema),
    defaultValues: { amount: 1000 },
    mode: "onChange",
  });

  const onOfferSubmit = (villageId: string) => {
    return offerForm.handleSubmit((data) => {
      createAllyOffer({
        warId: war.id ?? "",
        tokenOffer: data.amount,
        targetVillageId: villageId,
      });
    });
  };

  // Query
  const { data: requests } = api.war.getAllyOffers.useQuery(undefined, {
    staleTime: 30000,
  });

  // Derived for this war
  const warRequests = requests?.filter(
    (r) => r.relatedId === war.id && r.status !== "ACCEPTED",
  );

  // Mutations
  const { mutate: acceptAllyOffer, isPending: isHiring } =
    api.war.acceptAllyOffer.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.war.getActiveWars.invalidate();
          await utils.war.getAllyOffers.invalidate();
        }
      },
    });

  const { mutate: rejectAllyOffer, isPending: isRejectingOffer } =
    api.war.rejectAllyOffer.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.war.getAllyOffers.invalidate();
        }
      },
    });

  const { mutate: cancelAllyOffer, isPending: isCancelling } =
    api.war.cancelAllyOffer.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.war.getAllyOffers.invalidate();
        }
      },
    });

  const { mutate: createAllyOffer, isPending: isCreatingOffer } =
    api.war.createAllyOffer.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.war.getAllyOffers.invalidate();
          offerForm.reset();
        }
      },
    });

  const { mutate: surrender } = api.war.surrender.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await Promise.all([
          utils.war.getActiveWars.invalidate(),
          utils.war.getEndedWars.invalidate(),
        ]);
      }
    },
  });

  const { mutate: adminEndWar } = api.war.adminEndWar.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.war.getActiveWars.invalidate();
        await utils.war.getEndedWars.invalidate();
      }
    },
  });

  // Derived
  const isAttacker =
    war.attackerVillageId === user.villageId ||
    war.warAllies.some(
      (warAlly) =>
        warAlly.supportVillageId === war.attackerVillageId &&
        warAlly.villageId === user.villageId,
    );
  const attackerStructure = war.attackerVillage?.structures?.find(
    (s) => s.route === war.targetStructureRoute,
  );
  const defenderStructure = war.defenderVillage?.structures?.find(
    (s) => s.route === war.targetStructureRoute,
  );
  const villagesThatCanJoin = villages?.filter((v) => {
    if (userVillage) {
      const { check } = canJoinWar(war, relationships ?? [], v, userVillage);
      return check;
    }
    return false;
  });
  if (!attackerStructure || !defenderStructure) return null;
  return (
    <div className="border p-4 rounded-lg">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h4 className="font-bold text-lg">
            {isAttacker ? "Attacking" : "Defending Against"}{" "}
            {isAttacker ? war.defenderVillage?.name : war.attackerVillage?.name} -{" "}
            {capitalizeFirstLetter(war.type.replace("_", " "))}
          </h4>
          <p className="text-sm">Started: {war.startedAt.toLocaleDateString()}</p>
          <p className="text-sm">War ID: {war.id}</p>
          {war.status !== "ACTIVE" && war.endedAt && (
            <>
              <p className="text-sm">Ended: {war.endedAt.toLocaleDateString()}</p>
              <p
                className={`font-bold ${war.status === "DRAW" ? "text-yellow-500" : war.status === "ATTACKER_VICTORY" ? (war.attackerVillageId === user.villageId ? "text-green-500" : "text-red-500") : war.defenderVillageId === user.villageId ? "text-green-500" : "text-red-500"}`}
              >
                Outcome:{" "}
                {war.status === "DRAW"
                  ? "War ended in a Draw"
                  : war.status === "ATTACKER_VICTORY"
                    ? war.attackerVillageId === user.villageId
                      ? "Victory"
                      : "Defeat"
                    : war.defenderVillageId === user.villageId
                      ? "Victory"
                      : "Defeat"}
              </p>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={() => setShowKills(true)}>
            <Swords className="h-5 w-5" />
          </Button>
          <Button variant="outline" size="icon" onClick={() => setShowStats(true)}>
            <Trophy className="h-5 w-5" />
          </Button>
          {isKage && war.status === "ACTIVE" && (
            <Confirm2
              title="Confirm Surrender"
              button={
                <Button variant="destructive" size="icon">
                  <DoorClosed className="h-5 w-5" />
                </Button>
              }
              onAccept={(e) => {
                e.preventDefault();
                surrender({ warId: war.id });
              }}
            >
              <p>
                Are you sure you want to surrender this war? This will result in an
                immediate loss to your village.
              </p>
            </Confirm2>
          )}
          {canAdministrateWars(user.role) && (
            <Confirm2
              title="End War"
              button={
                <Button variant="destructive" size="icon">
                  <Trash2 className="h-5 w-5" />
                </Button>
              }
              onAccept={(e) => {
                e.preventDefault();
                adminEndWar({ warId: war.id });
              }}
            >
              <p>
                As an admin you can end the war at any time. This will end the war and
                remove all information about the war. No losses will be incurred for
                either side.
              </p>
            </Confirm2>
          )}
        </div>
      </div>

      {/* Add dialog for war kills */}
      <Modal2
        title={`War Kills - ${war.attackerVillage.name} vs ${war.defenderVillage.name}`}
        isOpen={showKills}
        setIsOpen={setShowKills}
        className="max-w-[99%]"
      >
        <div className="min-h-[200px]">
          <p className="text-sm text-muted-foreground">
            Kills are recorded for 30 days after the war ends.
          </p>
          {warKills && warKills.length > 0 ? (
            <div className="border rounded-lg">
              <Table
                data={tableData}
                columns={killColumns}
                linkColumn="killerId"
                linkPrefix="/userid/"
              />
            </div>
          ) : (
            <p className="text-center text-muted-foreground">No kills recorded yet</p>
          )}
        </div>
      </Modal2>

      {/* Add dialog for war kill stats */}
      <Modal2
        title={`War Statistics - ${war.attackerVillage.name} vs ${war.defenderVillage.name}`}
        isOpen={showStats}
        setIsOpen={setShowStats}
        className="max-w-[99%]"
      >
        <div className="space-y-4">
          <div className="flex justify-center gap-2">
            <Button
              variant={selectedStat === "totalKills" ? "default" : "outline"}
              onClick={() => setSelectedStat("totalKills")}
            >
              Total Kills
            </Button>
            <Button
              variant={selectedStat === "townhallHpChange" ? "default" : "outline"}
              onClick={() => setSelectedStat("townhallHpChange")}
            >
              Townhall Damage
            </Button>
            <Button
              variant={selectedStat === "shrineHpChange" ? "default" : "outline"}
              onClick={() => setSelectedStat("shrineHpChange")}
            >
              Shrine Damage
            </Button>
          </div>

          <div className="min-h-[200px]">
            {warKillStats && warKillStats.length > 0 ? (
              <Table
                data={statsTableData}
                columns={statsColumns}
                linkColumn="killerId"
                linkPrefix="/userid/"
              />
            ) : (
              <p className="text-center text-muted-foreground">
                No statistics recorded yet
              </p>
            )}
          </div>
        </div>
      </Modal2>

      <div className="grid grid-cols-2 gap-8 items-start justify-center">
        <WarSide
          structure={isAttacker ? attackerStructure : defenderStructure}
          village={isAttacker ? war.attackerVillage : war.defenderVillage}
          war={war}
          warHealth={isAttacker ? war.attackerWarHealth : war.defenderWarHealth}
          warHealthMax={
            isAttacker ? war.attackerWarHealthMax : war.defenderWarHealthMax
          }
        />
        <WarSide
          structure={isAttacker ? defenderStructure : attackerStructure}
          village={isAttacker ? war.defenderVillage : war.attackerVillage}
          war={war}
          warHealth={isAttacker ? war.defenderWarHealth : war.attackerWarHealth}
          warHealthMax={
            isAttacker ? war.defenderWarHealthMax : war.attackerWarHealthMax
          }
        />
      </div>

      {isKage && war.status === "ACTIVE" && war.type === "VILLAGE_WAR" && (
        <div className="mt-4">
          <h5 className="font-bold mb-2">Send War Alliance Offers</h5>
          <p className="text-sm text-muted-foreground mb-4">
            Send offers to factions or allied villages to join your war effort.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {villagesThatCanJoin?.map((village) => (
              <div
                key={village.id}
                className="border rounded-lg py-1 px-2 hover:bg-popover transition-colors"
              >
                <div className="flex items-center space-x-2">
                  <Image
                    src={village.villageGraphic}
                    alt={village.name}
                    width={40}
                    height={40}
                    className="rounded-full"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{village.name}</p>
                    <p className="text-sm">
                      {village.type === "VILLAGE" ? "Ally" : "Faction"}
                    </p>
                  </div>
                  <Confirm2
                    title={`Send Offer to ${village.name}`}
                    button={
                      <Button
                        size="sm"
                        className="shrink-0"
                        onClick={(e) => e.preventDefault()}
                      >
                        <Handshake className="h-4 w-4" />
                      </Button>
                    }
                    onAccept={onOfferSubmit(village.id)}
                  >
                    <Form {...offerForm}>
                      <form className="space-y-4">
                        <FormField
                          control={offerForm.control}
                          name="amount"
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input
                                  type="number"
                                  placeholder={`Token offer (min ${WAR_ALLY_OFFER_MIN}, max ${userVillage?.tokens?.toLocaleString()})`}
                                  {...field}
                                  onChange={(e) => {
                                    const value = parseInt(e.target.value);
                                    field.onChange(value);
                                  }}
                                />
                              </FormControl>
                              <FormMessage className="text-xs" />
                            </FormItem>
                          )}
                        />
                      </form>
                    </Form>
                    <p className="text-sm text-muted-foreground mt-4">
                      This will send an offer to {village.name} to join your side in the
                      war against{" "}
                      {war.attackerVillageId === user.villageId
                        ? war.defenderVillage?.name
                        : war.attackerVillage?.name}
                      . They can choose to accept or reject this offer.
                    </p>
                  </Confirm2>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {!user.isOutlaw &&
        war.status === "ACTIVE" &&
        warRequests &&
        warRequests.length > 0 && (
          <ContentBox
            title="War Ally Offers"
            subtitle="Sent to or from you"
            initialBreak={true}
            padding={false}
          >
            <UserRequestSystem
              isLoading={
                isHiring || isRejectingOffer || isCancelling || isCreatingOffer
              }
              requests={warRequests}
              userId={user.userId}
              onAccept={({ id }) => acceptAllyOffer({ offerId: id })}
              onReject={({ id }) => rejectAllyOffer({ id })}
              onCancel={({ id }) => cancelAllyOffer({ offerId: id })}
            />
          </ContentBox>
        )}
    </div>
  );
};

/**
 * A component that displays a side of a war
 * @param structure
 * @param war
 * @param village
 * @param user
 * @returns
 */
const WarSide: React.FC<{
  structure: VillageStructure;
  war: FetchActiveWarsReturnType;
  village: Village;
  warHealth: number;
  warHealthMax: number;
}> = ({ structure, war, village, warHealth, warHealthMax }) => {
  return (
    <div className="flex flex-col items-center justify-center">
      <h5 className="font-bold mb-2">{village.name}</h5>
      {war.status === "ACTIVE" && (
        <div className="w-full mb-2">
          <StatusBar
            title="War Health"
            tooltip="War Health - Depletes from PvP kills"
            color="bg-red-500"
            showText={true}
            current={warHealth}
            total={warHealthMax}
          />
        </div>
      )}
      <div className="w-full md:w-3/5 lg:w-3/4 aspect-square">
        <Building
          structure={structure}
          village={village}
          textPosition="bottom"
          showBar={false}
          showNumbers={false}
        />
      </div>
      {/* Show our supporting factions */}
      {war.type === "VILLAGE_WAR" && (
        <div className="mt-4">
          <h6 className="font-semibold text-sm mb-2">Supporting Forces:</h6>
          <div className="flex flex-wrap gap-2 justify-center">
            {war.warAllies
              .filter((warAlly) => warAlly.supportVillageId === village.id)
              .map((warAlly) => (
                <div
                  key={warAlly.villageId}
                  className="flex items-center space-x-2 bg-poppopover rounded-full px-3 py-1 border-2"
                >
                  <Image
                    src={warAlly.village.villageGraphic}
                    alt={warAlly.village.name}
                    width={20}
                    height={20}
                    className="rounded-full"
                  />
                  <span className="text-sm">{warAlly.village.name}</span>
                </div>
              ))}
            {war.warAllies.filter((warAlly) => warAlly.supportVillageId === village.id)
              .length === 0 && (
              <div className="text-sm text-muted-foreground italic">
                No supporting forces
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
