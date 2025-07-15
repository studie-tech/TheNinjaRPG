"use client";

import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { BattleTypes, type BattleType } from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import AvatarImage from "@/layout/Avatar";
import type { ArrayElement } from "@/utils/typeutils";

const battleTypeLabels: Record<BattleType, string> = {
  ARENA: "Arena",
  COMBAT: "Open World PvP",
  SPARRING: "Sparring",
  KAGE_AI: "Kage AI",
  KAGE_PVP: "Kage PvP",
  CLAN_CHALLENGE: "Clan Challenge",
  CLAN_BATTLE: "Clan Battle",
  SHRINE_WAR: "Shrine War",
  TOURNAMENT: "Tournament",
  QUEST: "Quest",
  VILLAGE_PROTECTOR: "Village Protector",
  TRAINING: "Training",
  RANKED_PVP: "Ranked PvP",
  RANKED_SPARRING: "Ranked Sparring",
  RANDOM_ENCOUNTER: "Random Encounter",
};

export default function ColosseumPage() {
  const [selectedType, setSelectedType] = useState<BattleType>("RANKED_PVP");
  const { data: battles, isLoading } = api.combat.listOngoingBattles.useQuery(
    { battleType: selectedType },
    { refetchInterval: 5000 },
  );

  const tableData =
    battles?.map((battle) => {
      const users = battle?.users.map((u) => ({
        userId: u.userId,
        username: u.username,
        avatar: u.avatar,
      }));
      return {
        id: battle.id,
        battleType: battleTypeLabels[battle.battleType],
        createdAt: battle.createdAt,
        players: (
          <div className="flex flex-row gap-2 items-center">
            {users.length > 0 ? (
              users.map((u) => (
                <div key={u.userId} className="flex flex-col items-center gap-1 w-20">
                  <AvatarImage
                    href={u.avatar}
                    alt={u.username || u.userId}
                    size={28}
                    className="border border-gray-400"
                  />
                  <span className="truncate max-w-[80px] text-xs">
                    {u.username || u.userId}
                  </span>
                </div>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">No players</span>
            )}
          </div>
        ),
      };
    }) ?? [];

  type BattleRow = ArrayElement<typeof tableData>;
  const columns: ColumnDefinitionType<BattleRow, keyof BattleRow>[] = [
    {
      key: "battleType",
      header: "Type",
      type: "string",
    },
    {
      key: "createdAt",
      header: "Started",
      type: "date",
    },
    {
      key: "players",
      header: "Players",
      type: "jsx",
    },
  ];

  return (
    <ContentBox
      title="Colosseum"
      subtitle="Live Spectate Ongoing Battles"
      padding={false}
      topRightContent={
        <Select
          value={selectedType}
          onValueChange={(v) => setSelectedType(v as BattleType)}
        >
          <SelectTrigger className="w-40">
            <SelectValue>{battleTypeLabels[selectedType]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {BattleTypes.filter((type) =>
              ["TOURNAMENT", "CLAN_BATTLE", "COMBAT", "RANKED_PVP"].includes(type),
            ).map((type) => (
              <SelectItem key={type} value={type}>
                {battleTypeLabels[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      <div>
        {isLoading && <Loader explanation="Loading battles..." />}
        {!isLoading && (!battles || battles.length === 0) && (
          <div className="text-muted-foreground text-center p-4">
            No ongoing battles found.
          </div>
        )}
        {battles && battles.length > 0 && (
          <Table
            data={tableData}
            columns={columns}
            buttons={[
              {
                label: "Spectate",
                onClick: (row) => {
                  window.location.href = `/battlelog/${row.id}`;
                },
              },
            ]}
          />
        )}
      </div>
    </ContentBox>
  );
}
