import { beforeEach, expect, it } from "bun:test";
import { battleHistory, userData } from "@/drizzle/schema";
import { combatRouter } from "@/server/api/routers/combat";
import { insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../../../setup/testDatabase";

describeWithDatabase("combat.getGraph", () => {
  beforeEach(async () => {
    await resetTables(battleHistory, userData);
  });

  it("returns no edges for an empty, unrelated or non-COMBAT history", async () => {
    await seedUsers(["subject", "a", "b"]);
    const caller = await callerFor(combatRouter, "a");
    const empty = await recordQueries(() => caller.getGraph({ userId: "subject" }));
    expect(empty.result).toEqual([]);
    expect(
      empty.statements.filter((statement) => statement.includes("`BattleHistory`")),
    ).toHaveLength(1);
    await seedFights([
      ["subject", "a", 5, "ARENA"],
      ["a", "b", 10],
    ]);
    expect(await caller.getGraph({ userId: "subject" })).toEqual([]);
    expect(await caller.getGraph({ userId: "missing" })).toEqual([]);
  });

  it("preserves directed full-history counts, display fields and two-hop eligibility", async () => {
    await seedUsers(["subject", "a", "b", "c", "d", "unrelated"]);
    await seedFights([
      ["subject", "a", 3],
      ["a", "subject", 2],
      ["b", "subject", 1],
      ["a", "b", 7],
      ["b", "a", 6],
      ["c", "a", 5],
      ["b", "d", 4],
      ["c", "d", 30],
      ["d", "unrelated", 30],
      ["subject", "deleted", 40],
      ["deleted", "a", 40],
      ["subject", "c", 40, "ARENA"],
      ["a", "c", 40, "RANKED_PVP"],
    ]);
    const result = await (await callerFor(combatRouter, "unrelated")).getGraph({
      userId: "subject",
    });
    expect(
      result.map(({ attackerId, defenderId, total }) => [
        attackerId,
        defenderId,
        total,
      ]),
    ).toEqual([
      ["a", "b", 7],
      ["b", "a", 6],
      ["c", "a", 5],
      ["b", "d", 4],
      ["subject", "a", 3],
      ["a", "subject", 2],
      ["b", "subject", 1],
    ]);
    expect(result[0]).toEqual({
      attackerId: "a",
      defenderId: "b",
      total: 7,
      attackerUsername: "name-a",
      defenderUsername: "name-b",
      attackerAvatar: "/a.png",
      defenderAvatar: "/b.png",
    });
  });

  it("finds a top second-hop edge through a direct opponent below the 100-edge cutoff", async () => {
    const neighbors = Array.from(
      { length: 110 },
      (_, index) => `n${String(index).padStart(3, "0")}`,
    );
    await seedUsers(["subject", "target", ...neighbors]);
    await seedFights([
      ...neighbors.map((id): Fight => ["subject", id, 1]),
      [neighbors.at(-1)!, "target", 20],
    ]);
    const caller = await callerFor(combatRouter, "subject");
    const { result, statements } = await recordQueries(() =>
      caller.getGraph({ userId: "subject" }),
    );
    expect(result).toHaveLength(100);
    expect(result[0]).toMatchObject({
      attackerId: neighbors.at(-1),
      defenderId: "target",
      total: 20,
    });
    expect(result.slice(1).map((edge) => edge.defenderId)).toEqual(
      neighbors.slice(0, 99),
    );
    const graphQueries = statements.filter((statement) =>
      statement.includes("`BattleHistory`"),
    );
    expect(graphQueries).toHaveLength(2);
    expect(graphQueries[0]).toContain("select distinct");
    expect(graphQueries[0]).not.toMatch(/username|avatar/);
    // The only limit belongs to the final aggregate, never the neighbor set.
    expect(graphQueries[0]).not.toMatch(/\blimit\b/i);
    expect(graphQueries[1]!.match(/\blimit\b/gi)).toHaveLength(1);
    expect(graphQueries[1]).toMatch(/order by count\(\*\) desc/);
    expect(graphQueries[1]).toMatch(/limit 100$/);
    expect(await caller.getGraph({ userId: "subject" })).toEqual(result);
  });

  it("prefers direct edges on tied counts without duplicating shared-neighbor edges", async () => {
    await seedUsers(["subject", "a", "b", "c"]);
    await seedFights([
      ["subject", "a", 2],
      ["subject", "b", 2],
      ["a", "subject", 2],
      ["a", "b", 2],
      ["c", "a", 2],
    ]);
    const result = await (await callerFor(combatRouter, "subject")).getGraph({
      userId: "subject",
    });
    expect(
      result.map(({ attackerId, defenderId, total }) => [
        attackerId,
        defenderId,
        total,
      ]),
    ).toEqual([
      ["a", "subject", 2],
      ["subject", "a", 2],
      ["subject", "b", 2],
      ["a", "b", 2],
      ["c", "a", 2],
    ]);
  });

  it("retains self-fights without expanding eligibility to unrelated edges", async () => {
    await seedUsers(["subject", "a", "b"]);
    await seedFights([
      ["subject", "subject", 3],
      ["a", "b", 10],
    ]);
    const result = await (await callerFor(combatRouter, "subject")).getGraph({
      userId: "subject",
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      attackerId: "subject",
      defenderId: "subject",
      total: 3,
    });
  });
});

const seedUsers = (ids: string[]) =>
  insertUsers(
    ids.map((userId) => ({
      userId,
      username: `name-${userId}`,
      avatar: `/${userId}.png`,
    })),
  );

const seedFights = async (fights: Fight[]) => {
  const db = await getTestDatabase();
  await db.insert(battleHistory).values(
    fights.flatMap(([attackedId, defenderId, total, battleType = "COMBAT"], pair) =>
      Array.from({ length: total }, (_, index) => ({
        battleId: `${pair}-${index}`,
        attackedId,
        defenderId,
        battleType,
        createdAt: new Date("2000-01-01T00:00:00.000Z"),
      })),
    ),
  );
};

type Fight = [
  string,
  string,
  number,
  (typeof battleHistory.$inferInsert)["battleType"]?,
];
