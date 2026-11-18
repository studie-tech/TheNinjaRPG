import superjson, { type SuperJSONResult } from "superjson";
import type { Quest } from "@/drizzle/schema";
import {
  findUserDataForQueryUpdatedUser,
  selectQuestDefinitions,
} from "@/queries/profile";
import type { DrizzleClient } from "@/server/db";
import { createRuntimeEntryCache } from "@/server/utils/runtimeCache";

/**
 * Load the profile snapshot with complete definitions for its quest history.
 *
 * The snapshot query reads only each quest's revision and raid state; the definitions
 * come from `hydrateQuestDefinitions`, so the result keeps the shape of a full join.
 */
export const fetchProfileUser = async (
  client: DrizzleClient,
  userId: string,
): Promise<ProfileUser | undefined> => {
  const user = await findUserDataForQueryUpdatedUser(client, userId);
  // A snapshot read without its history has nothing to hydrate.
  if (!user?.userQuests) return user as ProfileUser | undefined;
  return {
    ...user,
    userQuests: await hydrateQuestDefinitions(client, user.userQuests),
  };
};

/**
 * Replace each history entry's quest revision with its complete definition.
 *
 * Content edits move `Quest.updatedAt`, so an entry stored under a quest's id and
 * revision never changes and needs no invalidation. Raid state changes without a new
 * revision and is taken from the revision columns. Definitions this instance and the
 * Runtime Cache lack are read in one statement and stored for other requests. A quest
 * deleted since the snapshot leaves its entry without a definition, as a join would.
 */
const hydrateQuestDefinitions = async <Entry extends { quest: QuestRevision | null }>(
  client: DrizzleClient,
  entries: Entry[],
): Promise<WithDefinition<Entry>[]> => {
  const revisions = new Map<string, QuestRevision>();
  for (const { quest } of entries)
    if (quest) revisions.set(definitionKey(quest), quest);
  const definitions = new Map<string, SuperJSONResult>();
  if (revisions.size > 0) {
    const stored = await sharedDefinitions.read([...revisions.keys()]);
    for (const [key, value] of stored)
      definitions.set(revisions.get(key)?.id ?? key, value);
    const missingIds = [...revisions.values()]
      .map((revision) => revision.id)
      .filter((id) => !definitions.has(id));
    if (missingIds.length > 0) {
      const rows = await selectQuestDefinitions(client, missingIds);
      await Promise.all(
        rows.map((row) => {
          const value = superjson.serialize(row);
          definitions.set(row.id, value);
          return sharedDefinitions.write(definitionKey(row), value);
        }),
      );
    }
  }
  return entries.map((entry) => {
    const stored = entry.quest && definitions.get(entry.quest.id);
    if (!entry.quest || !stored)
      return { ...entry, quest: null } as unknown as WithDefinition<Entry>;
    const { id: _id, updatedAt: _updatedAt, ...raidState } = entry.quest;
    // Each entry decodes its own copy, so per-user rewrites stay private.
    return {
      ...entry,
      quest: { ...superjson.deserialize<Quest>(stored), ...raidState },
    } as WithDefinition<Entry>;
  });
};

// Every quest fits in memory. Keys name the deployment, whose schema shapes the rows, as
// `createRuntimeCache` payload keys do.
const sharedDefinitions = createRuntimeEntryCache<SuperJSONResult>({
  name: "quest-definition",
  ttlSeconds: 24 * 60 * 60,
  memoryLimit: 1000,
});

/** The shared entry key of one quest revision. */
const definitionKey = (quest: Pick<Quest, "id" | "updatedAt">) =>
  `${deploymentKey}:${quest.id}:${quest.updatedAt.getTime()}`;
const deploymentKey = process.env.VERCEL_DEPLOYMENT_ID ?? "local";

/** The quest columns `findUserDataForQueryUpdatedUser` reads with each history entry. */
type QuestRevision = Pick<
  Quest,
  | "id"
  | "updatedAt"
  | "raidBossCurrentHealth"
  | "raidStartedAt"
  | "raidEndsAt"
  | "raidCaptureDeadline"
  | "raidGracePeriodEnd"
>;

/** A history entry carrying its complete quest definition. */
type WithDefinition<Entry extends { quest: QuestRevision | null }> = Omit<
  Entry,
  "quest"
> & { quest: null extends Entry["quest"] ? Quest | null : Quest };

/** The profile snapshot with complete definitions for its quest history. */
type ProfileUser = Omit<ProfileSnapshot, "userQuests"> & {
  userQuests: WithDefinition<ProfileSnapshot["userQuests"][number]>[];
};
type ProfileSnapshot = NonNullable<
  Awaited<ReturnType<typeof findUserDataForQueryUpdatedUser>>
>;
