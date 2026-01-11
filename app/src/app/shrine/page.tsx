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
import { WAR_SHRINE_IMAGE, VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
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

  // Loaders
  if (!userData) return <Loader explanation="Loading userdata" />;
  if (!sectorData) return <Loader explanation="Loading sector data" />;
  if (!userData.villageId) return <Loader explanation="No village found" />;

  // Query for user's queued shrine battle (to check if they're queued for this sector)
  const { data: userQueuedBattle } = api.shrine.getUserQueuedShrineBattle.useQuery(
    undefined,
    { enabled: userData.status === "QUEUED" },
  );

  // Check if there's an active war in this sector
  // Filter to only show wars for the current sector
  const activeWars = sectorData.warData?.filter(
    (war) => war.sector === userData.sector,
  );

  // Determine if this sector is owned by another village (for MPVP attacks)
  const sectorOwnerVillageId = sectorData.sectorData?.villageId ?? null;
  const canShowMpvpOption =
    sectorOwnerVillageId && sectorOwnerVillageId !== userData.villageId;

  // Check if user is queued FOR THIS SECTOR - only then show the lobby
  const isUserQueuedForThisSector =
    userData.status === "QUEUED" && userQueuedBattle?.sector === userData.sector;

  if (!activeWars || activeWars.length === 0) {
    return (
      <>
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
                {canShowMpvpOption ? (
                  <div className="mb-4 text-sm text-muted-foreground">
                    Form a team to attack this shrine together! Up to 3 attackers can
                    join the assault, and defenders from the owning village can queue to
                    defend.
                  </div>
                ) : isUserQueuedForThisSector ? (
                  <div className="mb-4 text-sm text-muted-foreground">
                    You are queued for a shrine battle. You can view your queue status or
                    leave the queue below.
                  </div>
                ) : null}
                <ShrineBattleLobby
                  sectorNumber={userData.sector}
                  userId={userData.userId}
                  userVillageId={userData.villageId}
                  defenderVillageId={sectorOwnerVillageId}
                />
              </TabsContent>
              <TabsContent value="info" className="mt-4">
                <div className="flex flex-col items-center">
                  {sectorData.sectorData ? (
                    sectorOwnerVillageId === userData.villageId ? (
                      <p>
                        This sector is owned by your village. You can defend it when other
                        villages attack.
                      </p>
                    ) : (
                      <p>
                        This sector is claimed by{" "}
                        <strong>{sectorData.sectorData?.village.name}</strong>. The
                        leader of your village or faction can attack the shrine to try
                        and defeat it and claim the sector.
                      </p>
                    )
                  ) : (
                    <p>
                      This sector is unclaimed. The leader of your village or faction can
                      attack the shrine to try and defeat it and claim the sector.
                    </p>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          ) : (
            <div className="flex flex-col items-center">
              {sectorData.sectorData ? (
                <p>
                  {" "}
                  This sector is claimed by{" "}
                  <strong>{sectorData.sectorData.village.name}</strong>. The leader of
                  your village or faction can attack the shrine to try and defeat it and
                  claim the sector.
                </p>
              ) : (
                <p>
                  This sector is unclaimed. The leader of your village or faction can
                  attack the shrine to try and defeat it and claim the sector.
                </p>
              )}
            </div>
          )}
        </ContentBox>
        <RamenShop initialBreak />
      </>
    );
  }

  // Split wars into user's wars and competing wars
  const userWars = activeWars.filter(
    (war) =>
      war.attackerVillageId === userData.villageId ||
      war.defenderVillageId === userData.villageId,
  );
  const competingWars = activeWars.filter(
    (war) =>
      war.attackerVillageId !== userData.villageId &&
      war.defenderVillageId !== userData.villageId,
  );

  // Check if user is an attacker in any of their wars (for Team Battle tab)
  const userIsAttacker = userWars.some(
    (war) => war.attackerVillageId === userData.villageId,
  );
  const userIsDefender = userWars.some(
    (war) => war.defenderVillageId === userData.villageId,
  );

  return (
    <div className="space-y-8">
      {userWars.length > 0 && (
        <>
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
                <div className="divide-y">
                  {userWars.map((war) => (
                    <WarCard
                      key={war.id}
                      war={war}
                      villageId={userData.villageId!}
                      sector={userData.sector}
                      onAttack={() => attack({ sector: userData.sector })}
                      isAttacking={isAttacking}
                    />
                  ))}
                </div>
              </TabsContent>
              <TabsContent value="team">
                {/* Issue 1: Show WarCard in Team Battle tab to display war state */}
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
                      />
                    ))}
                  </div>
                )}
                {userIsAttacker ? (
                  <>
                    <div className="mb-4 text-sm text-muted-foreground">
                      Form a team to attack this shrine together! Up to 3 attackers can
                      join the assault, and defenders from the owning village can queue
                      to defend.
                    </div>
                    <ShrineBattleLobby
                      sectorNumber={userData.sector}
                      userId={userData.userId}
                      userVillageId={userData.villageId}
                      defenderVillageId={sectorOwnerVillageId}
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
          <RamenShop />
        </>
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
              />
            ))}
          </div>
        </ContentBox>
      )}
    </div>
  );
}

// Component to render a single war
const WarCard = ({
  war,
  villageId,
  onAttack,
  isAttacking,
  hideAttackButton = false,
}: {
  war: War & {
    attackerVillage: { name: string; villageGraphic: string };
    defenderVillage: { name: string; villageGraphic: string };
  };
  villageId: string;
  sector: number;
  onAttack: () => void;
  isAttacking: boolean;
  hideAttackButton?: boolean;
}) => {
  const isAttacker = war.attackerVillageId === villageId;
  // Only attackers can attack the shrine - defenders shouldn't attack their own shrine
  const canAttack = isAttacker && war.shrineHp > 0 && !hideAttackButton;

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
            className={`${war.shrineHp <= 0 ? "opacity-50 grayscale" : ""}`}
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
            className={`${war.shrineHp <= 0 ? "opacity-50 grayscale" : ""}`}
          />
          <div className="w-full max-w-md space-y-4">
            <div>
              <p className="text-sm font-medium">Shrine - Sector {war.sector}</p>
              <p className="text-sm text-muted-foreground">
                {war.attackerVillageId === villageId
                  ? "Your village is attacking"
                  : war.defenderVillageId === villageId
                    ? "Your village is defending"
                    : "Competing war"}
              </p>
              {war.shrineHp > 0 && (
                <StatusBar
                  key={war.shrineHp}
                  title="HP"
                  tooltip="Shrine Health"
                  color="bg-red-500"
                  showText={true}
                  status="AWAKE"
                  current={war.shrineHp > 0 ? war.shrineHp : 0}
                  total={war.shrineMaxHp}
                />
              )}
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
            className={`${war.shrineHp <= 0 ? "opacity-50 grayscale" : ""}`}
          />
          <p className="mt-2 text-sm font-medium">
            {war.defenderVillageId === VILLAGE_SYNDICATE_ID
              ? "Neutral Territory"
              : war.defenderVillage.name}
          </p>
        </div>
      </div>

      <div className="relative w-full">
        {canAttack &&
          (!isAttacking ? (
            <Button
              size="xl"
              decoration="gold"
              animation="pulse"
              className="italic text-2xl w-full"
              onClick={onAttack}
            >
              <Swords className="h-10 w-10 mr-4" />
              Attack shrine
            </Button>
          ) : (
            <div className="min-h-64">
              <div className="absolute bottom-0 left-0 right-0 top-0 z-20 m-auto flex flex-col justify-center bg-black opacity-95">
                <div className="m-auto text-white">
                  <p className="text-5xl">Attacking the Shrine</p>
                  <Loader />
                </div>
              </div>
            </div>
          ))}
        {war.shrineHp <= 0 && (
          <div className="text-center space-y-4 mt-4">
            <h3 className="text-2xl font-bold">Shrine Defeated!</h3>
            <p>
              The shrine has been defeated. Quickly return to your village&apos;s Town
              Hall to finalize the war and claim the sector!
            </p>
            <Link href="/travel">
              <Button>Travel to Village</Button>
            </Link>
          </div>
        )}
        {canAttack && (
          <div className="space-y-4 mt-4 text-muted-foreground">
            In order to attack the shrine, you can either attack it directly, or kill
            villages of the defending village.
          </div>
        )}
      </div>
    </div>
  );
};
