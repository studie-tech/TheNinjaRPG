import { describe, expect, it, mock } from "bun:test";
import { fetchBloodlineCollectionRolls } from "@/queries/quests";
import type { DrizzleClient } from "@/server/db";
import { withRequestScope } from "@/server/requestScope";
import {
  fetchBloodlineCollectionCatalogue,
  hydrateQuestCollections,
} from "@/server/utils/questCollections";

const catalogue = [
  { id: "rolled", rank: "D", hidden: false },
  { id: "equipped", rank: "D", hidden: false },
  { id: "missing", rank: "C", hidden: false },
] as const;
const rolls = [{ bloodlineId: "rolled" }, { bloodlineId: "rolled" }];

const userWithCollection = () =>
  ({
    userId: "collection-user",
    role: "USER",
    level: 50,
    rank: "JONIN",
    bloodlineId: "equipped",
    medicalExperience: 0,
    huntingExperience: 0,
    gatheringExperience: 0,
    completedQuests: [],
    questData: [],
    userQuests: [
      {
        id: "history",
        questId: "collection-quest",
        completed: 0,
        quest: {
          id: "collection-quest",
          questType: "achievement",
          hidden: false,
          retryDelay: "none",
          content: {
            objectives: [{ id: "collection-goal", task: "bloodline_collection" }],
            reward: {},
          },
        },
      },
    ],
  }) as unknown as Parameters<typeof hydrateQuestCollections>[1];

const database = () => {
  const findCatalogue = mock(async () => structuredClone(catalogue));
  const findRolls = mock(async () => structuredClone(rolls));
  const client = {
    query: {
      bloodline: { findMany: findCatalogue },
      bloodlineRolls: { findMany: findRolls },
    },
  } as unknown as DrizzleClient;
  return { client, findCatalogue, findRolls };
};

describe("quest collection snapshots", () => {
  it("uses preloaded rows without more reads and still counts the equipped bloodline", async () => {
    const { client, findCatalogue, findRolls } = database();
    const snapshot = { catalogue: [...catalogue], rolls };
    const result = await hydrateQuestCollections(
      client,
      userWithCollection(),
      false,
      snapshot,
    );

    expect(result.bloodlineCollectionProgress).toContainEqual({
      rank: "D",
      collected: 2,
      total: 2,
    });
    expect(result.bloodlineCollectionProgress).toContainEqual({
      rank: "C",
      collected: 0,
      total: 1,
    });
    expect(findCatalogue).not.toHaveBeenCalled();
    expect(findRolls).not.toHaveBeenCalled();
    expect(snapshot.rolls).toEqual(rolls);
  });

  it("retains the lazy fallback for callers without a snapshot", async () => {
    const { client, findCatalogue, findRolls } = database();
    const result = await hydrateQuestCollections(client, userWithCollection());
    expect(result.bloodlineCollectionProgress).toContainEqual({
      rank: "D",
      collected: 2,
      total: 2,
    });
    expect(findCatalogue).toHaveBeenCalledTimes(1);
    expect(findRolls).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    "skips completed collection goals (preloaded=%s)",
    async (preloaded) => {
      const { client, findCatalogue, findRolls } = database();
      const user = userWithCollection();
      user.questData = [
        { id: "collection-quest", goals: [{ id: "collection-goal", done: true }] },
      ] as never;
      const result = await hydrateQuestCollections(
        client,
        user,
        false,
        preloaded ? { catalogue: [...catalogue], rolls } : undefined,
      );
      expect(result.bloodlineCollectionProgress).toBeUndefined();
      expect(findCatalogue).not.toHaveBeenCalled();
      expect(findRolls).not.toHaveBeenCalled();
    },
  );

  it("treats an empty preloaded snapshot as loaded", async () => {
    const { client, findCatalogue, findRolls } = database();
    const result = await hydrateQuestCollections(client, userWithCollection(), false, {
      catalogue: [],
      rolls: [],
    });
    expect(result.bloodlineCollectionProgress?.every((rank) => rank.total === 0)).toBe(
      true,
    );
    expect(findCatalogue).not.toHaveBeenCalled();
    expect(findRolls).not.toHaveBeenCalled();
  });

  it("shares only the catalogue within a request and gives callers independent copies", async () => {
    const { client, findCatalogue, findRolls } = database();
    await withRequestScope(async () => {
      const [first, second] = await Promise.all([
        fetchBloodlineCollectionCatalogue(client),
        fetchBloodlineCollectionCatalogue(client),
      ]);
      expect(first).toEqual(second);
      expect(first).not.toBe(second);
      first.splice(0);
      expect(await fetchBloodlineCollectionCatalogue(client)).toEqual([...catalogue]);
      await fetchBloodlineCollectionRolls(client, "collection-user");
      await fetchBloodlineCollectionRolls(client, "collection-user");
    });
    expect(findCatalogue).toHaveBeenCalledTimes(1);
    expect(findRolls).toHaveBeenCalledTimes(2);
  });

  it("reads the transaction session sequentially, bypassing preloaded and memoized rows", async () => {
    const events: string[] = [];
    const lazyQuery = <T>(name: string, rows: T) => ({
      then(resolve: (value: T) => void) {
        events.push(`${name}:start`);
        queueMicrotask(() => {
          events.push(`${name}:end`);
          resolve(rows);
        });
      },
    });
    const { client } = database();
    const transaction = {
      query: {
        bloodline: { findMany: () => lazyQuery("catalogue", [...catalogue]) },
        bloodlineRolls: { findMany: () => lazyQuery("rolls", []) },
      },
    } as unknown as DrizzleClient;
    await withRequestScope(async () => {
      await fetchBloodlineCollectionCatalogue(client);
      const result = await hydrateQuestCollections(
        transaction,
        userWithCollection(),
        true,
        {
          catalogue: [],
          rolls,
        },
      );
      expect(result.bloodlineCollectionProgress).toContainEqual({
        rank: "D",
        collected: 1,
        total: 2,
      });
    });
    expect(events).toEqual([
      "catalogue:start",
      "catalogue:end",
      "rolls:start",
      "rolls:end",
    ]);
  });

  describe("owned objective jutsu", () => {
    const userWithObjective = (trainJutsuIds: string[], done = false) =>
      ({
        ...userWithCollection(),
        questData: [{ id: "jutsu-quest", goals: [{ id: "learn", done }] }],
        userQuests: [
          {
            id: "history",
            questId: "jutsu-quest",
            completed: 0,
            quest: {
              id: "jutsu-quest",
              questType: "starter",
              hidden: false,
              retryDelay: "none",
              content: {
                objectives: [
                  { id: "learn", task: "train_specific_jutsu", trainJutsuIds },
                ],
                reward: {},
              },
            },
          },
        ],
      }) as unknown as Parameters<typeof hydrateQuestCollections>[1];
    const jutsuDatabase = () => {
      const findOwned = mock(async () => [
        { jutsuId: "listed", jutsu: { statClassification: "Ninjutsu" } },
      ]);
      const client = { query: { userJutsu: { findMany: findOwned } } };
      return { client: client as unknown as DrizzleClient, findOwned };
    };

    it("reads ownership for an unfinished objective, disciplines included", async () => {
      const { client, findOwned } = jutsuDatabase();
      const result = await hydrateQuestCollections(
        client,
        userWithObjective(["listed"]),
      );
      expect(findOwned).toHaveBeenCalledTimes(1);
      expect(result.ownedObjectiveJutsus).toEqual([
        { jutsuId: "listed", masteryTypes: ["Ninjutsu"] },
      ]);
    });

    it("costs nothing once done, or for mastery objectives without a jutsu list", async () => {
      const { client, findOwned } = jutsuDatabase();
      const done = await hydrateQuestCollections(
        client,
        userWithObjective(["listed"], true),
      );
      const unlisted = await hydrateQuestCollections(client, userWithObjective([]));
      expect(findOwned).not.toHaveBeenCalled();
      expect(done.ownedObjectiveJutsus).toBeUndefined();
      expect(unlisted.ownedObjectiveJutsus).toBeUndefined();
    });
  });
});
