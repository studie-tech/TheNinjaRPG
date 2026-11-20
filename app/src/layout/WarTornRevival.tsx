"use client";

import { Button } from "@/components/ui/button";
import { RESOURCE_SILO_RESPAWN_COST } from "@/drizzle/constants";
import type { useWarTornRevival } from "@/hooks/useResourceSilos";
import { useRequiredUserData } from "@/utils/UserContext";

/** A defeated fighter can pay for immediate shrine recovery or keep their village treatment. */
export const WarTornRevival = ({
  revival,
}: {
  revival: ReturnType<typeof useWarTornRevival>;
}) => {
  const { data: user } = useRequiredUserData();
  if (!user?.warTornRespawn || user.status !== "HOSPITALIZED") return null;
  return (
    <div className="space-y-3 border-b p-3">
      <h2 className="text-lg font-bold">War-Torn Shrine Revival</h2>
      <p>
        Revive immediately at the shrine with full health, chakra and stamina for{" "}
        {RESOURCE_SILO_RESPAWN_COST.toLocaleString()} ryo. No PvP immunity applies in
        the War-Torn Sector.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={revival.isPending || user.money < RESOURCE_SILO_RESPAWN_COST}
          onClick={() => revival.mutate({ destination: "shrine" })}
        >
          Revive at Shrine ({RESOURCE_SILO_RESPAWN_COST.toLocaleString()} ryo)
        </Button>
        <Button
          variant="outline"
          disabled={revival.isPending}
          onClick={() => revival.mutate({ destination: "village" })}
        >
          Return to Village
        </Button>
      </div>
      {user.money < RESOURCE_SILO_RESPAWN_COST && (
        <p className="text-sm">
          You need {RESOURCE_SILO_RESPAWN_COST.toLocaleString()} ryo for shrine revival.
          Village treatment is still available below.
        </p>
      )}
      {revival.isPending && <p role="status">Resolving revival…</p>}
    </div>
  );
};
