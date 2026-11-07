import { VILLAGE_STRUCTURE_MONTHLY_COST } from "@/drizzle/constants";
import {
  listVillageForAccrueVillageStructureMaintenance,
  updateVillageForAccrueVillageStructureMaintenance,
  updateVillageForAccrueVillageStructureMaintenance2,
} from "@/queries/village";
import type { DrizzleClient } from "@/server/db";
import { getUtcMonthDistance, getUtcMonthKey } from "@/utils/time";
import { countMaintainedStructures } from "@/utils/village";

export const accrueVillageStructureMaintenance = async (
  client: DrizzleClient,
  now = new Date(),
) => {
  const month = getUtcMonthKey(now);
  const villages = await listVillageForAccrueVillageStructureMaintenance(client);
  await Promise.all(
    villages.map(async (entry) => {
      const previous = entry.structureMaintenanceMonth;
      if (previous && previous >= month) return;
      const structureCount = countMaintainedStructures(entry.structures);
      // A newly created village starts its first full billing period now, without retroactive fees.
      const fee = previous
        ? structureCount *
          VILLAGE_STRUCTURE_MONTHLY_COST *
          getUtcMonthDistance(previous, month)
        : 0;
      await updateVillageForAccrueVillageStructureMaintenance(
        client,
        fee,
        month,
        entry,
        previous,
      );
    }),
  );
  // Automatic payment retries hourly. Accrual is durable and month-guarded, so a partial run is safe to retry.
  const paid = await updateVillageForAccrueVillageStructureMaintenance2(client);
  return { paid: paid.rowsAffected };
};
