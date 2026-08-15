// @vitest-environment node

import { and, eq, isNull, or, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { anbuSquad, userData, userRequest } from "@/drizzle/schema";

type AnbuTestMocks = {
  fetchActor: ReturnType<typeof vi.fn>;
  fetchPendingRequest: ReturnType<typeof vi.fn>;
  fetchUser: ReturnType<typeof vi.fn>;
  fetchRequest: ReturnType<typeof vi.fn>;
  fetchRequests: ReturnType<typeof vi.fn>;
  insertRequest: ReturnType<typeof vi.fn>;
  notify: ReturnType<typeof vi.fn>;
};

function getAnbuTestMocks(): AnbuTestMocks {
  const globals = globalThis as unknown as { __anbuTestMocks?: AnbuTestMocks };
  if (!globals.__anbuTestMocks) {
    globals.__anbuTestMocks = {
      fetchActor: vi.fn(),
      fetchPendingRequest: vi.fn(),
      fetchUser: vi.fn(),
      fetchRequest: vi.fn(),
      fetchRequests: vi.fn(),
      insertRequest: vi.fn(),
      notify: vi.fn(),
    };
  }
  return globals.__anbuTestMocks;
}

vi.mock("@/libs/pusher", () => ({
  getServerPusher: () => ({
    trigger: (...args: unknown[]) =>
      (getAnbuTestMocks().notify as (...values: unknown[]) => unknown)(...args),
  }),
}));

vi.mock("@/routers/profile", () => ({
  fetchUser: (...args: unknown[]) =>
    (getAnbuTestMocks().fetchUser as (...values: unknown[]) => unknown)(...args),
  updateNindo: vi.fn(),
}));

vi.mock("@/routers/sparring", () => ({
  fetchRequest: (...args: unknown[]) =>
    (getAnbuTestMocks().fetchRequest as (...values: unknown[]) => unknown)(...args),
  fetchRequests: (...args: unknown[]) =>
    (getAnbuTestMocks().fetchRequests as (...values: unknown[]) => unknown)(...args),
  insertRequest: (...args: unknown[]) =>
    (getAnbuTestMocks().insertRequest as (...values: unknown[]) => unknown)(...args),
}));

import {
  acceptAnbuRequest,
  createAnbuRequest,
  fetchSquadForAnbuRequest,
  getAnbuRequests,
  isAnbuRequestForSquad,
  promoteAnbuLeader,
  rejectAnbuRequest,
  reassignPendingAnbuRequestsOnPromotion,
  removeFromSquad,
} from "@/routers/anbu";

const {
  fetchActor: fetchActorMock,
  fetchPendingRequest: fetchPendingRequestMock,
  fetchUser: fetchUserMock,
  fetchRequest: fetchRequestMock,
  fetchRequests: fetchRequestsMock,
  insertRequest: insertRequestMock,
  notify: notifyMock,
} = getAnbuTestMocks();

/** Stable string form of a drizzle SQL predicate for assertion (cols + params). */
function describeSql(node: unknown): string {
  if (!node || typeof node !== "object") return String(node);
  const obj = node as Record<string, unknown>;
  if ("name" in obj && "columnType" in obj) return `col(${String(obj.name)})`;
  if ("value" in obj && Array.isArray(obj.value) && !("queryChunks" in obj)) {
    return (obj.value as unknown[]).map(String).join("");
  }
  if ("value" in obj && !("queryChunks" in obj) && !Array.isArray(obj.value)) {
    return `param(${JSON.stringify(obj.value)})`;
  }
  if ("queryChunks" in obj && Array.isArray(obj.queryChunks)) {
    return (obj.queryChunks as unknown[]).map(describeSql).join("");
  }
  return Object.prototype.toString.call(node);
}

describe("ANBU request squad identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("matches requests by relatedId even when receiverId is stale", () => {
    expect(
      isAnbuRequestForSquad(
        { relatedId: "squad-1", receiverId: "old-leader" },
        "squad-1",
        "new-leader",
      ),
    ).toBe(true);
    expect(
      isAnbuRequestForSquad(
        { relatedId: "squad-other", receiverId: "new-leader" },
        "squad-1",
        "new-leader",
      ),
    ).toBe(false);
  });

  it("matches legacy requests without relatedId via current leader receiverId", () => {
    expect(
      isAnbuRequestForSquad(
        { relatedId: null, receiverId: "leader-1" },
        "squad-1",
        "leader-1",
      ),
    ).toBe(true);
    expect(
      isAnbuRequestForSquad(
        { relatedId: null, receiverId: "other-leader" },
        "squad-1",
        "leader-1",
      ),
    ).toBe(false);
    expect(
      isAnbuRequestForSquad(
        { relatedId: null, receiverId: "leader-1" },
        "squad-1",
        null,
      ),
    ).toBe(false);
  });

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

    const result = await fetchSquadForAnbuRequest(client as never, {
      relatedId: "squad-1",
      // Stale receiver from before promoteMember reassignment
      receiverId: "old-leader",
    });

    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(describeSql(findFirst.mock.calls[0]?.[0]?.where)).toBe(
      expectedWhere,
    );
    expect(result).toEqual(squad);
    expect(result?.leaderId).toBe("new-leader");
    expect(result?.leaderId).not.toBe("old-leader");
  });

  it("falls back to receiverId for legacy requests without relatedId", async () => {
    const squad = {
      id: "squad-1",
      leaderId: "old-leader",
      villageId: "village-1",
      members: [],
    };
    const expectedWhere = describeSql(eq(anbuSquad.leaderId, "old-leader"));
    const findFirst = vi.fn().mockImplementation((args: { where: unknown }) => {
      // Only succeed when looking up by leader id (legacy path)
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

    const result = await fetchSquadForAnbuRequest(client as never, {
      relatedId: null,
      receiverId: "old-leader",
    });

    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(describeSql(findFirst.mock.calls[0]?.[0]?.where)).toBe(
      expectedWhere,
    );
    expect(result).toEqual(squad);
  });

  it("reassigns pending requests to the new leader and sets relatedId on promotion", async () => {
    const expectedWhere = describeSql(
      and(
        eq(userRequest.type, "ANBU"),
        eq(userRequest.status, "PENDING"),
        or(
          eq(userRequest.relatedId, "squad-1"),
          and(
            isNull(userRequest.relatedId),
            eq(userRequest.receiverId, "old-leader"),
          ),
        ),
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
      "old-leader",
      "new-leader",
    );

    expect(client.update).toHaveBeenCalledWith(userRequest);
    expect(set).toHaveBeenCalledWith({
      receiverId: "new-leader",
      relatedId: "squad-1",
    });
    expect(where).toHaveBeenCalledTimes(1);
    expect(describeSql(where.mock.calls[0]?.[0])).toBe(expectedWhere);
  });

  it("anchors relatedId without changing receiverId when there is no successor", async () => {
    const where = vi.fn().mockResolvedValue({ rowsAffected: 1 });
    const set = vi.fn().mockReturnValue({ where });
    const client = {
      update: vi.fn().mockReturnValue({ set }),
    };

    await reassignPendingAnbuRequestsOnPromotion(
      client as never,
      "squad-1",
      "old-leader",
      null,
    );

    expect(set).toHaveBeenCalledWith({ relatedId: "squad-1" });
    expect(set).not.toHaveBeenCalledWith(
      expect.objectContaining({ receiverId: expect.anything() }),
    );
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
            const actor = await (
              fetchActorMock as (...values: unknown[]) => unknown
            )(args);
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
    const squadRequest = { ...ownForThisSquad, id: "managed-1" };
    fetchRequestsMock.mockImplementation(
      async (_client, _types, _seconds, id, relatedId) =>
        (relatedId
          ? [squadRequest]
          : id
            ? [ownForThisSquad, ownForOtherSquad]
            : []) as never,
    );

    fetchActorMock.mockResolvedValueOnce({
      user: makeUser({ anbuId: "squad-1" }),
    } as never);
    await expect(
      getAnbuRequests(
        {
          ctx: { drizzle: client, userId: "actor" },
          input: { squadId: "squad-1" },
        } as never,
      ),
    ).resolves.toEqual([squadRequest]);
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
      getAnbuRequests(
        {
          ctx: { drizzle: client, userId: "applicant" },
          input: { squadId: "squad-1" },
        } as never,
      ),
    ).resolves.toEqual([ownForThisSquad]);
    expect(fetchRequestsMock).toHaveBeenCalledTimes(2);
    expect(fetchRequestsMock).toHaveBeenLastCalledWith(
      client,
      ["ANBU"],
      3600 * 12,
      "applicant",
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
      getAnbuRequests(
        {
          ctx: { drizzle: client, userId: "actor" },
          input: { squadId: "squad-1" },
        } as never,
      ),
    ).resolves.toEqual([]);
    expect(fetchRequestsMock).not.toHaveBeenCalled();
  });

  it("blocks duplicate pending requests before insert", async () => {
    const squad = makeSquad();
    const { client } = makeDrizzleMock(squad, []);
    fetchActorMock.mockResolvedValue({ user: makeUser() } as never);
    fetchPendingRequestMock.mockResolvedValue({ id: "request-1" } as never);

    await expect(
      createAnbuRequest(
        {
          ctx: { drizzle: client, userId: "actor" },
          input: { squadId: "squad-1" },
        } as never,
      ),
    ).resolves.toEqual({
      success: false,
      message: "You already have a pending ANBU request",
    });
    expect(insertRequestMock).not.toHaveBeenCalled();
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
      acceptAnbuRequest(
        {
          ctx: { drizzle: client, userId: "actor" },
          input: { id: "request-1" },
        } as never,
      ),
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
      rejectAnbuRequest(
        {
          ctx: { drizzle: client, userId: "actor" },
          input: { id: "request-1" },
        } as never,
      ),
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
      rejectAnbuRequest(
        {
          ctx: { drizzle: client, userId: "actor" },
          input: { id: "request-1" },
        } as never,
      ),
    ).resolves.toEqual({ success: false, message: "Squad not found" });
    expect(update).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
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
        acceptAnbuRequest(
          {
            ctx: { drizzle: client, userId: "actor" },
            input: { id: "request-1" },
          } as never,
        ),
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
      acceptAnbuRequest(
        {
          ctx: { drizzle: client, userId: "actor" },
          input: { id: "request-1" },
        } as never,
      ),
    ).resolves.toEqual({ success: false, message: "Squad is full" });
    expect(updates.filter((entry) => entry.table === userRequest)).toHaveLength(
      2,
    );
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
      acceptAnbuRequest(
        {
          ctx: { drizzle: client, userId: "actor" },
          input: { id: "request-1" },
        } as never,
      ),
    ).resolves.toEqual({
      success: false,
      message: "Requester already in a squad",
    });
    expect(updates.filter((entry) => entry.table === userRequest)).toHaveLength(
      2,
    );
    expect(updates.filter((entry) => entry.table === anbuSquad)).toHaveLength(
      2,
    );
    expect(updates.filter((entry) => entry.table === userData)).toHaveLength(1);
    expect(notifyMock).not.toHaveBeenCalled();
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
      acceptAnbuRequest(
        {
          ctx: { drizzle: client, userId: "actor" },
          input: { id: "request-1" },
        } as never,
      ),
    ).resolves.toEqual({ success: true, message: "Request accepted" });
    expect(updates.filter((entry) => entry.table === userRequest)).toHaveLength(
      1,
    );
  });
});

describe("ANBU membership invariants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
    expect(describeSql(selectedPredicates[0])).toContain("col(userId)");
    expect(describeSql(selectedPredicates[0])).toContain("col(anbuId)");
    expect(updates).toHaveLength(1);
    expect(updates[0]?.table).toBe(anbuSquad);
    expect(updates[0]?.values).toEqual({ leaderId: "successor" });
    expect(describeSql(updates[0]?.predicate)).toContain("col(leaderId)");
    expect(describeSql(updates[0]?.predicate)).toContain('param("leader")');
  });
});
