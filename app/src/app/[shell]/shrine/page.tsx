"use client";

import { Shield, Swords, Users } from "lucide-react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  MAP_RESERVED_SECTORS,
  VILLAGE_SYNDICATE_ID,
  VILLAGE_WAR_TYPES,
  WAR_SHRINE_IMAGE,
} from "@/drizzle/constants";
import type { War } from "@/drizzle/schema";
import { useCombatEntry } from "@/hooks/combatEntry";
import { useNavigationRouter as useRouter } from "@/hooks/navigation";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import RaidBrowser from "@/layout/RaidBrowser";
import RamenShop from "@/layout/RamenShop";
import ShrineBattleLobby from "@/layout/ShrineBattleLobby";
import StatusBar from "@/layout/StatusBar";
import { WarFieldActions } from "@/layout/WarFieldActions";
import {
  findShrineAttackWar,
  getVillageWarShrineAction,
  getWarSide,
} from "@/libs/objectiveWar";
import { isRaidCurrentlyActive } from "@/libs/raids";
import { showMutationToast } from "@/libs/toast";
import { pushToCombat } from "@/utils/routing";
import { useRequiredUserDataSelector } from "@/utils/UserContext";

/** Explains why a ramen menu follows the shrine on a war page. */
const SHRINE_RAMEN_SUBTITLE = "Eat to recover chakra & stamina before the next assault";

export default function Shrine() {
  // Data from database
  const {
    data: userData,
    pusher,
    prepareUserUpdate,
    updateUser,
  } = useRequiredUserDataSelector((profile) => ({
    userId: profile.userId,
    sector: profile.sector,
    status: profile.status,
    villageId: profile.villageId,
  }));
  const { data: sectorData } = api.travel.getSectorData.useQuery(
    { sector: userData?.sector || 0 },
    { enabled: !!userData, refetchInterval: 10000 },
  );

  // Router for forwarding
  const router = useRouter();
  const { prepareCombatEntry, loadBattle } = useCombatEntry();

  // Mutation for starting a fight
  const { mutate: attack, isPending: isAttacking } =
    api.combat.startShrineBattle.useMutation({
      onMutate: () => {
        prepareCombatEntry();
        return prepareUserUpdate();
      },
      onSuccess: async (result, _variables, revision) => {
        if (result.success && result.battleId) {
          loadBattle(result.battleId);
          await updateUser(result, { revision, refetch: false });
          pushToCombat(router, result.battleId);
          showMutationToast({ ...result, message: "Attacking the Shrine" });
        } else {
          if (result.userRecovery)
            await updateUser(result, { revision, refetch: false });
          showMutationToast(result);
        }
      },
      onError: (error) => {
        showMutationToast({ success: false, message: error.message });
      },
    });

  // Query for user's queued shrine battle (to check if they're queued for this sector)
  // IMPORTANT: This hook must be called before any early returns to follow React's Rules of Hooks
  const { data: userQueuedBattle } = api.shrine.getUserQueuedShrineBattle.useQuery(
    undefined,
    { enabled: userData?.status === "QUEUED" },
  );

  // Query for available raids in this sector (for exclusive raid on shrine defeat)
  const { data: availableRaidsData } = api.raids.getAvailableRaids.useQuery(
    { sector: userData?.sector || 0 },
    { enabled: !!userData?.sector },
  );

  // Loaders
  if (!userData) return <Loader explanation="Loading userdata" />;
  if (!sectorData) return <Loader explanation="Loading sector data" />;
  if (
    !userData.villageId &&
    !sectorData.warData?.some((war) => getWarSide(war, null, userData.userId))
  )
    return <Loader explanation="No village found" />;

  // Check if there's an active war in this sector
  // For SECTOR_WAR: check war.sector
  // For VILLAGE_WAR/WAR_RAID: check if this sector is either village's home sector
  const activeWars = sectorData.warData?.filter((war) => {
    if (war.type === "SECTOR_WAR") {
      return war.sector === userData.sector;
    }
    if (VILLAGE_WAR_TYPES.includes(war.type)) {
      return (
        war.attackerVillage?.sector === userData.sector ||
        war.defenderVillage?.sector === userData.sector
      );
    }
    return false;
  });

  // Determine if this sector is owned (for MPVP attacks/defends)
  const sectorOwnerVillageId = sectorData.sectorData?.villageId ?? null;
  const sectorWar = sectorData.warData?.find(
    (war) =>
      !!getWarSide(war, userData.villageId, userData.userId) &&
      (war.attackerVillageId === sectorOwnerVillageId ||
        war.defenderVillageId === sectorOwnerVillageId),
  );
  const userSideVillageId = sectorWar
    ? getWarSide(sectorWar, userData.villageId, userData.userId)
    : userData.villageId;
  const userIsOwner = sectorOwnerVillageId === userSideVillageId;
  const isSyndicate = sectorOwnerVillageId === VILLAGE_SYNDICATE_ID;
  const isAtWar = !!sectorWar;
  const canShowMpvpOption =
    !!sectorOwnerVillageId && (isAtWar || (isSyndicate && !userIsOwner));

  // Check if user is queued FOR THIS SECTOR - only then show the lobby
  const isUserQueuedForThisSector =
    userData.status === "QUEUED" && userQueuedBattle?.sector === userData.sector;

  // Check if this sector is protected; objective wars open reserved shrines
  const isReserved =
    MAP_RESERVED_SECTORS.includes(userData.sector) &&
    !findShrineAttackWar(
      sectorData.warData ?? [],
      userData.villageId,
      userData.userId,
      userData.sector,
    )?.rules;
  const isHome = !!sectorData.village;

  // Check if user can attack OR defend the shrine in a Village War or Raid
  const userCanBattleVillageWarShrine = sectorData.warData?.some(
    (war) =>
      getVillageWarShrineAction(
        war,
        getWarSide(war, userData.villageId, userData.userId),
        userData.sector,
      ) !== null,
  );

  // Home sectors are protected UNLESS user can battle in a Village War/Raid
  const isProtected = isReserved || (isHome && !userCanBattleVillageWarShrine);

  // Split wars into user's wars and competing wars
  const userWars =
    activeWars?.filter((war) => getWarSide(war, userData.villageId, userData.userId)) ??
    [];
  const competingWars =
    activeWars?.filter(
      (war) => !getWarSide(war, userData.villageId, userData.userId),
    ) ?? [];

  // Check if user is an attacker in any of their wars (for Team Battle tab)
  const userIsAttacker = userWars.some(
    (war) =>
      getWarSide(war, userData.villageId, userData.userId) === war.attackerVillageId,
  );
  const userIsDefender = userWars.some(
    (war) =>
      getWarSide(war, userData.villageId, userData.userId) === war.defenderVillageId,
  );

  const hasNoActiveWars = !activeWars || activeWars.length === 0;

  // Check for active exclusive raid in this sector (for when sector war shrine is defeated)
  const availableRaids = availableRaidsData?.raids ?? [];
  const activeExclusiveRaid = availableRaids.find(
    (raid) => raid.raidType === "exclusive" && isRaidCurrentlyActive(raid),
  );

  // Check if user is attacker in a sector war with defeated shrine (for exclusive raid flow)
  const userSectorWarWithDefeatedShrine = userWars.find(
    (war) =>
      war.type === "SECTOR_WAR" &&
      war.defenderShrineHp <= 0 &&
      getWarSide(war, userData.villageId, userData.userId) === war.attackerVillageId,
  );

  // Show exclusive raid flow when shrine is defeated and user is attacker
  const showExclusiveRaidFlow = !!userSectorWarWithDefeatedShrine;

  // If showing raid flow, determine if raid is active or completed
  if (showExclusiveRaidFlow) {
    return (
      <div>
        {activeExclusiveRaid ? (
          // Raid is active - show raid browser
          <RaidBrowser
            title="Defeat the Raid Boss!"
            subtitle="Complete to claim sector"
            initialBreak={false}
            sectorFilter={userData.sector}
          />
        ) : (
          // Raid completed or not configured - show message to finalize
          <ContentBox
            title="Sector Ready to Claim!"
            subtitle={`Sector ${userData.sector}`}
            defaultBackHref="/travel"
          >
            <div className="space-y-4 text-center">
              <Image
                src={WAR_SHRINE_IMAGE}
                alt="War Shrine"
                width={200}
                height={200}
                className="mx-auto opacity-50 grayscale"
              />
              <h3 className="font-bold text-2xl">Victory!</h3>
              <p>
                The shrine has been defeated! Return to your village&apos;s Town Hall to
                finalize the war and claim the sector.
              </p>
              <Button asChild size="lg">
                <Link href="/travel">Travel to Village</Link>
              </Button>
            </div>
          </ContentBox>
        )}
        <RamenShop initialBreak={true} subtitle={SHRINE_RAMEN_SUBTITLE} />
      </div>
    );
  }

  const protectedNotice = isReserved
    ? "This sector is reserved and cannot be attacked."
    : "This is a village home sector and its shrine cannot be attacked.";
  const teamPitch = (
    <div className="mb-4 text-muted-foreground text-sm">
      Form a team to attack this shrine together! Up to 3 attackers can join the
      assault, and defenders from the owning village can queue to defend.
    </div>
  );
  const lobby = (
    <ShrineBattleLobby
      sectorNumber={userData.sector}
      userId={userData.userId}
      sideVillageId={userSideVillageId}
      defenderVillageId={sectorOwnerVillageId}
      isProtected={isProtected}
    />
  );

  return (
    <div className="space-y-8">
      {hasNoActiveWars && (
        <ContentBox
          title={`Lvl. ${sectorData.sectorData?.shrineLevel || 1} Shrine`}
          subtitle={sectorData.sectorData ? "Sector is Claimed" : "Unclaimed Sector"}
          defaultBackHref="/travel"
          topRightContent={<WarFieldActions />}
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
                  <div className="mb-4 text-muted-foreground text-sm">
                    Your village owns this sector. You can join as a defender if an
                    attack party is formed against this shrine.
                  </div>
                ) : isProtected ? (
                  <div className="mb-4 font-semibold text-amber-800 dark:text-amber-300 text-sm">
                    {protectedNotice}
                  </div>
                ) : canShowMpvpOption ? (
                  teamPitch
                ) : isUserQueuedForThisSector ? (
                  <div className="mb-4 text-muted-foreground text-sm">
                    You are queued for a shrine battle. You can view your queue status
                    or leave the queue below.
                  </div>
                ) : null}
                {lobby}
              </TabsContent>
              <TabsContent value="info" className="mt-4">
                <div className="flex flex-col items-center">
                  <SectorClaimDescription
                    ownerVillage={sectorData.sectorData?.village.name}
                    userIsOwner={userIsOwner}
                    isProtected={isProtected}
                  />
                </div>
              </TabsContent>
            </Tabs>
          ) : (
            <div className="flex flex-col items-center text-center">
              <SectorClaimDescription
                ownerVillage={sectorData.sectorData?.village.name}
                userIsOwner={userIsOwner}
                isProtected={isProtected}
              />
              {isProtected && (
                <p className="mt-2 font-semibold text-amber-800 dark:text-amber-300">
                  {protectedNotice}
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
          topRightContent={<WarFieldActions />}
        >
          <Tabs defaultValue="solo" className="w-full">
            <TabsList className="mb-4 grid w-full grid-cols-2">
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
              <div className="divide-y rounded-lg border">
                {userWars.map((war) => (
                  <WarCard
                    key={war.id}
                    war={war}
                    sideVillageId={getWarSide(war, userData.villageId, userData.userId)}
                    sector={userData.sector}
                    onAttack={() =>
                      attack({
                        sector: userData.sector,
                        originSocketId: pusher?.connection.socket_id,
                      })
                    }
                    isAttacking={isAttacking}
                    isProtected={isProtected}
                    hasActiveExclusiveRaid={!!activeExclusiveRaid}
                  />
                ))}
              </div>
            </TabsContent>
            <TabsContent value="team">
              <div className="mb-6 divide-y rounded-lg border">
                {userWars.map((war) => (
                  <WarCard
                    key={war.id}
                    war={war}
                    sideVillageId={getWarSide(war, userData.villageId, userData.userId)}
                    sector={userData.sector}
                    isProtected={isProtected}
                    hasActiveExclusiveRaid={!!activeExclusiveRaid}
                  />
                ))}
              </div>
              {userIsAttacker ? (
                <>
                  {isProtected ? (
                    <div className="mb-4 font-semibold text-amber-800 dark:text-amber-300 text-sm">
                      {protectedNotice}
                    </div>
                  ) : (
                    teamPitch
                  )}
                  {lobby}
                </>
              ) : userIsDefender ? (
                <>
                  <div className="mb-4 text-muted-foreground text-sm">
                    Your village is defending this shrine. You can join as a defender
                    when attackers start a team battle.
                  </div>
                  {lobby}
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
          topRightContent={userWars.length === 0 ? <WarFieldActions /> : undefined}
        >
          <div className="divide-y">
            {competingWars.map((war) => (
              <WarCard
                key={war.id}
                war={war}
                sideVillageId={getWarSide(war, userData.villageId, userData.userId)}
                sector={userData.sector}
                isProtected={isProtected}
                hasActiveExclusiveRaid={!!activeExclusiveRaid}
              />
            ))}
          </div>
        </ContentBox>
      )}

      <RamenShop subtitle={SHRINE_RAMEN_SUBTITLE} />
    </div>
  );
}

/** Who holds the sector, and whether its shrine can be attacked. */
const SectorClaimDescription = ({
  ownerVillage,
  userIsOwner,
  isProtected,
}: {
  ownerVillage: string | undefined;
  userIsOwner: boolean;
  isProtected: boolean;
}) => {
  if (!ownerVillage) {
    return (
      <p>
        This sector is unclaimed.{" "}
        {!isProtected &&
          "The leader of your village or faction can attack the shrine to try and defeat it and claim the sector."}
      </p>
    );
  }
  if (userIsOwner) {
    return (
      <p>
        This sector is owned by your village. You can defend it when other villages
        attack.
      </p>
    );
  }
  return (
    <p>
      This sector is claimed by <strong>{ownerVillage}</strong>.{" "}
      {isProtected
        ? "However, because it is a protected sector, it cannot be attacked."
        : "The leader of your village or faction can attack the shrine to try and defeat it and claim the sector."}
    </p>
  );
};

// Component to render a single war; without onAttack it offers no attack or defence
const WarCard = ({
  war,
  sideVillageId,
  sector,
  onAttack,
  isAttacking = false,
  isProtected = false,
  hasActiveExclusiveRaid = false,
}: {
  war: War & {
    attackerVillage: { name: string; villageGraphic: string; sector?: number };
    defenderVillage: { name: string; villageGraphic: string; sector?: number };
    warAllies: Array<{ villageId: string; supportVillageId: string }>;
  };
  sideVillageId: string | null;
  sector: number;
  onAttack?: () => void;
  isAttacking?: boolean;
  isProtected?: boolean;
  hasActiveExclusiveRaid?: boolean;
}) => {
  const isUserAttacker = sideVillageId === war.attackerVillageId;
  const isUserDefender = sideVillageId === war.defenderVillageId;
  const isVillageWar = VILLAGE_WAR_TYPES.includes(war.type);
  const hideAttackButton = !onAttack;

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
  const shrineAction = getVillageWarShrineAction(war, sideVillageId, sector);
  const isDefendAction = shrineAction === "defend";

  // For Village Wars: users can attack/defend based on location and shrine state
  const canAttackVillageWar =
    shrineAction === "attack" &&
    targetShrineHp > 0 &&
    !hideAttackButton &&
    !isProtected;

  const canDefendVillageWar =
    isVillageWar && !hideAttackButton && !isProtected && isDefendAction;

  // For Sector Wars: only attackers can attack
  const canAttackSectorWar =
    !isVillageWar &&
    isUserAttacker &&
    war.defenderShrineHp > 0 &&
    !hideAttackButton &&
    !isProtected;

  const canAttack = canAttackVillageWar || canAttackSectorWar;
  const canDefend = canDefendVillageWar;

  // For SECTOR_WAR, shrine is "captured" when HP reaches 0 (no status tracking)
  // For VILLAGE_WAR/WAR_RAID, shrine is captured when status is "CAPTURED"
  const isShrineDefeated = isVillageWar
    ? targetShrineStatus === "CAPTURED"
    : targetShrineHp <= 0;

  // Get shrine status display
  const getShrineStatusBadge = (hp: number, maxHp: number, defeated: boolean) => {
    if (defeated) return { text: "Captured", className: "bg-red-500/20 text-red-500" };
    if (hp < maxHp * 0.25)
      return { text: "Damaged", className: "bg-yellow-500/20 text-yellow-500" };
    return { text: "Active", className: "bg-green-500/20 text-green-500" };
  };

  const statusBadge = getShrineStatusBadge(
    targetShrineHp,
    targetShrineMaxHp,
    isShrineDefeated,
  );

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
          <div className="mb-2 font-bold text-sm">Attacker</div>
          <Image
            src={war.attackerVillage.villageGraphic}
            alt={war.attackerVillage.name}
            width={100}
            height={100}
          />
          <p className="mt-2 font-medium text-sm">{war.attackerVillage.name}</p>
        </div>

        {/* Shrine */}
        <div className="flex flex-col items-center">
          <Image
            src={WAR_SHRINE_IMAGE}
            alt="War Shrine"
            width={200}
            height={200}
            className={`${isShrineDefeated ? "opacity-50 grayscale" : ""}`}
          />
          <div className="w-full max-w-md space-y-4">
            <div>
              <p className="font-medium text-sm">
                Shrine - Sector {displaySector}
                <span
                  className={`ml-2 rounded px-2 py-0.5 text-xs ${statusBadge.className}`}
                >
                  {statusBadge.text}
                </span>
              </p>
              <p className="text-muted-foreground text-sm">
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
                key={`${targetShrineHp}-${isShrineDefeated}`}
                title="HP"
                tooltip="Shrine Health"
                color={isShrineDefeated ? "bg-red-500" : "bg-green-500"}
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
          <div className="mb-2 font-bold text-sm">Defender</div>
          <Image
            src={war.defenderVillage.villageGraphic}
            alt={war.defenderVillage.name}
            width={100}
            height={100}
          />
          <p className="mt-2 font-medium text-sm">
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
              className="w-full text-2xl italic"
              onClick={onAttack}
            >
              {canDefend ? (
                <>
                  <Shield className="mr-4 h-10 w-10" />
                  Defend shrine
                </>
              ) : (
                <>
                  <Swords className="mr-4 h-10 w-10" />
                  Attack shrine
                </>
              )}
            </Button>
          ) : (
            <div className="min-h-64">
              <div className="absolute top-0 right-0 bottom-0 left-0 z-20 m-auto flex flex-col justify-center bg-black opacity-95">
                <div className="m-auto text-white">
                  <p className="text-5xl">
                    {canDefend ? "Defending" : "Attacking"} the Shrine
                  </p>
                  <Loader />
                </div>
              </div>
            </div>
          ))}
        {isShrineDefeated && (
          <div className="mt-4 space-y-4 text-center">
            <h3 className="font-bold text-2xl">Shrine Captured!</h3>
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
                    Defend this shrine to recover HP. Once the shrine HP rises above
                    25%, your war health will heal.
                  </p>
                ) : (
                  <p>The shrine has been captured in this war.</p>
                )
              ) : isUserDefender ? (
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
            ) : hasActiveExclusiveRaid ? (
              <>
                <p className="mb-4">
                  The shrine has been defeated! But before you can claim this sector,
                  you must defeat the raid boss. Join forces with your village to take
                  down the boss!
                </p>
                <RaidBrowser
                  title="Defeat the Raid Boss!"
                  subtitle="Complete to claim sector"
                  initialBreak={false}
                  sectorFilter={sector}
                />
              </>
            ) : (
              <>
                <p>
                  The shrine has been defeated. Quickly return to your village&apos;s
                  Town Hall to finalize the war and claim the sector!
                </p>
                <Button asChild>
                  <Link href="/travel">Travel to Village</Link>
                </Button>
              </>
            )}
          </div>
        )}
        {(canAttack || canDefend) && (
          <div className="mt-4 space-y-4 text-muted-foreground">
            {canDefend
              ? "Defend your shrine by winning battles against the AI defenders. Victories will restore shrine HP."
              : "Attack the enemy shrine by engaging its AI defenders. Victories will reduce shrine HP."}
          </div>
        )}
      </div>
    </div>
  );
};
