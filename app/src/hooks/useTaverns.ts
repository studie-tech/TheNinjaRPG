"use client";

import { useMemo } from "react";
import { api } from "@/app/_trpc/client";
import { useSectorVillage } from "@/hooks/useSectorVillage";
import type { UserWithRelations } from "@/routers/profile";
import { findVillageUserRelationship } from "@/utils/alliance";

/**
 * Taverns the player may open: Global (when enabled, always for staff), their own
 * village or Syndicate tavern, an allied village's tavern while in its sector, and
 * for staff every village tavern.
 */
export const useTaverns = (userData: UserWithRelations | null | undefined) => {
  const { data: villages } = api.village.getAll.useQuery(undefined, {
    enabled: !!userData,
  });
  const { sectorVillage, isLoading: isLoadingSector } = useSectorVillage(userData);
  const { data: globalTavernEnabled = true, isPending: isLoadingGlobalTavern } =
    api.misc.getGlobalTavernEnabled.useQuery();

  // Tavern name based on user village
  const localTavern = useMemo(() => {
    let tavern =
      ["OUTLAW", "STRONGHOLD", "VILLAGE"].includes(userData?.village?.type ?? "") &&
      userData?.village?.name
        ? userData?.village?.name
        : "Syndicate";

    // Change to ally tavern if relevant
    if (sectorVillage && userData) {
      const relationship = findVillageUserRelationship(
        sectorVillage,
        userData.villageId ?? "syndicate",
      );
      if (relationship?.status === "ALLY") {
        tavern = sectorVillage.name;
      }
    }
    return tavern;
  }, [userData, sectorVillage]);

  // Global is available while enabled, and always for staff
  const canAccessGlobal = globalTavernEnabled || userData?.role !== "USER";

  const availTaverns = canAccessGlobal ? ["Global", localTavern] : [localTavern];
  if (userData?.role !== "USER") {
    villages
      ?.filter((v) => ["OUTLAW", "VILLAGE"].includes(v.type))
      .map((v) => v.name)
      .filter((v) => !availTaverns.includes(v))
      .forEach((v) => {
        availTaverns.push(v);
      });
  }

  return {
    availTaverns,
    localTavern,
    canAccessGlobal,
    globalTavernEnabled,
    isLoading: isLoadingSector || isLoadingGlobalTavern,
  };
};
