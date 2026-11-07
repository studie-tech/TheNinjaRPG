import { beforeEach, expect, it } from "bun:test";
import type { BattleType } from "@/drizzle/constants";
import { battle, tournamentMatch, userRequest } from "@/drizzle/schema";
import { combatRouter } from "@/server/api/routers/combat";
import { makeCompleteBattle, makeUser } from "../../../../libs/combat/helpers/battleScenario";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  indexColumns,
  recordQueries,
  resetTables,
} from "../../../../setup/testDatabase";
import { interceptExecute } from "../../../../setup/statements";

describeWithDatabase("combat.listOngoingBattles", () => {
  beforeEach(async () => {
    await resetTables(battle, tournamentMatch, userRequest);
  });

  for (const battleType of ["SPARRING", "RANKED_SPARRING"] as const) {
    it(`keeps ${battleType} private unless accepted for spectating or linked to an event`, async () => {
      const database = await getTestDatabase();
      await database.insert(battle).values([
        fixture("private", battleType, 5),
        fixture("pending", battleType, 4),
        fixture("public", battleType, 3),
        fixture("event", battleType, 2, "game"),
        fixture("older", battleType, 1),
        fixture("other-type", "ARENA", 6),
      ]);
      await database.insert(userRequest).values([
        { id: "private", relatedId: "private", spectatable: false, status: "ACCEPTED", type: "SPAR", senderId: "a", receiverId: "b" },
        { id: "pending", relatedId: "pending", spectatable: true, status: "PENDING", type: "SPAR", senderId: "a", receiverId: "b" },
        { id: "public", relatedId: "public", spectatable: true, status: "ACCEPTED", type: "SPAR", senderId: "a", receiverId: "b" },
        { id: "older", relatedId: "older", spectatable: true, status: "ACCEPTED", type: "SPAR", senderId: "a", receiverId: "b" },
      ]);
      // EXISTS must not multiply list rows, even if more than one token links a battle.
      await database.insert(tournamentMatch).values(["game", "second-token"].map((id) => ({
        id, tournamentId: "event", battleId: "event", round: 1, match: 1,
        userId1: "a", userId2: "b", startedAt: new Date(),
      })));

      const caller = await listCaller();
      const { result, statements } = await recordQueries(() => caller.listOngoingBattles({ battleType }));
      expect(result.map((row) => row.id)).toEqual(["public", "event", "older"]);
      expect(result[0]?.users).toEqual([{ userId: "a", username: "Player", avatar: "/avatar.png" }]);
      expect((await caller.listOngoingBattles({ battleType, limit: 1, offset: 1 })).map((row) => row.id)).toEqual(["event"]);
      const listQueries = statements.filter((statement) => /FROM Battle\b/.test(statement));
      expect(listQueries).toHaveLength(1);
      // Merely mentioning this LOB in WHERE forces a fetch even on non-sparring tabs.
      expect(listQueries[0]).not.toMatch(/extraState/i);
    });
  }

  it("keeps non-sparring battles visible without a request or event token", async () => {
    const database = await getTestDatabase();
    await database.insert(battle).values([
      fixture("arena", "ARENA", 1),
      fixture("ranked", "RANKED_PVP", 2),
    ]);
    const caller = await listCaller();
    expect((await caller.listOngoingBattles({ battleType: "ARENA" })).map((row) => row.id)).toEqual(["arena"]);
    expect((await caller.listOngoingBattles({})).map((row) => row.id)).toEqual(["ranked"]);
  });

  it("indexes the event battle lookup", async () => {
    expect(await indexColumns("TournamentMatch", "TournamentMatch_battleId_idx")).toEqual({ columns: ["battleId"], unique: false });
  });
});

const fixture = (id: string, battleType: BattleType, order: number, tournamentGameId?: string) =>
  makeCompleteBattle({
    id, battleType, background: "arena", createdAt: new Date(2026, 0, 1, 0, 0, order),
    usersState: [makeUser({ userId: "a", username: "Player", avatar: "/avatar.png" })],
    extraState: tournamentGameId ? { tournamentGameId } : {},
  });

/** Adapt mysql2's raw SELECT tuple to the PlanetScale execute result used by this endpoint. */
const listCaller = async () => {
  const database = await getTestDatabase();
  const client = interceptExecute(database, async (_query, run) => {
    const [rows] = await run() as unknown as [unknown[], unknown];
    return { rows };
  });
  return callerForDatabase(combatRouter, "viewer", client);
};
