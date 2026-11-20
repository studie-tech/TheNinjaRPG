"use client";

import { api } from "@/app/_trpc/client";
import { summarizePlayerTurnOrder } from "@/libs/statistics";

/** Staff-only: how often a player starts head-to-head PvP first or second, and wins. */
export const PlayerTurnOrder = ({ userId }: { userId: string }) => {
  const { data, isPending, isError } = api.data.getPlayerTurnOrder.useQuery(
    { userId },
    { staleTime: 60_000 },
  );
  if (isPending)
    return <p className="text-muted-foreground">Starting turns: loading…</p>;
  if (isError)
    return <p className="text-muted-foreground">Starting turns: unavailable</p>;
  const [first, second] = summarizePlayerTurnOrder(data);
  const battles = (first?.battles ?? 0) + (second?.battles ?? 0);
  return (
    <>
      <p>Counted 1v1 PvP battles: {battles.toLocaleString()}</p>
      {battles > 0 &&
        [first, second].map(
          (row) =>
            row && (
              <p key={row.turnOrder}>
                Went {row.turnOrder === 1 ? "first" : "second"}: {row.share} · won{" "}
                {row.winRate}
              </p>
            ),
        )}
    </>
  );
};
