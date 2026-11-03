import dynamic from "next/dynamic";
import type React from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import Loader from "@/layout/Loader";
import { getUnique } from "@/utils/grouping";

/**
 * cytoscape is over a megabyte of source for a graph that only appears once someone asks
 * for it, so the boundary sits here rather than at the page: this wrapper's whole job is to
 * feed GraphUsersGeneric, and every consumer gets the deferral.
 */
const GraphUsersGeneric = dynamic(() => import("@/layout/GraphUsersGeneric"), {
  ssr: false,
  loading: () => <Loader explanation="Loading graph" />,
});

const GraphBlackmarketLedger: React.FC = () => {
  // Queries
  const { data, isPending, isFetching, refetch } =
    api.blackmarket.getGraph.useQuery(undefined);

  if (!data) {
    if (isPending) return <Loader explanation="Loading black market ledger" />;
    return (
      <div role="alert" className="space-y-2 py-2">
        <p>Could not load the black market ledger graph.</p>
        <Button type="button" onClick={() => void refetch()} disabled={isFetching}>
          Try again
        </Button>
      </div>
    );
  }
  if (data.length === 0) return <p role="status">No black market trades to display.</p>;

  // Wrangling a bit
  const users =
    data
      .filter((x) => x.receiverId)
      .flatMap((x) => [
        { id: x.senderId, label: x.senderUsername, img: x.senderAvatar },
        { id: x.receiverId, label: x.receiverUsername, img: x.receiverAvatar },
      ])
      .filter((x) => x) || [];
  const nodes = getUnique(users, "id");
  const edges = data.flatMap((x) => [
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
  ]);

  return <GraphUsersGeneric nodes={nodes} edges={edges} hideDefault />;
};

export default GraphBlackmarketLedger;
