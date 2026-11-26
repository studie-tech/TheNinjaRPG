import { expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  BLACKSTEEL_DOUBLE_AI_ID,
  TUTORIAL_GENIN_EXAM_QUEST_ID,
  TUTORIAL_STARTER_QUEST_ID,
  TUTORIAL_STEPS_COUNT,
} from "@/drizzle/constants";
import { GENIN_QUEST_OBJECTIVES, STARTER_QUEST_OBJECTIVES } from "@/libs/tutorial";
import { AllObjectives } from "@/validators/objectives";

const migration = await readFile(
  new URL("../../drizzle/migrations/0195_broken_squadron_supreme.sql", import.meta.url),
  "utf8",
);

/** The quest content a `CAST('…' AS JSON)` update writes for one quest id. */
const questContent = (questId: string) => {
  const statement = migration
    .split(/;\n/)
    .find((entry) => entry.includes(`WHERE \`id\` = '${questId}'`));
  const literal = statement?.match(/CAST\('((?:[^']|'')*)' AS JSON\)/)?.[1];
  if (!literal) throw new Error(`No content update for quest ${questId}`);
  return z
    .object({ objectives: z.array(AllObjectives) })
    .parse(JSON.parse(literal.replaceAll("''", "'")));
};

const starter = questContent(TUTORIAL_STARTER_QUEST_ID);
const exam = questContent(TUTORIAL_GENIN_EXAM_QUEST_ID);

it("gives each objective its own reward line", () => {
  // A claim collects every finished objective at once, so a line shared between
  // objectives, or a reward without its own line, reads as belonging to another one.
  for (const { objectives } of [starter, exam]) {
    const lines = objectives.flatMap((objective) =>
      objective.successDescription ? [objective.successDescription] : [],
    );
    expect(new Set(lines).size).toBe(lines.length);
  }
});

it("thanks the player for reaching level 5, not for the clone fight", () => {
  const byId = (id: string) => exam.objectives.find((objective) => objective.id === id);
  const level = byId(GENIN_QUEST_OBJECTIVES.level);
  expect(level?.reward_exp).toBeGreaterThan(0);
  expect(level?.successDescription).toBe(
    "Level 5 reached: you may now sit the Genin exam.",
  );
  expect(byId(GENIN_QUEST_OBJECTIVES.proctor)?.successDescription).toContain(
    "The clone bursts into smoke",
  );
});

it("calls the rescued companion a pup", () => {
  const text = starter.objectives
    .map((objective) => `${objective.description} ${objective.successDescription}`)
    .join(" ");
  expect(text).toContain("pup");
  expect(text).not.toMatch(/hound/i);
});

it("chains the Academy Trials in the order the tutorial walks them", () => {
  const order = Object.values(STARTER_QUEST_OBJECTIVES);
  const ids = starter.objectives.map((objective) => objective.id);
  expect(ids).toEqual([...order]);
  starter.objectives.slice(0, -1).forEach((objective, index) => {
    const next = objective.nextObjectiveId;
    expect(
      Array.isArray(next) ? next.map((answer) => answer.nextObjectiveId) : [next],
    ).toEqual([ids[index + 1]]);
  });
});

it("opens with a fight a new student retries at full health, without the hospital", () => {
  const double = starter.objectives.find(
    (objective) => objective.id === STARTER_QUEST_OBJECTIVES.double,
  );
  expect(double).toEqual(
    expect.objectContaining({
      task: "start_battle",
      completionOutcome: "Win",
      keepOriginalPools: true,
      givePools: 100,
      opponentAIs: [expect.objectContaining({ ids: [BLACKSTEEL_DOUBLE_AI_ID] })],
    }),
  );
});

it("moves every saved step to one the tutorial has, or past its end", () => {
  const cases = [...migration.matchAll(/WHEN \d+ THEN (\d+)/g)].map((match) =>
    Number(match[1]),
  );
  expect(cases.length).toBe(49);
  expect(Math.max(...cases)).toBe(TUTORIAL_STEPS_COUNT);
  expect(Math.min(...cases)).toBe(0);
});
