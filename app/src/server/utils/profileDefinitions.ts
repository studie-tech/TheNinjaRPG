import superjson, { type SuperJSONResult } from "superjson";
import type { Item, Quest, VillageStructure } from "@/drizzle/schema";
import {
  findProfileUserWithDefinitions,
  findUserDataForQueryUpdatedUser,
  selectItemDefinitions,
  selectQuestDefinitions,
  selectStructureDefinitions,
} from "@/queries/profile";
import type { DrizzleClient } from "@/server/db";
import { createRuntimeEntryCache } from "@/server/utils/runtimeCache";

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
    questCache.hydrate(
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

/**
 * Definitions of one table, keyed by id and content revision in the Runtime Cache.
 *
 * The revision hashes every column the definition holds, so any write to a definition
 * gives it a new key: a stored entry never changes and needs no invalidation. Columns
 * the snapshot reads live are taken from the snapshot.
 */
const createDefinitionCache = <Definition extends { id: string }>({
  name,
  memoryLimit,
  select,
}: {
  name: string;
  /** Every definition of the table fits in memory. */
  memoryLimit: number;
  select: (
    client: DrizzleClient,
    ids: string[],
  ) => Promise<{ definition: Definition; revision: string }[]>;
}) => {
  // Keys name the deployment, whose schema shapes the rows, as `createRuntimeCache`
  // payload keys do.
  const entries = createRuntimeEntryCache<SuperJSONResult>({
    name,
    ttlSeconds: 24 * 60 * 60,
    memoryLimit,
  });
  const entryKey = (revision: Revision) =>
    `${deploymentKey}:${revision.id}:${revision.revision}`;

  return {
    /**
     * Resolve each revision read with the snapshot to its complete definition.
     *
     * Definitions this instance and the Runtime Cache lack are read in one statement and
     * stored for other requests. A relation the snapshot read as missing resolves to
     * null, as a join would. A definition changed or deleted since the snapshot returns
     * undefined so the caller can retry the complete snapshot.
     */
    hydrate: async <Live extends Revision>(
      client: DrizzleClient,
      revisions: (Live | null)[],
    ): Promise<((revision: Live | null) => Definition | null) | undefined> => {
      const wanted = new Map<string, Revision>();
      for (const revision of revisions)
        if (revision) wanted.set(entryKey(revision), revision);
      const definitions = new Map<string, SuperJSONResult>();
      if (wanted.size > 0) {
        const stored = await entries.read([...wanted.keys()]);
        for (const [key, value] of stored)
          definitions.set(wanted.get(key)?.id ?? key, value);
        const missingIds = [...wanted.values()]
          .map((revision) => revision.id)
          .filter((id) => !definitions.has(id));
        if (missingIds.length > 0) {
          const rows = await select(client, missingIds);
          if (
            rows.length < missingIds.length ||
            rows.some(
              ({ definition, revision }) =>
                !wanted.has(entryKey({ id: definition.id, revision })),
            )
          )
            return undefined;
          await Promise.all(
            rows.map(({ definition, revision }) => {
              const value = superjson.serialize(definition);
              definitions.set(definition.id, value);
              return entries.write(entryKey({ id: definition.id, revision }), value);
            }),
          );
        }
      }
      return (revision) => {
        const stored = revision && definitions.get(revision.id);
        if (!revision || !stored) return null;
        const { revision: _revision, ...live } = revision;
        // Each use decodes its own copy, so per-user rewrites stay private.
        return { ...superjson.deserialize<Definition>(stored), ...live };
      };
    },
  };
};

const deploymentKey = process.env.VERCEL_DEPLOYMENT_ID ?? "local";

const questCache = createDefinitionCache<Quest>({
  name: "quest-definition",
  memoryLimit: 1000,
  select: (client, ids) => selectQuestDefinitions(client, ids),
});

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

/** The id and content hash a snapshot reads in place of a definition, with its live columns. */
type Revision = { id: string; revision: string };

/** The profile snapshot with complete definitions, shaped as the joined read. */
type ProfileUser = NonNullable<
  Awaited<ReturnType<typeof findProfileUserWithDefinitions>>
>;
