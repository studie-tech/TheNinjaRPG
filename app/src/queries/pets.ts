/**
 * Database access for pets; authorization and transaction scopes stay in callers.
 */
import type { SQL } from "drizzle-orm";
import { and, eq } from "drizzle-orm";
import type { CombatStatName } from "@/drizzle/constants";
import { jutsu, userData, userPet, userSkill } from "@/drizzle/schema";
import { actionReadinessSqlSet, fetchActionUser } from "@/queries/actionReadiness";
import { fetchAllGameSettings } from "@/queries/profile";
import type { DrizzleClient } from "@/server/db";
import type { ActionReadinessWrite } from "@/server/utils/actionReadiness";
import { getNextUserSnapshotAt } from "@/utils/time";

/** Load independent owner and collection snapshots; actions include recovery context in the same read phase. */
export const fetchPetOwner = async (
  client: DrizzleClient,
  userId: string,
  petId?: string,
  includeActionReadiness = false,
) => {
  const [user, pets, settings] = await Promise.all([
    includeActionReadiness
      ? fetchActionUser(client, userId)
      : client.query.userData.findFirst({ where: eq(userData.userId, userId) }),
    client.query.userPet.findMany({
      where: eq(userPet.userId, userId),
      orderBy: userPet.createdAt,
      with: { species: true },
    }),
    includeActionReadiness ? fetchAllGameSettings(client) : [],
  ]);
  const pet =
    pets.find((entry) => entry.id === (petId ?? user?.activePetId)) ??
    (!petId ? pets[0] : undefined);
  return { user, pet, pets, settings };
};

/** Published pet jutsus are shared; passive skills still require an activated owner copy. */
export const fetchPetAbilities = async (client: DrizzleClient, userId: string) => {
  const [jutsus, skills] = await Promise.all([
    client.query.jutsu.findMany({
      where: and(eq(jutsu.jutsuType, "PETS"), eq(jutsu.hidden, false)),
    }),
    client.query.userSkill.findMany({
      where: and(eq(userSkill.userId, userId), eq(userSkill.activated, true)),
      with: { skill: true },
    }),
  ]);
  return {
    jutsus,
    skills: skills.map((owned) => owned.skill),
  };
};

import { count, gt, gte, isNull, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import { CombatStatNames } from "@/drizzle/constants";
import {
  item,
  petSpecies,
  type UserData,
  type UserPet,
  userItem,
  userUpload,
} from "@/drizzle/schema";

/** Table alias for previous pet joins, keeping its columns distinct from other participants. */
const previousPet = alias(userPet, "previous_pet");
/**
 * Materialize the owner XP bank before a companion transfer or queued award; compose it into
 * the guarded statement so bank settlement adds no database round-trip.
 */
export const selectUserDataForActivatePet = (
  client: Pick<DrizzleClient, "select">,
  ownerSnapshotWhere: (user: UserData) => SQL<unknown> | undefined,
  user: import("@/drizzle/schema").UserData,
  readiness?: ActionReadinessWrite,
) =>
  client
    .select({
      userId: userData.userId,
      petExperience:
        sql<number>`${readiness?.set.petExperience ?? userData.petExperience}`.as(
          "ownerPetExperience",
        ),
    })
    .from(userData)
    .where(ownerSnapshotWhere(user))
    .limit(1)
    .for("update")
    .as("owner_snapshot");

/** Execute the database statement for `activatePet`. */
export const executeActivatedForActivatePet = (
  client: Pick<DrizzleClient, "execute">,
  ownerSnapshot: ReturnType<typeof selectUserDataForActivatePet>,
  previous:
    | undefined
    | (import("@/drizzle/schema").UserPet & {
        species: import("@/drizzle/schema").PetSpecies;
      }),
  pet: import("@/drizzle/schema").UserPet & {
    species: import("@/drizzle/schema").PetSpecies;
  },
  user: import("@/drizzle/schema").UserData,
  now: Date,
  ownerSnapshotWhere: (user: UserData) => SQL<unknown> | undefined,
  readiness?: ActionReadinessWrite,
) =>
  client.execute(sql`
          UPDATE ${userData}
          INNER JOIN ${ownerSnapshot} ON ${eq(userData.userId, ownerSnapshot.userId)}
          INNER JOIN ${userPet} ON ${eq(userPet.userId, userData.userId)}
          ${previous ? sql`INNER JOIN ${userPet} previous_pet ON ${and(eq(previousPet.id, previous.id), eq(previousPet.userId, userData.userId), eq(previousPet.revision, previous.revision))}` : sql``}
          SET ${actionReadinessSqlSet(readiness, ["petExperience"])} ${userData.activePetId} = ${pet.id},
              ${userData.petExperience} = ${pet.storedExperience},
              ${userData.updatedAt} = ${getNextUserSnapshotAt(user.updatedAt, now)},
              ${userPet.storedExperience} = 0,
              ${userPet.revision} = ${userPet.revision} + 1,
              ${userPet.updatedAt} = ${now}
              ${previous ? sql`, ${previousPet.storedExperience} = ${ownerSnapshot.petExperience}, ${previousPet.revision} = ${previousPet.revision} + 1, ${previousPet.updatedAt} = ${now}` : sql``}
          WHERE ${and(ownerSnapshotWhere(user), petSnapshotWhere(pet))}
        `);

/** Build the `userItem` lookup for `feedPet`, using predicates on `id` and `userId`. */
export const findUserItemForFeedPet = (
  client: Pick<DrizzleClient, "query">,
  input: { userItemId: string },
  ctx: { userId: string },
) =>
  client.query.userItem.findFirst({
    where: and(eq(userItem.id, input.userItemId), eq(userItem.userId, ctx.userId)),
    with: { item: true },
  });

/** Execute the database statement for `feedPet`. */
export const executeFedForFeedPet = (
  client: Pick<DrizzleClient, "execute" | "select">,
  user: import("@/drizzle/schema").UserData,
  now: Date,
  meal: {
    quantity: number;
    id: string;
    itemId: string;
    item: { rarity: import("@/drizzle/schema").ItemRarity };
  },
  isActive: false | true,
  experience: number,
  ownerSnapshotWhere: (user: UserData) => SQL<unknown> | undefined,

  pet: import("@/drizzle/schema").UserPet & {
    species: import("@/drizzle/schema").PetSpecies;
  },
  ctx: { userId: string },
  readiness?: ActionReadinessWrite,
) => {
  // A queued XP award must read companion eligibility before this same statement changes it.
  const recoverySnapshot = readiness?.set.petExperience
    ? selectUserDataForActivatePet(client, ownerSnapshotWhere, user, readiness)
    : undefined;
  return client.execute(sql`
          UPDATE ${userData}
          ${recoverySnapshot ? sql`INNER JOIN ${recoverySnapshot} ON ${eq(userData.userId, recoverySnapshot.userId)}` : sql``}
          INNER JOIN ${userPet} ON ${eq(userPet.userId, userData.userId)}
          INNER JOIN ${userItem} ON ${eq(userItem.userId, userData.userId)}
          SET ${actionReadinessSqlSet(readiness, recoverySnapshot ? ["petExperience"] : [])} ${!isActive && recoverySnapshot ? sql`${userData.petExperience} = ${recoverySnapshot.petExperience},` : sql``}
              ${userData.updatedAt} = ${getNextUserSnapshotAt(user.updatedAt, now)},
              ${userItem.quantity} = ${meal.quantity - 1},
              ${userPet.lastFedAt} = ${now},
              ${userPet.revision} = ${userPet.revision} + 1,
              ${userPet.updatedAt} = ${now},
              ${isActive ? sql`${userData.petExperience} = ${recoverySnapshot?.petExperience ?? userData.petExperience} + ${experience}` : sql`${userPet.storedExperience} = ${userPet.storedExperience} + ${experience}`}
          WHERE ${and(ownerSnapshotWhere(user), petSnapshotWhere(pet))}
            AND ${userItem.id} = ${meal.id}
            AND ${userItem.userId} = ${ctx.userId}
            AND ${userItem.itemId} = ${meal.itemId}
            AND ${userItem.quantity} = ${meal.quantity}
            AND ${userItem.quantity} > 0
            AND ${userItem.isInAuction} = FALSE
            AND ${userItem.storedAtHome} = FALSE
            AND ${userItem.equipped} = 'NONE'
            AND (${userItem.craftingFinishedAt} IS NULL OR ${userItem.craftingFinishedAt} <= ${now})
            AND EXISTS (SELECT 1 FROM ${item} WHERE ${item.id} = ${meal.itemId}
              AND ${item.itemType} = 'MEAL' AND ${item.rarity} = ${meal.item.rarity})
        `);
};

/** Build the `petSpecies` listing for `getPet`. */
export const listPetSpeciesForGetPet = (client: Pick<DrizzleClient, "query">) =>
  client.query.petSpecies.findMany();

/** Build the `userItem` listing for `getPet`, including predicates on `userId`, `quantity`, `storedAtHome`. */
export const listUserItemForGetPet = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userItem.findMany({
    where: and(
      eq(userItem.userId, ctx.userId),
      gt(userItem.quantity, 0),
      eq(userItem.storedAtHome, false),
      eq(userItem.isInAuction, false),
      eq(userItem.equipped, "NONE"),
      or(
        isNull(userItem.craftingFinishedAt),
        lt(userItem.craftingFinishedAt, new Date()),
      ),
    ),
    with: { item: true },
  });

/** Build the `jutsu` listing, using predicates on `jutsuType` and `hidden`. */
export const listVisiblePetJutsu = (client: Pick<DrizzleClient, "query">) =>
  client.query.jutsu.findMany({
    where: and(eq(jutsu.jutsuType, "PETS"), eq(jutsu.hidden, false)),
  });

/** Build the `userPet` selection for `where`, using predicates on `userId`. */
export const selectUserPetForWhere = (
  client: Pick<DrizzleClient, "select">,
  user: { userId: string },
) =>
  client
    .select({ count: count() })
    .from(userPet)
    .where(eq(userPet.userId, user.userId));

/** Build the `petSpecies` selection for `where`, using predicates on `id` and `isActive`. */
export const selectPetSpeciesForWhere = (
  client: Pick<DrizzleClient, "select">,
  input: { speciesId: string },
) =>
  client
    .select({ id: petSpecies.id })
    .from(petSpecies)
    .where(and(eq(petSpecies.id, input.speciesId), eq(petSpecies.isActive, true)));

/** Build the `userPet` insert. */
export const insertUserPet = (
  client: Pick<DrizzleClient, "insert">,
  created: import("@/drizzle/schema").UserPetInsert,
) => client.insert(userPet).values(created);

/** Execute the database statement for `releasePet`. */
export const executeRemovedForReleasePet = (
  client: Pick<DrizzleClient, "execute">,
  ownerSnapshotWhere: (user: UserData) => SQL<unknown> | undefined,
  user: import("@/drizzle/schema").UserData,

  pet: import("@/drizzle/schema").UserPet & {
    species: import("@/drizzle/schema").PetSpecies;
  },
) =>
  client.execute(sql`
              DELETE ${userPet}
              FROM ${userPet}
              INNER JOIN ${userData} ON ${eq(userData.userId, userPet.userId)}
              WHERE ${and(ownerSnapshotWhere(user), petSnapshotWhere(pet))}
            `);

/** Build the `userPet` deletion for `releasePet`, using the configured predicates. */
export const deleteUserPetForReleasePet = (
  client: Pick<DrizzleClient, "delete">,

  pet: import("@/drizzle/schema").UserPet & {
    species: import("@/drizzle/schema").PetSpecies;
  },
) => client.delete(userPet).where(petSnapshotWhere(pet));

/** Pin the XP bank as well as revisions so allocation can return its exact remaining balance. */
export const executeAssignedForAssignExperience = (
  client: Pick<DrizzleClient, "execute" | "select">,
  user: import("@/drizzle/schema").UserData,
  now: Date,
  bank:
    | typeof import("@/drizzle/schema").userData["petExperience"]
    | typeof import("@/drizzle/schema").userPet["storedExperience"],
  availableExperience: number,
  spent: number,
  stats: Pick<UserData, CombatStatName>,
  ownerSnapshotWhere: (user: UserData) => SQL<unknown> | undefined,

  pet: import("@/drizzle/schema").UserPet & {
    species: import("@/drizzle/schema").PetSpecies;
  },
  readiness?: ActionReadinessWrite,
) => {
  // A queued XP award must read companion eligibility before this same statement changes it.
  const recoverySnapshot = readiness?.set.petExperience
    ? selectUserDataForActivatePet(client, ownerSnapshotWhere, user, readiness)
    : undefined;
  return client.execute(sql`
          UPDATE ${userData}
          ${recoverySnapshot ? sql`INNER JOIN ${recoverySnapshot} ON ${eq(userData.userId, recoverySnapshot.userId)}` : sql``}
          INNER JOIN ${userPet} ON ${eq(userPet.userId, userData.userId)}
          SET ${actionReadinessSqlSet(readiness, recoverySnapshot ? ["petExperience"] : [])} ${bank !== userData.petExperience && recoverySnapshot ? sql`${userData.petExperience} = ${recoverySnapshot.petExperience},` : sql``}
              ${userData.updatedAt} = ${getNextUserSnapshotAt(user.updatedAt, now)},
              ${bank} = ${bank === userData.petExperience && recoverySnapshot ? recoverySnapshot.petExperience : bank} - ${spent},
              ${sql.join(
                CombatStatNames.map((stat) => sql`${userPet[stat]} = ${stats[stat]}`),
                sql`, `,
              )},
              ${userPet.experience} = ${userPet.experience} + ${spent},
              ${userPet.revision} = ${userPet.revision} + 1,
              ${userPet.updatedAt} = ${now}
          WHERE ${and(ownerSnapshotWhere(user), petSnapshotWhere(pet), eq(bank, availableExperience), gte(bank, spent))}
        `);
};

/** Build the `userPet` update for `generateAppearance`, using predicates on `federalStatus` and `staffAccount`. */
export const updateUserPetForGenerateAppearance = (
  client: Pick<DrizzleClient, "execute" | "select">,
  token: string,
  now: Date,
  attempts: number,

  pet: import("@/drizzle/schema").UserPet & {
    species: import("@/drizzle/schema").PetSpecies;
  },
  ownerSnapshotWhere: (user: UserData) => SQL<unknown> | undefined,
  user: UserData,
  readiness?: ActionReadinessWrite,
) => {
  // A queued XP award must read companion eligibility before this same statement changes it.
  const recoverySnapshot = readiness?.set.petExperience
    ? selectUserDataForActivatePet(client, ownerSnapshotWhere, user, readiness)
    : undefined;
  return client.execute(sql`
    UPDATE ${userData}
          ${recoverySnapshot ? sql`INNER JOIN ${recoverySnapshot} ON ${eq(userData.userId, recoverySnapshot.userId)}` : sql``}
    INNER JOIN ${userPet} ON ${eq(userPet.userId, userData.userId)}
    SET ${actionReadinessSqlSet(readiness, recoverySnapshot ? ["petExperience"] : [])}
        ${recoverySnapshot ? sql`${userData.petExperience} = ${recoverySnapshot.petExperience},` : sql``}
        ${readiness?.set.status ? sql`${userData.updatedAt} = ${getNextUserSnapshotAt(user.updatedAt, now)},` : sql``}
        ${userPet.generationStatus} = 'GENERATING',
        ${userPet.generationToken} = ${token},
        ${userPet.generationStartedAt} = ${now},
        ${userPet.generationAttempts} = ${attempts + 1},
        ${userPet.revision} = ${userPet.revision} + 1,
        ${userPet.updatedAt} = ${now}
    WHERE ${and(
      petSnapshotWhere(pet),
      ownerSnapshotWhere(user),
      eq(userData.federalStatus, user.federalStatus),
      eq(userData.staffAccount, user.staffAccount),
    )}
  `);
};

/** Build the `userUpload` insert for `generateAppearance`. */
export const insertUserUploadForGenerateAppearance = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  imageUrl: string,
) => client.insert(userUpload).values({ id: nanoid(), userId: ctx.userId, imageUrl });

/** Build the `userPet` update for `generateAppearance`, including predicates on `id`, `userId`, `rank`. */
export const updateUserPetForGenerateAppearance2 = (
  client: Pick<DrizzleClient, "update">,
  appearance:
    | undefined
    | Pick<
        import("@/drizzle/schema").UserPet,
        "paletteIndex" | "characteristicIndex" | "auraIndex"
      >,
  avatar: string,
  avatarFacing: "left",
  pet: { rank: number; id: string },
  ctx: { userId: string },
  token: string,
) =>
  client
    .update(userPet)
    .set({
      ...appearance,
      avatar,
      avatarFacing,
      artRank: pet.rank,
      generationStatus: "READY",
      generationToken: null,
      revision: sql`${userPet.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(userPet.id, pet.id),
        eq(userPet.userId, ctx.userId),
        eq(userPet.rank, pet.rank),
        eq(userPet.generationToken, token),
        eq(userPet.generationStatus, "GENERATING"),
      ),
    );

/** Build the `userPet` update for `generateAppearance`, including predicates on `id`, `userId`, `generationToken`. */
export const updateUserPetForGenerateAppearance3 = (
  client: Pick<DrizzleClient, "update">,
  keepsPreviousLook: false | true,
  pet: { rank: number; avatar: null | string; artRank: number; id: string },
  ctx: { userId: string },
  token: string,
) =>
  client
    .update(userPet)
    .set({
      ...(keepsPreviousLook && { artRank: pet.rank }),
      // Staff can reset the counter mid-generation; never underflow the unsigned column.
      generationAttempts: sql`GREATEST(${userPet.generationAttempts}, 1) - 1`,
      generationStatus:
        pet.avatar && (pet.artRank === pet.rank || keepsPreviousLook)
          ? "READY"
          : "FAILED",
      generationToken: null,
      revision: sql`${userPet.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(userPet.id, pet.id),
        eq(userPet.userId, ctx.userId),
        eq(userPet.generationToken, token),
        eq(userPet.generationStatus, "GENERATING"),
      ),
    );

/** Execute the database statement for `updateOwnedPet`. */
export const executeResultForUpdateOwnedPet = (
  client: Pick<DrizzleClient, "execute" | "select">,
  user: import("@/drizzle/schema").UserData,
  now: Date,
  assignments: SQL<unknown>[],
  ownerSnapshotWhere: (user: UserData) => SQL<unknown> | undefined,

  pet: import("@/drizzle/schema").UserPet,
  readiness?: ActionReadinessWrite,
) => {
  // A queued XP award must read companion eligibility before this same statement changes it.
  const recoverySnapshot = readiness?.set.petExperience
    ? selectUserDataForActivatePet(client, ownerSnapshotWhere, user, readiness)
    : undefined;
  return client.execute(sql`
      UPDATE ${userData}
          ${recoverySnapshot ? sql`INNER JOIN ${recoverySnapshot} ON ${eq(userData.userId, recoverySnapshot.userId)}` : sql``}
      INNER JOIN ${userPet} ON ${eq(userPet.userId, userData.userId)}
      SET ${actionReadinessSqlSet(readiness, recoverySnapshot ? ["petExperience"] : [])} ${recoverySnapshot ? sql`${userData.petExperience} = ${recoverySnapshot.petExperience},` : sql``}
        ${userData.updatedAt} = ${getNextUserSnapshotAt(user.updatedAt, now)},
          ${sql.join(assignments, sql`, `)}${assignments.length ? sql`,` : sql``}
          ${userPet.revision} = ${userPet.revision} + 1,
          ${userPet.updatedAt} = ${now}
      WHERE ${and(ownerSnapshotWhere(user), petSnapshotWhere(pet))}
    `);
};

/** Every pet write must still own the selected identity at the fetched revision. */
const petSnapshotWhere = (pet: UserPet) =>
  and(
    eq(userPet.id, pet.id),
    eq(userPet.userId, pet.userId),
    eq(userPet.revision, pet.revision),
  );
