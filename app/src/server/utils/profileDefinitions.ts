import type { VillageStructure } from "@/drizzle/schema";
import {
  findProfileUserWithDefinitions,
  findUserDataForQueryUpdatedUser,
  selectStructureDefinitions,
} from "@/queries/profile";
import type { DrizzleClient } from "@/server/db";
import { createDefinitionCache, itemDefinitions } from "@/server/utils/definitionCache";
import { questDefinitionCache } from "@/server/utils/questRevisions";

/**
 * Load the profile snapshot with complete quest, item and village structure definitions.
 *
 * The snapshot query reads only each definition's content hash and live columns; the
 * definitions come from `createDefinitionCache`, so the result keeps the shape of a full
 * join.
 */
export const fetchProfileUser = async (
  client: DrizzleClient,
  userId: string,
): Promise<ProfileUser | undefined> => {
  const read = await readProfileUser(client, userId, false);
  if (!read) return undefined;
  const { questBootstrap: _bootstrap, rolledBloodlineIds: _rolled, ...user } = read;
  return user;
};

/**
 * `fetchProfileUser` with the per-user reads of the profile refresh's opening wave in the
 * same statement: the tier/exam bootstrap candidates and the rolled bloodline ids that
 * `bloodline_collection` objectives count.
 */
export const fetchProgressionProfileUser = async (
  client: DrizzleClient,
  userId: string,
) => {
  const read = await readProfileUser(client, userId, true);
  if (!read) return undefined;
  const { questBootstrap, rolledBloodlineIds, ...user } = read;
  return {
    user,
    questBootstrap: questBootstrap ?? [],
    rolledBloodlineIds: rolledBloodlineIds ?? [],
  };
};

/** The hydrated snapshot; the progression columns are null unless requested. */
const readProfileUser = async (
  client: DrizzleClient,
  userId: string,
  withProgressionReads: boolean,
): Promise<ProfileRead | undefined> => {
  const user = await findUserDataForQueryUpdatedUser(
    client,
    userId,
    withProgressionReads,
  );
  if (!user) return undefined;
  // Snapshots read without a relation (partial clients) leave it as read.
  const items = user.items ?? [];
  const structures = user.village?.structures ?? [];
  const [quests, hydratedItems, hydratedStructures] = await Promise.all([
    questDefinitionCache.hydrate(
      client,
      (user.userQuests ?? []).map((entry) => entry.quest),
    ),
    itemDefinitions.hydrate(
      client,
      items.flatMap((entry) => [
        entry.item,
        ...(entry.imbuements ?? []).map((imbuement) => imbuement.item),
      ]),
    ),
    structureDefinitions.hydrate(client, structures),
  ]);
  // One joined retry keeps definitions and live state in the same snapshot, even if
  // staff keep editing while this request reads a cold definition.
  if (!quests || !hydratedItems || !hydratedStructures)
    return findProfileUserWithDefinitions(client, userId, withProgressionReads);
  return {
    ...user,
    ...(user.userQuests && {
      userQuests: user.userQuests.map((entry) => ({
        ...entry,
        quest: quests(entry.quest),
      })),
    }),
    ...(user.items && {
      items: user.items.map((entry) => ({
        ...entry,
        item: hydratedItems(entry.item),
        ...(entry.imbuements && {
          imbuements: entry.imbuements.map((imbuement) => ({
            ...imbuement,
            item: hydratedItems(imbuement.item),
          })),
        }),
      })),
    }),
    ...(user.village?.structures && {
      village: {
        ...user.village,
        structures: user.village.structures.map(hydratedStructures),
      },
    }),
  } as ProfileRead;
};

/**
 * Village structure rows shared by profile and sector reads. Rows change with upgrades
 * and raids; each change is one read per village.
 */
export const structureDefinitions = createDefinitionCache<VillageStructure>({
  name: "village-structure",
  memoryLimit: 1000,
  select: (client, ids) => selectStructureDefinitions(client, ids),
});

/** The profile snapshot with complete definitions, shaped as the joined read. */
type ProfileRead = NonNullable<
  Awaited<ReturnType<typeof findProfileUserWithDefinitions>>
>;

/** The profile snapshot without the opt-in progression reads. */
type ProfileUser = Omit<ProfileRead, "questBootstrap" | "rolledBloodlineIds">;
