"use client";

import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { type BattleType, IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import Loader from "@/layout/Loader";
import Table from "@/layout/Table";

export const BattleHistoryTable = ({
  userId,
  secondsBack,
  combatTypes,
  enabled = true,
  showBattleType = false,
  emptyMessage = "No combat history found",
}: {
  userId?: string;
  secondsBack?: number;
  combatTypes?: BattleType[];
  enabled?: boolean;
  showBattleType?: boolean;
  emptyMessage?: string;
}) => {
  const {
    data: history,
    isPending,
    isFetching,
    isFetchNextPageError,
    error,
    fetchNextPage,
    hasNextPage,
    refetch,
  } = api.combat.getBattleHistory.useInfiniteQuery(
    { userId, secondsBack, combatTypes, limit: 20 },
    { enabled, getNextPageParam: (lastPage) => lastPage.nextCursor },
  );
  const rows = history?.pages
    .flatMap((page) => page.data)
    .map((entry) => ({
      id: String(entry.id),
      attackerAvatar: entry.attacker?.avatar || IMG_AVATAR_DEFAULT,
      defenderAvatar: entry.defender?.avatar || IMG_AVATAR_DEFAULT,
      battleId: entry.battleId,
      battleType: entry.battleType || "Unknown",
      createdAt: entry.createdAt,
    }));

  if (isPending) return <Loader explanation="Loading battles..." />;

  return (
    <div>
      {rows && rows.length > 0 && (
        <Table
          data={rows}
          columns={[
            { key: "attackerAvatar", header: "Attacker", type: "avatar" },
            { key: "defenderAvatar", header: "Defender", type: "avatar" },
            showBattleType
              ? { key: "battleType", header: "Type", type: "capitalized" }
              : { key: "battleId", header: "Battle ID", type: "string" },
            { key: "createdAt", header: "Date", type: "date" },
          ]}
          linkPrefix="/battlelog/"
          linkColumn="battleId"
        />
      )}
      {!error && rows?.length === 0 && <p className="p-3">{emptyMessage}</p>}
      {error && (
        <p role="alert" className="p-3">
          Could not load battles: {error.message}
        </p>
      )}
      {(hasNextPage || error) && (
        <div className="p-3 text-center">
          <Button
            disabled={isFetching}
            onClick={() =>
              error && !isFetchNextPageError ? void refetch() : void fetchNextPage()
            }
          >
            {isFetching ? "Loading battles..." : error ? "Try again" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
};
