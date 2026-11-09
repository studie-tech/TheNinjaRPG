/**
 * Database access for skill tree; authorization and transaction scopes stay in callers.
 */
import type { SQL } from "drizzle-orm";
import { and, eq, gt, ne } from "drizzle-orm";
import { userData, userItem, userSkill } from "@/drizzle/schema";
import type { MasterySources } from "@/libs/mastery";
import type { DrizzleClient } from "@/server/db";
import { getNextUserSnapshotAt } from "@/utils/time";

/**
 * Fetch the user's skills
 * @param client - The database client
 * @param userId - The user ID
 * @returns The user's skills
 */
export const fetchUserSkills = async (client: DrizzleClient, userId: string) => {
  return await client.query.userSkill.findMany({
    where: eq(userSkill.userId, userId),
    with: { skill: { with: { folder: true } } },
  });
};

/**
 * Preload the bloodline, activated skills and equipped gear for mastery and activity bonuses.
 * Keep hidden equipped items: inventory visibility does not determine passive eligibility.
 * Availability fields let the shared eligibility helpers filter these sources in memory.
 * @param client - The database client
 * @param userId - The user ID
 */
export const fetchMasterySources = async (
  client: DrizzleClient,
  userId: string,
): Promise<Required<MasterySources>> => {
  const sources = await client.query.userData.findFirst({
    columns: { userId: true },
    where: eq(userData.userId, userId),
    with: {
      bloodline: { columns: { effects: true } },
      titles: true,
      userSkills: {
        columns: { id: true, skillId: true, activated: true },
        where: eq(userSkill.activated, true),
        with: { skill: { columns: { target: true, effects: true } } },
      },
      items: {
        columns: {
          id: true,
          equipped: true,
          durability: true,
          level: true,
          quantity: true,
          storedAtHome: true,
          isInAuction: true,
          craftingFinishedAt: true,
        },
        where: and(ne(userItem.equipped, "NONE"), gt(userItem.quantity, 0)),
        with: {
          item: {
            columns: {
              itemType: true,
              maxDurability: true,
              bloodlineId: true,
              canBeImbued: true,
              effects: true,
              requiredNinjutsuMastery: true,
              requiredGenjutsuMastery: true,
              requiredTaijutsuMastery: true,
              requiredBukijutsuMastery: true,
              requiredSkillId: true,
              requiredBloodlineMastery: true,
              requiredSageMastery: true,
            },
          },
          imbuements: {
            columns: { craftingFinishedAt: true },
            with: { item: { columns: { effects: true } } },
          },
        },
      },
    },
  });
  return {
    bloodline: sources?.bloodline ?? null,
    titles: sources?.titles ?? [],
    userSkills: sources?.userSkills ?? [],
    items: sources?.items ?? [],
  };
};

import { asc, gte, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { COST_SKILL_RESET, IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import {
  actionLog,
  bloodline,
  item,
  jutsu,
  skillTree,
  skillTreeFolder,
} from "@/drizzle/schema";

/** Build the `skillTree` listing for `getAllNames`, using predicates on `pathType`. */
export const listSkillTreeForGetAllNames = (client: Pick<DrizzleClient, "query">) =>
  client.query.skillTree.findMany({
    columns: { id: true, name: true, skillType: true, hidden: true },
    where: eq(skillTree.pathType, "SKILL"),
    with: { folder: true },
    orderBy: (table, { asc }) => [asc(table.name)],
  });

/** Build the `skillTreeFolder` selection for `getAll`, using predicates on `hidden`. */
export const selectSkillTreeFolderForGetAll = (client: Pick<DrizzleClient, "select">) =>
  client
    .select({ id: skillTreeFolder.id })
    .from(skillTreeFolder)
    .where(eq(skillTreeFolder.hidden, true));

/** Build the `skillTree` listing for `getAll`, using the configured predicates. */
export const listSkillTreeForGetAll = (
  client: Pick<DrizzleClient, "query">,
  baseFilters: SQL<unknown>[],
  limit: number,
  skip: number,
) =>
  client.query.skillTree.findMany({
    where: and(...baseFilters),
    orderBy: [skillTree.tier, skillTree.name],
    with: { folder: true },
    limit,
    offset: skip,
  });

/** Build the `skillTree` lookup, using predicates on `id`. */
export const findSkillWithFolderById = (
  client: Pick<DrizzleClient, "query">,
  skillId: string,
) =>
  client.query.skillTree.findFirst({
    where: eq(skillTree.id, skillId),
    with: { folder: true },
  });

/** Build the `userSkill` update for `purchaseSkill`, setting `activated`, using predicates on `id`. */
export const updateUserSkillForPurchaseSkill = (
  client: Pick<DrizzleClient, "update">,
  existingUserSkill: { id: string },
) =>
  client
    .update(userSkill)
    .set({ activated: true })
    .where(eq(userSkill.id, existingUserSkill.id));

/** Build the `userSkill` insert for `purchaseSkill`, updating duplicate keys. */
export const insertUserSkillForPurchaseSkill = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { skillId: string },
) =>
  client
    .insert(userSkill)
    .values({
      id: nanoid(),
      userId: ctx.userId,
      skillId: input.skillId,
      activated: true,
    })
    .onDuplicateKeyUpdate({ set: { activated: true } });

/** Build a bloodline ID lookup to validate its existence. */
export const findBloodlineIdentityById = (
  client: Pick<DrizzleClient, "query">,
  bloodlineId: string,
) =>
  client.query.bloodline.findFirst({
    where: eq(bloodline.id, bloodlineId),
    columns: { id: true },
  });

/** Build the `skillTree` insert for `create`. */
export const insertSkillTreeForCreate = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
  input: { bloodlineId?: undefined | string } | undefined,
) =>
  client.insert(skillTree).values({
    id,
    name: `New Skill - ${id}`,
    description: "New skill description",
    image: IMG_AVATAR_DEFAULT,
    effects: [],
    target: "SELF",
    tier: 1,
    requiredSkillIds: [],
    costSkillPoints: 1,
    pathType: input?.bloodlineId ? "BLOODRIGHT" : "SKILL",
    bloodlineId: input?.bloodlineId ?? null,
    hidden: true,
    skillType: "DEFAULT",
  });

/** Build the `skillTree` lookup for `update`, selecting only `name` and `id`, using predicates on `name`. */
export const findSkillTreeForUpdate = (
  client: Pick<DrizzleClient, "query">,
  input: { data: { name: string } },
) =>
  client.query.skillTree.findFirst({
    columns: { name: true, id: true },
    where: eq(skillTree.name, input.data.name),
  });

/** Build the `skillTreeFolder` lookup for `update`, selecting only `hidden`, using predicates on `id`. */
export const findSkillTreeFolderForUpdate = (
  client: Pick<DrizzleClient, "query">,
  requestedFolderId: string,
) =>
  client.query.skillTreeFolder.findFirst({
    where: eq(skillTreeFolder.id, requestedFolderId),
    columns: { hidden: true },
  });

/** Build the `skillTree` listing for `update`, using predicates on `id`. */
export const listSkillTreeForUpdate = (
  client: Pick<DrizzleClient, "query">,
  input: { data: { requiredSkillIds: string[] } },
) =>
  client.query.skillTree.findMany({
    where: inArray(skillTree.id, input.data.requiredSkillIds),
  });

/** Build the `userData` lookup for `update`, selecting only `userId`, using predicates on `bloodright`. */
export const findUserDataForUpdate = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.userData.findFirst({
    where: sql`JSON_SEARCH(${userData.bloodright}, 'one', ${input.id}, NULL, '$[*].skillId') IS NOT NULL`,
    columns: { userId: true },
  });

/** Build the `skillTree` listing for `update`, using predicates on `requiredSkillIds`. */
export const listSkillTreeForUpdate2 = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.skillTree.findMany({
    where: sql`JSON_CONTAINS(${skillTree.requiredSkillIds}, ${JSON.stringify(input.id)})`,
    columns: { id: true, tier: true, bloodlineId: true, pathType: true },
  });

/** Build the `skillTree` update for `update`, setting `updatedAt`, using predicates on `id` and `bloodright`. */
export const updateSkillTreeForUpdate = (
  client: Pick<DrizzleClient, "update">,
  data: Pick<
    import("@/drizzle/schema").SkillTree,
    | "name"
    | "description"
    | "image"
    | "target"
    | "bloodlineId"
    | "effects"
    | "tier"
    | "requiredSkillIds"
    | "costSkillPoints"
    | "pathType"
    | "seichiSilverCost"
    | "skillType"
    | "folderId"
  > & { hidden: undefined | false | true },
  skill: { updatedAt: Date; pathType: "SKILL" | "BLOODRIGHT"; id: string },
  input: { id: string },
  changesHierarchy: false | true,
) =>
  client
    .update(skillTree)
    .set({ ...data, updatedAt: getNextUserSnapshotAt(skill.updatedAt) })
    .where(
      and(
        eq(skillTree.id, input.id),
        changesHierarchy && skill.pathType === "BLOODRIGHT"
          ? sql`NOT EXISTS (SELECT 1 FROM ${userData} WHERE JSON_SEARCH(${userData.bloodright}, 'one', ${skill.id}, NULL, '$[*].skillId') IS NOT NULL)`
          : undefined,
      ),
    );

/** Build the `skillTree` lookup for `delete`, using predicates on `id`. */
export const findSkillTreeForDelete = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) => client.query.skillTree.findFirst({ where: eq(skillTree.id, input.id) });

/** Build the `userSkill` listing for `delete`, selecting one `id` to test for any owner. */
export const listUserSkillForDelete = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.userSkill.findMany({
    columns: { id: true },
    where: eq(userSkill.skillId, input.id),
    limit: 1,
  });

/** Build the `skillTree` listing for `delete`, selecting only `id`, using predicates on `requiredSkillIds`. */
export const listSkillTreeForDelete = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.skillTree.findMany({
    where: sql`JSON_CONTAINS(${skillTree.requiredSkillIds}, ${JSON.stringify(input.id)})`,
    columns: { id: true },
  });

/** Build the `item` listing for `delete`, selecting only `id`, using predicates on `requiredSkillId`. */
export const listItemForDelete = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.item.findMany({
    columns: { id: true },
    where: eq(item.requiredSkillId, input.id),
    limit: 1,
  });

/** Build the `jutsu` listing for `delete`, selecting only `id`, using predicates on `requiredSkillId`. */
export const listJutsuForDelete = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.jutsu.findMany({
    columns: { id: true },
    where: eq(jutsu.requiredSkillId, input.id),
    limit: 1,
  });

/** Build the `skillTree` deletion for `delete`, using predicates on `id`. */
export const deleteSkillTreeForDelete = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(skillTree).where(eq(skillTree.id, input.id));

/** Build the `actionLog` insert for `update`. */
export const insertActionLogForUpdate = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  diff: string[],
  entry: { id: string; name: string; image: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "skillTree",
    changes: diff,
    relatedId: entry.id,
    relatedMsg: `Update: ${entry.name}`,
    relatedImage: entry.image,
  });

/** Build the `actionLog` insert for `delete`. */
export const insertActionLogForDelete = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  entry: { id: string; name: string; image: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "skillTree",
    changes: [`Deleted: ${entry.name}`],
    relatedId: entry.id,
    relatedMsg: `Delete: ${entry.name}`,
    relatedImage: entry.image,
  });

/**
 * Build the `userData` update for `resetSkillPoints`, using predicates on `userId`,
 * `monthlySkillResets`, `reputationPoints`.
 */
export const updateUserDataForResetSkillPoints = (
  client: Pick<DrizzleClient, "update">,
  user: { updatedAt: Date; monthlySkillResets: { month: string; count: number } },
  isFreeReset: false | true,
  monthlySkillResets: { month: string; count: number },
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      updatedAt: getNextUserSnapshotAt(user.updatedAt),
      reputationPoints: sql`${userData.reputationPoints} - ${isFreeReset ? 0 : COST_SKILL_RESET}`,
      monthlySkillResets,
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        sql`${userData.monthlySkillResets} = CAST(${JSON.stringify(user.monthlySkillResets)} AS JSON)`,
        gte(userData.reputationPoints, isFreeReset ? 0 : COST_SKILL_RESET),
      ),
    );

/** Build deletion of all skills belonging to one user. */
export const deleteUserSkills = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(userSkill).where(eq(userSkill.userId, userId));

/** Build the `actionLog` insert for `resetSkillPoints`. */
export const insertActionLogForResetSkillPoints = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  user: { avatarLight: null | string },
  resetActionLogDetails: {
    changes: string[];
    relatedMsg: string;
    relatedValue: number;
  },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "skillReset",
    relatedId: null,
    relatedImage: user.avatarLight,
    ...resetActionLogDetails,
  });

/** Build the `userSkill` selection for `resetAllUsersSkillPoints`. */
export const selectUserSkillForResetAllUsersSkillPoints = (
  client: Pick<DrizzleClient, "select">,
  BATCH_SIZE: 500,
) => client.select({ id: userSkill.id }).from(userSkill).limit(BATCH_SIZE);

/** Build the `userSkill` deletion for `resetAllUsersSkillPoints`, using predicates on `id`. */
export const deleteUserSkillForResetAllUsersSkillPoints = (
  client: Pick<DrizzleClient, "delete">,
  ids: string[],
) => client.delete(userSkill).where(inArray(userSkill.id, ids));

/** Build the `actionLog` insert for `resetAllUsersSkillPoints`. */
export const insertActionLogForResetAllUsersSkillPoints = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  user: { username: string; avatarLight: null | string },
  totalDeleted: number,
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "userSkill",
    changes: [`Partial mass reset of users' skill trees`],
    relatedId: null,
    relatedMsg: `Partial skill tree reset by ${user.username} (${totalDeleted} entries cleared, some remained)`,
    relatedImage: user.avatarLight,
  });

/** Build the `actionLog` insert for `resetAllUsersSkillPoints`. */
export const insertActionLogForResetAllUsersSkillPoints2 = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  user: { username: string; avatarLight: null | string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "userSkill",
    changes: [`Mass reset all users' skill trees`],
    relatedId: null,
    relatedMsg: `Mass skill tree reset by ${user.username}`,
    relatedImage: user.avatarLight,
  });

/** Build the `skillTreeFolder` listing for `getAllFolders`. */
export const listSkillTreeFolderForGetAllFolders = (
  client: Pick<DrizzleClient, "query">,
) =>
  client.query.skillTreeFolder.findMany({
    orderBy: [asc(skillTreeFolder.order), asc(skillTreeFolder.name)],
  });

/** List folder assignments to distinguish bloodright-only folders from skill folders. */
export const listSkillTreeFolderAssignments = (client: Pick<DrizzleClient, "query">) =>
  client.query.skillTree.findMany({ columns: { folderId: true, pathType: true } });

/** Build the `skillTree` listing for `getFolderStats`, using predicates on `pathType`. */
export const listSkillTreeForGetFolderStats = (client: Pick<DrizzleClient, "query">) =>
  client.query.skillTree.findMany({
    columns: { id: true, folderId: true, hidden: true, skillType: true },
    where: eq(skillTree.pathType, "SKILL"),
    with: { folder: true },
  });

/** Build the `skillTreeFolder` insert for `createFolder`. */
export const insertSkillTreeFolderForCreateFolder = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
  input: SkillTreeFolderInput,
) =>
  client.insert(skillTreeFolder).values({
    id,
    name: input.name,
    image: input.image || "",
    description: input.description || null,
    hidden: input.hidden || false,
    order: input.order || 0,
  });

/** Build the `skillTreeFolder` lookup for `updateFolder`, using predicates on `id`. */
export const findSkillTreeFolderForUpdateFolder = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.skillTreeFolder.findFirst({
    where: eq(skillTreeFolder.id, input.id),
  });

/** Build the `skillTreeFolder` update for `updateFolder`, using predicates on `id`. */
export const updateSkillTreeFolderForUpdateFolder = (
  client: Pick<DrizzleClient, "update">,
  input: {
    data: SkillTreeFolderInput;
    id: string;
  },
) =>
  client
    .update(skillTreeFolder)
    .set({
      name: input.data.name,
      image: input.data.image || "",
      description: input.data.description || null,
      hidden: input.data.hidden || false,
      order: input.data.order || 0,
      updatedAt: new Date(),
    })
    .where(eq(skillTreeFolder.id, input.id));

/** Build the `skillTreeFolder` lookup for `deleteFolder`, selecting only `id`, using predicates on `id`. */
export const findSkillTreeFolderForDeleteFolder = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.skillTreeFolder.findFirst({
    where: eq(skillTreeFolder.id, input.id),
    columns: { id: true },
  });

/** Build the `skillTree` listing for `deleteFolder`, selecting only `id`, using predicates on `folderId`. */
export const listSkillTreeForDeleteFolder = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.skillTree.findMany({
    where: eq(skillTree.folderId, input.id),
    columns: { id: true },
  });

/** Build the `skillTreeFolder` deletion for `deleteFolder`, using predicates on `id`. */
export const deleteSkillTreeFolderForDeleteFolder = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(skillTreeFolder).where(eq(skillTreeFolder.id, input.id));

/** Build the `skillTreeFolder` update for `reorderFolders`, setting `order` and `updatedAt`, using predicates on `id`. */
export const updateSkillTreeFolderForReorderFolders = (
  client: Pick<DrizzleClient, "update">,
  order: number,
  id: string,
) =>
  client
    .update(skillTreeFolder)
    .set({ order, updatedAt: new Date() })
    .where(eq(skillTreeFolder.id, id));

/** Build the `skillTree` lookup, selecting only `id` and `pathType`, using predicates on `id`. */
export const findRequiredSkillTreeEntry = (
  client: Pick<DrizzleClient, "query">,
  input: { data: { requiredSkillId: string } },
) =>
  client.query.skillTree.findFirst({
    columns: { id: true, pathType: true },
    where: eq(skillTree.id, input.data.requiredSkillId),
  });

/** Editable folder fields shared by the create and update statements. */
type SkillTreeFolderInput = {
  name: string;
  image?: string | undefined;
  description?: string | undefined;
  hidden?: boolean | undefined;
  order?: number | undefined;
};
