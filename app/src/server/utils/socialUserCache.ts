import { shrineLobbyFreshAfter } from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import { effectiveMasteries } from "@/libs/mastery";
import { calcActiveUserRegen, calcMaxEnergy } from "@/libs/profile";
import { getRaidObjectiveData, isRaidListedForVillage } from "@/libs/raids";
import { getTimedRegeneration } from "@/libs/timedBuffs";
import { regenerationBuffs } from "@/libs/titles";
import {
  fetchActiveRaids,
  fetchActiveShrineLobbies,
  fetchAllActiveWars,
  fetchAllGameSettings,
} from "@/queries/profile";
import { fetchMasterySources } from "@/queries/skillTree";
import {
  findBattleUserCache,
  findMembershipUserCache,
  findQueueUserCache,
  findWarUserCache,
} from "@/queries/socialUserCache";
import type { DrizzleClient } from "@/server/db";
import { withRequestScope } from "@/server/requestScope";
import { getPublicQuestTrackerPatch } from "@/server/utils/questUserCache";
import { fetchMercenaryWarId } from "@/server/utils/warMercenary";

/** Reproject only membership-dependent data, retaining unrelated progression and inventory. */
export const getMembershipUserPatch = (client: DrizzleClient, before: UserData) =>
  withRequestScope(async () => {
    const now = new Date();
    const [saved, wars, shrines, raids, settings, mercenaryWarId] = await Promise.all([
      findMembershipUserCache(client, before.userId),
      fetchAllActiveWars(client),
      fetchActiveShrineLobbies(client, shrineLobbyFreshAfter(now)),
      fetchActiveRaids(client, now),
      fetchAllGameSettings(client),
      fetchMercenaryWarId(client, before.userId),
    ]);
    if (!saved) return undefined;
    const user = { ...before, ...saved };
    const regenerationWithoutTimedBuffs = calcActiveUserRegen(user, settings, false);
    const owned = new Set(saved.village?.sectors.map((entry) => entry.sector) ?? []);
    const defeated = new Set(
      wars
        .filter(
          (entry) =>
            entry.type === "SECTOR_WAR" &&
            entry.defenderShrineHp <= 0 &&
            (entry.attackerVillageId === saved.villageId ||
              entry.warAllies.some(
                (ally) =>
                  ally.villageId === saved.villageId &&
                  ally.supportVillageId === entry.attackerVillageId,
              )),
        )
        .map((entry) => entry.sector),
    );
    const {
      bloodline: _bloodline,
      raidBuffs: _buffs,
      titles: _titles,
      homeType: _homeType,
      ...patch
    } = saved;
    return {
      ...patch,
      regenerationWithoutTimedBuffs,
      regeneration: getTimedRegeneration(
        regenerationWithoutTimedBuffs,
        regenerationBuffs(user),
      ),
      activeWars: wars.filter(
        (entry) =>
          (!mercenaryWarId || entry.id === mercenaryWarId) &&
          (entry.attackerVillageId === saved.villageId ||
            entry.defenderVillageId === saved.villageId ||
            entry.warAllies.some((ally) => ally.villageId === saved.villageId)),
      ),
      shrineBattles: shrines.filter(
        (entry) =>
          entry.defenderEntityId === saved.villageId ||
          entry.attackerEntityId === saved.villageId,
      ),
      activeRaids: raids
        .filter((entry) =>
          isRaidListedForVillage(entry, saved.villageId, owned, defeated, now),
        )
        .flatMap((entry) => {
          const objective = getRaidObjectiveData(entry);
          return objective
            ? [
                {
                  id: entry.id,
                  name: entry.name,
                  description: entry.description,
                  image: entry.image,
                  sector: objective.sector,
                  raidType: objective.raidType,
                  raidEndsAt: entry.raidEndsAt,
                },
              ]
            : [];
        }),
    };
  });

/** Contract acceptance and resignation alter the exclusive list of visible wars. */
export const getWarAllegianceUserPatch = (client: DrizzleClient, userId: string) =>
  withRequestScope(async () => {
    const [saved, wars, mercenaryWarId] = await Promise.all([
      findWarUserCache(client, userId),
      fetchAllActiveWars(client),
      fetchMercenaryWarId(client, userId),
    ]);
    if (!saved) return undefined;
    return {
      ...saved,
      activeWars: wars.filter(
        (entry) =>
          (!mercenaryWarId || entry.id === mercenaryWarId) &&
          (entry.attackerVillageId === saved.villageId ||
            entry.defenderVillageId === saved.villageId ||
            entry.warAllies.some((ally) => ally.villageId === saved.villageId)),
      ),
    };
  });

/** Fresh lobby summaries update village-wide shrine notices after queue creation/deletion/start. */
export const getShrineLobbyUserPatch = (
  client: DrizzleClient,
  userId: string,
  villageId: string | null,
  isCombat = false,
) =>
  withRequestScope(async () => {
    const [saved, lobbies] = await Promise.all([
      isCombat
        ? getBattleUserPatch(client, userId)
        : findQueueUserCache(client, userId),
      fetchActiveShrineLobbies(client, shrineLobbyFreshAfter()),
    ]);
    return saved
      ? {
          ...saved,
          shrineBattles: lobbies.filter(
            (entry) =>
              entry.attackerEntityId === villageId ||
              entry.defenderEntityId === villageId,
          ),
        }
      : undefined;
  });

/** Public derived combat values retain equipment eligibility without exposing effect definitions. */
export const getBattleUserPatch = async (client: DrizzleClient, userId: string) => {
  const [saved, sources] = await Promise.all([
    findBattleUserCache(client, userId),
    fetchMasterySources(client, userId),
  ]);
  if (!saved) return undefined;
  const publicTrackers = await getPublicQuestTrackerPatch(client, saved);
  if (!publicTrackers) return undefined;
  const sourceUser = { ...saved, ...sources };
  const { bloodlineId: _bloodlineId, isAi: _isAi, role: _role, ...patch } = saved;
  return {
    ...patch,
    ...publicTrackers,
    effectiveMasteries: effectiveMasteries(sourceUser),
    maxEnergy: calcMaxEnergy(sourceUser),
  };
};
