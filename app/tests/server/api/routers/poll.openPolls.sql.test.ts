import { beforeEach, expect, it } from "bun:test";
import { actionLog, poll, pollOption, userData, userPollVote } from "@/drizzle/schema";
import { fetchHasUnvotedPolls } from "@/queries/profile";
import { pollRouter } from "@/routers/poll";
import { secondsFromNow } from "@/utils/time";
import { insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

describeWithDatabase("unvoted poll alert", () => {
  beforeEach(async () => {
    await resetTables(actionLog, userPollVote, pollOption, poll, userData);
    await insertUsers([
      { userId: "editor", username: "Editor", rank: "JONIN", role: "CONTENT-ADMIN" },
      { userId: "genin", username: "Genin", rank: "GENIN" },
    ]);
    const database = await getTestDatabase();
    await database.insert(poll).values({
      id: "ended-poll",
      title: "Ended",
      description: "Ended",
      createdByUserId: "editor",
      endDate: secondsFromNow(-60),
    });
  });

  it("follows polls opened, closed and reopened through the router", async () => {
    const database = await getTestDatabase();
    const unvoted = () => fetchHasUnvotedPolls(database, "genin", new Date());
    const editor = await callerFor(pollRouter, "editor");

    // The cached listing now holds no open poll.
    expect(await unvoted()).toEqual([]);

    const created = await editor.createPoll({
      title: "Fresh poll",
      description: "Pick one",
      options: [
        { type: "text", text: "A" },
        { type: "text", text: "B" },
      ],
      allowCustomOptions: false,
    });
    expect(created.success).toBe(true);
    const [fresh] = await database.query.poll.findMany({
      where: (table, { eq }) => eq(table.title, "Fresh poll"),
    });
    expect(await unvoted()).toEqual([{ id: fresh!.id }]);

    await editor.closePoll({ id: fresh!.id, isActive: false });
    expect(await unvoted()).toEqual([]);

    await editor.updatePoll({ id: fresh!.id, isActive: true });
    expect(await unvoted()).toEqual([{ id: fresh!.id }]);

    const [option] = await database.query.pollOption.findMany({
      where: (table, { eq }) => eq(table.pollId, fresh!.id),
    });
    await (await callerFor(pollRouter, "genin")).vote({
      pollId: fresh!.id,
      optionId: option!.id,
    });
    expect(await unvoted()).toEqual([]);
  });

  it("treats a cached poll whose end date has passed as closed", async () => {
    const database = await getTestDatabase();
    await database.insert(poll).values({
      id: "ending-poll",
      title: "Ending",
      description: "Ending",
      createdByUserId: "editor",
      endDate: secondsFromNow(60),
    });

    expect(await fetchHasUnvotedPolls(database, "genin", new Date())).toEqual([
      { id: "ending-poll" },
    ]);
    expect(await fetchHasUnvotedPolls(database, "genin", secondsFromNow(120))).toEqual(
      [],
    );
  });
});
