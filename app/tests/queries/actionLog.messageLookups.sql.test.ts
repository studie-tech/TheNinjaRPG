import { beforeEach, expect, it } from "bun:test";
import { nanoid } from "nanoid";
import { JUTSU_TRANSFER_DAYS } from "@/drizzle/constants";
import { actionLog } from "@/drizzle/schema";
import { findActionLogForSwapBloodline } from "@/queries/bloodline";
import { listActionLogForGetRecentTransfers } from "@/queries/jutsu";
import { DAY_S, secondsFromNow } from "@/utils/time";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../setup/testDatabase";

const daysAgo = (days: number) => secondsFromNow(-days * DAY_S);

const insertLogs = async (
  rows: Pick<
    typeof actionLog.$inferInsert,
    "userId" | "tableName" | "relatedMsg" | "createdAt" | "relatedId"
  >[],
) =>
  (await getTestDatabase())
    .insert(actionLog)
    .values(rows.map((row) => ({ id: nanoid(), changes: [], ...row })));

describeWithDatabase("ActionLog message lookups", () => {
  beforeEach(async () => {
    await resetTables(actionLog);
    await insertLogs([
      {
        userId: "player",
        tableName: "userjutsu",
        relatedMsg: "JutsuLevelTransfer",
        relatedId: "recent",
        createdAt: daysAgo(1),
      },
      {
        userId: "player",
        tableName: "userjutsu",
        relatedMsg: "JutsuLevelTransfer",
        relatedId: "expired",
        createdAt: daysAgo(JUTSU_TRANSFER_DAYS + 1),
      },
      {
        userId: "player",
        tableName: "userjutsu",
        relatedMsg: "Jutsu learned",
        relatedId: "other-message",
        createdAt: daysAgo(1),
      },
      {
        userId: "someone-else",
        tableName: "userjutsu",
        relatedMsg: "JutsuLevelTransfer",
        relatedId: "other-user",
        createdAt: daysAgo(1),
      },
      {
        userId: "player",
        tableName: "user",
        relatedMsg: "Bloodline Changed",
        relatedId: "older-swap",
        createdAt: daysAgo(40),
      },
      {
        userId: "player",
        tableName: "user",
        relatedMsg: "Bloodline Changed",
        relatedId: "latest-swap",
        createdAt: daysAgo(10),
      },
      {
        userId: "player",
        tableName: "bloodlineSwap",
        relatedMsg: "Bloodline Changed",
        relatedId: "other-table",
        createdAt: daysAgo(2),
      },
    ]);
  });

  it("lists only the player's jutsu transfers inside the transfer window", async () => {
    const transfers = await listActionLogForGetRecentTransfers(
      await getTestDatabase(),
      {
        userId: "player",
      },
    );
    expect(transfers.map((log) => log.relatedId)).toEqual(["recent"]);
  });

  it("finds the player's latest bloodline change on the user table", async () => {
    const swap = await findActionLogForSwapBloodline(await getTestDatabase(), {
      userId: "player",
    });
    expect(swap?.relatedId).toBe("latest-swap");
  });
});
