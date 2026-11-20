import superjson, { type SuperJSONResult } from "superjson";
import type { Quest } from "@/drizzle/schema";
import type { questRevisionColumns } from "@/queries/questRevisions";
import { selectQuestRevisionDefinitions } from "@/queries/questRevisions";
import type { DrizzleClient } from "@/server/db";
import { createRuntimeEntryCache } from "@/server/utils/runtimeCache";

/**
 * Resolve quest revisions, read with `questRevisionRelation` or `questRevisionColumns`,
 * to complete definitions.
 *
 * The revision hashes every column but the raid state, so any write to a definition
 * gives it a new key: a stored entry never changes and needs no invalidation. Raid state
 * changes during fights and is taken from the revision read. Definitions this instance
 * and the Runtime Cache lack are read in one statement and stored for other requests.
 * A definition changed or deleted since the revision read returns undefined, so the
 * caller can repeat its read with the joined definitions.
 */
export const resolveQuestRevisions = async (
  client: DrizzleClient,
  revisions: (QuestRevision | null)[],
): Promise<((revision: QuestRevision) => Quest) | undefined> => {
  const wanted = new Map<string, QuestRevision>();
  for (const revision of revisions)
    if (revision) wanted.set(definitionKey(revision), revision);
  const definitions = new Map<string, SuperJSONResult>();
  if (wanted.size > 0) {
    const stored = await sharedDefinitions.read([...wanted.keys()]);
    for (const [key, value] of stored) definitions.set(key, value);
    const missingIds = [...wanted]
      .filter(([key]) => !definitions.has(key))
      .map(([, revision]) => revision.id);
    if (missingIds.length > 0) {
      const rows = await selectQuestRevisionDefinitions(client, missingIds);
      const keys = rows.map(({ definition, revision }) =>
        definitionKey({ id: definition.id, revision }),
      );
      if (rows.length < missingIds.length || keys.some((key) => !wanted.has(key)))
        return undefined;
      await Promise.all(
        rows.map(({ definition }, index) => {
          const key = keys[index] as string;
          const value = superjson.serialize(definition);
          definitions.set(key, value);
          return sharedDefinitions.write(key, value);
        }),
      );
    }
  }
  return (revision) => {
    const { revision: _revision, ...raidState } = revision;
    const stored = definitions.get(definitionKey(revision)) as SuperJSONResult;
    // Each call decodes its own copy, so per-user rewrites stay private.
    return { ...superjson.deserialize<Quest>(stored), ...raidState };
  };
};

/**
 * Replace each history entry's quest revision with its complete definition. An entry
 * whose quest the read found deleted keeps a null quest, as a join would.
 */
export const withQuestDefinitions = async <
  Entry extends { quest: QuestRevision | null },
>(
  client: DrizzleClient,
  entries: Entry[],
): Promise<WithDefinition<Entry>[] | undefined> => {
  const resolve = await resolveQuestRevisions(
    client,
    entries.map((entry) => entry.quest),
  );
  return resolve
    ? entries.map(
        (entry) =>
          ({
            ...entry,
            quest: entry.quest ? resolve(entry.quest) : null,
          }) as WithDefinition<Entry>,
      )
    : undefined;
};

// The cache `fetchProfileUser` hydrates from, under its name, options and key format:
// every quest fits in memory. Keys name the deployment, whose schema shapes the rows, as
// `createRuntimeCache` payload keys do.
const sharedDefinitions = createRuntimeEntryCache<SuperJSONResult>({
  name: "quest-definition",
  ttlSeconds: 24 * 60 * 60,
  memoryLimit: 1000,
});

/** The shared entry key of one quest revision. */
const definitionKey = (quest: Pick<QuestRevision, "id" | "revision">) =>
  `${deploymentKey}:${quest.id}:${quest.revision}`;
const deploymentKey = process.env.VERCEL_DEPLOYMENT_ID ?? "local";

/** The quest columns a revision read returns. */
export type QuestRevision = Pick<
  Quest,
  Exclude<keyof typeof questRevisionColumns, "revision">
> & {
  revision: string;
};

/** A history entry carrying its complete quest definition. */
type WithDefinition<Entry extends { quest: QuestRevision | null }> = Omit<
  Entry,
  "quest"
> & { quest: null extends Entry["quest"] ? Quest | null : Quest };
