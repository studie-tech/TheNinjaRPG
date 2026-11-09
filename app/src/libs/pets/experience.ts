/** SQL-side eligibility and increments for the active companion's unassigned XP bank. */
import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { UserRanks } from "@/drizzle/constants";
import { userData, userPet } from "@/drizzle/schema";
import { getMaxPetRank } from "@/libs/pets/progression";

/**
 * Add mirrored player XP or dedicated pet rewards in the caller's guarded owner
 * update, using live pet eligibility. Omit petId to use the current active
 * pet, pass an ID to bind battle rewards to its original companion, or pass null
 * to award no pet XP. Assigning already earned player XP must not call this again.
 */
export const petExperienceGainSql = (experience: number, petId?: string | null) => {
  if (!Number.isFinite(experience) || experience <= 0 || petId === null)
    return sql`${userData.petExperience}`;
  // Player XP columns store whole points; mirror the committed grant rather than
  // accumulate fractional training gains that the player's integer column rounds.
  const gain = Math.round(experience);
  const maxRank = sql`CASE ${userData.rank} ${sql.join(
    UserRanks.map((rank) => sql`WHEN ${rank} THEN ${getMaxPetRank(rank)}`),
    sql` `,
  )} ELSE 0 END`;
  // The live identity guard excludes released/replaced pets, while the correlated
  // rank check also stops progression after the owner loses the required rank.
  // Match isPetAppearanceReady: accepted current-rank art remains usable during redraws.
  const eligible = and(
    eq(userPet.userId, userData.userId),
    eq(userPet.id, userData.activePetId),
    eq(userPet.battleEnabled, true),
    inArray(userPet.generationStatus, ["READY", "GENERATING"]),
    eq(userPet.artRank, userPet.rank),
    isNotNull(userPet.avatar),
    ne(userPet.avatar, ""),
    lte(userPet.rank, maxRank),
    gte(userPet.rank, 1),
    or(
      isNull(userData.petTask),
      sql`COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${userData.petTask}, '$.petId')), '') <> ${userPet.id}`,
    ),
    petId ? eq(userPet.id, petId) : undefined,
  );
  return sql`${userData.petExperience} + IF(EXISTS (SELECT 1 FROM ${userPet} WHERE ${eligible}), ${gain}, 0)`;
};
