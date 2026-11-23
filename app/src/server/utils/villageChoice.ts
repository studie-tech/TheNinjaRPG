import {
  getDialogVillageMembership,
  getFullVillageIds,
  villageFullMessage,
} from "@/libs/villageChoice";
import { fetchVillages } from "@/queries/village";
import type { DrizzleClient } from "@/server/db";
import { fetchVillageActivity } from "@/server/utils/caches/villageActivity";
import type { QuestContentType } from "@/validators/objectives";

/**
 * The villages a new Genin can join, each marked full when it is not taking new Genin
 * and `needsShinobi` on the open village with the fewest players active this week.
 */
export const fetchVillageChoices = async (client: DrizzleClient) => {
  const [villages, activity] = await Promise.all([
    fetchVillages(client),
    fetchVillageActivity(client),
  ]);
  const joinable = villages
    .filter((entry) => entry.type === "VILLAGE" && entry.joinable)
    .map((entry) => ({
      village: entry,
      players: activity.find((row) => row.villageId === entry.id)?.players ?? 0,
    }));
  const fullIds = getFullVillageIds(
    joinable.map(({ village, players }) => ({ id: village.id, players })),
  );
  const quietestId = joinable.reduce<(typeof joinable)[number] | undefined>(
    (quietest, entry) =>
      !quietest || entry.players < quietest.players ? entry : quietest,
    undefined,
  )?.village.id;
  return joinable.map(({ village }) => ({
    name: village.name,
    villageGraphic: village.villageGraphic,
    hexColor: village.hexColor,
    isFull: fullIds.has(village.id),
    needsShinobi: village.id === quietestId,
  }));
};

/**
 * Why a dialog answer may not be taken: the answer leads into an objective that grants
 * membership of a village that is full. Reads the villages only for such an answer.
 */
export const getVillageChoiceBlock = async (
  client: DrizzleClient,
  content: Pick<QuestContentType, "objectives"> | undefined,
  nextObjectiveId: string | undefined,
) => {
  const membership =
    nextObjectiveId && getDialogVillageMembership(content, nextObjectiveId);
  if (!membership) return undefined;
  const choices = await fetchVillageChoices(client);
  const chosen = choices.find((entry) => entry.name.toUpperCase() === membership);
  return chosen?.isFull ? villageFullMessage(chosen.name) : undefined;
};
