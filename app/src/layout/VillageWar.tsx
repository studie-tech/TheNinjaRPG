"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  DoorClosed,
  Handshake,
  Info,
  Loader2,
  Swords,
  Trash2,
  Trophy,
} from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { NumberInput } from "@/components/ui/number-input";
import {
  FACTION_RAID_BOOST_HOURS,
  FACTION_RAID_BOOST_PERCENT,
  FACTION_RAID_DAILY_DRAIN,
  FACTION_RAID_MAX_DAYS,
  FACTION_RAID_REWARD,
  VILLAGE_WAR_TYPES,
  WAR_ALLY_OFFER_MIN,
  WAR_RECAPTURE_THRESHOLD,
  WAR_SHRINE_CAPTURE_WARHEALTH_DMG,
  WAR_SHRINE_IMAGE,
  WAR_SHRINE_RECAPTURE_WARHEALTH_HEAL,
} from "@/drizzle/constants";
import type { Village, VillageAlliance, VillageStructure } from "@/drizzle/schema";
import { useAdminEndWar, useAllyOfferActions } from "@/hooks/useWarActions";
import Building from "@/layout/Building";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import Modal from "@/layout/Modal";
import { ObjectiveWarPanel } from "@/layout/ObjectiveWarPanel";
import StatusBar from "@/layout/StatusBar";
import type { ColumnDefinitionType } from "@/layout/Table";
import Table from "@/layout/Table";
import UserRequestSystem from "@/layout/UserRequestSystem";
import { getWarSide } from "@/libs/objectiveWar";
import { showMutationToast } from "@/libs/toast";
import { canJoinWar, isOfferForWarCard } from "@/libs/war";
import type { UserWithRelations } from "@/routers/profile";
import type { FetchActiveWarsReturnType } from "@/server/api/routers/war";
import { canAdministrateWars } from "@/utils/permissions";
import { capitalizeFirstLetter } from "@/utils/string";
import type { ArrayElement } from "@/utils/typeutils";
import {
  type AllianceOfferSchema,
  type AllianceOfferSchemaInput,
  createAllianceOfferSchema,
} from "@/validators/war";

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
}> = ({ war: initialWar, user, villages, relationships, userVillage, isKage }) => {
  // Add state for dialog
  const [showKills, setShowKills] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showShrineMechanics, setShowShrineMechanics] = useState(false);
  const [showSurrenderDialog, setShowSurrenderDialog] = useState(false);
  const [selectedStat, setSelectedStat] = useState<
    "townhallHpChange" | "shrineHpChange" | "totalKills"
  >("totalKills");

  // Add query for war kills
  const { data: objectiveInfo } = api.war.getObjectiveWarInfo.useQuery(
    { warId: initialWar.id },
    {
      enabled: !!initialWar.rules,
      refetchInterval: (query) =>
        (query.state.data?.war.status ?? initialWar.status) === "ACTIVE"
          ? 10000
          : false,
    },
  );
  const war = {
    ...initialWar,
    ...objectiveInfo?.war,
    attackerVillage: initialWar.attackerVillage,
    defenderVillage: initialWar.defenderVillage,
    warAllies: initialWar.warAllies,
  };
  const { data: warKills } = api.war.getWarKills.useQuery(
    { warId: war.id },
    { enabled: showKills && !war.rules },
  );

  // Add query for war kill stats
  const { data: warKillStats } = api.war.getWarKillStats.useQuery(
    { warId: war.id, aggregateBy: selectedStat },
    { enabled: showStats && !war.rules },
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

  const surrenderAlly = war.warAllies.find(
    (entry) => entry.villageId === user.villageId,
  );
  const surrenderRole: SurrenderParticipationRole | undefined =
    user.villageId === war.attackerVillageId
      ? "MAIN_ATTACKER"
      : user.villageId === war.defenderVillageId
        ? "MAIN_DEFENDER"
        : surrenderAlly?.supportVillageId === war.attackerVillageId
          ? "ALLY_ATTACKER"
          : surrenderAlly?.supportVillageId === war.defenderVillageId
            ? "ALLY_DEFENDER"
            : undefined;

  // Form for token offer
  const offerSchema = createAllianceOfferSchema(userVillage?.tokens ?? 0);

  const offerForm = useForm<AllianceOfferSchemaInput, unknown, AllianceOfferSchema>({
    resolver: zodResolver(offerSchema),
    defaultValues: { amount: WAR_ALLY_OFFER_MIN },
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
  const warRequests = requests?.filter((r) => isOfferForWarCard(r, war.id));

  // Mutations
  const allyOffers = useAllyOfferActions();
  const adminEnd = useAdminEndWar(war.id);

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

  const { mutate: surrender, isPending: isSurrendering } =
    api.war.surrender.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (!data.success) return;
        setShowSurrenderDialog(false);
        await Promise.all([
          utils.war.getActiveWars.invalidate(),
          utils.war.getRaidOptions.invalidate(),
          utils.war.getEndedWars.invalidate(),
          utils.war.getAllyOffers.invalidate(),
        ]);
      },
    });

  const isAdminEnding = adminEnd.isPending;
  const competingVillageWarMutation =
    allyOffers.isPending || isCreatingOffer || isAdminEnding;

  const supportedVillageName =
    surrenderAlly?.supportVillageId === war.attackerVillageId
      ? war.attackerVillage.name
      : war.defenderVillage.name;

  // Derived
  const isAttacker =
    getWarSide(war, user.villageId, user.userId) === war.attackerVillageId;
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
  const attackerSide = {
    village: war.attackerVillage,
    structure: attackerStructure,
    warHealth: war.attackerWarHealth,
    warHealthMax: war.attackerWarHealthMax,
    shrineHp: war.attackerShrineHp,
    shrineMaxHp: war.attackerShrineMaxHp,
    shrineStatus: war.attackerShrineStatus,
  };
  const defenderSide = {
    village: war.defenderVillage,
    structure: defenderStructure,
    warHealth: war.defenderWarHealth,
    warHealthMax: war.defenderWarHealthMax,
    shrineHp: war.defenderShrineHp,
    shrineMaxHp: war.defenderShrineMaxHp,
    shrineStatus: war.defenderShrineStatus,
  };
  // The viewer's own side is listed first.
  const sides = isAttacker
    ? [attackerSide, defenderSide]
    : [defenderSide, attackerSide];
  const outcome =
    war.status === "DRAW"
      ? WAR_OUTCOMES.draw
      : (war.status === "ATTACKER_VICTORY") === isAttacker
        ? WAR_OUTCOMES.victory
        : WAR_OUTCOMES.defeat;
  return (
    <div className="rounded-lg border p-4" aria-busy={isSurrendering || isAdminEnding}>
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
              <p className={`font-bold ${outcome.className}`}>
                Outcome: {outcome.label}
              </p>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            disabled={isSurrendering || isAdminEnding}
            className={war.rules ? "hidden" : undefined}
            onClick={() => setShowKills(true)}
          >
            <Swords className="h-5 w-5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            disabled={isSurrendering || isAdminEnding}
            className={war.rules ? "hidden" : undefined}
            onClick={() => setShowStats(true)}
          >
            <Trophy className="h-5 w-5" />
          </Button>
          {isKage && war.status === "ACTIVE" && surrenderRole && (
            <Button
              variant="destructive"
              size="icon"
              aria-label={isSurrendering ? "Surrendering" : `Surrender war ${war.id}`}
              disabled={isSurrendering || competingVillageWarMutation}
              onClick={() => setShowSurrenderDialog(true)}
            >
              {isSurrendering ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <DoorClosed className="h-5 w-5" />
              )}
            </Button>
          )}
          {canAdministrateWars(user.role) && war.status === "ACTIVE" && (
            <Button
              variant="destructive"
              size="icon"
              className="bg-amber-700 hover:bg-amber-800"
              aria-label={`Administratively end ${war.type === "WAR_RAID" ? "war raid" : "village war"} ${war.id}`}
              disabled={isSurrendering || competingVillageWarMutation}
              onClick={() => adminEnd.setShowDialog(true)}
            >
              {isAdminEnding ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Trash2 className="h-5 w-5" />
              )}
            </Button>
          )}
        </div>
      </div>

      <Modal
        id="village-war-surrender"
        title="Confirm Village War Surrender"
        isOpen={showSurrenderDialog && war.status === "ACTIVE" && !!surrenderRole}
        setIsOpen={setShowSurrenderDialog}
        proceed_label="Surrender"
        proceed_loading_label="Surrendering"
        confirmClassName="bg-red-700 text-white hover:bg-red-800 focus-visible:ring-red-500"
        isLoading={isSurrendering}
        keepOpenOnAccept={true}
        onAccept={() => surrender({ warId: war.id })}
        className="max-w-xl border-red-900/60"
      >
        {showSurrenderDialog && surrenderRole && (
          <div className="space-y-4">
            <div className="rounded-md border border-red-800/60 bg-red-950/30 p-3">
              <p className="font-semibold text-red-300">
                This action cannot be undone.
              </p>
              {surrenderRole.startsWith("MAIN_") ? (
                <p className="mt-1 text-sm">
                  {user.village?.name} is a main belligerent. Surrendering immediately
                  ends this war in defeat for your village. The opposing main village
                  receives the victory rewards, while your village receives defeat
                  exhaustion and structure penalties. Supporting forces remain part of
                  the recorded outcome.
                </p>
              ) : (
                <p className="mt-1 text-sm">
                  {user.village?.name} is supporting {supportedVillageName}.
                  Surrendering withdraws only your village; the war continues for both
                  main villages and all other allies. Your village receives defeat
                  exhaustion, and the {surrenderAlly?.tokensPaid.toLocaleString()}{" "}
                  tokens already paid are not refunded.
                </p>
              )}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">War</dt>
              <dd className="font-mono">{war.id}</dd>
              <dt className="text-muted-foreground">Conflict</dt>
              <dd>
                {war.attackerVillage.name} vs {war.defenderVillage.name}
              </dd>
              <dt className="text-muted-foreground">Your role</dt>
              <dd>{surrenderRole.replaceAll("_", " ")}</dd>
              <dt className="text-muted-foreground">Confirmed by</dt>
              <dd>{user.village?.name}&apos;s current Kage</dd>
            </dl>
          </div>
        )}
      </Modal>

      <Modal
        id="village-admin-end-war"
        title={war.type === "WAR_RAID" ? "End War Raid" : "End Village War"}
        isOpen={adminEnd.showDialog && war.status === "ACTIVE"}
        setIsOpen={adminEnd.setShowDialog}
        proceed_label={war.type === "WAR_RAID" ? "End war raid" : "End village war"}
        proceed_loading_label="Ending"
        confirmClassName="bg-amber-700 text-white hover:bg-amber-800 focus-visible:ring-amber-500"
        isLoading={isAdminEnding}
        keepOpenOnAccept={true}
        onAccept={adminEnd.endWar}
        className="max-w-xl border-amber-900/60"
      >
        <div className="space-y-4">
          <div className="rounded-md border border-amber-800/60 bg-amber-950/30 p-3">
            <p className="font-semibold text-amber-300">
              This administrative action cannot be undone.
            </p>
            <p className="mt-1 text-sm">
              The exact active war, its kill history, supporting forces, and pending
              ally offers will be removed. No winner is assigned, no victory or defeat
              rewards are granted, and no village tokens, structures, or sector
              ownership are changed.
            </p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border bg-muted/40 p-3 text-sm">
            <dt className="text-muted-foreground">War ID</dt>
            <dd className="break-all font-mono">{war.id}</dd>
            <dt className="text-muted-foreground">Type</dt>
            <dd>{war.type.replaceAll("_", " ")}</dd>
            <dt className="text-muted-foreground">Participants</dt>
            <dd>
              {war.attackerVillage.name} vs {war.defenderVillage.name}
            </dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd>{war.status}</dd>
            <dt className="text-muted-foreground">Target structure</dt>
            <dd>{war.targetStructureRoute}</dd>
            <dt className="text-muted-foreground">Attacker health</dt>
            <dd>
              {war.attackerWarHealth.toLocaleString()} /{" "}
              {war.attackerWarHealthMax.toLocaleString()}
            </dd>
            <dt className="text-muted-foreground">Defender health</dt>
            <dd>
              {war.defenderWarHealth.toLocaleString()} /{" "}
              {war.defenderWarHealthMax.toLocaleString()}
            </dd>
          </dl>
        </div>
      </Modal>

      {/* Add dialog for war kills */}
      <Modal
        title={`War Kills - ${war.attackerVillage.name} vs ${war.defenderVillage.name}`}
        isOpen={showKills && !war.rules}
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
                linkDisabled={(row) => !row.killerId}
              />
            </div>
          ) : (
            <p className="text-center text-muted-foreground">No kills recorded yet</p>
          )}
        </div>
      </Modal>

      {/* Add dialog for war kill stats */}
      <Modal
        title={`War Statistics - ${war.attackerVillage.name} vs ${war.defenderVillage.name}`}
        isOpen={showStats && !war.rules}
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
                linkDisabled={(row) => !row.killerId}
              />
            ) : (
              <p className="text-center text-muted-foreground">
                No statistics recorded yet
              </p>
            )}
          </div>
        </div>
      </Modal>

      {war.type === "WAR_RAID" && (
        <p className="mb-3 text-sm">
          Raid: {FACTION_RAID_DAILY_DRAIN} HP daily decay. Ends after{" "}
          {FACTION_RAID_MAX_DAYS} days. The winner receives a{" "}
          {FACTION_RAID_BOOST_PERCENT}% structure bonus for {FACTION_RAID_BOOST_HOURS}{" "}
          hours; an attacking victory also grants {FACTION_RAID_REWARD.toLocaleString()}{" "}
          treasury tokens.
        </p>
      )}
      {/* Structure health */}
      <div className="rounded-lg border border-border p-4">
        <div className="grid grid-cols-2 gap-4">
          {sides.map((side) => (
            <WarSideTownHall
              key={side.village.id}
              structure={side.structure}
              village={side.village}
              warStatus={war.status}
              warHealth={side.warHealth}
              warHealthMax={side.warHealthMax}
            />
          ))}
        </div>
      </div>

      {war.rules && <ObjectiveWarPanel warId={war.id} />}
      {/* Shrines Section */}
      {!war.rules &&
        VILLAGE_WAR_TYPES.includes(war.type) &&
        war.status === "ACTIVE" && (
          <div className="mt-4 rounded-lg border border-border p-4">
            <div className="grid grid-cols-2 gap-4">
              {sides.map((side) => (
                <WarSideShrine
                  key={side.village.id}
                  village={side.village}
                  shrineHp={side.shrineHp}
                  shrineMaxHp={side.shrineMaxHp}
                  shrineStatus={side.shrineStatus}
                />
              ))}
            </div>
            <div className="mt-3 flex justify-center">
              <Button
                variant="ghost"
                size="sm"
                disabled={isSurrendering || isAdminEnding}
                onClick={() => setShowShrineMechanics(true)}
              >
                <Info className="mr-1 h-4 w-4" />
                Shrine Mechanics
              </Button>
              <Modal
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
                      When you win shrine combat against an enemy at your own shrine,
                      you <span className="font-semibold text-green-500">restore</span>{" "}
                      your shrine&apos;s HP.
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
              </Modal>
            </div>
          </div>
        )}

      {/* Supporting Forces Section */}
      {war.type === "VILLAGE_WAR" && (
        <div className="mt-4 rounded-lg border border-border p-4">
          <h6 className="mb-3 text-center font-semibold text-sm">Supporting Forces</h6>
          <div className="grid grid-cols-2 gap-4">
            {sides.map((side) => (
              <WarSideSupportingForces
                key={side.village.id}
                village={side.village}
                warAllies={war.warAllies}
              />
            ))}
          </div>
        </div>
      )}

      {isKage && war.status === "ACTIVE" && war.type === "VILLAGE_WAR" && (
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
                  <Confirm
                    title={`Send Offer to ${village.name}`}
                    disabled={isSurrendering || isAdminEnding}
                    button={
                      <Button
                        size="sm"
                        className="shrink-0"
                        disabled={isSurrendering || isAdminEnding}
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
                                <NumberInput
                                  disabled={isSurrendering || isAdminEnding}
                                  placeholder={`Token offer (min ${WAR_ALLY_OFFER_MIN}, max ${userVillage?.tokens?.toLocaleString()})`}
                                  {...field}
                                  value={field.value as number}
                                  onValueChange={field.onChange}
                                />
                              </FormControl>
                              <FormMessage className="text-xs" />
                            </FormItem>
                          )}
                        />
                      </form>
                    </Form>
                    <p className="mt-4 text-muted-foreground text-sm">
                      This will send an offer to {village.name} to join your side in the
                      war against{" "}
                      {war.attackerVillageId === user.villageId
                        ? war.defenderVillage?.name
                        : war.attackerVillage?.name}
                      . They can choose to accept or reject this offer.
                    </p>
                  </Confirm>
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
              isLoading={competingVillageWarMutation || isSurrendering}
              requests={warRequests}
              userId={user.userId}
              onAccept={allyOffers.onAccept}
              onReject={allyOffers.onReject}
              onCancel={allyOffers.onCancel}
            />
          </ContentBox>
        )}
      {/* Shrine HP Status for Village Wars and Raids */}
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
            key={`hp-${warHealth}-${warHealthMax}`}
            title="HP"
            tooltip="Townhall health — affected by war victories, objectives, camps and daily decay"
            color="bg-red-500"
            showText={true}
            current={warHealth}
            total={warHealthMax}
          />
        </div>
      )}
      <div className="w-full max-w-[160px]">
        <Building structure={structure} village={village} showBar={false} />
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
          key={`shrine-${shrineHp}-${shrineMaxHp}`}
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

/** Outcome line text and colour from the viewer's side. */
const WAR_OUTCOMES = {
  draw: { label: "War ended in a Draw", className: "text-yellow-500" },
  victory: { label: "Victory", className: "text-green-500" },
  defeat: { label: "Defeat", className: "text-red-500" },
};

type SurrenderParticipationRole =
  | "MAIN_ATTACKER"
  | "MAIN_DEFENDER"
  | "ALLY_ATTACKER"
  | "ALLY_DEFENDER";
