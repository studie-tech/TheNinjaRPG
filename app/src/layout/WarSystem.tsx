"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  DoorClosed,
  Handshake,
  Info,
  LandPlot,
  Locate,
  Swords,
  Trash2,
  Trophy,
} from "lucide-react";
import dynamic from "next/dynamic";
import type React from "react";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MAP_RESERVED_SECTORS,
  VILLAGE_SYNDICATE_ID,
  WAR_ALLY_OFFER_MIN,
  WAR_DAILY_TOKEN_DECAY_PERCENT_BASE,
  WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_5,
  WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_8,
  WAR_DECLARATION_COST,
  WAR_FUNDS_COST,
  WAR_PURCHASE_SHRINE_TOKEN_COST,
  WAR_RECAPTURE_THRESHOLD,
  WAR_SHRINE_CAPTURE_WARHEALTH_DMG,
  WAR_SHRINE_IMAGE,
  WAR_SHRINE_RECAPTURE_WARHEALTH_HEAL,
  WAR_VICTORY_TOKEN_BONUS,
} from "@/drizzle/constants";
import type { Village, VillageAlliance, VillageStructure } from "@/drizzle/schema";
import { useMap } from "@/hooks/map";
import Building from "@/layout/Building";
import Confirm2 from "@/layout/Confirm2";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import MapError from "@/layout/MapError";
import Modal2 from "@/layout/Modal2";
import NavTabs from "@/layout/NavTabs";
import StatusBar from "@/layout/StatusBar";
import type { ColumnDefinitionType } from "@/layout/Table";
import Table from "@/layout/Table";
import UserRequestSystem from "@/layout/UserRequestSystem";
import { showMutationToast } from "@/libs/toast";
import { canJoinWar } from "@/libs/war";
import type { UserWithRelations } from "@/routers/profile";
import type { FetchActiveWarsReturnType } from "@/server/api/routers/war";
import { calculateEnemyConsequences, findRelationship } from "@/utils/alliance";
import { canAdministrateWars } from "@/utils/permissions";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import type { ArrayElement } from "@/utils/typeutils";
import { useRequiredUserData } from "@/utils/UserContext";
import {
  type FindSectorSchema,
  type FindSectorSchemaInput,
  findSectorSchema,
} from "@/validators/travel";
import {
  type AllianceOfferSchema,
  type AllianceOfferSchemaInput,
  createAllianceOfferSchema,
} from "@/validators/war";

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
            <div className="space-y-2 text-center">
              <p className="text-muted-foreground">
                Your village cannot declare war until the exhaustion period ends.
              </p>
              <p className="font-semibold text-lg">
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
  const [focusSector, setFocusSector] = useState<number | null>(null);

  // Find sector form
  const findSectorForm = useForm<FindSectorSchemaInput, unknown, FindSectorSchema>({
    mode: "all",
    resolver: zodResolver(findSectorSchema),
  });
  const findSectorValue = useWatch({
    control: findSectorForm.control,
    name: "sector",
  });

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
    sectorOwnerVillage,
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
  let modalContent: React.ReactNode | undefined;
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
            userVillageId: user.villageId ?? "",
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
            userVillageId: user.villageId ?? "",
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
      {/* Find Sector Control */}
      <div className="absolute top-2 right-2 z-10">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className={focusSector !== null ? "text-purple-500" : ""}
            >
              <Locate className="h-5 w-5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent>
            <p className="py-2 font-semibold">Find Sector</p>
            <p className="pb-2 text-muted-foreground text-sm">
              Enter a sector ID to locate it on the map.
            </p>
            <Form {...findSectorForm}>
              <form
                onSubmit={findSectorForm.handleSubmit((data) => {
                  setFocusSector(data.sector);
                })}
                className="flex flex-col gap-2"
              >
                <FormField
                  control={findSectorForm.control}
                  name="sector"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          className="w-full"
                          placeholder="Sector ID (0-492)"
                          type="number"
                          {...field}
                          value={field.value as number | undefined}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    className="flex-1"
                    disabled={findSectorValue === undefined}
                  >
                    Find Sector {(findSectorValue as number | undefined) ?? "..."}
                  </Button>
                  {focusSector !== null && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setFocusSector(null)}
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </form>
            </Form>
          </PopoverContent>
        </Popover>
      </div>
      {villages && globe && (
        <GlobalMap
          intersection={true}
          highlights={villages}
          userLocation={true}
          showOwnership={true}
          focusSector={focusSector}
          focusSectorLabel="Target"
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

  // Only show active sector wars
  if (war.status !== "ACTIVE") return null;

  // Derived
  const canBuildShrine =
    isKage &&
    user.village?.tokens &&
    war.attackerVillageId === user.villageId &&
    war.defenderShrineHp <= 0 &&
    user.village?.tokens >= WAR_PURCHASE_SHRINE_TOKEN_COST;

  // Render
  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-2">
          <div className="flex w-full justify-end">
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
            className={war.defenderShrineHp <= 0 ? "opacity-50 grayscale" : ""}
          />
          <div className="w-full max-w-md space-y-2">
            <div>
              <p className="font-medium text-sm">Shrine - Sector {war.sector}</p>
              {war.defenderShrineHp > 0 && (
                <StatusBar
                  title="HP"
                  tooltip="Shrine Health"
                  color="bg-red-500"
                  showText={true}
                  status="AWAKE"
                  current={war.defenderShrineHp}
                  total={war.defenderShrineMaxHp}
                />
              )}
            </div>
            <div className="mt-2 rounded-md bg-popover p-3 text-popover-foreground text-sm">
              {war.defenderShrineHp > 0 ? (
                war.defenderVillageId === VILLAGE_SYNDICATE_ID ? (
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
                )
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
                    <LandPlot className="mr-2 h-5 w-5" />
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
  sectorOwnerVillage?: Village;
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
      <p className={`mb-2 font-semibold text-sm ${props.textColor}`}>
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
        Tokens. Each day at war reduces your tokens by{" "}
        {WAR_DAILY_TOKEN_DECAY_PERCENT_BASE}% (increasing to{" "}
        {WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_5}% after 5 days and{" "}
        {WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_8}% after 8 days).
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
    <div className="relative rounded-lg border p-4 text-center">
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
    <div className="relative rounded-lg border p-4 text-center">
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
    <div className="relative rounded-lg border p-4 text-center">
      <SectorVillageDialogContent {...props} />
      <p>
        You are about to declare war on {props.sectorVillage.name}. Are you sure? The
        cost of declaring war is {WAR_DECLARATION_COST.toLocaleString()} Village Tokens.
        Each day at war reduces your tokens by {WAR_DAILY_TOKEN_DECAY_PERCENT_BASE}%
        (increasing to {WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_5}% after 5 days and{" "}
        {WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_8}% after 8 days).
      </p>
    </div>
  );
};

/**
 * Raid Dialog Content
 */
export const InitiateRaidDialogContent: React.FC<DialogContentProps> = (props) => {
  return (
    <div className="relative rounded-lg border p-4 text-center">
      <SectorVillageDialogContent {...props} />
      <div>
        You have the option of initiating a raid in this sector, targeting a given
        structure. The cost of starting a raid is{" "}
        {WAR_DECLARATION_COST.toLocaleString()} tokens. Each day at war reduces your
        tokens by {WAR_DAILY_TOKEN_DECAY_PERCENT_BASE}% (increasing to{" "}
        {WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_5}% after 5 days and{" "}
        {WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_8}% after 8 days). If you win, the structure
        level will be reduced by 3 and you will receive{" "}
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
 * Town Hall component for a side of a war
 */
const WarSideTownHall: React.FC<{
  structure: VillageStructure;
  village: Village;
  warStatus: string;
  warHealth: number;
  warHealthMax: number;
}> = ({ structure, village, warStatus, warHealth, warHealthMax }) => {
  return (
    <div className="flex flex-col items-center">
      <h5 className="mb-2 font-bold">{village.name}</h5>
      {warStatus === "ACTIVE" && (
        <div className="mb-2 w-full">
          <StatusBar
            title="HP"
            tooltip="War Health - Depletes from PvP kills"
            color="bg-red-500"
            showText={true}
            current={warHealth}
            total={warHealthMax}
          />
        </div>
      )}
      <div className="w-full max-w-[160px]">
        <Building
          structure={structure}
          village={village}
          textPosition="bottom"
          showBar={false}
          showNumbers={false}
        />
      </div>
    </div>
  );
};

/**
 * Shrine component for a side of a war
 */
const WarSideShrine: React.FC<{
  village: Village;
  shrineHp: number;
  shrineMaxHp: number;
  shrineStatus: string | null;
}> = ({ village, shrineHp, shrineMaxHp, shrineStatus }) => {
  const isCaptured = shrineStatus === "CAPTURED";
  const isDamaged = shrineHp < shrineMaxHp * 0.25;

  return (
    <div className="flex flex-col items-center">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-semibold text-sm">{village.name} Shrine</span>
        <span
          className={`rounded px-2 py-0.5 text-xs ${isCaptured ? "bg-red-500/20 text-red-500" : isDamaged ? "bg-yellow-500/20 text-yellow-500" : "bg-green-500/20 text-green-500"}`}
        >
          {isCaptured ? "Captured" : isDamaged ? "Damaged" : "Active"}
        </span>
      </div>
      <div className="mb-2 w-full">
        <StatusBar
          title="HP"
          tooltip="Shrine Health"
          color={isCaptured ? "bg-red-500" : "bg-blue-500"}
          showText={true}
          status="AWAKE"
          current={shrineHp}
          total={shrineMaxHp}
        />
      </div>
      <div className="relative aspect-square w-full max-w-[160px]">
        <Image
          src={WAR_SHRINE_IMAGE}
          alt={`${village.name} Shrine`}
          fill
          className={`object-contain ${isCaptured ? "opacity-50 grayscale" : ""}`}
        />
      </div>
    </div>
  );
};

/**
 * Supporting Forces component for a side of a war
 */
const WarSideSupportingForces: React.FC<{
  village: Village;
  warAllies: FetchActiveWarsReturnType["warAllies"];
}> = ({ village, warAllies }) => {
  const allies = warAllies.filter((warAlly) => warAlly.supportVillageId === village.id);

  return (
    <div className="flex flex-col items-center">
      <p className="mb-2 text-muted-foreground text-sm">{village.name}</p>
      <div className="flex flex-wrap justify-center gap-2">
        {allies.map((warAlly) => (
          <div
            key={warAlly.villageId}
            className="flex items-center space-x-2 rounded-full border bg-popover px-3 py-1"
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
        {allies.length === 0 && (
          <div className="text-muted-foreground text-sm italic">
            No supporting forces
          </div>
        )}
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
  const [showShrineMechanics, setShowShrineMechanics] = useState(false);
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
    { key: "townhallHpChange", header: "War Health", type: "string" },
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
            ? "War Health Damage"
            : "Shrine Damage",
      type: "string",
    },
  ];

  // tRPC utility
  const utils = api.useUtils();

  // Form for token offer
  const offerSchema = createAllianceOfferSchema(userVillage?.tokens ?? 0);

  const offerForm = useForm<AllianceOfferSchemaInput, unknown, AllianceOfferSchema>({
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
    <div className="rounded-lg border p-4">
      <div className="mb-4 flex items-center justify-between">
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
                className={`font-bold ${war.status === "DRAW" ? "text-yellow-500" : war.status === "ATTACKER_VICTORY" ? (isAttacker ? "text-green-500" : "text-red-500") : !isAttacker ? "text-green-500" : "text-red-500"}`}
              >
                Outcome:{" "}
                {war.status === "DRAW"
                  ? "War ended in a Draw"
                  : war.status === "ATTACKER_VICTORY"
                    ? isAttacker
                      ? "Victory"
                      : "Defeat"
                    : !isAttacker
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
          <p className="text-muted-foreground text-sm">
            Kills are recorded for 30 days after the war ends.
          </p>
          {warKills && warKills.length > 0 ? (
            <div className="rounded-lg border">
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
              War Health Damage
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

      {/* Town Halls Section */}
      <div className="rounded-lg border border-border p-4">
        <div className="grid grid-cols-2 gap-4">
          <WarSideTownHall
            structure={isAttacker ? attackerStructure : defenderStructure}
            village={isAttacker ? war.attackerVillage : war.defenderVillage}
            warStatus={war.status}
            warHealth={isAttacker ? war.attackerWarHealth : war.defenderWarHealth}
            warHealthMax={
              isAttacker ? war.attackerWarHealthMax : war.defenderWarHealthMax
            }
          />
          <WarSideTownHall
            structure={isAttacker ? defenderStructure : attackerStructure}
            village={isAttacker ? war.defenderVillage : war.attackerVillage}
            warStatus={war.status}
            warHealth={isAttacker ? war.defenderWarHealth : war.attackerWarHealth}
            warHealthMax={
              isAttacker ? war.defenderWarHealthMax : war.attackerWarHealthMax
            }
          />
        </div>
      </div>

      {/* Shrines Section */}
      {["VILLAGE_WAR", "WAR_RAID"].includes(war.type) && war.status === "ACTIVE" && (
        <div className="mt-4 rounded-lg border border-border p-4">
          <div className="grid grid-cols-2 gap-4">
            <WarSideShrine
              village={isAttacker ? war.attackerVillage : war.defenderVillage}
              shrineHp={isAttacker ? war.attackerShrineHp : war.defenderShrineHp}
              shrineMaxHp={
                isAttacker ? war.attackerShrineMaxHp : war.defenderShrineMaxHp
              }
              shrineStatus={
                isAttacker ? war.attackerShrineStatus : war.defenderShrineStatus
              }
            />
            <WarSideShrine
              village={isAttacker ? war.defenderVillage : war.attackerVillage}
              shrineHp={isAttacker ? war.defenderShrineHp : war.attackerShrineHp}
              shrineMaxHp={
                isAttacker ? war.defenderShrineMaxHp : war.attackerShrineMaxHp
              }
              shrineStatus={
                isAttacker ? war.defenderShrineStatus : war.attackerShrineStatus
              }
            />
          </div>
          <div className="mt-3 flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowShrineMechanics(true)}
            >
              <Info className="mr-1 h-4 w-4" />
              Shrine Mechanics
            </Button>
            <Modal2
              title="Shrine Mechanics"
              isOpen={showShrineMechanics}
              setIsOpen={setShowShrineMechanics}
            >
              <div className="space-y-4">
                <p className="text-muted-foreground text-sm">
                  The shrine is a key objective in village wars. Its HP determines
                  control of the shrine.
                </p>
                <div className="space-y-2">
                  <h6 className="font-semibold">Attack (Enemy Shrine):</h6>
                  <p className="text-muted-foreground text-sm">
                    When you win shrine combat against an enemy at their shrine, you{" "}
                    <span className="font-semibold text-red-500">reduce</span> their
                    shrine&apos;s HP.
                  </p>
                </div>
                <div className="space-y-2">
                  <h6 className="font-semibold">Defend (Your Shrine):</h6>
                  <p className="text-muted-foreground text-sm">
                    When you win shrine combat against an enemy at your own shrine, you{" "}
                    <span className="font-semibold text-green-500">restore</span> your
                    shrine&apos;s HP.
                  </p>
                </div>
                <div className="space-y-2">
                  <h6 className="font-semibold">Capture (HP reaches 0):</h6>
                  <p className="text-muted-foreground text-sm">
                    When the shrine HP reaches 0, it is captured. This deals{" "}
                    <span className="font-semibold text-red-500">
                      -{WAR_SHRINE_CAPTURE_WARHEALTH_DMG} HP
                    </span>{" "}
                    to the defender&apos;s war health.
                  </p>
                </div>
                <div className="space-y-2">
                  <h6 className="font-semibold">
                    Recapture (HP exceeds {WAR_RECAPTURE_THRESHOLD * 100}%):
                  </h6>
                  <p className="text-muted-foreground text-sm">
                    When defenders recapture the shrine by raising its HP above{" "}
                    {WAR_RECAPTURE_THRESHOLD * 100}%, they heal{" "}
                    <span className="font-semibold text-green-500">
                      +{WAR_SHRINE_RECAPTURE_WARHEALTH_HEAL} HP
                    </span>{" "}
                    to their war health.
                  </p>
                </div>
              </div>
            </Modal2>
          </div>
        </div>
      )}

      {/* Supporting Forces Section */}
      {["VILLAGE_WAR", "WAR_RAID"].includes(war.type) && (
        <div className="mt-4 rounded-lg border border-border p-4">
          <h6 className="mb-3 text-center font-semibold text-sm">Supporting Forces</h6>
          <div className="grid grid-cols-2 gap-4">
            <WarSideSupportingForces
              village={isAttacker ? war.attackerVillage : war.defenderVillage}
              warAllies={war.warAllies}
            />
            <WarSideSupportingForces
              village={isAttacker ? war.defenderVillage : war.attackerVillage}
              warAllies={war.warAllies}
            />
          </div>
        </div>
      )}

      {isKage &&
        war.status === "ACTIVE" &&
        ["VILLAGE_WAR", "WAR_RAID"].includes(war.type) && (
          <div className="mt-4">
            <h5 className="mb-2 font-bold">Send War Alliance Offers</h5>
            <p className="mb-4 text-muted-foreground text-sm">
              Send offers to factions or allied villages to join your war effort.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {villagesThatCanJoin?.map((village) => (
                <div
                  key={village.id}
                  className="rounded-lg border px-2 py-1 transition-colors hover:bg-popover"
                >
                  <div className="flex items-center space-x-2">
                    <Image
                      src={village.villageGraphic}
                      alt={village.name}
                      width={40}
                      height={40}
                      className="rounded-full"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-sm">{village.name}</p>
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
                                    value={field.value as number}
                                    onChange={(e) => {
                                      const value = parseInt(e.target.value, 10);
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
                      <p className="mt-4 text-muted-foreground text-sm">
                        This will send an offer to {village.name} to join your side in
                        the war against{" "}
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
      {/* Shrine HP Status for Village Wars and Raids */}
    </div>
  );
};
