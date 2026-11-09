import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { userAssociation, userData, userRequest } from "@/drizzle/schema";
import { marriageRouter } from "@/server/api/routers/marriage";
import { insertUsers } from "../../../setup/factories";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import { beforeStatements } from "../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const insertProposal = async (
  status: "PENDING" | "CANCELLED" | "REJECTED" | "ACCEPTED",
) =>
  (await getTestDatabase()).insert(userRequest).values({
    id: "proposal",
    senderId: "suitor",
    receiverId: "beloved",
    status,
    type: "MARRIAGE",
  });

describeWithDatabase("Marriage proposals", () => {
  beforeEach(async () => {
    await resetTables(userAssociation, userData, userRequest);
    await insertUsers([
      { userId: "suitor", username: "suitor", marriageSlots: 2 },
      { userId: "beloved", username: "beloved", marriageSlots: 2 },
    ]);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(["CANCELLED", "REJECTED", "ACCEPTED"] as const)(
    "does not accept a %s proposal",
    async (status) => {
      await insertProposal(status);
      const result = await (await callerFor(marriageRouter, "beloved")).acceptRequest({
        id: "proposal",
      });
      expect(result.success).toBe(false);
      expect(await (await getTestDatabase()).query.userAssociation.findMany()).toEqual(
        [],
      );
    },
  );

  it("marries once when the same proposal is accepted twice at the same time", async () => {
    await insertProposal("PENDING");
    const db = await getTestDatabase();
    const results: boolean[] = [];
    // Hold every write of the first accept until a second accept has finished
    let second: Promise<void> | undefined;
    const runSecond = () =>
      (second ??= (async () => {
        results.push(
          (
            await (
              await callerFor(marriageRouter, "beloved")
            ).acceptRequest({ id: "proposal" })
          ).success,
        );
      })());
    const raced = beforeStatements(
      beforeStatements(db, userRequest, [runSecond]),
      userAssociation,
      [runSecond],
    );
    results.unshift(
      (
        await callerForDatabase(marriageRouter, "beloved", raced).acceptRequest({
          id: "proposal",
        })
      ).success,
    );
    expect({
      marriages: (await db.query.userAssociation.findMany()).length,
      results,
    }).toEqual({ marriages: 1, results: [false, true] });
  });

  it("lists no marriages for a signed-out visitor who names no user", async () => {
    const db = await getTestDatabase();
    await insertProposal("PENDING");
    expect(
      (
        await (
          await callerFor(marriageRouter, "beloved")
        ).acceptRequest({ id: "proposal" })
      ).success,
    ).toBe(true);
    stubRateLimitTransport();
    const anonymous = marriageRouter.createCaller({
      drizzle: db,
      userId: null,
      userIp: "203.0.113.7",
    } as never);
    expect(await anonymous.getMarriedUsers({})).toEqual([]);
    expect(
      (await anonymous.getMarriedUsers({ id: "beloved" })).map((user) => user.userId),
    ).toEqual(["suitor"]);
  });
});
