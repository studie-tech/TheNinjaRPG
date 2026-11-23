import { beforeEach, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { TUTORIAL_STARTER_QUEST_ID } from "@/drizzle/constants";
import { userData } from "@/drizzle/schema";
import { STARTER_QUEST_OBJECTIVES } from "@/libs/tutorial";
import { QuestTracker } from "@/validators/objectives";
import { insertUsers } from "../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  runRawSql,
} from "../setup/testDatabase";

const migration = await readFile(
  new URL("../../drizzle/migrations/0194_faithful_diamondback.sql", import.meta.url),
  "utf8",
);
const statement = migration
  .split(/;\n/)
  .find((entry) => entry.includes('"selectedNextObjectiveId": "tArna"'))
  ?.replace(/^\s*--.*$/gm, "");
const O = STARTER_QUEST_OBJECTIVES;
/** The arena objective the trials used to start with. */
const FORMER_ARENA = "tArna";

const student = (userId: string, goals: object[]) => ({
  userId,
  earnedExperience: 100,
  questData: [QuestTracker.parse({ id: TUTORIAL_STARTER_QUEST_ID, goals })],
});

const read = async (userId: string) => {
  const row = await (await getTestDatabase()).query.userData.findFirst({
    where: eq(userData.userId, userId),
  });
  const goals = row?.questData?.[0]?.goals ?? [];
  return {
    earnedExperience: row?.earnedExperience,
    next: goals.find((goal) => goal.id === O.stand)?.selectedNextObjectiveId,
  };
};

describeWithDatabase("moving the arena trial behind the first jutsu", () => {
  beforeEach(async () => {
    await resetTables(userData);
    const answered = { id: O.stand, done: true, selectedNextObjectiveId: FORMER_ARENA };
    await insertUsers([
      student("fighting", [answered, { id: FORMER_ARENA }]),
      student("unclaimed", [
        answered,
        {
          id: FORMER_ARENA,
          done: true,
          value: 1,
          collected: false,
          selectedNextObjectiveId: O.jutsu,
        },
      ]),
      student("claimed", [
        answered,
        {
          id: FORMER_ARENA,
          done: true,
          value: 1,
          collected: true,
          selectedNextObjectiveId: O.jutsu,
        },
        { id: O.jutsu },
      ]),
      student("new", [{ id: O.stand }]),
    ]);
    if (!statement) throw new Error("expected the arena trial statement");
    await runRawSql(statement);
    // A partial run can be repeated.
    await runRawSql(statement);
  });

  it("leads every student past the former objective on to their jutsu", async () => {
    for (const id of ["fighting", "unclaimed", "claimed"])
      expect((await read(id)).next).toBe(O.jutsu);
    expect((await read("new")).next).toBeUndefined();
  });

  it("pays the experience the former objective still owed, once", async () => {
    expect((await read("fighting")).earnedExperience).toBe(600);
    expect((await read("unclaimed")).earnedExperience).toBe(600);
    expect((await read("claimed")).earnedExperience).toBe(100);
    expect((await read("new")).earnedExperience).toBe(100);
  });
});
