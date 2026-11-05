import type React from "react";
import { api } from "@/app/_trpc/client";
import { GraphQueryState, LazyGraphUsers, toGraphNodes } from "@/layout/LazyGraphUsers";

const GraphBlackmarketLedger: React.FC = () => {
  const query = api.blackmarket.getGraph.useQuery(undefined);

  return (
    <GraphQueryState
      query={query}
      loadingText="Loading black market ledger"
      errorText="Could not load the black market ledger graph."
      emptyText="No black market trades to display."
    >
      {(rows) => (
        <LazyGraphUsers
          nodes={toGraphNodes(
            rows.filter((x) => x.receiverId),
            (x) => [
              { id: x.senderId, label: x.senderUsername, img: x.senderAvatar },
              { id: x.receiverId, label: x.receiverUsername, img: x.receiverAvatar },
            ],
          )}
          edges={rows.flatMap((x) => [
            {
              source: x.senderId,
              target: x.receiverId,
              label: `${x.totalReps} reps`,
              weight: x.totalReps,
            },
            {
              source: x.receiverId,
              target: x.senderId,
              label: `${x.totalRyo} ryo`,
              weight: Math.log(x.totalRyo),
            },
          ])}
          hideDefault
        />
      )}
    </GraphQueryState>
  );
};

export default GraphBlackmarketLedger;
