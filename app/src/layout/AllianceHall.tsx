"use client";

import { DoorOpen, Handshake, LandPlot, Swords } from "lucide-react";
import type React from "react";
import { useState } from "react";
import type { RouterOutputs } from "@/app/_trpc/client";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WAR_FUNDS_COST } from "@/drizzle/constants";
import type { Village, VillageAlliance } from "@/drizzle/schema";
import AvatarImage from "@/layout/Avatar";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import UserRequestSystem from "@/layout/UserRequestSystem";
import { showMutationToast } from "@/libs/toast";
import { isFactionVillage } from "@/libs/war";
import type { UserWithRelations } from "@/routers/profile";
import { calculateEnemyConsequences, findRelationship } from "@/utils/alliance";
import { capitalizeFirstLetter } from "@/utils/string";
import type { BaseServerResponse } from "@/validators/base";

/**
 * Alliance Overview Component
 */
export const AllianceHall: React.FC<{
  user: NonNullable<UserWithRelations>;
  navTabs: React.ReactNode;
}> = ({ user, navTabs }) => {
  // Queries
  const { data, isPending } = api.village.getAlliances.useQuery(undefined, {
    staleTime: 10000,
  });

  // tRPC utility
  const utils = api.useUtils();
  /** Report an alliance change and refresh the relations it affects. */
  const onAllianceChange = async (data: BaseServerResponse) => {
    showMutationToast(data);
    if (data.success) await utils.village.getAlliances.invalidate();
  };

  // Mutations
  const { mutate: accept, isPending: isAccepting } =
    api.village.acceptRequest.useMutation({ onSuccess: onAllianceChange });

  const { mutate: reject, isPending: isRejecting } =
    api.village.rejectRequest.useMutation({ onSuccess: onAllianceChange });

  const { mutate: cancel, isPending: isCancelling } =
    api.village.cancelRequest.useMutation({ onSuccess: onAllianceChange });

  if (isPending || !data) return <Loader explanation="Loading alliances" />;

  // All villages and factions with alliance system enabled
  const allVillages = data.villages.filter((v) => v.allianceSystem);
  const relationships = data.relationships;
  const requests = data.requests;

  return (
    <>
      <ContentBox
        id="tutorial-townhall-alliance"
        title={user.isOutlaw ? "Rumours" : "Town Hall"}
        subtitle="Alliances & Relations"
        defaultBackHref="/village"
        topRightContent={navTabs}
      >
        <AllianceList
          user={user}
          villages={allVillages}
          relationships={relationships}
        />
      </ContentBox>
      {requests && requests.length > 0 && (
        <ContentBox
          title="Current Requests"
          subtitle="Sent to or from you"
          initialBreak={true}
          padding={false}
        >
          <UserRequestSystem
            isLoading={isAccepting || isRejecting || isCancelling}
            requests={requests}
            userId={user.userId}
            onAccept={accept}
            onReject={reject}
            onCancel={cancel}
          />
        </ContentBox>
      )}
    </>
  );
};

/**
 * Alliance List Component
 * Displays a searchable/filterable list of all villages and factions with alliance actions
 */
const AllianceList: React.FC<{
  user: NonNullable<UserWithRelations>;
  villages: VillageWithKage[];
  relationships: VillageAlliance[];
}> = ({ user, villages, relationships }) => {
  const utils = api.useUtils();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "ALL" | "ALLY" | "ENEMY" | "NEUTRAL"
  >("ALL");
  const [typeFilter, setTypeFilter] = useState<"ALL" | "VILLAGE" | "FACTION">("ALL");

  // Filter all villages/factions (exclude user's own)
  const allEntities = villages.filter((v) => v.id !== user.villageId);

  // Apply search, status, and type filters
  const filteredEntities = allEntities
    .filter((entity) => {
      // Search filter
      const matchesSearch = entity.name.toLowerCase().includes(search.toLowerCase());
      if (!matchesSearch) return false;

      // Type filter
      if (typeFilter === "VILLAGE" && !isPlayerVillageType(entity)) return false;
      if (typeFilter === "FACTION" && !isFactionVillage(entity)) return false;

      // Status filter
      if (statusFilter === "ALL") return true;
      const relationship = findRelationship(relationships, user.villageId, entity.id);
      const status = relationship?.status || "NEUTRAL";
      return status === statusFilter;
    })
    // Sort: villages first, then factions, alphabetically within each group
    .sort((a, b) => {
      const aIsVillage = isPlayerVillageType(a);
      const bIsVillage = isPlayerVillageType(b);
      if (aIsVillage && !bIsVillage) return -1;
      if (!aIsVillage && bIsVillage) return 1;
      return a.name.localeCompare(b.name);
    });

  /** Report an alliance change and refresh the relations it affects. */
  const onAllianceChange = async (data: BaseServerResponse) => {
    showMutationToast(data);
    if (data.success) await utils.village.getAlliances.invalidate();
  };

  // Mutations
  const { mutate: create, isPending: isCreating } =
    api.village.createRequest.useMutation({ onSuccess: onAllianceChange });

  const { mutate: leave, isPending: isLeaving } = api.village.leaveAlliance.useMutation(
    { onSuccess: onAllianceChange },
  );

  const { mutate: attack, isPending: isAttacking } =
    api.village.declareEnemy.useMutation({ onSuccess: onAllianceChange });

  const isKage = user.userId === user.village?.kageId;
  const isLoading = isCreating || isLeaving || isAttacking;

  return (
    <div className="space-y-4">
      {/* Search and Filters */}
      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Search villages & factions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-[150px] flex-1"
        />
        <Select
          value={typeFilter}
          onValueChange={(v) => setTypeFilter(v as "ALL" | "VILLAGE" | "FACTION")}
        >
          <SelectTrigger className="w-[110px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Types</SelectItem>
            <SelectItem value="VILLAGE">Villages</SelectItem>
            <SelectItem value="FACTION">Factions</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(v) =>
            setStatusFilter(v as "ALL" | "ALLY" | "ENEMY" | "NEUTRAL")
          }
        >
          <SelectTrigger className="w-[110px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Status</SelectItem>
            <SelectItem value="ALLY">Allies</SelectItem>
            <SelectItem value="ENEMY">Enemies</SelectItem>
            <SelectItem value="NEUTRAL">Neutral</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Entity Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {filteredEntities.map((entity) => (
          <AllianceCard
            key={entity.id}
            entity={entity}
            user={user}
            relationships={relationships}
            villages={villages}
            isKage={isKage}
            onCreate={create}
            onLeave={leave}
            onAttack={attack}
            isLoading={isLoading}
          />
        ))}
        {filteredEntities.length === 0 && (
          <p className="col-span-full py-4 text-center text-muted-foreground">
            No villages or factions found
          </p>
        )}
      </div>
    </div>
  );
};

/**
 * Alliance Card Component
 * Displays a single village or faction with its alliance status and actions
 */
const AllianceCard: React.FC<{
  entity: VillageWithKage;
  user: NonNullable<UserWithRelations>;
  relationships: VillageAlliance[];
  villages: VillageWithKage[];
  isKage: boolean;
  onCreate: (params: { targetId: string; type: "ALLIANCE" | "SURRENDER" }) => void;
  onLeave: (params: { allianceId: string }) => void;
  onAttack: (params: { villageId: string }) => void;
  isLoading: boolean;
}> = ({
  entity,
  user,
  relationships,
  villages,
  isKage,
  onCreate,
  onLeave,
  onAttack,
  isLoading,
}) => {
  const relationship = findRelationship(relationships, user.villageId, entity.id);
  const status = relationship?.status || "NEUTRAL";
  const { ally, enemy, newEnemies, newNeutrals } = calculateEnemyConsequences(
    relationships,
    villages,
    user.villageId ?? "",
    entity.id,
  );

  // Determine entity type display
  const isVillage = isPlayerVillageType(entity);
  const typeLabel = isVillage ? "Village" : "Faction";
  const typeColors = isVillage
    ? "text-blue-600 bg-blue-100"
    : "text-purple-600 bg-purple-100";

  const statusColors: Record<string, string> = {
    ALLY: "text-green-600 bg-green-100",
    ENEMY: "text-red-600 bg-red-100",
    NEUTRAL: "text-slate-600 bg-slate-100",
  };

  return (
    <div className="flex flex-col rounded-lg border p-3">
      <div className="grid grid-cols-[2fr_3fr_3fr] items-center gap-2">
        <Image
          src={entity.villageGraphic}
          alt={entity.name}
          width={80}
          height={80}
          className="aspect-square w-full rounded object-cover"
        />
        <div className="min-w-0">
          <p className="truncate font-bold text-sm">{entity.name}</p>
          <div className="flex flex-wrap gap-1">
            <span className={`rounded px-1.5 py-0.5 text-xs ${typeColors}`}>
              {typeLabel}
            </span>
            <span className={`rounded px-1.5 py-0.5 text-xs ${statusColors[status]}`}>
              {capitalizeFirstLetter(status)}
            </span>
          </div>
          {entity.kage && (
            <p className="mt-1 truncate text-muted-foreground text-xs">
              {isVillage ? "Kage" : "Leader"}: {entity.kage.username}
            </p>
          )}
        </div>
        {entity.kage ? (
          <Link href={`/userid/${entity.kage.userId}`}>
            <AvatarImage
              href={entity.kage.avatar}
              alt={entity.kage.username}
              size={120}
              hover_effect={true}
              priority={false}
              className="!m-0 !w-full !max-w-full !rounded-md"
            />
          </Link>
        ) : (
          <div />
        )}
      </div>

      {isKage && !isLoading && (
        <div className="mt-2 flex gap-2 border-t pt-2">
          {ally.success && status === "NEUTRAL" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onCreate({ targetId: entity.id, type: "ALLIANCE" })}
              title="Request Alliance"
            >
              <Handshake className="h-4 w-4" />
            </Button>
          )}
          {status === "ALLY" && relationship && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onLeave({ allianceId: relationship.id })}
              title="Leave Alliance"
            >
              <DoorOpen className="h-4 w-4" />
            </Button>
          )}
          {enemy.success && status !== "ENEMY" && (
            <Confirm
              title="Declare Enemy"
              onAccept={(e) => {
                e.preventDefault();
                onAttack({ villageId: entity.id });
              }}
              button={
                <Button size="sm" variant="outline" title="Declare Enemy">
                  <Swords className="h-4 w-4" />
                </Button>
              }
            >
              <p>
                Declare {entity.name} as enemy? Cost: {WAR_FUNDS_COST.toLocaleString()}{" "}
                tokens.
              </p>
              {newEnemies.length > 0 && (
                <p className="text-red-500">
                  Additional enemies: {newEnemies.map((v) => v.name).join(", ")}
                </p>
              )}
              {newNeutrals.length > 0 && (
                <p className="text-yellow-500">
                  Broken alliances: {newNeutrals.map((v) => v.name).join(", ")}
                </p>
              )}
            </Confirm>
          )}
          {status === "ENEMY" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onCreate({ targetId: entity.id, type: "SURRENDER" })}
              title="Request Surrender"
            >
              <LandPlot className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
      {isLoading && <Loader explanation="" />}
    </div>
  );
};

/** Alliance entities listed as villages; a safezone is neither this nor a faction. */
const isPlayerVillageType = (entity: Pick<Village, "type">) =>
  entity.type === "VILLAGE" || entity.type === "OUTLAW";

type VillageWithKage = RouterOutputs["village"]["getAlliances"]["villages"][number];
