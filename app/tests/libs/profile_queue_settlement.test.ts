// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchUpdatedUser } from "@/routers/profile";
import type { DrizzleClient } from "@/server/db";

const { settleAllQueuesForUser } = vi.hoisted(() => ({
  settleAllQueuesForUser: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/env/server.mjs", () => ({
  env: { NODE_ENV: "test", NEXT_PUBLIC_BASE_URL: "http://localhost:3000" },
}));
vi.mock("@/env/client.mjs", () => ({
  env: { NEXT_PUBLIC_BASE_URL: "http://localhost:3000" },
}));
vi.mock("@/libs/moderator", () => ({
  moderateContent: vi.fn(),
  validateUserUpdateReason: vi.fn(),
}));
vi.mock("@/server/db", () => ({ drizzleDB: {} }));
vi.mock("@/server/utils/queue", () => ({ settleAllQueuesForUser }));

const client = () => {
  const selection = Object.assign(Promise.resolve([]), {
    from: () => selection,
    where: () => selection,
    leftJoin: () => selection,
    limit: () => selection,
  });
  return {
    select: () => selection,
    query: {
      userData: { findFirst: vi.fn().mockResolvedValue(undefined) },
      war: { findMany: vi.fn().mockResolvedValue([]) },
      mpvpBattleQueue: { findMany: vi.fn().mockResolvedValue([]) },
      quest: { findMany: vi.fn().mockResolvedValue([]) },
    },
  } as unknown as DrizzleClient;
};

describe("profile queue settlement", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not settle queues during ordinary user reads", async () => {
    await fetchUpdatedUser({ client: client(), userId: "missing-user" });
    expect(settleAllQueuesForUser).not.toHaveBeenCalled();
  });

  it("settles once when the profile refresh opts in", async () => {
    const db = client();
    await fetchUpdatedUser({
      client: db,
      userId: "missing-user",
      skipQueueSettlement: false,
    });
    expect(settleAllQueuesForUser).toHaveBeenCalledExactlyOnceWith(db, "missing-user");
  });
});
