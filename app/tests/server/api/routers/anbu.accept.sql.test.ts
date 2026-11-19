import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { ANBU_MAX_MEMBERS } from "@/drizzle/constants";
import { anbuSquad, userData, userRequest, village } from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { anbuRouter } from "@/server/api/routers/anbu";
import type { DrizzleClient } from "@/server/db";
import * as nativePush from "@/server/utils/push/defer";
import { insertUsers } from "../../../setup/factories";
import { beforeStatements, overrideQuery } from "../../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../../setup/testDatabase";

const accept = (db: DrizzleClient, actor = "leader", id = "request") =>
  callerForDatabase(anbuRouter, actor, db).acceptRequest({ id });

const state = async () => {
  const db = await getTestDatabase();
  const [squad, applicant, request] = await Promise.all([
    db.query.anbuSquad.findFirst({ where: eq(anbuSquad.id, "squad") }),
    db.query.userData.findFirst({ where: eq(userData.userId, "applicant") }),
    db.query.userRequest.findFirst({ where: eq(userRequest.id, "request") }),
  ]);
  return {
    memberCount: squad?.memberCount,
    leaderId: squad?.leaderId,
    applicantSquad: applicant?.anbuId ?? null,
    status: request?.status,
  };
};

const insertRequest = (db: DrizzleClient, id: string, senderId: string) =>
  db.insert(userRequest).values({
    id,
    senderId,
    receiverId: "kage",
    type: "ANBU",
    status: "PENDING",
    relatedId: "squad",
  });

describeWithDatabase("ANBU request acceptance", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    vi.spyOn(nativePush, "deferPushToUsers").mockImplementation(() => {});
    await resetTables(anbuSquad, userData, userRequest, village);
    const db = await getTestDatabase();
    await db.insert(village).values([
      { id: "village", name: "Village", sector: 1, kageId: "kage" },
      { id: "other-village", name: "Other", sector: 2, kageId: "other-kage" },
    ]);
    await insertUsers([
      { userId: "kage", username: "kage", villageId: "village", rank: "JONIN" },
      {
        userId: "leader",
        username: "leader",
        villageId: "village",
        rank: "JONIN",
        anbuId: "squad",
      },
      {
        userId: "applicant",
        username: "applicant",
        villageId: "village",
        rank: "JONIN",
      },
      { userId: "rival", username: "rival", villageId: "village", rank: "JONIN" },
    ]);
    await db.insert(anbuSquad).values([
      {
        id: "squad",
        image: "/squad.webp",
        name: "Squad",
        villageId: "village",
        leaderId: "leader",
        memberCount: 1,
        kageOrderId: "kage-order",
        leaderOrderId: "leader-order",
      },
      {
        id: "other-squad",
        image: "/squad.webp",
        name: "Other squad",
        villageId: "village",
        leaderId: null,
        memberCount: 0,
        kageOrderId: "other-kage-order",
        leaderOrderId: "other-leader-order",
      },
    ]);
    await insertRequest(db, "request", "applicant");
  });
  afterEach(() => vi.restoreAllMocks());

  it("reads everything in one wave and commits the acceptance in one statement", async () => {
    const db = await getTestDatabase();
    const measured = await recordQueries(() => accept(db));
    expect(measured.result).toEqual({ success: true, message: "Request accepted" });
    expect(measured.roundTrips).toBe(2);
    expect(
      measured.statements.filter((statement) => /^\s*update\b/i.test(statement)),
    ).toHaveLength(1);
    expect(await state()).toEqual({
      memberCount: 2,
      leaderId: "leader",
      applicantSquad: "squad",
      status: "ACCEPTED",
    });
  });

  it("accepts the same request once when two managers accept it together", async () => {
    const db = await getTestDatabase();
    let second: Promise<{ success: boolean; message: string }> | undefined;
    const raced = beforeStatements(db, anbuSquad, [
      () => (second ??= accept(db, "kage")),
    ]);
    const first = await accept(raced);
    expect([first.success, (await second)?.success].sort()).toEqual([false, true]);
    expect(await state()).toEqual({
      memberCount: 2,
      leaderId: "leader",
      applicantSquad: "squad",
      status: "ACCEPTED",
    });
  });

  it("leaves the request pending when the squad fills before the acceptance", async () => {
    const db = await getTestDatabase();
    const raced = beforeStatements(db, anbuSquad, [
      () =>
        db
          .update(anbuSquad)
          .set({ memberCount: ANBU_MAX_MEMBERS })
          .where(eq(anbuSquad.id, "squad")),
    ]);
    expect(await accept(raced)).toEqual({ success: false, message: "Squad is full" });
    expect(await state()).toEqual({
      memberCount: ANBU_MAX_MEMBERS,
      leaderId: "leader",
      applicantSquad: null,
      status: "PENDING",
    });
  });

  it("accepts a newly freed slot even when the squad read saw it full", async () => {
    const db = await getTestDatabase();
    await db
      .update(anbuSquad)
      .set({ memberCount: ANBU_MAX_MEMBERS })
      .where(eq(anbuSquad.id, "squad"));
    const raced = overrideQuery(db, "anbuSquad", {
      findFirst: async (read, ...args) => {
        const squad = await read(...args);
        await db
          .update(anbuSquad)
          .set({ memberCount: ANBU_MAX_MEMBERS - 1 })
          .where(eq(anbuSquad.id, "squad"));
        return squad;
      },
    });
    expect((await accept(raced)).success).toBe(true);
    expect(await state()).toMatchObject({
      memberCount: ANBU_MAX_MEMBERS,
      applicantSquad: "squad",
      status: "ACCEPTED",
    });
  });

  it("leaves the squad unchanged when the applicant joins another squad first", async () => {
    const db = await getTestDatabase();
    const raced = beforeStatements(db, anbuSquad, [
      () =>
        db
          .update(userData)
          .set({ anbuId: "other-squad" })
          .where(eq(userData.userId, "applicant")),
    ]);
    expect(await accept(raced)).toEqual({
      success: false,
      message: "Requester already in a squad",
    });
    expect(await state()).toEqual({
      memberCount: 1,
      leaderId: "leader",
      applicantSquad: "other-squad",
      status: "PENDING",
    });
  });

  it("makes an eligible applicant lead a leaderless squad and redirects its requests", async () => {
    const db = await getTestDatabase();
    await db.update(anbuSquad).set({ leaderId: null }).where(eq(anbuSquad.id, "squad"));
    await insertRequest(db, "rival-request", "rival");
    expect(await accept(db, "kage")).toEqual({
      success: true,
      message: "Request accepted",
    });
    expect(await state()).toMatchObject({ leaderId: "applicant", status: "ACCEPTED" });
    expect(
      (
        await db.query.userRequest.findFirst({
          where: eq(userRequest.id, "rival-request"),
        })
      )?.receiverId,
    ).toBe("applicant");
  });

  it("keeps a leader installed concurrently and leaves pending requests with it", async () => {
    const db = await getTestDatabase();
    await db.update(anbuSquad).set({ leaderId: null }).where(eq(anbuSquad.id, "squad"));
    await insertRequest(db, "rival-request", "rival");
    const raced = beforeStatements(db, anbuSquad, [
      () =>
        db
          .update(anbuSquad)
          .set({ leaderId: "leader" })
          .where(eq(anbuSquad.id, "squad")),
    ]);
    expect((await accept(raced, "kage")).success).toBe(true);
    expect(await state()).toEqual({
      memberCount: 2,
      leaderId: "leader",
      applicantSquad: "squad",
      status: "ACCEPTED",
    });
    expect(
      (
        await db.query.userRequest.findFirst({
          where: eq(userRequest.id, "rival-request"),
        })
      )?.receiverId,
    ).toBe("kage");
  });
});
