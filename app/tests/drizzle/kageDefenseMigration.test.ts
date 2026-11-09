import { expect, it } from "bun:test";
import type mysql from "mysql2/promise";
import { readMigration, withMigrationSandbox } from "../setup/migrations";
import { describeWithDatabase } from "../setup/testDatabase";

describeWithDatabase("Kage defense lifecycle migration", () => {
  it("preserves completed defenses and releases legacy requests before admitting new lifecycle rows", async () => {
    await withMigrationSandbox(
      {
        snapshot: "0088",
        baseline: [
          "KageDefendedChallenges",
          "UserData",
          "UserRequest",
          "Village",
          "VillageElderVote",
        ],
      },
      async ({ query }) => {
        await query(
          "INSERT INTO UserData (userId, username, gender, status, money) VALUES ('challenger', 'Challenger', 'Other', 'KAGE_QUEUED', 123456), ('defender', 'Defender', 'Other', 'AWAKE', 654321)",
        );
        await query(
          "INSERT INTO UserRequest (id, senderId, receiverId, status, type) VALUES ('legacy-request', 'challenger', 'defender', 'PENDING', 'KAGE'), ('spar-request', 'challenger', 'defender', 'PENDING', 'SPAR')",
        );
        await query(
          "INSERT INTO KageDefendedChallenges (id, battleId, villageId, userId, kageId, didWin, rounds, createdAt) VALUES ('old-win', 'old-battle', 'home', 'challenger', 'defender', 1, 7, '2026-10-10 11:12:13.123'), ('old-loss', NULL, 'home', 'challenger', 'defender', 0, 9, '2026-10-11 14:15:16.456')",
        );
        const [historyBefore] = await query<mysql.RowDataPacket[]>(
          "SELECT * FROM KageDefendedChallenges ORDER BY id",
        );
        const migration = await readMigration("0089_kage_defense_schedule.sql");
        await query(migration);
        const [history] = await query<mysql.RowDataPacket[]>(
          "SELECT * FROM KageDefendedChallenges ORDER BY id",
        );
        expect(history).toHaveLength(2);
        for (const [index, previous] of historyBefore.entries()) {
          const row = history[index]!;
          expect(row).toEqual(expect.objectContaining(previous));
          expect(row).toEqual(
            expect.objectContaining({
              status: "COMPLETED",
              tenure: null,
              activeChallengerId: null,
              notBefore: previous.createdAt,
              startedAt: previous.createdAt,
              resolvedAt: previous.createdAt,
            }),
          );
          expect(row.outcome).toBe(
            previous.didWin
              ? "Challenger won the title fight"
              : "Kage defended the title",
          );
        }
        const [accounts] = await query<mysql.RowDataPacket[]>(
          "SELECT userId, status, money FROM UserData ORDER BY userId",
        );
        expect(
          accounts.map(({ userId, status, money }) => ({ userId, status, money })),
        ).toEqual([
          { userId: "challenger", status: "AWAKE", money: 123456 },
          { userId: "defender", status: "AWAKE", money: 654321 },
        ]);
        const [requests] = await query<mysql.RowDataPacket[]>(
          "SELECT id, status FROM UserRequest ORDER BY id",
        );
        expect(requests.map(({ id, status }) => ({ id, status }))).toEqual([
          { id: "legacy-request", status: "CANCELLED" },
          { id: "spar-request", status: "PENDING" },
        ]);
        await query(
          "INSERT INTO KageDefendedChallenges (id, villageId, userId, kageId, tenure, notBefore) VALUES ('new-entry', 'home', 'challenger', 'defender', NOW(3), NOW(3))",
        );
        const [queued] = await query<mysql.RowDataPacket[]>(
          "SELECT status, didWin, rounds, activeChallengerId FROM KageDefendedChallenges WHERE id = 'new-entry'",
        );
        expect(
          queued.map(({ status, didWin, rounds, activeChallengerId }) => ({
            status,
            didWin,
            rounds,
            activeChallengerId,
          })),
        ).toEqual([
          {
            status: "QUEUED",
            didWin: null,
            rounds: null,
            activeChallengerId: "challenger",
          },
        ]);
        await expect(
          query(
            "INSERT INTO KageDefendedChallenges (id, villageId, userId, kageId, notBefore) VALUES ('duplicate-entry', 'home', 'challenger', 'defender', NOW(3))",
          ),
        ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
        await query(
          "UPDATE KageDefendedChallenges SET status = 'CANCELLED' WHERE id = 'new-entry'",
        );
        await query(
          "INSERT INTO KageDefendedChallenges (id, villageId, userId, kageId, notBefore) VALUES ('next-entry', 'home', 'challenger', 'defender', NOW(3))",
        );
        await expect(
          query(
            "UPDATE KageDefendedChallenges SET battleId = 'old-battle' WHERE id = 'next-entry'",
          ),
        ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
      },
    );
  }, 30_000);
});
