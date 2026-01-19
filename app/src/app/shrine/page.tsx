"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useRequiredUserData } from "@/utils/UserContext";
import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { Swords, Users, Shield } from "lucide-react";
import Image from "@/layout/Image";
import StatusBar from "@/layout/StatusBar";
import {
  WAR_SHRINE_IMAGE,
  VILLAGE_SYNDICATE_ID,
  MAP_RESERVED_SECTORS,
} from "@/drizzle/constants";
import RamenShop from "@/layout/RamenShop";
import ShrineBattleLobby from "@/layout/ShrineBattleLobby";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type War } from "@/drizzle/schema";

export default function Shrine() {
  // Data from database
  const { data: userData, updateUser } = useRequiredUserData();
  const { data: sectorData } = api.travel.getSectorData.useQuery(
    { sector: userData?.sector || 0 },
    { enabled: !!userData, refetchInterval: 10000 },
  );

  // Router for forwarding
  const router = useRouter();

  // Mutation for starting a fight
  const { mutate: attack, isPending: isAttacking } =
    api.combat.startShrineBattle.useMutation({
      onSuccess: async (result) => {
        if (result.success && result.battleId) {
          await updateUser({
            status: "BATTLE",
            battleId: result.battleId,
            updatedAt: new Date(),
          });
          router.push("/combat");
          showMutationToast({ ...result, message: "Attacking the Shrine" });
        } else {
          showMutationToast(result);
        }
      },
    });

  // Query for user's queued shrine battle (to check if they're queued for this sector)
  // IMPORTANT: This hook must be called before any early returns to follow React's Rules of Hooks
  const { data: userQueuedBattle } = api.shrine.getUserQueuedShrineBattle.useQuery(
    undefined,
    { enabled: userData?.status === "QUEUED" },
  );

  // Loaders
  if (!userData) return <Loader explanation="Loading userdata" />;
  if (!sectorData) return <Loader explanation="Loading sector data" />;
  if (!userData.villageId) return <Loader explanation="No village found" />;

  // Check if there's an active war in this sector
  // For SECTOR_WAR: check war.sector
  // For VILLAGE_WAR/WAR_RAID: check if this sector is either village's home sector
  const activeWars = sectorData.warData?.filter((war) => {
    if (war.type === "SECTOR_WAR") {
      return war.sector === userData.sector;
    }
    if (["VILLAGE_WAR", "WAR_RAID"].includes(war.type)) {
      return (
        war.attackerVillage?.sector === userData.sector ||
        war.defenderVillage?.sector === userData.sector
      );
    }
    return false;
  });

  // Determine if this sector is owned (for MPVP attacks/defends)
  const sectorOwnerVillageId = sectorData.sectorData?.villageId ?? null;
  const userIsOwner = sectorOwnerVillageId === userData.villageId;
  const isSyndicate = sectorOwnerVillageId === VILLAGE_SYNDICATE_ID;
  const isAtWar = sectorData.warData?.some(
    (war) =>
      (war.attackerVillageId === userData.villageId ||
        war.defenderVillageId === userData.villageId ||
        war.warAllies?.some((a) => a.villageId === userData.villageId)) &&
      (war.attackerVillageId === sectorOwnerVillageId ||
        war.defenderVillageId === sectorOwnerVillageId),
  );
  const canShowMpvpOption =
    !!sectorOwnerVillageId && (isAtWar || (isSyndicate && !userIsOwner));

  // Check if user is queued FOR THIS SECTOR - only then show the lobby
  const isUserQueuedForThisSector =
    userData.status === "QUEUED" && userQueuedBattle?.sector === userData.sector;

  // Check if this sector is protected
  const isReserved = MAP_RESERVED_SECTORS.includes(userData.sector);
  const isHome = !!sectorData.village;

  // Check if user can attack OR defend the shrine in a Village War or Raid
  // Attack: Attackers at defender's village, Defenders at attacker's village (reduces shrine HP)
  // Defend: Attackers at their own village when damaged, Defenders at their own village when damaged (restores shrine HP)
  const userCanBattleVillageWarShrine = sectorData.warData?.some((war) => {
    if (!["VILLAGE_WAR", "WAR_RAID"].includes(war.type)) return false;

    const isUserOnAttackerSide =
      war.attackerVillageId === userData.villageId ||
      war.warAllies?.some(
        (a) =>
          a.villageId === userData.villageId &&
          a.supportVillageId === war.attackerVillageId,
      );

    const isUserOnDefenderSide =
      war.defenderVillageId === userData.villageId ||
      war.warAllies?.some(
        (a) =>
          a.villageId === userData.villageId &&
          a.supportVillageId === war.defenderVillageId,
      );

    const atDefenderVillage = war.defenderVillage?.sector === userData.sector;
    const atAttackerVillage = war.attackerVillage?.sector === userData.sector;

    // Attack scenarios: at enemy's village
    const canAttack =
      (atDefenderVillage && isUserOnAttackerSide) ||
      (atAttackerVillage && isUserOnDefenderSide);

    // Defend scenarios: at own village when shrine is damaged
    const canDefend =
      (atAttackerVillage &&
        isUserOnAttackerSide &&
        war.attackerShrineHp < war.attackerShrineMaxHp) ||
      (atDefenderVillage &&
        isUserOnDefenderSide &&
        war.defenderShrineHp < war.defenderShrineMaxHp);

    return canAttack || canDefend;
  });

  // Home sectors are protected UNLESS user can battle in a Village War/Raid
  const isProtected = isReserved || (isHome && !userCanBattleVillageWarShrine);

  // Split wars into user's wars and competing wars
  const userWars =
    activeWars?.filter(
      (war) =>
        war.attackerVillageId === userData.villageId ||
        war.defenderVillageId === userData.villageId ||
        war.warAllies.some((wa) => wa.villageId === userData.villageId),
    ) ?? [];
  const competingWars =
    activeWars?.filter(
      (war) =>
        war.attackerVillageId !== userData.villageId &&
        war.defenderVillageId !== userData.villageId &&
        !war.warAllies.some((wa) => wa.villageId === userData.villageId),
    ) ?? [];

  // Check if user is an attacker in any of their wars (for Team Battle tab)
  const userIsAttacker = userWars.some(
    (war) =>
      war.attackerVillageId === userData.villageId ||
      war.warAllies.some(
        (wa) =>
          wa.villageId === userData.villageId &&
          wa.supportVillageId === war.attackerVillageId,
      ),
  );
  const userIsDefender = userWars.some(
    (war) =>
      war.defenderVillageId === userData.villageId ||
      war.warAllies.some(
        (wa) =>
          wa.villageId === userData.villageId &&
          wa.supportVillageId === war.defenderVillageId,
      ),
  );

  const hasNoActiveWars = !activeWars || activeWars.length === 0;

  return (
    <div className="space-y-8">
      {hasNoActiveWars && (
        <ContentBox
          title={`Lvl. ${sectorData.sectorData?.shrineLevel || 1} Shrine`}
          subtitle={sectorData.sectorData ? "Sector is Claimed" : "Unclaimed Sector"}
          defaultBackHref="/travel"
        >
          {canShowMpvpOption || isUserQueuedForThisSector ? (
            <Tabs defaultValue="team" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="team">
                  <Users className="mr-2 h-4 w-4" />
                  Team Battle
                </TabsTrigger>
                <TabsTrigger value="info">
                  <Shield className="mr-2 h-4 w-4" />
                  Sector Info
                </TabsTrigger>
              </TabsList>
              <TabsContent value="team" className="mt-4">
                {userIsOwner ? (
                  <div className="mb-4 text-sm text-muted-foreground">
                    Your village owns this sector. You can join as a defender if an
                    attack party is formed against this shrine.
                  </div>
                ) : isProtected ? (
                  <div className="mb-4 text-sm text-amber-600 font-semibold">
                    {isReserved
                      ? "This sector is reserved and cannot be attacked."
                      : "This is a village home sector and its shrine cannot be attacked."}
                  </div>
                ) : canShowMpvpOption ? (
                  <div className="mb-4 text-sm text-muted-foreground">
                    Form a team to attack this shrine together! Up to 3 attackers can
                    join the assault, and defenders from the owning village can queue
                    to defend.
                  </div>
                ) : isUserQueuedForThisSector ? (
                  <div className="mb-4 text-sm text-muted-foreground">
                    You are queued for a shrine battle. You can view your queue status
                    or leave the queue below.
                  </div>
                ) : null}
                <ShrineBattleLobby
                  sectorNumber={userData.sector}
                  userId={userData.userId}
                  userVillageId={userData.villageId}
                  defenderVillageId={sectorOwnerVillageId}
                  isProtected={isProtected}
                />
              </TabsContent>
              <TabsContent value="info" className="mt-4">
                <div className="flex flex-col items-center">
                  {sectorData.sectorData ? (
                    userIsOwner ? (
                      <p>
                        This sector is owned by your village. You can defend it when
                        other villages attack.
                      </p>
                    ) : (
                      <p>
                        This sector is claimed by{" "}
                        <strong>{sectorData.sectorData?.village.name}</strong>.{" "}
                        {isProtected
                          ? "However, because it is a protected sector, it cannot be attacked."
                          : "The leader of your village or faction can attack the shrine to try and defeat it and claim the sector."}
                      </p>
                    )
                  ) : (
                    <p>
                      This sector is unclaimed.{" "}
                      {!isProtected &&
                        "The leader of your village or faction can attack the shrine to try and defeat it and claim the sector."}
                    </p>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          ) : (
            <div className="flex flex-col items-center text-center">
              {sectorData.sectorData ? (
                userIsOwner ? (
                  <p>
                    This sector is owned by your village. You can defend it when
                    other villages attack.
                  </p>
                ) : (
                  <p>
                    {" "}
                    This sector is claimed by{" "}
                    <strong>{sectorData.sectorData.village.name}</strong>.{" "}
                    {isProtected
                      ? "However, because it is a protected sector, it cannot be attacked."
                      : "The leader of your village or faction can attack the shrine to try and defeat it and claim the sector."}
                  </p>
                )
              ) : (
                <p>
                  This sector is unclaimed.{" "}
                  {!isProtected &&
                    "The leader of your village or faction can attack the shrine to try and defeat it and claim the sector."}
                </p>
              )}
              {isProtected && (
                <p className="mt-2 text-amber-600 font-semibold">
                  {isReserved
                    ? "This sector is reserved and cannot be attacked."
                    : "This is a village home sector and its shrine cannot be attacked."}
                </p>
              )}
            </div>
          )}
        </ContentBox>
      )}

      {userWars.length > 0 && (
        <ContentBox
          title="Your Wars"
          subtitle={`Sector ${userData.sector}`}
          defaultBackHref="/travel"
        >
          <Tabs defaultValue="solo" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="solo">
                <Swords className="mr-2 h-4 w-4" />
                Solo Battle
              </TabsTrigger>
              <TabsTrigger value="team">
                <Users className="mr-2 h-4 w-4" />
                Team Battle
              </TabsTrigger>
            </TabsList>
            <TabsContent value="solo">
              <div className="divide-y border rounded-lg">
                {userWars.map((war) => (
                  <WarCard
                    key={war.id}
                    war={war}
                    villageId={userData.villageId!}
                    sector={userData.sector}
                    onAttack={() => attack({ sector: userData.sector })}
                    isAttacking={isAttacking}
                    isProtected={isProtected}
                  />
                ))}
              </div>
            </TabsContent>
            <TabsContent value="team">
              {userWars.length > 0 && (
                <div className="mb-6 divide-y border rounded-lg">
                  {userWars.map((war) => (
                    <WarCard
                      key={war.id}
                      war={war}
                      villageId={userData.villageId!}
                      sector={userData.sector}
                      onAttack={() => {}}
                      isAttacking={false}
                      hideAttackButton={true}
                      isProtected={isProtected}
                    />
                  ))}
                </div>
              )}
              {userIsAttacker ? (
                <>
                  {isProtected ? (
                    <div className="mb-4 text-sm text-amber-600 font-semibold">
                      {isReserved
                        ? "This sector is reserved and cannot be attacked."
                        : "This is a village home sector and its shrine cannot be attacked."}
                    </div>
                  ) : (
                    <div className="mb-4 text-sm text-muted-foreground">
                      Form a team to attack this shrine together! Up to 3 attackers
                      can join the assault, and defenders from the owning village can
                      queue to defend.
                    </div>
                  )}
                  <ShrineBattleLobby
                    sectorNumber={userData.sector}
                    userId={userData.userId}
                    userVillageId={userData.villageId}
                    defenderVillageId={sectorOwnerVillageId}
                    isProtected={isProtected}
                  />
                </>
              ) : userIsDefender ? (
                <>
                  <div className="mb-4 text-sm text-muted-foreground">
                    Your village is defending this shrine. You can join as a defender
                    when attackers start a team battle.
                  </div>
                  <ShrineBattleLobby
                    sectorNumber={userData.sector}
                    userId={userData.userId}
                    userVillageId={userData.villageId}
                    defenderVillageId={sectorOwnerVillageId}
                    isProtected={isProtected}
                  />
                </>
              ) : (
                <div className="text-center text-muted-foreground">
                  No active team battles for this sector.
                </div>
              )}
            </TabsContent>
          </Tabs>
        </ContentBox>
      )}

      {competingWars.length > 0 && (
        <ContentBox
          title="Competing Wars"
          subtitle="Other villages trying to claim sector"
        >
          <div className="divide-y">
            {competingWars.map((war) => (
              <WarCard
                key={war.id}
                war={war}
                villageId={userData.villageId!}
                sector={userData.sector}
                onAttack={() => attack({ sector: userData.sector })}
                isAttacking={isAttacking}
                isProtected={isProtected}
              />
            ))}
          </div>
        </ContentBox>
      )}

      <RamenShop initialBreak={hasNoActiveWars} />
    </div>
  );
}

// Component to render a single war
const WarCard = ({
  war,
  villageId,
  sector,
  onAttack,
  isAttacking,
  hideAttackButton = false,
  isProtected = false,
}: {
  war: War & {
    attackerVillage: { name: string; villageGraphic: string; sector?: number };
    defenderVillage: { name: string; villageGraphic: string; sector?: number };
    warAllies: Array<{ villageId: string; supportVillageId: string }>;
  };
  villageId: string;
  sector: number;
  onAttack: () => void;
  isAttacking: boolean;
  hideAttackButton?: boolean;
  isProtected?: boolean;
}) => {
  // Check if user is attacker or defender (including via war allies)
  const isUserAttacker =
    war.attackerVillageId === villageId ||
    war.warAllies.some(
      (wa) =>
        wa.villageId === villageId &&
        wa.supportVillageId === war.attackerVillageId,
    );
  const isUserDefender =
    war.defenderVillageId === villageId ||
    war.warAllies.some(
      (wa) =>
        wa.villageId === villageId &&
        wa.supportVillageId === war.defenderVillageId,
    );
  const isVillageWar = ["VILLAGE_WAR", "WAR_RAID"].includes(war.type);

  // Determine which village's shrine we're at
  const atAttackerVillage = war.attackerVillage?.sector === sector;
  const atDefenderVillage = war.defenderVillage?.sector === sector;

  // Determine which shrine is being targeted and its HP
  // For Village Wars: at defender village = defender shrine, at attacker village = attacker shrine
  // For Sector Wars: always defender shrine
  const targetShrineHp = isVillageWar
    ? atDefenderVillage
      ? war.defenderShrineHp
      : war.attackerShrineHp
    : war.defenderShrineHp;
  const targetShrineMaxHp = isVillageWar
    ? atDefenderVillage
      ? war.defenderShrineMaxHp
      : war.attackerShrineMaxHp
    : war.defenderShrineMaxHp;
  const targetShrineStatus = isVillageWar
    ? atDefenderVillage
      ? war.defenderShrineStatus
      : war.attackerShrineStatus
    : war.defenderShrineStatus;

  // Determine action type: attack or defend
  // Attackers at own village = defend (if shrine damaged)
  // Attackers at enemy village = attack
  // Defenders at own village = defend (if shrine damaged)
  // Defenders at enemy village = attack
  const isDefendAction = isVillageWar && (
    (isUserAttacker && atAttackerVillage && war.attackerShrineHp < war.attackerShrineMaxHp) ||
    (isUserDefender && atDefenderVillage && war.defenderShrineHp < war.defenderShrineMaxHp)
  );

  // For Village Wars: users can attack/defend based on location and shrine state
  const canAttackVillageWar =
    isVillageWar &&
    !hideAttackButton &&
    !isProtected &&
    ((isUserAttacker && atDefenderVillage && war.defenderShrineHp > 0) ||
     (isUserDefender && atAttackerVillage && war.attackerShrineHp > 0));

  const canDefendVillageWar =
    isVillageWar &&
    !hideAttackButton &&
    !isProtected &&
    isDefendAction;

  // For Sector Wars: only attackers can attack
  const canAttackSectorWar =
    !isVillageWar && isUserAttacker && war.defenderShrineHp > 0 && !hideAttackButton && !isProtected;

  const canAttack = canAttackVillageWar || canAttackSectorWar;
  const canDefend = canDefendVillageWar;

  // Get shrine status display
  const getShrineStatusBadge = (hp: number, maxHp: number, status: string) => {
    if (status === "CAPTURED") return { text: "Captured", className: "bg-red-500/20 text-red-500" };
    if (hp < maxHp * 0.25) return { text: "Damaged", className: "bg-yellow-500/20 text-yellow-500" };
    return { text: "Active", className: "bg-green-500/20 text-green-500" };
  };

  const statusBadge = getShrineStatusBadge(targetShrineHp, targetShrineMaxHp, targetShrineStatus);

  // Determine the shrine sector to display
  const displaySector = isVillageWar
    ? atAttackerVillage
      ? war.attackerVillage?.sector
      : war.defenderVillage?.sector
    : war.sector;

  return (
    <div className="flex flex-col items-center gap-4 p-4">
      <div className="flex w-full items-center justify-between gap-4">
        {/* Attacker Village */}
        <div className="flex flex-col items-center">
          <div className="text-sm font-bold mb-2">Attacker</div>
          <Image
            src={war.attackerVillage.villageGraphic}
            alt={war.attackerVillage.name}
            width={100}
            height={100}
          />
          <p className="mt-2 text-sm font-medium">{war.attackerVillage.name}</p>
        </div>

        {/* Shrine */}
        <div className="flex flex-col items-center">
          <Image
            src={WAR_SHRINE_IMAGE}
            alt="War Shrine"
            width={200}
            height={200}
            className={`${targetShrineStatus === "CAPTURED" ? "opacity-50 grayscale" : ""}`}
          />
          <div className="w-full max-w-md space-y-4">
            <div>
              <p className="text-sm font-medium">
                Shrine - Sector {displaySector}
                <span className={`ml-2 text-xs px-2 py-0.5 rounded ${statusBadge.className}`}>
                  {statusBadge.text}
                </span>
              </p>
              <p className="text-sm text-muted-foreground">
                {isVillageWar
                  ? atAttackerVillage
                    ? `${war.attackerVillage.name}'s shrine`
                    : `${war.defenderVillage.name}'s shrine`
                  : isUserAttacker
                    ? "Your village is attacking"
                    : isUserDefender
                      ? "Your village is defending"
                      : "Competing war"}
              </p>
              <StatusBar
                key={`${targetShrineHp}-${targetShrineStatus}`}
                title="HP"
                tooltip="Shrine Health"
                color={targetShrineStatus === "CAPTURED" ? "bg-red-500" : "bg-green-500"}
                showText={true}
                status="AWAKE"
                current={Math.max(0, targetShrineHp)}
                total={targetShrineMaxHp}
              />
            </div>
          </div>
        </div>

        {/* Defender Village */}
        <div className="flex flex-col items-center">
          <div className="text-sm font-bold mb-2">Defender</div>
          <Image
            src={war.defenderVillage.villageGraphic}
            alt={war.defenderVillage.name}
            width={100}
            height={100}
          />
          <p className="mt-2 text-sm font-medium">
            {war.defenderVillageId === VILLAGE_SYNDICATE_ID
              ? "Neutral Territory"
              : war.defenderVillage.name}
          </p>
        </div>
      </div>

      <div className="relative w-full">
        {(canAttack || canDefend) &&
          (!isAttacking ? (
            <Button
              size="xl"
              decoration="gold"
              animation="pulse"
              className="italic text-2xl w-full"
              onClick={onAttack}
            >
              {canDefend ? (
                <>
                  <Shield className="h-10 w-10 mr-4" />
                  Defend shrine
                </>
              ) : (
                <>
                  <Swords className="h-10 w-10 mr-4" />
                  Attack shrine
                </>
              )}
            </Button>
          ) : (
            <div className="min-h-64">
              <div className="absolute bottom-0 left-0 right-0 top-0 z-20 m-auto flex flex-col justify-center bg-black opacity-95">
                <div className="m-auto text-white">
                  <p className="text-5xl">{canDefend ? "Defending" : "Attacking"} the Shrine</p>
                  <Loader />
                </div>
              </div>
            </div>
          ))}
        {targetShrineStatus === "CAPTURED" && (
          <div className="text-center space-y-4 mt-4">
            <h3 className="text-2xl font-bold">Shrine Captured!</h3>
            {isVillageWar ? (
              atDefenderVillage ? (
                isUserAttacker ? (
                  <p>
                    The defender&apos;s shrine has been captured! The defending
                    village&apos;s war health has taken damage. Keep fighting to prevent
                    the defenders from recovering.
                  </p>
                ) : isUserDefender ? (
                  <p>
                    Your shrine has been captured! Your war health has taken damage.
                    Defend this shrine to recover HP. Once the shrine HP rises above 25%,
                    your war health will heal.
                  </p>
                ) : (
                  <p>The shrine has been captured in this war.</p>
                )
              ) : (
                isUserDefender ? (
                  <p>
                    The attacker&apos;s shrine has been captured! Their war health has
                    taken damage. Keep fighting to prevent them from recovering.
                  </p>
                ) : isUserAttacker ? (
                  <p>
                    Your shrine has been captured! Your war health has taken damage.
                    Defend this shrine to recover HP. Once the shrine HP rises above 25%,
                    your war health will heal.
                  </p>
                ) : (
                  <p>The shrine has been captured in this war.</p>
                )
              )
            ) : (
              <>
                <p>
                  The shrine has been defeated. Quickly return to your village&apos;s
                  Town Hall to finalize the war and claim the sector!
                </p>
                <Link href="/travel">
                  <Button>Travel to Village</Button>
                </Link>
              </>
            )}
          </div>
        )}
        {(canAttack || canDefend) && (
          <div className="space-y-4 mt-4 text-muted-foreground">
            {canDefend
              ? "Defend your shrine by winning battles against the AI defenders. Victories will restore shrine HP."
              : "Attack the enemy shrine by engaging its AI defenders. Victories will reduce shrine HP."}
          </div>
        )}
      </div>
    </div>
  );
};
