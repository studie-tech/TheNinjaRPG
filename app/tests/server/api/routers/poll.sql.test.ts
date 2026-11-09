import { beforeEach, expect, it } from "bun:test";
import { actionLog, poll, pollOption, userData } from "@/drizzle/schema";
import { pollRouter } from "@/routers/poll";
import { insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

describeWithDatabase("poll custom options", () => {
  beforeEach(async () => {
    await resetTables(actionLog, pollOption, poll, userData);
    await insertUsers([
      { userId: "student", username: "Student", rank: "STUDENT" },
      { userId: "genin", username: "Genin", rank: "GENIN" },
    ]);
    const database = await getTestDatabase();
    await database.insert(poll).values({
      id: "open-poll",
      title: "Open",
      description: "Open",
      createdByUserId: "genin",
      allowCustomOptions: true,
    });
  });

  it("requires the same rank as voting", async () => {
    const database = await getTestDatabase();
    const input = { pollId: "open-poll", text: "Mine", type: "text" as const };

    const refused = await (await callerFor(pollRouter, "student")).addOption(input);

    expect(refused).toEqual({
      success: false,
      message: "Too low rank to use polls. Must be at least Genin.",
    });
    expect(await database.query.pollOption.findMany()).toEqual([]);
    expect(await database.query.actionLog.findMany()).toEqual([]);

    const added = await (await callerFor(pollRouter, "genin")).addOption(input);

    expect(added.success).toBe(true);
    expect(await database.query.pollOption.findMany()).toMatchObject([
      { text: "Mine" },
    ]);
  });
});
