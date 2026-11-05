import type React from "react";
import { api } from "@/app/_trpc/client";
import { GraphQueryState, LazyGraphUsers, toGraphNodes } from "@/layout/LazyGraphUsers";

const GraphBankLedger: React.FC = () => {
  const query = api.bank.getGraph.useQuery(undefined);

  return (
    <GraphQueryState
      query={query}
      loadingText="Loading bank ledger graph"
      errorText="Could not load the bank ledger graph."
      emptyText="No bank transfers to display."
    >
      {(rows) => (
        <LazyGraphUsers
          nodes={toGraphNodes(rows, (x) => [
            { id: x.senderId, label: x.senderUsername, img: x.senderAvatar },
            { id: x.receiverId, label: x.receiverUsername, img: x.receiverAvatar },
          ])}
          edges={rows.map((x) => ({
            source: x.senderId,
            target: x.receiverId,
            label: String(x.total),
            weight: x.total > 1 ? Math.log(x.total) : 1,
          }))}
          hideDefault
        />
      )}
    </GraphQueryState>
  );
};

export default GraphBankLedger;
