import type { Item, VillageStructure } from "@/drizzle/schema";
import {
  findProfileUserWithDefinitions,
  findUserDataForQueryUpdatedUser,
  selectItemDefinitions,
  selectStructureDefinitions,
} from "@/queries/profile";
import type { DrizzleClient } from "@/server/db";
import { createDefinitionCache } from "@/server/utils/definitionCache";
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
  const user = await findUserDataForQueryUpdatedUser(client, userId);
  if (!user) return undefined;
  // Snapshots read without a relation (partial clients) leave it as read.
  const items = user.items ?? [];
  const structures = user.village?.structures ?? [];
  const [quests, itemDefinitions, structureDefinitions] = await Promise.all([
    questDefinitionCache.hydrate(
      client,
      (user.userQuests ?? []).map((entry) => entry.quest),
    ),
    itemCache.hydrate(
      client,
      items.flatMap((entry) => [
        entry.item,
        ...(entry.imbuements ?? []).map((imbuement) => imbuement.item),
      ]),
    ),
    structureCache.hydrate(client, structures),
  ]);
  // One joined retry keeps definitions and live state in the same snapshot, even if
  // staff keep editing while this request reads a cold definition.
  if (!quests || !itemDefinitions || !structureDefinitions)
    return findProfileUserWithDefinitions(client, userId);
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
        item: itemDefinitions(entry.item),
        ...(entry.imbuements && {
          imbuements: entry.imbuements.map((imbuement) => ({
            ...imbuement,
            item: itemDefinitions(imbuement.item),
          })),
        }),
      })),
    }),
    ...(user.village?.structures && {
      village: {
        ...user.village,
        structures: user.village.structures.map(structureDefinitions),
      },
    }),
  } as ProfileUser;
};

const itemCache = createDefinitionCache<Item>({
  name: "item-definition",
  memoryLimit: 2000,
  select: (client, ids) => selectItemDefinitions(client, ids),
});

// Structure rows change with upgrades and raids; each change is one read per village.
const structureCache = createDefinitionCache<VillageStructure>({
  name: "village-structure",
  memoryLimit: 1000,
  select: (client, ids) => selectStructureDefinitions(client, ids),
});

/** The profile snapshot with complete definitions, shaped as the joined read. */
type ProfileUser = NonNullable<
  Awaited<ReturnType<typeof findProfileUserWithDefinitions>>
>;
