"use client";

import { Locate } from "lucide-react";
import dynamic from "next/dynamic";
import type React from "react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ALLIANCE_VILLAGE_TYPES,
  FACTION_RAID_BOOST_HOURS,
  FACTION_RAID_BOOST_PERCENT,
  FACTION_RAID_COST,
  FACTION_RAID_DAILY_DRAIN,
  FACTION_RAID_FAILURE_COOLDOWN_HOURS,
  FACTION_RAID_MAX_DAYS,
  FACTION_RAID_MIN_MEMBERS,
  FACTION_RAID_REWARD,
  FACTION_RAID_STRUCTURE_HP,
  FACTION_RAID_STRUCTURE_ROUTES,
  FACTION_RAID_TARGET_COOLDOWN_HOURS,
  MAP_RESERVED_SECTORS,
  VILLAGE_SYNDICATE_ID,
  WAR_DAILY_TOKEN_DECAY_PERCENT_BASE,
  WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_5,
  WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_8,
  WAR_DECLARATION_COST,
  WAR_FUNDS_COST,
} from "@/drizzle/constants";
import type { Village, VillageAlliance, VillageStructure } from "@/drizzle/schema";
import { useMap } from "@/hooks/map";
import { FindSectorPopover } from "@/layout/FindSectorPopover";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import MapError from "@/layout/MapError";
import Modal from "@/layout/Modal";
import { showMutationToast } from "@/libs/toast";
import { isFactionVillage } from "@/libs/war";
import type { UserWithRelations } from "@/routers/profile";
import { calculateEnemyConsequences, findRelationship } from "@/utils/alliance";
import { capitalizeFirstLetter } from "@/utils/string";

const GlobalMap = dynamic(() => import("@/layout/Map"), { ssr: false });

/**
 * Globe for choosing a declaration target: sector war, village war, faction raid,
 * alliance change or sector release.
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
  const [declarationError, setDeclarationError] = useState<string | null>(null);
  const [targetSector, setTargetSector] = useState<number | null>(null);
  const [structureRoute, setStructureRoute] = useState<string>(
    FACTION_RAID_STRUCTURE_ROUTES[0],
  );
  const [focusSector, setFocusSector] = useState<number | null>(null);

  // Query data
  const { data: allSectors } = api.travel.getAllSectors.useQuery();
  const utils = api.useUtils();

  // Derived
  const canWar = ALLIANCE_VILLAGE_TYPES.some((type) => type === user.village?.type);
  const userOwnedSectors = allSectors?.find((s) => s.villageId === user.villageId);
  const canDeclareWar = isKage && canWar;
  const sectorVillage = villages?.find(
    (v) =>
      v.sector === targetSector &&
      ((v.type === "VILLAGE" && (user.isOutlaw || v.allianceSystem === true)) ||
        isFactionVillage(v)),
  );
  const sectorClaimed = villages?.find((v) => v.sector === targetSector);
  const sectorOwnerId = allSectors?.find((s) =>
    s.sectors.includes(targetSector ?? 0),
  )?.villageId;
  const sectorOwnerVillage = villages?.find((v) => v.id === sectorOwnerId);
  const ownsTargetSector = userOwnedSectors?.sectors?.includes(targetSector ?? 0);
  const relationship = findRelationship(
    relationships ?? [],
    user.villageId ?? "",
    sectorVillage?.id ?? "",
  );
  const status =
    relationship?.status ||
    (user.isOutlaw ||
    ["STRONGHOLD", "HIDEOUT", "OUTLAW"].includes(sectorVillage?.type ?? "")
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

  const { data: raidOptions, isFetching: isLoadingRaidOptions } =
    api.war.getRaidOptions.useQuery(
      { userVillageId: user.villageId ?? "", targetVillageId: sectorVillage?.id ?? "" },
      { enabled: !!sectorVillage && user.isOutlaw && showModal },
    );
  const raidBlock = raidOptions?.find(
    (option) => option.route === structureRoute,
  )?.block;

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
            utils.war.getRaidOptions.invalidate(),
            utils.village.getSectorOwnerships.invalidate(),
          ]);
          setShowModal(false);
        }
      },
    });

  const { mutate: declareVillageWarOrRaid, isPending: isDeclaringVillageWar } =
    api.war.declareVillageWarOrRaid.useMutation({
      onSuccess: async (data) => {
        setDeclarationError(data.success ? null : data.message);
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.war.getActiveWars.invalidate(),
            utils.war.getRaidOptions.invalidate(),
            utils.village.getSectorOwnerships.invalidate(),
          ]);
          setShowModal(false);
        }
      },
      onError: () =>
        setDeclarationError(
          "The declaration could not be completed. Please try again.",
        ),
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
    sectorOwnerVillage,
    status,
    textColor,
    relationships,
    villages,
    targetSector,
    structureRoute,
    structures,
    setStructureRoute,
    raidBlock,
  };

  // What to show in the modal
  let modalTitle = "Declare War";
  let proceedLabel: string | undefined = "Declare War";
  let onAccept: () => void = () => {};
  let modalContent: React.ReactNode | undefined;
  if (targetSector) {
    if (sectorVillage) {
      if (user.isOutlaw) {
        proceedLabel = "Start Raid";
        modalTitle = "Raid Sector";
        modalContent = <InitiateRaidDialogContent {...dialogContentProps} />;
        onAccept = () => {
          setDeclarationError(null);
          declareVillageWarOrRaid({
            targetVillageId: sectorVillage.id,
            targetStructureRoute: structureRoute,
            userVillageId: user.villageId ?? "",
          });
        };
      } else if (isFactionVillage(sectorVillage)) {
        proceedLabel = undefined;
        modalContent = <p>Only factions can initiate raids.</p>;
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
          setDeclarationError(null);
          declareVillageWarOrRaid({
            targetVillageId: sectorVillage.id,
            targetStructureRoute: "/townhall",
            userVillageId: user.villageId ?? "",
          });
        };
      }
    } else if (ownsTargetSector) {
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
    } else if (user.village && isFactionVillage(user.village)) {
      proceedLabel = undefined;
      modalTitle = "Sector Ownership";
      modalContent = <p>Factions cannot purchase sectors.</p>;
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
      {canDeclareWar && user.isOutlaw && (
        <div className="mb-3 pr-12">
          <Select
            onValueChange={(villageId) => {
              const target = villages?.find((v) => v.id === villageId);
              if (target) {
                setDeclarationError(null);
                setTargetSector(target.sector);
                setShowModal(true);
              }
            }}
          >
            <SelectTrigger aria-label="Choose a raid target">
              <SelectValue placeholder="Choose a settlement to raid" />
            </SelectTrigger>
            <SelectContent>
              {villages
                ?.filter(
                  (v) =>
                    v.id !== user.villageId &&
                    ALLIANCE_VILLAGE_TYPES.some((type) => type === v.type),
                )
                .map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Find Sector Control */}
      <div className="absolute top-2 right-2 z-10">
        <FindSectorPopover
          focusSector={focusSector}
          onFocusSector={setFocusSector}
          triggerAsChild
          trigger={
            <Button
              variant="outline"
              size="icon"
              aria-label="Find sector"
              className={focusSector !== null ? "text-purple-500" : ""}
            >
              <Locate className="h-5 w-5" />
            </Button>
          }
        />
      </div>
      {villages && globe && (
        <GlobalMap
          highlights={villages}
          userLocation={true}
          showOwnership={true}
          focusSector={focusSector}
          onTileClick={(sector) => {
            if (!canDeclareWar) {
              showMutationToast({ success: false, message: "You are not the leader" });
            } else {
              setDeclarationError(null);
              setTargetSector(sector);
              setShowModal(true);
            }
          }}
          actionExplanation={
            canDeclareWar
              ? "Click tile to declare war on sector"
              : "Hover or tap a sector to see its owner"
          }
          hexasphere={globe}
        />
      )}
      {mapError && <MapError />}
      {showModal && globe && targetSector && (
        <Modal
          title={modalTitle}
          isOpen={showModal}
          setIsOpen={setShowModal}
          proceed_label={!isLoading ? proceedLabel : undefined}
          onAccept={onAccept}
          keepOpenOnAccept={
            proceedLabel === "Start Raid" || proceedLabel === "Declare War"
          }
          isLoading={isLoading}
          proceedDisabled={
            user.isOutlaw &&
            !!sectorVillage &&
            (isLoadingRaidOptions || !raidOptions || !!raidBlock)
          }
        >
          {isLoading && <Loader explanation="Processing..." />}
          {!isLoading && modalContent}
          {declarationError && (
            <p role="alert" className="mt-2 text-destructive text-sm">
              {declarationError}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
};

/**
 * Sector Village Dialog Content, Showing the village and its status
 */
const SectorVillageDialogContent: React.FC<DialogContentProps> = (props) => {
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
      <p className={`mb-2 font-semibold text-sm ${props.textColor}`}>
        {capitalizeFirstLetter(props.status)}
      </p>
    </div>
  );
};

/**
 * Declare Sector War Dialog Content
 */
const DeclareSectorWarDialogContent: React.FC<DialogContentProps> = (props) => {
  return (
    <div className="relative rounded-lg border p-4 text-center">
      <SectorVillageDialogContent {...props} />
      <p>
        You are about to declare war on sector {props.targetSector}
        {props.sectorOwnerVillage &&
        props.sectorOwnerVillage.id !== VILLAGE_SYNDICATE_ID ? (
          <>
            , currently owned by <b>{props.sectorOwnerVillage.name}</b>
          </>
        ) : (
          ", which is currently neutral territory"
        )}
        .
      </p>
      <p className="py-2">
        {props.sectorOwnerVillage &&
        props.sectorOwnerVillage.id !== VILLAGE_SYNDICATE_ID ? (
          <>
            This will initiate a war between your village and any village in sector{" "}
            {props.targetSector}.
          </>
        ) : (
          <>This will initiate a war to capture sector {props.targetSector}.</>
        )}
      </p>
      <p className="py-2">
        The cost of declaring war is {WAR_DECLARATION_COST.toLocaleString()} Village
        Tokens. {WAR_TOKEN_DECAY_NOTE}
      </p>
      <p>Do you confirm?</p>
    </div>
  );
};

/**
 * Break Alliance Dialog Content
 */
const BreakAllianceDialogContent: React.FC<DialogContentProps> = (props) => {
  if (!props.sectorVillage) return null;
  return (
    <div className="relative rounded-lg border p-4 text-center">
      <SectorVillageDialogContent {...props} />
      <p>You will break your alliance with {props.sectorVillage.name}. Are you sure?</p>
    </div>
  );
};

/**
 * Declare Enemy Dialog Content
 */
const DeclareEnemyDialogContent: React.FC<DialogContentProps> = (props) => {
  if (!props.sectorVillage) return null;
  const { newEnemies, newNeutrals } = calculateEnemyConsequences(
    props.relationships,
    props.villages ?? [],
    props.user.villageId ?? "",
    props.sectorVillage.id,
  );
  return (
    <div className="relative rounded-lg border p-4 text-center">
      <SectorVillageDialogContent {...props} />
      <p>
        You are about to declare {props.sectorVillage.name} an enemy. Are you sure? The
        cost of declaring a village as enemy is {WAR_FUNDS_COST} village tokens.
      </p>
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
    </div>
  );
};

/**
 * Initiate Village War Dialog Content
 */
const InitiateVillageWarDialogContent: React.FC<DialogContentProps> = (props) => {
  const { data: rules } = api.war.getRules.useQuery();
  if (!props.sectorVillage) return null;
  return (
    <div className="relative rounded-lg border p-4 text-center">
      <SectorVillageDialogContent {...props} />
      <p>
        You are about to declare war on {props.sectorVillage.name}. Are you sure? The
        cost of declaring war is{" "}
        {(rules?.enabled
          ? rules.declarationCost
          : WAR_DECLARATION_COST
        ).toLocaleString()}{" "}
        Village Tokens.
        {rules?.enabled
          ? ` After elder approval, there is a ${rules.noticeHours}-hour notice period. The war lasts ${rules.durationDays} days, with ${rules.dailyDecay} townhall health lost each day.`
          : ` ${WAR_TOKEN_DECAY_NOTE}`}
      </p>
    </div>
  );
};

/**
 * Raid Dialog Content
 */
const InitiateRaidDialogContent: React.FC<DialogContentProps> = (props) => {
  return (
    <div className="relative rounded-lg border p-4 text-center">
      <SectorVillageDialogContent {...props} />
      <div className="space-y-2 py-3">
        <p>
          Factions with at least {FACTION_RAID_MIN_MEMBERS} members can start a raid for{" "}
          {FACTION_RAID_COST.toLocaleString()} treasury tokens. Each side&apos;s
          matching structure has {FACTION_RAID_STRUCTURE_HP.toLocaleString()} raid HP
          and loses {FACTION_RAID_DAILY_DRAIN} HP daily.
        </p>
        <p>
          Win within {FACTION_RAID_MAX_DAYS} days to earn{" "}
          {FACTION_RAID_REWARD.toLocaleString()} treasury tokens and a{" "}
          {FACTION_RAID_BOOST_PERCENT}% increase to your matching structure&apos;s
          benefits for {FACTION_RAID_BOOST_HOURS} hours. A successful defender receives
          the same structure bonus.
        </p>
        <p>
          The target structure is protected for {FACTION_RAID_TARGET_COOLDOWN_HOURS}{" "}
          hours after completion. An active bonus blocks another raid for that structure
          category. A failed raid blocks the same target settlement for{" "}
          {FACTION_RAID_FAILURE_COOLDOWN_HOURS} hours. Raids apply no war penalties,
          exhaustion, or token decay.
        </p>
      </div>
      <div className="space-y-2">
        <p className="font-semibold">Select Target Structure:</p>
        <Select value={props.structureRoute} onValueChange={props.setStructureRoute}>
          <SelectTrigger>
            <SelectValue placeholder="Select a structure to raid" />
          </SelectTrigger>
          <SelectContent>
            {props.structures
              ?.filter((structure) =>
                (FACTION_RAID_STRUCTURE_ROUTES as readonly string[]).includes(
                  structure.route,
                ),
              )
              .map((structure) => (
                <SelectItem key={structure.id} value={structure.route}>
                  {structure.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        {props.raidBlock && (
          <p role="status" className="text-destructive text-sm">
            {props.raidBlock}
          </p>
        )}
      </div>
    </div>
  );
};

/** How a village war drains the declaring village's tokens over time. */
const WAR_TOKEN_DECAY_NOTE = `Each day at war reduces your tokens by ${WAR_DAILY_TOKEN_DECAY_PERCENT_BASE}% (increasing to ${WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_5}% after 5 days and ${WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_8}% after 8 days).`;

/**
 * Props passed to all dialog content components
 */
interface DialogContentProps {
  /** Why the selected structure cannot be raided, when it cannot. */
  raidBlock?: string;
  status: string;
  textColor: string;
  relationships: VillageAlliance[];
  targetSector: number | null;
  user: NonNullable<UserWithRelations>;
  villages?: Village[];
  sectorVillage?: Village;
  sectorOwnerVillage?: Village;
  structureRoute: string;
  structures?: VillageStructure[];
  setStructureRoute: React.Dispatch<React.SetStateAction<string>>;
}
