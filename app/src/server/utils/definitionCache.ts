import superjson, { type SuperJSONResult } from "superjson";
import type { Bloodline, Item, Jutsu } from "@/drizzle/schema";
import { selectItemDefinitions } from "@/queries/item";
import { selectBloodlineDefinitions, selectJutsuDefinitions } from "@/queries/jutsu";
import type { DrizzleClient } from "@/server/db";
import { createRuntimeEntryCache } from "@/server/utils/runtimeCache";

/**
 * Item definitions of inventory reads. The Runtime Cache name and keys match the profile
 * read's item definitions, so both share stored entries.
 */
export const itemDefinitions = createDefinitionCache<Item>({
  name: "item-definition",
  memoryLimit: 2000,
  select: (client, ids) => selectItemDefinitions(client, ids),
});

/** Jutsu definitions of jutsu list reads. */
export const jutsuDefinitions = createDefinitionCache<Jutsu>({
  name: "jutsu-definition",
  memoryLimit: 4000,
  select: (client, ids) => selectJutsuDefinitions(client, ids),
});

/** Bloodline definitions attached to bloodline jutsu in jutsu list reads. */
export const bloodlineDefinitions = createDefinitionCache<Bloodline>({
  name: "bloodline-definition",
  memoryLimit: 1000,
  select: (client, ids) => selectBloodlineDefinitions(client, ids),
});

/**
 * Definitions of one table, keyed by id and content revision in the Runtime Cache.
 *
 * The revision hashes every column the definition holds, so any write to a definition
 * gives it a new key: a stored entry never changes and needs no invalidation. Columns
 * the player read selects next to the revision are taken from that read.
 */
export function createDefinitionCache<Definition extends { id: string }>({
  name,
  memoryLimit,
  select,
}: {
  /** Runtime Cache name: letters, digits and dashes. */
  name: string;
  /** Every definition of the table fits in memory. */
  memoryLimit: number;
  select: (
    client: DrizzleClient,
    ids: string[],
  ) => Promise<{ definition: Definition; revision: string }[]>;
}) {
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
     * Resolve each revision a player read selected to its complete definition.
     *
     * Definitions this instance and the Runtime Cache lack are read in one statement and
     * stored for other requests. A relation the read found missing resolves to null, as
     * a join would; every revision it found resolves. A definition changed or deleted
     * since the read returns undefined, so the caller can repeat it with joined
     * definitions.
     */
    hydrate: async <Live extends Revision>(
      client: DrizzleClient,
      revisions: (Live | null)[],
    ): Promise<Resolve<Definition, Live> | undefined> => {
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
      return ((revision: Live | null) => {
        const stored = revision && definitions.get(revision.id);
        if (!revision || !stored) return null;
        const { revision: _revision, ...live } = revision;
        // Each use decodes its own copy, so per-user rewrites stay private.
        return { ...superjson.deserialize<Definition>(stored), ...live };
      }) as Resolve<Definition, Live>;
    },
  };
}

const deploymentKey = process.env.VERCEL_DEPLOYMENT_ID ?? "local";

/** The id and content hash a player read selects in place of a definition. */
type Revision = { id: string; revision: string };

/** The complete definition of a revision, with the columns read next to it. */
type Resolve<Definition, Live extends Revision> = <Read extends Live | null>(
  revision: Read,
) => Read extends Live ? Definition & Omit<Read, "revision"> : null;
