import dynamic from "next/dynamic";
import type React from "react";
import { api } from "@/app/_trpc/client";
import Loader from "@/layout/Loader";
import { getUnique } from "@/utils/grouping";

interface GraphCombatLogProps {
  userId: string;
}
/**
 * cytoscape and its edge-handles plugin are over a megabyte of source for a graph that only
 * appears once someone asks for it, so the boundary sits here rather than at the page: this
 * wrapper's whole job is to feed GraphUsersGeneric, and every consumer gets the deferral.
 */
const GraphUsersGeneric = dynamic(() => import("@/layout/GraphUsersGeneric"), {
  ssr: false,
  loading: () => <Loader explanation="Loading graph" />,
});

const GraphCombatLog: React.FC<GraphCombatLogProps> = (props) => {
  // Queries
  const { data, isPending } = api.combat.getGraph.useQuery(
    { userId: props.userId },
    {},
  );

  if (!data || isPending) return <Loader explanation="Loading Battle Data" />;

  // Wrangle data a bit
  const users =
    data
      .flatMap((x) => [
        { id: x.attackerId, label: x.attackerUsername, img: x.attackerAvatar },
        { id: x.defenderId, label: x.defenderUsername, img: x.defenderAvatar },
      ])
      .filter((x) => x) || [];
  const nodes = getUnique(users, "id");
  const edges = data.map((x) => ({
    source: x.attackerId,
    target: x.defenderId,
    label: String(x.total),
    weight: x.total > 1 ? x.total : 1,
  }));

  // Render
  return <GraphUsersGeneric nodes={nodes} edges={edges} />;
};

export default GraphCombatLog;
