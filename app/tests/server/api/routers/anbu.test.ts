import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { and, eq, type SQL, sql } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { anbuSquad, userData, userRequest } from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { reassignPendingAnbuRequestsOnPromotion } from "@/queries/anbu";
import {
  acceptAnbuRequest,
  createAnbuRequest,
  fetchSquadForAnbuRequest,
  getAnbuRequests,
  promoteAnbuLeader,
  rejectAnbuRequest,
  removeFromSquad,
} from "@/routers/anbu";
import * as nativePush from "@/server/utils/push/defer";
import { membershipUpdate } from "@/server/utils/push/messages";
import {
  resetServerModuleStubs,
  stubProfile,
  stubSparring,
} from "../../../setup/serverModules";

const fetchActorMock = vi.fn();
const fetchPendingRequestMock = vi.fn();
const fetchUserMock = vi.fn();
const fetchRequestMock = vi.fn();
const fetchRequestsMock = vi.fn();
const insertRequestMock = vi.fn();
const notifyMock = vi.fn();

/** Stable string form of a drizzle SQL predicate for assertion (cols + params). */
const describeSql = (node: unknown) => {
  const { sql, params } = new MySqlDialect().sqlToQuery(node as SQL);
  return `${sql} ${JSON.stringify(params)}`;
};

describe("ANBU request squad identity", () => {
  it("resolves the squad from relatedId after a leader change", async () => {
    const squad = {
      id: "squad-1",
      leaderId: "new-leader",
      villageId: "village-1",
      members: [],
    };
    const expectedWhere = describeSql(eq(anbuSquad.id, "squad-1"));
    const findFirst = vi.fn().mockImplementation((args: { where: unknown }) => {
      // Only succeed when looking up by squad id (relatedId path), not leaderId
      if (describeSql(args.where) !== expectedWhere) {
        return Promise.resolve(null);
      }
      return Promise.resolve(squad);
    });
    const client = {
      query: {
        anbuSquad: { findFirst },
      },
    };

    // Stale receiver from before promoteMember reassignment
    const request = { relatedId: "squad-1", receiverId: "old-leader" };
    const result = await fetchSquadForAnbuRequest(client as never, request);

    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(describeSql(findFirst.mock.calls[0]?.[0]?.where)).toBe(expectedWhere);
    expect(result).toEqual<typeof squad>(squad);
    expect(result?.leaderId).toBe("new-leader");
    expect(result?.leaderId).not.toBe("old-leader");
  });

  it("resolves no squad for a request without relatedId", async () => {
    const findFirst = vi.fn();
    const client = { query: { anbuSquad: { findFirst } } };

    await expect(
      fetchSquadForAnbuRequest(client as never, { relatedId: null }),
    ).resolves.toBeUndefined();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("reassigns the squad's pending requests to the new leader on promotion", async () => {
    const expectedWhere = describeSql(
      and(
        eq(userRequest.type, "ANBU"),
        eq(userRequest.status, "PENDING"),
        eq(userRequest.relatedId, "squad-1"),
      ),
    );
    const where = vi.fn().mockResolvedValue({ rowsAffected: 2 });
    const set = vi.fn().mockReturnValue({ where });
    const client = {
      update: vi.fn().mockReturnValue({ set }),
    };

    await reassignPendingAnbuRequestsOnPromotion(
      client as never,
      "squad-1",
      "new-leader",
    );

    expect(client.update).toHaveBeenCalledWith(userRequest);
    expect(set).toHaveBeenCalledWith({ receiverId: "new-leader" });
    expect(where).toHaveBeenCalledTimes(1);
    expect(describeSql(where.mock.calls[0]?.[0])).toBe(expectedWhere);
  });

  it("keeps pending requests unchanged when there is no successor", async () => {
    const client = { update: vi.fn() };

    await reassignPendingAnbuRequestsOnPromotion(client as never, "squad-1", null);

    expect(client.update).not.toHaveBeenCalled();
  });
});

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  userId: "actor",
  username: "Actor",
  villageId: "village-1",
  village: { id: "village-1", kageId: "kage" },
  anbuId: null,
  rank: "JONIN",
  role: "USER",
  ...overrides,
});

const makeSquad = (overrides: Record<string, unknown> = {}) => ({
  id: "squad-1",
  villageId: "village-1",
  leaderId: "leader",
  memberCount: 1,
  members: [],
  ...overrides,
});

type UpdateRecord = { table: unknown; values: unknown; predicate: unknown };

function makeDrizzleMock(
  squad: ReturnType<typeof makeSquad>,
  results: Array<[unknown, Array<{ rowsAffected: number }>]>,
  members: Array<{ userId: string; rank: string }> = [],
) {
  const queues = new Map(results);
  const updates: UpdateRecord[] = [];
  const selectedPredicates: unknown[] = [];
  const update = vi.fn((table: unknown) => ({
    set: vi.fn((values: unknown) => ({
      where: vi.fn(async (predicate: unknown) => {
        updates.push({ table, values, predicate });
        return queues.get(table)?.shift() ?? { rowsAffected: 1 };
      }),
    })),
  }));
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn((predicate: unknown) => {
        selectedPredicates.push(predicate);
        return { getSQL: () => sql`SELECT 1` };
      }),
    })),
  }));
  return {
    client: {
      query: {
        anbuSquad: { findFirst: vi.fn().mockResolvedValue(squad) },
        userData: {
          findFirst: vi.fn(async (args: { columns?: { username?: boolean } }) => {
            if (!args.columns?.username) {
              return (fetchUserMock as (...values: unknown[]) => unknown)();
            }
            const actor = await (fetchActorMock as (...values: unknown[]) => unknown)(
              args,
            );
            return (actor as { user?: unknown } | undefined)?.user ?? actor;
          }),
          findMany: vi.fn().mockResolvedValue(members),
        },
        userRequest: {
          findFirst: vi.fn(async (...args: unknown[]) =>
            (fetchPendingRequestMock as (...values: unknown[]) => unknown)(...args),
          ),
        },
      },
      update,
      select,
    },
    updates,
    update,
    select,
    selectedPredicates,
  };
}

describe("ANBU router request permissions and concurrency", () => {
  const queuePush = vi.fn();
  beforeEach(() => {
    queuePush.mockReset();
    vi.spyOn(nativePush, "deferPushToUsers").mockImplementation(queuePush);
  });

  it("queues a request alert only after insertion succeeds", async () => {
    const { client } = makeDrizzleMock(makeSquad(), []);
    fetchActorMock.mockResolvedValue({ user: makeUser() } as never);
    fetchPendingRequestMock.mockResolvedValue(null as never);
    let completeInsertion: () => void = () => {};
    insertRequestMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          completeInsertion = resolve;
        }),
    );
    const creating = createAnbuRequest({
      ctx: { drizzle: client, userId: "actor" },
      input: { squadId: "squad-1" },
    } as never);
    // Let the actor/duplicate reads and expired-request write finish first.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(insertRequestMock).toHaveBeenCalledTimes(1);
    expect(queuePush).not.toHaveBeenCalled();
    completeInsertion();
    expect(await creating).toMatchObject({ success: true });
    expect(queuePush).toHaveBeenCalledWith(
      client,
      ["leader"],
      membershipUpdate("anbu"),
    );
  });

  it.each([0, 1])(
    "queues rejection only for a successful request CAS (%i)",
    async (rowsAffected) => {
      const { client } = makeDrizzleMock(makeSquad({ leaderId: "actor" }), [
        [userRequest, [{ rowsAffected }]],
      ]);
      fetchActorMock.mockResolvedValue({
        user: makeUser({ anbuId: "squad-1" }),
      } as never);
      fetchRequestMock.mockResolvedValue({
        id: "request-1",
        senderId: "requester",
        receiverId: "actor",
        relatedId: "squad-1",
        status: "PENDING",
      } as never);
      const result = await rejectAnbuRequest({
        ctx: { drizzle: client, userId: "actor" },
        input: { id: "request-1" },
      } as never);
      expect(result.success).toBe(rowsAffected === 1);
      expect(queuePush).toHaveBeenCalledTimes(rowsAffected);
      if (rowsAffected)
        expect(queuePush).toHaveBeenCalledWith(
          client,
          ["requester"],
          membershipUpdate("anbu"),
        );
    },
  );

  it("returns durable squad requests to leaders and only scoped own requests to applicants", async () => {
    const squad = makeSquad({ leaderId: "actor" });
    const { client } = makeDrizzleMock(squad, []);
    const ownForThisSquad = {
      id: "own-1",
      senderId: "applicant",
      receiverId: "old-leader",
      relatedId: "squad-1",
      status: "PENDING",
    };
    const ownForOtherSquad = {
      ...ownForThisSquad,
      id: "own-2",
      relatedId: "squad-2",
    };
    // Received by the applicant as a former leader of the squad, but sent by someone else.
    const squadRequest = {
      ...ownForThisSquad,
      id: "managed-1",
      senderId: "other-applicant",
      receiverId: "applicant",
    };
    fetchRequestsMock.mockImplementation(
      async (_client, _types, _seconds, id, relatedId) =>
        [squadRequest, ownForThisSquad, ownForOtherSquad].filter(
          (request) =>
            (!relatedId || request.relatedId === relatedId) &&
            (!id || request.senderId === id || request.receiverId === id),
        ) as never,
    );

    fetchActorMock.mockResolvedValueOnce({
      user: makeUser({ anbuId: "squad-1" }),
    } as never);
    await expect(
      getAnbuRequests({
        ctx: { drizzle: client, userId: "actor" },
        input: { squadId: "squad-1" },
      } as never),
    ).resolves.toEqual<Array<typeof squadRequest>>([squadRequest, ownForThisSquad]);
    expect(fetchRequestsMock).toHaveBeenCalledTimes(1);
    expect(fetchRequestsMock).toHaveBeenLastCalledWith(
      client,
      ["ANBU"],
      3600 * 12,
      undefined,
      "squad-1",
    );

    fetchActorMock.mockResolvedValueOnce({
      user: makeUser({ userId: "applicant" }),
    } as never);
    await expect(
      getAnbuRequests({
        ctx: { drizzle: client, userId: "applicant" },
        input: { squadId: "squad-1" },
      } as never),
    ).resolves.toEqual<Array<typeof ownForThisSquad>>([ownForThisSquad]);
    expect(fetchRequestsMock).toHaveBeenCalledTimes(2);
    expect(fetchRequestsMock).toHaveBeenLastCalledWith(
      client,
      ["ANBU"],
      3600 * 12,
      "applicant",
      "squad-1",
    );
  });

  it("returns no squad requests to an ordinary member", async () => {
    const squad = makeSquad();
    const { client } = makeDrizzleMock(squad, []);
    fetchActorMock.mockResolvedValue({
      user: makeUser({ anbuId: "squad-1" }),
    } as never);
    fetchRequestsMock.mockResolvedValue([] as never);

    await expect(
      getAnbuRequests({
        ctx: { drizzle: client, userId: "actor" },
        input: { squadId: "squad-1" },
      } as never),
    ).resolves.toEqual([]);
    expect(fetchRequestsMock).not.toHaveBeenCalled();
  });

  it("blocks duplicate pending requests before insert", async () => {
    const squad = makeSquad();
    const { client } = makeDrizzleMock(squad, []);
    fetchActorMock.mockResolvedValue({ user: makeUser() } as never);
    fetchPendingRequestMock.mockResolvedValue({ id: "request-1" } as never);

    await expect(
      createAnbuRequest({
        ctx: { drizzle: client, userId: "actor" },
        input: { squadId: "squad-1" },
      } as never),
    ).resolves.toEqual({
      success: false,
      message: "You already have a pending ANBU request",
    });
    expect(insertRequestMock).not.toHaveBeenCalled();
    expect(queuePush).not.toHaveBeenCalled();
  });

  it("rejects a kage from a different village before any write", async () => {
    const squad = makeSquad();
    const { client, update } = makeDrizzleMock(squad, []);
    fetchRequestMock.mockResolvedValue({
      id: "request-1",
      senderId: "requester",
      receiverId: "leader",
      relatedId: "squad-1",
      status: "PENDING",
    } as never);
    fetchActorMock.mockResolvedValue({
      user: makeUser({
        villageId: "village-2",
        village: { id: "village-2", kageId: "actor" },
      }),
    } as never);
    fetchUserMock.mockResolvedValue(
      makeUser({ userId: "requester", villageId: "village-1" }) as never,
    );

    await expect(
      acceptAnbuRequest({
        ctx: { drizzle: client, userId: "actor" },
        input: { id: "request-1" },
      } as never),
    ).resolves.toEqual({ success: false, message: "Not allowed" });
    expect(update).not.toHaveBeenCalled();
  });

  it("blocks a different-village kage from rejecting a request", async () => {
    const squad = makeSquad();
    const { client, update } = makeDrizzleMock(squad, []);
    fetchRequestMock.mockResolvedValue({
      id: "request-1",
      senderId: "requester",
      receiverId: "leader",
      relatedId: "squad-1",
      status: "PENDING",
    } as never);
    fetchActorMock.mockResolvedValue({
      user: makeUser({
        villageId: "village-2",
        village: { id: "village-2", kageId: "actor" },
      }),
    } as never);

    await expect(
      rejectAnbuRequest({
        ctx: { drizzle: client, userId: "actor" },
        input: { id: "request-1" },
      } as never),
    ).resolves.toEqual({
      success: false,
      message: "Not allowed to reject this request",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("reports a missing squad before checking reject permissions", async () => {
    const { client, update } = makeDrizzleMock(null as never, []);
    fetchRequestMock.mockResolvedValue({
      id: "request-1",
      senderId: "requester",
      receiverId: "former-leader",
      relatedId: "deleted-squad",
      status: "PENDING",
    } as never);
    fetchActorMock.mockResolvedValue({
      user: makeUser({ rank: "KAGE" }),
    } as never);

    await expect(
      rejectAnbuRequest({
        ctx: { drizzle: client, userId: "actor" },
        input: { id: "request-1" },
      } as never),
    ).resolves.toEqual({ success: false, message: "Squad not found" });
    expect(update).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
    expect(queuePush).not.toHaveBeenCalled();
  });

  for (const [label, actor] of [
    ["same-village elder", { rank: "ELDER" }],
    ["staff editor", { villageId: "village-2", role: "CONTENT" }],
  ] as const) {
    it(`allows a ${label} through the accept authorization guard`, async () => {
      const squad = makeSquad({ memberCount: 4 });
      const { client, updates } = makeDrizzleMock(squad, [
        [userRequest, [{ rowsAffected: 1 }, { rowsAffected: 1 }]],
        [anbuSquad, [{ rowsAffected: 0 }]],
      ]);
      fetchRequestMock.mockResolvedValue({
        id: "request-1",
        senderId: "requester",
        receiverId: "leader",
        relatedId: "squad-1",
        status: "PENDING",
      } as never);
      fetchActorMock.mockResolvedValue({
        user: makeUser(actor),
      } as never);
      fetchUserMock.mockResolvedValue(
        makeUser({ userId: "requester", villageId: "village-1" }) as never,
      );

      await expect(
        acceptAnbuRequest({
          ctx: { drizzle: client, userId: "actor" },
          input: { id: "request-1" },
        } as never),
      ).resolves.toEqual({ success: false, message: "Squad is full" });
      expect(updates.some((entry) => entry.table === userRequest)).toBe(true);
    });
  }

  it("rolls back the request claim when the atomic capacity claim loses", async () => {
    const squad = makeSquad({ leaderId: "actor", memberCount: 3 });
    const { client, updates } = makeDrizzleMock(squad, [
      [userRequest, [{ rowsAffected: 1 }, { rowsAffected: 1 }]],
      [anbuSquad, [{ rowsAffected: 0 }]],
    ]);
    fetchRequestMock.mockResolvedValue({
      id: "request-1",
      senderId: "requester",
      receiverId: "actor",
      relatedId: "squad-1",
      status: "PENDING",
    } as never);
    fetchActorMock.mockResolvedValue({
      user: makeUser({ anbuId: "squad-1" }),
    } as never);
    fetchUserMock.mockResolvedValue(
      makeUser({ userId: "requester", villageId: "village-1" }) as never,
    );

    await expect(
      acceptAnbuRequest({
        ctx: { drizzle: client, userId: "actor" },
        input: { id: "request-1" },
      } as never),
    ).resolves.toEqual({ success: false, message: "Squad is full" });
    expect(updates.filter((entry) => entry.table === userRequest)).toHaveLength(2);
    expect(updates.some((entry) => entry.table === userData)).toBe(false);
  });

  it("rolls back capacity and request claims when the membership CAS loses", async () => {
    const squad = makeSquad({ leaderId: "actor", memberCount: 2 });
    const { client, updates } = makeDrizzleMock(squad, [
      [userRequest, [{ rowsAffected: 1 }, { rowsAffected: 1 }]],
      [anbuSquad, [{ rowsAffected: 1 }, { rowsAffected: 1 }]],
      [userData, [{ rowsAffected: 0 }]],
    ]);
    fetchRequestMock.mockResolvedValue({
      id: "request-1",
      senderId: "requester",
      receiverId: "actor",
      relatedId: "squad-1",
      status: "PENDING",
    } as never);
    fetchActorMock.mockResolvedValue({
      user: makeUser({ anbuId: "squad-1" }),
    } as never);
    fetchUserMock.mockResolvedValue(
      makeUser({ userId: "requester", villageId: "village-1" }) as never,
    );

    await expect(
      acceptAnbuRequest({
        ctx: { drizzle: client, userId: "actor" },
        input: { id: "request-1" },
      } as never),
    ).resolves.toEqual({
      success: false,
      message: "Requester already in a squad",
    });
    expect(updates.filter((entry) => entry.table === userRequest)).toHaveLength(2);
    expect(updates.filter((entry) => entry.table === anbuSquad)).toHaveLength(2);
    expect(updates.filter((entry) => entry.table === userData)).toHaveLength(1);
    expect(notifyMock).not.toHaveBeenCalled();
    expect(queuePush).not.toHaveBeenCalled();
  });

  it("does not reassign leaderless requests when another leader claim wins", async () => {
    const squad = makeSquad({ leaderId: null, memberCount: 0 });
    const { client, updates } = makeDrizzleMock(squad, [
      [userRequest, [{ rowsAffected: 1 }]],
      [anbuSquad, [{ rowsAffected: 1 }, { rowsAffected: 0 }]],
      [userData, [{ rowsAffected: 1 }]],
    ]);
    fetchRequestMock.mockResolvedValue({
      id: "request-1",
      senderId: "requester",
      receiverId: "actor",
      relatedId: "squad-1",
      status: "PENDING",
    } as never);
    fetchActorMock.mockResolvedValue({
      user: makeUser({ village: { id: "village-1", kageId: "actor" } }),
    } as never);
    fetchUserMock.mockResolvedValue(
      makeUser({ userId: "requester", rank: "JONIN" }) as never,
    );

    await expect(
      acceptAnbuRequest({
        ctx: { drizzle: client, userId: "actor" },
        input: { id: "request-1" },
      } as never),
    ).resolves.toEqual({ success: true, message: "Request accepted" });
    expect(updates.filter((entry) => entry.table === userRequest)).toHaveLength(1);
    expect(queuePush).toHaveBeenCalledWith(
      client,
      ["requester"],
      membershipUpdate("anbu"),
    );
  });
});

describe("ANBU membership invariants", () => {
  it("atomically refuses to remove the last member", async () => {
    const squad = makeSquad({ leaderId: "member-1", memberCount: 1 });
    const { client, updates } = makeDrizzleMock(squad, [
      [anbuSquad, [{ rowsAffected: 0 }]],
    ]);

    await expect(
      removeFromSquad(client as never, squad as never, "member-1"),
    ).resolves.toBe(false);
    expect(updates.some((entry) => entry.table === userData)).toBe(false);
  });

  it("elects only a live eligible member after the leader leaves", async () => {
    const squad = makeSquad({ leaderId: "leader", memberCount: 2 });
    const { client, updates } = makeDrizzleMock(
      squad,
      [
        [anbuSquad, [{ rowsAffected: 1 }, { rowsAffected: 1 }]],
        [userData, [{ rowsAffected: 1 }]],
        [userRequest, [{ rowsAffected: 1 }]],
      ],
      [{ userId: "successor", rank: "JONIN" }],
    );

    await expect(
      removeFromSquad(client as never, squad as never, "leader"),
    ).resolves.toBe(true);
    expect(
      updates.some(
        (entry) =>
          entry.table === anbuSquad &&
          (entry.values as { leaderId?: string }).leaderId === "successor",
      ),
    ).toBe(true);
  });

  it("uses a membership subquery and outgoing-leader CAS for promotion", async () => {
    const { client, updates, select, selectedPredicates } = makeDrizzleMock(
      makeSquad(),
      [],
    );

    await expect(
      promoteAnbuLeader(client as never, "squad-1", "successor", "leader"),
    ).resolves.toBe(true);
    expect(select).toHaveBeenCalledTimes(1);
    expect(describeSql(selectedPredicates[0])).toContain("`userId`");
    expect(describeSql(selectedPredicates[0])).toContain("`anbuId`");
    expect(updates).toHaveLength(1);
    expect(updates[0]?.table).toBe(anbuSquad);
    expect(updates[0]?.values).toEqual({ leaderId: "successor" });
    expect(describeSql(updates[0]?.predicate)).toContain("`leaderId`");
    expect(describeSql(updates[0]?.predicate)).toContain('"leader"');
  });
});

// Notification transport and router dependencies belong to the current test, including nested suites.
beforeEach(() => {
  vi.spyOn(Pusher.prototype, "trigger").mockImplementation(notifyMock);
  stubProfile("fetchUser", fetchUserMock);
  stubProfile("updateNindo", (() => undefined) as never);
  stubSparring("fetchRequest", fetchRequestMock);
  stubSparring("fetchRequests", fetchRequestsMock);
  stubSparring("insertRequest", insertRequestMock);
  vi.clearAllMocks();
});
afterEach(() => {
  resetServerModuleStubs();
  vi.restoreAllMocks();
});
