import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { userVote } from "@/drizzle/schema";
import {
  updateUserVoteForGET,
  updateUserVoteForHandleVote,
  updateUserVoteForTopRankinGames,
} from "@/queries/profile";
import { insertUserVotes } from "../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../setup/testDatabase";

const readVote = async () =>
  (await getTestDatabase()).query.userVote.findFirst({
    where: eq(userVote.userId, "voter"),
  });

describeWithDatabase("TopRankinGames vote recording", () => {
  beforeEach(async () => {
    await resetTables(userVote);
    await insertUserVotes([{ userId: "voter", secret: "vote-token" }]);
  });

  it("records concurrent duplicate deliveries only once", async () => {
    const database = await getTestDatabase();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        updateUserVoteForTopRankinGames(database, "vote-token", "123", new Date()),
      ),
    );
    expect(results.filter((result) => result.rowsAffected > 0)).toHaveLength(1);
    expect(await readVote()).toMatchObject({
      topRankinGames: true,
      topRankinGamesVoteId: "123",
    });
  });

  it("keeps the receipt when daily flags reset and refuses its replay", async () => {
    const database = await getTestDatabase();
    await updateUserVoteForTopRankinGames(database, "vote-token", "123", new Date());
    await updateUserVoteForGET(database);
    expect(await readVote()).toMatchObject({
      topRankinGames: false,
      topRankinGamesVoteId: "123",
    });
    await updateUserVoteForTopRankinGames(database, "vote-token", "123", new Date());
    expect(await readVote()).toMatchObject({ topRankinGames: false });
    await updateUserVoteForTopRankinGames(database, "vote-token", "124", new Date());
    expect(await readVote()).toMatchObject({
      topRankinGames: true,
      topRankinGamesVoteId: "124",
    });
  });

  it("does not let the unsigned legacy endpoint complete the signed site", async () => {
    const database = await getTestDatabase();
    await updateUserVoteForHandleVote(
      database,
      "topRankinGames",
      new Date(),
      "vote-token",
    );
    expect(await readVote()).toMatchObject({
      topRankinGames: false,
      topRankinGamesVoteId: null,
    });
  });

  it("ignores unknown tokens and already claimed vote sets", async () => {
    const database = await getTestDatabase();
    await updateUserVoteForTopRankinGames(database, "wrong-token", "123", new Date());
    expect(await readVote()).toMatchObject({ topRankinGames: false });
    await database
      .update(userVote)
      .set({ claimed: true })
      .where(eq(userVote.userId, "voter"));
    await updateUserVoteForTopRankinGames(database, "vote-token", "123", new Date());
    expect(await readVote()).toMatchObject({ topRankinGames: false });
  });
});
