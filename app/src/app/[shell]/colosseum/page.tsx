"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type BattleType, BattleTypeLabels, BattleTypes } from "@/drizzle/constants";
import AvatarImage from "@/layout/Avatar";
import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import type { ArrayElement } from "@/utils/typeutils";

export default function ColosseumPage() {
  const router = useRouter();
  const [selectedType, setSelectedType] = useState<BattleType>("RANKED_PVP");
  const { data: battles, isLoading } = api.combat.listOngoingBattles.useQuery(
    { battleType: selectedType },
    { refetchInterval: 5000, refetchIntervalInBackground: false },
  );

  const tableData =
    battles?.map((battle) => {
      const users = battle.users;
      return {
        id: battle.id,
        battleType: BattleTypeLabels[battle.battleType],
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
      defaultBackHref="/village"
      subtitle="Live Spectate Ongoing Battles"
      padding={false}
      topRightContent={
        <Select
          value={selectedType}
          onValueChange={(v) => setSelectedType(v as BattleType)}
        >
          <SelectTrigger className="w-40">
            <SelectValue>{BattleTypeLabels[selectedType]}</SelectValue>
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
                "OVERWORLD",
              ].includes(type),
            ).map((type, i) => (
              <SelectItem key={`${type}-${i}`} value={type}>
                {BattleTypeLabels[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      <div>
        <div className="m-4 rounded-lg border p-4">
          <Link className="font-bold text-orange-500 underline" href="/tournaments">
            Wake Island Tournaments
          </Link>
          <p className="text-sm">
            Register, view brackets and accept your tournament matches.
          </p>
        </div>
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
                onClick: (row) => router.push(`/battlelog/${row.id}`),
              },
            ]}
          />
        )}
      </div>
    </ContentBox>
  );
}
