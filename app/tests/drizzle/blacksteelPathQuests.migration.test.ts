import { expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  TUTORIAL_GENIN_EXAM_QUEST_ID,
  TUTORIAL_STARTER_QUEST_ID,
} from "@/drizzle/constants";
import { GENIN_QUEST_OBJECTIVES } from "@/libs/tutorial";
import { AllObjectives } from "@/validators/objectives";

const migration = await readFile(
  new URL("../../drizzle/migrations/0193_foamy_jack_power.sql", import.meta.url),
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
