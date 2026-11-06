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
import { scopedRead } from "@/server/requestScope";
import { queryInTransaction } from "@/server/utils/concurrency";
import { getFarmCollectionCount } from "@/server/utils/farming";

/**
 * Load collection and owned-jutsu snapshots only for unfinished goals of active quests.
 * @param inTransaction - Await queries in order on a shared PlanetScale transaction session.
 * @param preloaded - Independent reads from the profile's opening query wave. Transactions
 * always read their own snapshot on the transaction session instead.
 */
export const hydrateQuestCollections = async (
  client: DrizzleClient,
  user: NonNullable<UserWithRelations>,
  inTransaction = false,
  preloaded?: BloodlineCollectionSnapshot,
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
  const objectiveJutsuIds = [
    ...new Set(
      objectives
        .filter((objective) => objective.task === "train_specific_jutsu")
        .flatMap(objectiveContentIds),
    ),
  ];
  const snapshot = inTransaction ? undefined : preloaded;
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
    objectiveJutsuIds.length > 0
      ? fetchOwnedObjectiveJutsus(client, user.userId, objectiveJutsuIds)
      : undefined,
  ] as const;
  const [farmingCollectionCount, catalogue, rolls, ownedJutsus] = inTransaction
    ? await queryInTransaction(queries)
    : await Promise.all(queries);
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

/** The visible catalogue is shared within a request; ownership is always read per caller. */
export const fetchBloodlineCollectionCatalogue = (client: DrizzleClient) =>
  scopedRead("bloodlineCollectionCatalogue", () =>
    queryBloodlineCollectionCatalogue(client),
  );

type BloodlineCollectionSnapshot = {
  catalogue: Awaited<ReturnType<typeof fetchBloodlineCollectionCatalogue>>;
  rolls: Awaited<ReturnType<typeof fetchBloodlineCollectionRolls>>;
};
