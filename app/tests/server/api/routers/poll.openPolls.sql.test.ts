import { beforeEach, expect, it } from "bun:test";
import { setImmediate } from "node:timers/promises";
import { actionLog, poll, pollOption, userData, userPollVote } from "@/drizzle/schema";
import { fetchHasUnvotedPolls } from "@/queries/profile";
import { pollRouter } from "@/routers/poll";
import { secondsFromNow } from "@/utils/time";
import { deferred } from "../../../setup/deferred";
import { insertUsers } from "../../../setup/factories";
import { aroundStatements, pollUntil } from "../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
  runRawSql,
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
    const later = await recordQueries(() =>
      fetchHasUnvotedPolls(database, "genin", secondsFromNow(120)),
    );
    expect(later.result).toEqual([]);
    expect(later.statements.filter((statement) => /`Poll`/.test(statement))).toEqual(
      [],
    );
  });

  it("awaits a committed poll's invalidation when its parallel audit insert fails", async () => {
    const database = await getTestDatabase();
    expect(await fetchHasUnvotedPolls(database, "genin", new Date())).toEqual([]);

    const pollInserted = deferred();
    const releasePoll = deferred();
    const auditFailed = deferred();
    const client = aroundStatements(
      aroundStatements(database, poll, async (run) => {
        const result = await run();
        pollInserted.resolve();
        await releasePoll.promise;
        return result;
      }),
      actionLog,
      async (run) => {
        await pollInserted.promise;
        try {
          return await run();
        } finally {
          auditFailed.resolve();
        }
      },
    );
    await runRawSql(
      "CREATE TRIGGER reject_poll_audit BEFORE INSERT ON ActionLog FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit unavailable'",
    );
    try {
      const editor = callerForDatabase(pollRouter, "editor", client);
      const outcome = editor
        .createPoll({
          title: "Fresh poll",
          description: "Pick one",
          options: [
            { type: "text", text: "A" },
            { type: "text", text: "B" },
          ],
          allowCustomOptions: false,
        })
        .catch((error: unknown) => error);
      try {
        await auditFailed.promise;
        expect(await Promise.race([outcome, setImmediate("pending")])).toBe("pending");
      } finally {
        releasePoll.resolve();
        await outcome;
        // Drain invalidation even when the pending-request assertion fails.
        expect(
          await pollUntil(
            async () =>
              (await fetchHasUnvotedPolls(database, "genin", new Date())).length === 1,
          ),
        ).toBe(true);
      }
      expect(await outcome).toBeInstanceOf(Error);
      const polls = await database.query.poll.findMany({
        where: (table, { eq }) => eq(table.title, "Fresh poll"),
      });
      expect(polls).toHaveLength(1);
      expect(polls[0]!.isActive).toBe(true);
      expect(await database.query.pollOption.findMany()).toHaveLength(2);
      expect(await database.query.actionLog.findMany()).toEqual([]);
      expect(await fetchHasUnvotedPolls(database, "genin", new Date())).toEqual([
        { id: polls[0]!.id },
      ]);
    } finally {
      await runRawSql("DROP TRIGGER reject_poll_audit");
    }
  });
});
