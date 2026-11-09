import { beforeEach, expect, it } from "bun:test";
import { userData, userRequest, village } from "@/drizzle/schema";
import { deleteRequests } from "@/queries/sparring";

import { fetchRequest } from "@/server/api/routers/sparring";
import { insertUsers } from "../../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

describeWithDatabase("shared user request lifecycle", () => {
  beforeEach(async () => {
    await resetTables(userRequest, userData, village);
    await insertUsers(
      ["subject", "host", "visitor", "other-host"].map((userId) => ({
        userId,
        username: userId,
      })),
    );
  });

  it("preserves incoming and outgoing home access when village or rank changes clear requests", async () => {
    const database = await getTestDatabase();
    await database.insert(userRequest).values([
      {
        id: "home-accepted-out",
        senderId: "subject",
        receiverId: "visitor",
        type: "HOME",
        status: "ACCEPTED",
      },
      {
        id: "home-pending-out",
        senderId: "subject",
        receiverId: "host",
        type: "HOME",
        status: "PENDING",
      },
      {
        id: "home-accepted-in",
        senderId: "host",
        receiverId: "subject",
        type: "HOME",
        status: "ACCEPTED",
      },
      {
        id: "home-pending-in",
        senderId: "other-host",
        receiverId: "subject",
        type: "HOME",
        status: "PENDING",
      },
      {
        id: "sensei-in",
        senderId: "host",
        receiverId: "subject",
        type: "SENSEI",
        status: "PENDING",
      },
      {
        id: "sensei-out",
        senderId: "subject",
        receiverId: "visitor",
        type: "SENSEI",
        status: "PENDING",
      },
      {
        id: "spar-out",
        senderId: "subject",
        receiverId: "visitor",
        type: "SPAR",
        status: "PENDING",
      },
      {
        id: "unrelated",
        senderId: "host",
        receiverId: "visitor",
        type: "SENSEI",
        status: "PENDING",
      },
    ]);
    await deleteRequests(database, "subject");
    expect(
      (await database.select({ id: userRequest.id }).from(userRequest))
        .map(({ id }) => id)
        .sort(),
    ).toEqual([
      "home-accepted-in",
      "home-accepted-out",
      "home-pending-in",
      "home-pending-out",
      "unrelated",
    ]);
  });

  it("only permits a missing request when the caller opts in and retains the request type guard", async () => {
    const database = await getTestDatabase();
    await database.insert(userRequest).values({
      id: "sensei-request",
      senderId: "host",
      receiverId: "subject",
      type: "SENSEI",
      status: "PENDING",
    });
    expect(await fetchRequest(database, "sensei-request", "SENSEI")).toMatchObject({
      id: "sensei-request",
      type: "SENSEI",
    });
    await expect(fetchRequest(database, "missing", "SENSEI")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(
      await fetchRequest(database, "missing", "HOME", { allowMissing: true }),
    ).toBeUndefined();
    expect(
      await fetchRequest(database, "sensei-request", "HOME", { allowMissing: true }),
    ).toBeUndefined();
  });
});
