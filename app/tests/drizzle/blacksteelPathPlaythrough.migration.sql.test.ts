import { beforeAll, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { inArray } from "drizzle-orm";
import { TERMINAL_DIALOG_PREFIX } from "@/drizzle/constants";
import { quest } from "@/drizzle/schema";
import { isQuestObjectiveAvailable } from "@/libs/objectives";
import { getNewTrackers } from "@/libs/quest";
import type { QuestTrackerType } from "@/validators/objectives";
import { trackerQuest, trackerUser } from "../setup/quest";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  runRawSql,
} from "../setup/testDatabase";

const migration = await readFile(
  new URL("../../drizzle/migrations/0198_tiny_rockslide.sql", import.meta.url),
  "utf8",
);
const questInserts = migration
  .split(/;\n/)
  .map((entry) => entry.replace(/^\s*--.*$/gm, "").trim())
  .filter((entry) => entry.startsWith("INSERT INTO `Quest`"));
const questIds = questInserts.map(
  (entry) => /VALUES \('([^']+)'/.exec(entry)?.[1] ?? "",
);

const VILLAGE = { sector: 177, village: { id: "v1", sector: 177 } };

type Objective = {
  id: string;
  task: string;
  value?: number;
  opponentAIs?: { ids: string[] }[];
  nextObjectiveId?: string | { nextObjectiveId?: string }[];
};
type Update = Parameters<typeof getNewTrackers>[1][number];

describeWithDatabase("Blacksteel Path play-through", () => {
  beforeAll(async () => {
    await resetTables(quest);
    for (const statement of questInserts) await runRawSql(statement);
  });

  it("creates every quest the migration writes", async () => {
    const database = await getTestDatabase();
    const rows = await database.query.quest.findMany({
      where: inArray(quest.id, questIds),
    });
    expect(rows.map((row) => row.id).sort()).toEqual([...questIds].sort());
  });

  it("can be finished by doing what each objective asks, in order", async () => {
    const database = await getTestDatabase();
    const rows = await database.query.quest.findMany({
      where: inArray(quest.id, questIds),
    });
    for (const row of rows) {
      const content = row.content as { objectives: Objective[] };
      const definition = trackerQuest(row.id, content.objectives, row.questType, {
        name: row.name,
        consecutiveObjectives: row.consecutiveObjectives,
        content: structuredClone(row.content),
      });
      let questData: QuestTrackerType[] = [];
      let position = { longitude: 0, latitude: 0, sector: VILLAGE.sector };
      let updates: Update[] = [];
      const state: Record<string, unknown> = {};
      const played: string[] = [];
      for (let turn = 0; turn < 60; turn++) {
        ({ trackers: questData } = getNewTrackers(
          trackerUser([definition], questData, {
            ...VILLAGE,
            ...position,
            ...state,
            status: "AWAKE",
          }),
          updates,
          {
            inWarTornSector: false,
            isWarParticipant: false,
            questBattleSource: { questId: row.id, objectiveId: played.at(-1) ?? "" },
          },
        ));
        const tracker = questData.find((entry) => entry.id === row.id);
        if (!tracker) throw new Error(`${row.name} has no tracker`);
        // Waiting out a timed pickup on the spot.
        for (const goal of tracker.goals) {
          if (goal.collectDeadline) goal.collectDeadline = new Date(0).toISOString();
          if (goal.timestamp) goal.timestamp = new Date(0).toISOString();
        }
        const next = content.objectives.findIndex(
          (objective, index) =>
            !tracker.goals.find((goal) => goal.id === objective.id)?.done &&
            isQuestObjectiveAvailable(definition as never, tracker, index),
        );
        if (next < 0) break;
        const objective = content.objectives[next]!;
        const goal = tracker.goals.find((entry) => entry.id === objective.id);
        played.push(objective.id);
        ({ updates, position } = act(objective, goal, position));
        Object.assign(state, stateAfter(objective));
      }
      const tracker = questData.find((entry) => entry.id === row.id);
      const open = content.objectives.filter(
        (objective, index) =>
          !tracker?.goals.find((goal) => goal.id === objective.id)?.done &&
          isQuestObjectiveAvailable(definition as never, tracker!, index),
      );
      expect(
        open.map((objective) => `${objective.id} (${objective.task})`),
        `${row.name} after ${played.join(" > ")}`,
      ).toEqual([]);
      if (row.consecutiveObjectives) {
        // A story chapter ends on its closing win, not on a branch left hanging.
        expect(played.length, row.name).toBeGreaterThan(0);
        const last = content.objectives.find(
          (objective) => objective.task === "win_quest",
        );
        if (last) {
          expect(
            tracker?.goals.find((goal) => goal.id === last.id)?.done,
            `${row.name} reaches ${last.id}`,
          ).toBe(true);
        }
      }
    }
  });
});

/** What doing this objective changes on the player, for goals read from their record. */
const stateAfter = (objective: Objective): Record<string, unknown> => {
  const missions = /^([a-z])_missions_total$/.exec(objective.task);
  if (missions) return { [`missions${missions[1]?.toUpperCase()}`]: objective.value };
  switch (objective.task) {
    case "errands_total":
      return { errands: objective.value };
    case "roll_element":
      return { primaryElement: "Fire" };
    case "choose_occupation":
      return { occupation: "HUNTER" };
    case "join_clan":
      return { clanId: "clan" };
    case "equip_item":
      return { items: [{ equipped: "CHEST" }] };
    case "job_contract_completed":
      return { craftingExperience: 1 };
    default:
      return {};
  }
};

/** The progress event the game sends when the player does what this objective asks. */
const act = (
  objective: Objective,
  goal: { sector?: number; longitude?: number; latitude?: number } | undefined,
  position: { longitude: number; latitude: number; sector: number },
): { updates: Update[]; position: typeof position } => {
  if (objective.task === "dialog") {
    const answers = Array.isArray(objective.nextObjectiveId)
      ? objective.nextObjectiveId
      : [];
    const contentId =
      answers[0]?.nextObjectiveId ?? `${TERMINAL_DIALOG_PREFIX}${objective.id}`;
    return { updates: [{ task: "dialog", contentId }], position };
  }
  if (objective.task === "defeat_opponents" || objective.task === "start_battle") {
    const opponents = (objective.opponentAIs ?? []).flatMap((entry) => entry.ids);
    return {
      updates: opponents.map((contentId) => ({
        task: objective.task as "defeat_opponents",
        contentId,
        text: "Won",
      })),
      position,
    };
  }
  if (objective.task === "move_to_location" || objective.task === "collect_item") {
    return {
      updates: [{ task: objective.task }],
      position: {
        sector: goal?.sector ?? position.sector,
        longitude: goal?.longitude ?? position.longitude,
        latitude: goal?.latitude ?? position.latitude,
      },
    };
  }
  if (objective.value !== undefined) {
    return {
      updates: [{ task: objective.task as "arena_kills", increment: objective.value }],
      position,
    };
  }
  return { updates: [{ task: "any" }], position };
};
