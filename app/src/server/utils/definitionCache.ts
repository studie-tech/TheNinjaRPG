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
  const pendingReads = new Map<
    string,
    Promise<Map<string, SuperJSONResult> | undefined>
  >();

  const readDefinitions = async (
    client: DrizzleClient,
    wanted: Map<string, Revision>,
  ) => {
    const definitions = await entries.read([...wanted.keys()]);
    const missing = [...wanted].filter(([key]) => !definitions.has(key));
    if (missing.length > 0) {
      const rows = await select(
        client,
        missing.map(([, revision]) => revision.id),
      );
      if (
        rows.length < missing.length ||
        rows.some(
          ({ definition, revision }) =>
            !wanted.has(entryKey({ id: definition.id, revision })),
        )
      )
        return undefined;
      await Promise.all(
        rows.map(({ definition, revision }) => {
          const key = entryKey({ id: definition.id, revision });
          const value = superjson.serialize(definition);
          definitions.set(key, value);
          return entries.write(key, value);
        }),
      );
    }
    return definitions;
  };

  return {
    /**
     * Resolve each revision a player read selected to its complete definition.
     *
     * Definitions this instance and the Runtime Cache lack are read in one statement and
     * stored for other requests. Concurrent reads of a revision share the pending lookup.
     * A relation the read found missing resolves to null, as
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
        const reads = new Set<Promise<Map<string, SuperJSONResult> | undefined>>();
        const fresh = new Map<string, Revision>();
        for (const [key, revision] of wanted) {
          const pending = pendingReads.get(key);
          if (pending) reads.add(pending);
          else fresh.set(key, revision);
        }
        if (fresh.size > 0) {
          // Reserve revisions before awaiting the cache, and keep new misses batched.
          const pending = readDefinitions(client, fresh).finally(() => {
            for (const key of fresh.keys()) pendingReads.delete(key);
          });
          for (const key of fresh.keys()) pendingReads.set(key, pending);
          reads.add(pending);
        }
        const results = await Promise.all(reads);
        for (const result of results) {
          if (!result) return undefined;
          for (const [key, value] of result) definitions.set(key, value);
        }
      }
      return ((revision: Live | null) => {
        const stored = revision && definitions.get(entryKey(revision));
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
