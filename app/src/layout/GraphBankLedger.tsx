import dynamic from "next/dynamic";
import type React from "react";
import { api } from "@/app/_trpc/client";
import Loader from "@/layout/Loader";
import { getUnique } from "@/utils/grouping";

/**
 * cytoscape and its edge-handles plugin are over a megabyte of source for a graph that only
 * appears once someone asks for it, so the boundary sits here rather than at the page: this
 * wrapper's whole job is to feed GraphUsersGeneric, and every consumer gets the deferral.
 */
const GraphUsersGeneric = dynamic(() => import("@/layout/GraphUsersGeneric"), {
  ssr: false,
  loading: () => <Loader explanation="Loading graph" />,
});

const GraphBankLedger: React.FC = () => {
  // Queries
  const { data, isPending } = api.bank.getGraph.useQuery(undefined);

  if (!data || isPending) return <Loader explanation="Loading bank ledger graph" />;

  // Wrangling a bit
  const users =
    data
      .flatMap((x) => [
        { id: x.senderId, label: x.senderUsername, img: x.senderAvatar },
        { id: x.receiverId, label: x.receiverUsername, img: x.receiverAvatar },
      ])
      .filter((x) => x) || [];
  const nodes = getUnique(users, "id");
  const edges = data.map((x) => ({
    source: x.senderId,
    target: x.receiverId,
    label: String(x.total),
    weight: x.total > 1 ? Math.log(x.total) : 1,
  }));

  return <GraphUsersGeneric nodes={nodes} edges={edges} hideDefault />;
};

export default GraphBankLedger;
