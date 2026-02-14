"use client";

import { useState } from "react";
import { api } from "@/app/_trpc/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type BattleType, BattleTypes } from "@/drizzle/constants";
import AvatarImage from "@/layout/Avatar";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
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
  RAID: "Raid",
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
          <div className="flex flex-row items-center gap-2">
            {users.length > 0 ? (
              users.map((u) => (
                <div key={u.userId} className="flex w-20 flex-col items-center gap-1">
                  <AvatarImage
                    href={u.avatar}
                    alt={u.username || u.userId}
                    size={28}
                    className="border border-gray-400"
                  />
                  <span className="max-w-[80px] truncate text-xs">
                    {u.username || u.userId}
                  </span>
                </div>
              ))
            ) : (
              <span className="text-muted-foreground text-xs">No players</span>
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
              [
                "TOURNAMENT",
                "CLAN_BATTLE",
                "COMBAT",
                "RANKED_PVP",
                "SPARRING",
                "RANKED_SPARRING",
              ].includes(type),
            ).map((type, i) => (
              <SelectItem key={`${type}-${i}`} value={type}>
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
          <div className="p-4 text-center text-muted-foreground">
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
