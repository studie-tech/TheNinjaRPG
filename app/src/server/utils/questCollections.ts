import { buildBloodlineCollectionProgress } from "@/libs/bloodline";
import { jutsuMasteryTypes } from "@/libs/jutsuMastery";
import { getUserQuests, objectiveContentIds } from "@/libs/quest";
import {
  fetchBloodlineCollectionRolls,
  fetchOwnedObjectiveJutsus,
  queryBloodlineCollectionCatalogue,
} from "@/queries/quests";
import type { UserWithRelations } from "@/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { queryInTransaction } from "@/server/utils/concurrency";
import { getFarmCollectionCount } from "@/server/utils/farming";
import { createRuntimeCache } from "@/server/utils/runtimeCache";
import type { AllObjectivesType } from "@/validators/objectives";

/**
 * Load collection and owned-jutsu snapshots only for unfinished goals of active quests.
 * @param inTransaction - Await queries in order on a shared PlanetScale transaction session.
 * @param preloaded - Independent reads from the profile's opening query wave; jutsu
 * targets it does not cover are read here. Transactions always read their own snapshot
 * on the transaction session instead.
 */
export const hydrateQuestCollections = async (
  client: DrizzleClient,
  user: NonNullable<UserWithRelations>,
  inTransaction = false,
  preloaded?: QuestCollectionSnapshot,
) => {
  const objectives = getUserQuests(user).flatMap((quest) =>
    quest.content.objectives.filter(
      (objective) =>
        !(user.questData ?? [])
          .find((tracker) => tracker.id === quest.id)
          ?.goals.find((goal) => goal.id === objective.id)?.done,
    ),
  );
  const hasFarming = objectives.some((o) => o.task === "farming_collection_log");
  const hasBloodlines = objectives.some((o) => o.task === "bloodline_collection");
  const objectiveJutsuIds = objectiveJutsuIdsOf(objectives);
  const snapshot = inTransaction ? undefined : preloaded;
  const unloadedJutsuIds = objectiveJutsuIds.filter(
    (id) => !snapshot?.objectiveJutsus?.jutsuIds.includes(id),
  );
  const queries = [
    hasFarming ? getFarmCollectionCount(client, user.userId, inTransaction) : undefined,
    hasBloodlines
      ? (snapshot?.catalogue ??
        (inTransaction
          ? queryBloodlineCollectionCatalogue(client)
          : fetchBloodlineCollectionCatalogue(client)))
      : undefined,
    hasBloodlines
      ? (snapshot?.rolls ?? fetchBloodlineCollectionRolls(client, user.userId))
      : undefined,
    unloadedJutsuIds.length > 0
      ? fetchOwnedObjectiveJutsus(client, user.userId, unloadedJutsuIds)
      : undefined,
  ] as const;
  const [farmingCollectionCount, catalogue, rolls, loadedJutsus] = inTransaction
    ? await queryInTransaction(queries)
    : await Promise.all(queries);
  const ownedJutsus =
    objectiveJutsuIds.length > 0
      ? [
          ...(snapshot?.objectiveJutsus?.owned.filter((entry) =>
            objectiveJutsuIds.includes(entry.jutsuId),
          ) ?? []),
          ...(loadedJutsus ?? []),
        ]
      : undefined;
  return {
    ...user,
    farmingCollectionCount,
    bloodlineCollectionProgress:
      catalogue && rolls
        ? buildBloodlineCollectionProgress(catalogue, [
            ...rolls.flatMap((roll) => (roll.bloodlineId ? [roll.bloodlineId] : [])),
            ...(user.bloodlineId ? [user.bloodlineId] : []),
          ])
        : undefined,
    ownedObjectiveJutsus: ownedJutsus?.map(({ jutsuId, jutsu }) => ({
      jutsuId,
      masteryTypes: jutsu ? jutsuMasteryTypes(jutsu) : [],
    })),
  };
};

// Bloodline editors invalidate the cache. Ownership is always read per caller.
const bloodlineCollectionCatalogue = createRuntimeCache({
  name: "bloodline-collection-catalogue",
  ttlSeconds: 60 * 60,
  load: queryBloodlineCollectionCatalogue,
});

/** The visible bloodline catalogue from the Runtime Cache. */
export const fetchBloodlineCollectionCatalogue = (client: DrizzleClient) =>
  bloodlineCollectionCatalogue.read(client);

/** Make every instance read the bloodline catalogue again; await after bloodline writes. */
export const invalidateBloodlineCollectionCatalogue =
  bloodlineCollectionCatalogue.invalidate;

/**
 * Read which `train_specific_jutsu` targets of the achievement catalogue the user owns.
 * It depends only on the catalogue, so it joins the profile's opening query wave.
 */
export const fetchAchievementObjectiveJutsus = async (
  client: DrizzleClient,
  userId: string,
  achievements: { content: { objectives: AllObjectivesType[] } }[],
) => {
  const jutsuIds = objectiveJutsuIdsOf(
    achievements.flatMap((achievement) => achievement.content.objectives),
  );
  const owned =
    jutsuIds.length > 0
      ? await fetchOwnedObjectiveJutsus(client, userId, jutsuIds)
      : [];
  return { jutsuIds, owned };
};

/** Distinct jutsu named by `train_specific_jutsu` objectives. */
const objectiveJutsuIdsOf = (objectives: AllObjectivesType[]) => [
  ...new Set(
    objectives
      .filter((objective) => objective.task === "train_specific_jutsu")
      .flatMap(objectiveContentIds),
  ),
];

type QuestCollectionSnapshot = {
  catalogue: Awaited<ReturnType<typeof fetchBloodlineCollectionCatalogue>>;
  rolls: Awaited<ReturnType<typeof fetchBloodlineCollectionRolls>>;
  objectiveJutsus?: Awaited<ReturnType<typeof fetchAchievementObjectiveJutsus>>;
};
