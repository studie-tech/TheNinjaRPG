import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { SENSEI_MAX_ACTIVE_STUDENTS } from "@/drizzle/constants";
import { userData, userRequest } from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { senseiRouter } from "@/server/api/routers/sensei";
import { insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const students = Array.from(
  { length: SENSEI_MAX_ACTIVE_STUDENTS },
  (_, i) => `student-${i}`,
);

describeWithDatabase("sensei students", () => {
  beforeEach(async () => {
    await resetTables(userRequest, userData);
    await insertUsers([
      { userId: "sensei", rank: "JONIN", level: 60 },
      { userId: "applicant", rank: "GENIN", level: 10 },
      ...students.map((userId) => ({
        userId,
        rank: "GENIN" as const,
        level: 10,
        senseiId: "sensei",
        lastIp: "203.0.113.7",
      })),
    ]);
    await (await getTestDatabase()).insert(userRequest).values({
      id: "ask",
      senderId: "applicant",
      receiverId: "sensei",
      status: "PENDING",
      type: "SENSEI",
    });
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("refuses another active student once the cap is reached", async () => {
    const sensei = await callerFor(senseiRouter, "sensei");
    expect(await sensei.acceptRequest({ id: "ask" })).toMatchObject({
      success: false,
      message: `Can only have ${SENSEI_MAX_ACTIVE_STUDENTS} active students`,
    });
    expect(
      await (await getTestDatabase()).query.userData.findFirst({
        where: eq(userData.userId, "applicant"),
      }),
    ).toMatchObject({ senseiId: null });
  });

  it("lists only public student fields", async () => {
    const applicant = await callerFor(senseiRouter, "applicant");
    const listed = await applicant.getStudents({ userId: "sensei" });
    expect(listed).toHaveLength(SENSEI_MAX_ACTIVE_STUDENTS);
    for (const student of listed)
      expect(Object.keys(student).sort()).toEqual([
        "avatar",
        "level",
        "rank",
        "userId",
        "username",
      ]);
  });
});
