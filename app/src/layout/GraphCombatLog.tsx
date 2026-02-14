import type React from "react";
import { api } from "@/app/_trpc/client";
import GraphUsersGeneric from "@/layout/GraphUsersGeneric";
import Loader from "@/layout/Loader";
import { getUnique } from "@/utils/grouping";

interface GraphCombatLogProps {
  userId: string;
}
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
