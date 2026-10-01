import { api } from "@/app/_trpc/client";
import type { UserWithRelations } from "@/server/api/routers/profile";
import { getOwnSectorVillage } from "@/utils/village";

/** Use the profile's own village immediately and share the lookup when visiting another sector. */
export const useSectorVillage = (userData?: UserWithRelations | null) => {
  const ownVillage = getOwnSectorVillage(userData);
  const query = api.travel.getVillageInSector.useQuery(
    { sector: userData?.sector ?? -1, isOutlaw: userData?.isOutlaw ?? false },
    { enabled: userData?.sector != null && !ownVillage },
  );
  return {
    sectorVillage: ownVillage ?? query.data,
    isLoading: !ownVillage && query.isLoading,
  };
};
