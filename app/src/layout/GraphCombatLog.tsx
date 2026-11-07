import type React from "react";
import { api } from "@/app/_trpc/client";
import { GraphQueryState, LazyGraphUsers, toGraphNodes } from "@/layout/LazyGraphUsers";

interface GraphCombatLogProps {
  userId: string;
}

const GraphCombatLog: React.FC<GraphCombatLogProps> = (props) => {
  const query = api.combat.getGraph.useQuery({ userId: props.userId }, {});

  return (
    <GraphQueryState
      query={query}
      loadingText="Loading Battle Data"
      errorText="Could not load the battle graph."
      emptyText="No battles to display."
    >
      {(rows) => (
        <LazyGraphUsers
          nodes={toGraphNodes(rows, (x) => [
            { id: x.attackerId, label: x.attackerUsername, img: x.attackerAvatar },
            { id: x.defenderId, label: x.defenderUsername, img: x.defenderAvatar },
          ])}
          edges={rows.map((x) => ({
            source: x.attackerId,
            target: x.defenderId,
            label: String(x.total),
            weight: x.total > 1 ? x.total : 1,
          }))}
        />
      )}
    </GraphQueryState>
  );
};

export default GraphCombatLog;
