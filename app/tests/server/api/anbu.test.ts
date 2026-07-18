// @vitest-environment node

import { and, eq, isNull, or } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { anbuSquad, userRequest } from "@/drizzle/schema";

type AnbuTestGlobals = {
  pusherTrigger: ReturnType<typeof vi.fn>;
  procedureStub: {
    meta: ReturnType<typeof vi.fn>;
    input: ReturnType<typeof vi.fn>;
    output: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    mutation: ReturnType<typeof vi.fn>;
  };
};

function getAnbuTestMocks(): AnbuTestGlobals {
  const g = globalThis as unknown as { __anbuTestMocks?: AnbuTestGlobals };
  if (!g.__anbuTestMocks) {
    const procedureStub = {
      meta: vi.fn().mockReturnThis(),
      input: vi.fn().mockReturnThis(),
      output: vi.fn().mockReturnThis(),
      query: vi.fn().mockReturnThis(),
      mutation: vi.fn().mockReturnThis(),
    };
    g.__anbuTestMocks = {
      pusherTrigger: vi.fn(),
      procedureStub,
    };
  }
  return g.__anbuTestMocks;
}

vi.mock("@/libs/pusher", () => ({
  getServerPusher: () => ({
    trigger: (...args: unknown[]) =>
      (getAnbuTestMocks().pusherTrigger as (...a: unknown[]) => unknown)(...args),
  }),
}));

vi.mock("@/server/api/trpc", () => ({
  baseServerResponse: {},
  createTRPCRouter: (router: unknown) => router,
  errorResponse: (message: string) => ({ success: false, message }),
  protectedProcedure: getAnbuTestMocks().procedureStub,
}));

vi.mock("@/routers/profile", () => ({
  fetchUpdatedUser: vi.fn(),
  fetchUser: vi.fn(),
  updateNindo: vi.fn(),
}));

vi.mock("@/routers/village", () => ({
  fetchVillage: vi.fn(),
}));

vi.mock("@/routers/comments", () => ({
  createConvo: vi.fn(),
}));

vi.mock("@/routers/clan", () => ({
  fetchClans: vi.fn(),
}));

vi.mock("@/routers/sparring", () => ({
  fetchRequest: vi.fn(),
  fetchRequests: vi.fn(),
  insertRequest: vi.fn(),
  updateRequestState: vi.fn(),
}));

import {
  fetchSquadForAnbuRequest,
  isAnbuRequestForSquad,
  reassignPendingAnbuRequestsOnPromotion,
} from "@/routers/anbu";

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
    expect(describeSql(findFirst.mock.calls[0]?.[0]?.where)).toBe(expectedWhere);
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
    expect(describeSql(findFirst.mock.calls[0]?.[0]?.where)).toBe(expectedWhere);
    expect(result).toEqual(squad);
  });

  it("reassigns pending requests to the new leader and sets relatedId on promotion", async () => {
    const expectedWhere = describeSql(
      and(
        eq(userRequest.type, "ANBU"),
        eq(userRequest.status, "PENDING"),
        or(
          eq(userRequest.relatedId, "squad-1"),
          and(isNull(userRequest.relatedId), eq(userRequest.receiverId, "old-leader")),
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
