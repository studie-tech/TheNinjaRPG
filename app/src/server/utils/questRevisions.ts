import type { Quest } from "@/drizzle/schema";
import type { questRevisionColumns } from "@/queries/questRevisions";
import type { DrizzleClient } from "@/server/db";
import { questDefinitions } from "@/server/utils/caches/questDefinitions";

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
  const resolve = await questDefinitions.hydrate(client, revisions);
  return resolve && ((revision) => resolve(revision) as Quest);
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
