import { beforeEach, expect, it } from "bun:test";
import { actionLog, poll, pollOption, userData, userPollVote } from "@/drizzle/schema";
import { pollRouter } from "@/server/api/routers/poll";
import { insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const remove = async (userId: string, optionId = "option") =>
  (await callerFor(pollRouter, userId)).deletePollOption({ pollId: "poll", optionId });

describeWithDatabase("poll option deletion", () => {
  beforeEach(async () => {
    await resetTables(actionLog, userPollVote, pollOption, poll, userData);
    await insertUsers([
      { userId: "author", username: "Author", rank: "GENIN" },
      { userId: "voter", username: "Voter", rank: "GENIN" },
    ]);
    const db = await getTestDatabase();
    await db.insert(poll).values({
      id: "poll",
      title: "Poll",
      description: "A poll",
      createdByUserId: "author",
    });
    await db
      .insert(pollOption)
      .values({ id: "option", pollId: "poll", text: "Yes", createdByUserId: "author" });
    await db
      .insert(userPollVote)
      .values({ id: "vote", userId: "voter", pollId: "poll", optionId: "option" });
  });

  it("deletes an option with its votes for the option's creator", async () => {
    expect(await remove("author")).toEqual({
      success: true,
      message: "Poll option deleted successfully",
    });
    const db = await getTestDatabase();
    expect(await db.select().from(pollOption)).toEqual([]);
    expect(await db.select().from(userPollVote)).toEqual([]);
  });

  it("refuses other players and unknown options", async () => {
    expect(await remove("voter")).toEqual({
      success: false,
      message: "You don't have permission to delete this poll option",
    });
    expect(await remove("author", "missing")).toEqual({
      success: false,
      message: "Option not found",
    });
    expect(await (await getTestDatabase()).select().from(userPollVote)).toHaveLength(1);
  });
});
