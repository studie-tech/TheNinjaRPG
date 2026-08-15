// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { tournament, tournamentMatch, tournamentRecord } from "@/drizzle/schema";

type TournamentTestGlobals = {
  pusherTrigger: ReturnType<typeof vi.fn>;
  fetchUserMock: ReturnType<typeof vi.fn>;
  updateRewardsMock: ReturnType<typeof vi.fn>;
  procedureStub: {
    meta: ReturnType<typeof vi.fn>;
    input: ReturnType<typeof vi.fn>;
    output: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    mutation: ReturnType<typeof vi.fn>;
  };
};

function getTournamentTestMocks(): TournamentTestGlobals {
  const g = globalThis as unknown as { __tournamentTestMocks?: TournamentTestGlobals };
  if (!g.__tournamentTestMocks) {
    const procedureStub = {
      meta: vi.fn().mockReturnThis(),
      input: vi.fn().mockReturnThis(),
      output: vi.fn().mockReturnThis(),
      query: vi.fn().mockReturnThis(),
      mutation: vi.fn().mockReturnThis(),
    };
    g.__tournamentTestMocks = {
      pusherTrigger: vi.fn(),
      fetchUserMock: vi.fn(),
      updateRewardsMock: vi.fn(),
      procedureStub,
    };
  }
  return g.__tournamentTestMocks;
}

vi.mock("@/libs/pusher", () => ({
  getServerPusher: () => ({
    trigger: (...args: unknown[]) =>
      (getTournamentTestMocks().pusherTrigger as (...a: unknown[]) => unknown)(...args),
  }),
}));

vi.mock("@/server/api/trpc", () => ({
  baseServerResponse: {},
  createTRPCRouter: (router: unknown) => router,
  errorResponse: (message: string) => ({ success: false, message }),
  protectedProcedure: getTournamentTestMocks().procedureStub,
}));

vi.mock("@/routers/clan", () => ({
  fetchClan: vi.fn(),
}));

vi.mock("@/routers/combat", () => ({
  initiateBattle: vi.fn(),
}));

vi.mock("@/routers/profile", () => ({
  fetchUser: (...args: unknown[]) =>
    (getTournamentTestMocks().fetchUserMock as (...a: unknown[]) => unknown)(...args),
}));

import { syncTournamentState } from "@/routers/tournament";
const FINALIZATION_INCOMPLETE =
  "Tournament finalization incomplete. Staff recovery required.";

const baseTournament = {
  id: "tournament-1",
  name: "Test Tournament",
  image: "image.png",
  description: "desc",
  round: 1,
  type: "KAGE",
  rewards: { reward_money: 5000 },
  startedAt: new Date("2026-05-01T08:00:00.000Z"),
  roundStartedAt: new Date("2026-05-01T08:00:00.000Z"),
  createdAt: new Date("2026-05-01T07:00:00.000Z"),
  status: "IN_PROGRESS",
};

const finalMatch = {
  id: "match-1",
  tournamentId: "tournament-1",
  round: 1,
  match: 1,
  state: "WAITING",
  winnerId: "winner-1",
  battleId: null,
  userId1: "winner-1",
  userId2: "loser-1",
  createdAt: new Date("2026-05-01T08:00:00.000Z"),
  startedAt: new Date("2026-05-01T08:00:00.000Z"),
  user1: { userId: "winner-1", username: "Winner", avatar: "a.png" },
  user2: { userId: "loser-1", username: "Loser", avatar: "b.png" },
};

const createTournamentData = (overrides?: Partial<typeof baseTournament>) => ({
  ...baseTournament,
  ...overrides,
  matches: [finalMatch],
});

const createTournamentRecord = (overrides?: Record<string, unknown>) => ({
  id: "tournament-1",
  name: "Test Tournament",
  image: "image.png",
  description: "desc",
  round: 1,
  type: "KAGE",
  rewards: { reward_money: 5000 },
  startedAt: new Date("2026-05-01T08:00:00.000Z"),
  winnerId: "winner-1",
  ...overrides,
});

const createClient = ({
  recordResponses = [null],
  tournamentResponses = [createTournamentData()],
  updateRowsAffected = [1, 1],
}: {
  recordResponses?: Array<unknown>;
  tournamentResponses?: Array<unknown>;
  updateRowsAffected?: number[];
} = {}) => {
  const tournamentFindFirst = vi.fn();
  for (const response of tournamentResponses) {
    tournamentFindFirst.mockResolvedValueOnce(response);
  }

  const tournamentRecordFindFirst = vi.fn();
  for (const response of recordResponses) {
    tournamentRecordFindFirst.mockResolvedValueOnce(response);
  }

  const updateWhere = vi.fn();
  for (const rowsAffected of updateRowsAffected) {
    updateWhere.mockResolvedValueOnce({ rowsAffected });
  }
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const deleteWhere = vi.fn().mockResolvedValue({ rowsAffected: 1 });
  const insertValues = vi.fn().mockResolvedValue({ rowsAffected: 1 });

  return {
    client: {
      query: {
        tournament: {
          findFirst: tournamentFindFirst,
        },
        tournamentRecord: {
          findFirst: tournamentRecordFindFirst,
        },
      },
      update: vi.fn().mockReturnValue({ set: updateSet }),
      delete: vi.fn().mockReturnValue({ where: deleteWhere }),
      insert: vi.fn().mockReturnValue({ values: insertValues }),
    },
    tournamentFindFirst,
    tournamentRecordFindFirst,
    updateWhere,
    deleteWhere,
    insertValues,
  };
};

describe("syncTournamentState", () => {
  let pusherTrigger: ReturnType<typeof vi.fn>;
  let fetchUserMock: ReturnType<typeof vi.fn>;
  let updateRewardsMock: ReturnType<typeof vi.fn>;
  let rewardWinner: typeof import("@/routers/quests").updateRewards;

  /** Runs synchronization with the isolated reward writer configured by each test. */
  const syncTournament = (client: unknown) =>
    syncTournamentState(client as never, "tournament-1", rewardWinner);

  beforeEach(() => {
    const mocks = getTournamentTestMocks();
    mocks.pusherTrigger.mockClear();
    mocks.fetchUserMock.mockClear();
    mocks.updateRewardsMock.mockClear();
    pusherTrigger = mocks.pusherTrigger;
    fetchUserMock = mocks.fetchUserMock;
    updateRewardsMock = mocks.updateRewardsMock;
    rewardWinner = updateRewardsMock as unknown as typeof rewardWinner;

    fetchUserMock.mockResolvedValue({
      userId: "winner-1",
      username: "Winner",
    });
    updateRewardsMock.mockResolvedValue(undefined);
  });

  it("finalizes the tournament exactly once when the CAS update wins", async () => {
    const { client, insertValues } = createClient();

    const result = await syncTournament(client);

    expect(result).toEqual({ success: true, message: "Tournament synchronized." });
    expect(client.insert).toHaveBeenCalledWith(tournamentRecord);
    expect(client.update).toHaveBeenNthCalledWith(1, tournament);
    expect(client.update).toHaveBeenNthCalledWith(2, tournamentRecord);
    expect(updateRewardsMock).toHaveBeenCalledTimes(1);
    expect(client.delete).toHaveBeenCalledWith(tournamentMatch);
    expect(client.delete).toHaveBeenCalledWith(tournament);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "tournament-1",
        winnerId: null,
      }),
    );
    expect(pusherTrigger).toHaveBeenCalledTimes(2);
  });

  it("does not mark the tournament completed when the winner user is missing", async () => {
    const { client } = createClient();
    fetchUserMock.mockResolvedValue(null);

    const result = await syncTournament(client);

    expect(result).toEqual({ success: false, message: "Tournament winner not found." });
    expect(client.update).not.toHaveBeenCalled();
    expect(updateRewardsMock).not.toHaveBeenCalled();
    expect(client.insert).not.toHaveBeenCalled();
    expect(client.delete).not.toHaveBeenCalled();
    expect(pusherTrigger).not.toHaveBeenCalled();
  });

  it("returns a manual-recovery error when rewards fail after the claim", async () => {
    const { client } = createClient();
    updateRewardsMock.mockRejectedValueOnce(new Error("boom"));

    const result = await syncTournament(client);

    expect(result).toEqual({ success: false, message: FINALIZATION_INCOMPLETE });
    expect(client.insert).toHaveBeenCalledWith(tournamentRecord);
    expect(client.update).toHaveBeenCalledTimes(1);
    expect(client.update).toHaveBeenCalledWith(tournament);
    expect(client.delete).not.toHaveBeenCalled();
    expect(pusherTrigger).not.toHaveBeenCalled();
  });

  it("blocks recovery when a pending finalization ledger exists", async () => {
    const { client } = createClient({
      tournamentResponses: [createTournamentData({ status: "COMPLETED" })],
      recordResponses: [createTournamentRecord({ winnerId: null })],
    });

    const result = await syncTournament(client);

    expect(result).toEqual({ success: false, message: FINALIZATION_INCOMPLETE });
    expect(updateRewardsMock).not.toHaveBeenCalled();
    expect(client.delete).not.toHaveBeenCalled();
    expect(pusherTrigger).not.toHaveBeenCalled();
  });

  it("resumes cleanup without replaying rewards when the ledger shows rewards already completed", async () => {
    const { client } = createClient({
      tournamentResponses: [createTournamentData({ status: "COMPLETED" })],
      recordResponses: [createTournamentRecord()],
    });

    const result = await syncTournament(client);

    expect(result).toEqual({ success: true, message: "Tournament synchronized." });
    expect(updateRewardsMock).not.toHaveBeenCalled();
    expect(client.delete).toHaveBeenCalledWith(tournamentMatch);
    expect(client.delete).toHaveBeenCalledWith(tournament);
    expect(pusherTrigger).not.toHaveBeenCalled();
  });

  it("does not reach reward grant when the completion CAS loses", async () => {
    const { client, updateWhere } = createClient({
      updateRowsAffected: [0],
    });

    const result = await syncTournament(client);

    expect(result).toEqual({ success: true, message: "Tournament synchronized." });
    expect(updateWhere).toHaveBeenCalledTimes(1);
    expect(updateRewardsMock).not.toHaveBeenCalled();
    expect(client.delete).toHaveBeenCalledWith(tournamentRecord);
    expect(client.delete).not.toHaveBeenCalledWith(tournamentMatch);
    expect(client.delete).not.toHaveBeenCalledWith(tournament);
    expect(pusherTrigger).not.toHaveBeenCalled();
  });

  it("does not grant rewards when record insert races and the ledger row is still pending", async () => {
    const { client, insertValues } = createClient({
      recordResponses: [null, createTournamentRecord({ winnerId: null })],
    });
    insertValues.mockRejectedValueOnce(new Error("ER_DUP_ENTRY"));

    const result = await syncTournament(client);

    expect(result).toEqual({ success: false, message: FINALIZATION_INCOMPLETE });
    expect(updateRewardsMock).not.toHaveBeenCalled();
    expect(client.update).not.toHaveBeenCalled();
  });

  it("cleans up without replaying rewards when duplicate insert loses to a finalized peer", async () => {
    const { client, insertValues } = createClient({
      tournamentResponses: [
        createTournamentData(),
        createTournamentData({ status: "COMPLETED" }),
      ],
      recordResponses: [null, createTournamentRecord({ winnerId: "winner-1" })],
    });
    insertValues.mockRejectedValueOnce(new Error("ER_DUP_ENTRY"));

    const result = await syncTournament(client);

    expect(result).toEqual({ success: true, message: "Tournament synchronized." });
    expect(updateRewardsMock).not.toHaveBeenCalled();
    expect(client.delete).toHaveBeenCalledWith(tournamentMatch);
    expect(client.delete).toHaveBeenCalledWith(tournament);
  });
});
