import { Pusher } from "@/libs/pusher";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { tournament, tournamentMatch, tournamentRecord } from "@/drizzle/schema";
import { resetServerModuleStubs } from "../../../../setup/serverModules";
import {
  archivedTournamentRecordName,
  syncTournamentState,
} from "@/routers/tournament";

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

const createTournamentRecord = (overrides?: Record<string, unknown>) => {
  const {
    roundStartedAt: _roundStartedAt,
    createdAt: _createdAt,
    status: _status,
    ...record
  } = baseTournament;
  return { ...record, winnerId: "winner-1", ...overrides };
};

const createClient = ({
  recordResponses = [null],
  tournamentResponses = [createTournamentData()],
  updateRowsAffected = [1, 1],
  winner = { userId: "winner-1", username: "Winner" },
}: {
  recordResponses?: Array<unknown>;
  tournamentResponses?: Array<unknown>;
  updateRowsAffected?: number[];
  winner?: unknown;
} = {}) => {
  const userFindFirst = vi.fn().mockResolvedValue(winner);
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
        userData: {
          findFirst: userFindFirst,
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
  const pusherTrigger = vi.fn();
  const updateRewardsMock = vi.fn();

  afterEach(() => {
    resetServerModuleStubs();
    vi.restoreAllMocks();
  });

  /** Runs synchronization with the isolated reward writer configured by each test. */
  const syncTournament = (client: unknown) =>
    syncTournamentState(client as never, "tournament-1", updateRewardsMock);

  beforeEach(() => {
    pusherTrigger.mockClear();
    updateRewardsMock.mockClear();
    vi.spyOn(Pusher.prototype, "trigger").mockImplementation(pusherTrigger);
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
    // A deleted character leaves its match rows behind; the lookup finds no user
    const { client } = createClient({ winner: null });

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

  const nameKeyConflict = () =>
    new Error("Failed query: insert into `TournamentRecord`", {
      cause: new Error(
        "Duplicate entry 'Test Tournament' for key 'TournamentRecord.HistoricalTournament_name_key' (errno 1062)",
      ),
    });

  it("archives the record under a unique name when an older record has the same name", async () => {
    const { client, insertValues } = createClient();
    insertValues.mockRejectedValueOnce(nameKeyConflict());

    const result = await syncTournament(client);

    expect(result).toEqual({ success: true, message: "Tournament synchronized." });
    expect(insertValues).toHaveBeenCalledTimes(2);
    expect(insertValues).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: "tournament-1",
        name: archivedTournamentRecordName("Test Tournament", "tournament-1"),
        winnerId: null,
      }),
    );
    expect(updateRewardsMock).toHaveBeenCalledTimes(1);
    expect(client.delete).toHaveBeenCalledWith(tournament);
  });

  it("recognizes the name key when it only appears in sqlMessage", async () => {
    const { client, insertValues } = createClient();
    const driverError = Object.assign(new Error("ER_DUP_ENTRY"), {
      sqlMessage:
        "Duplicate entry 'Test Tournament' for key 'TournamentRecord.HistoricalTournament_name_key'",
    });
    insertValues.mockRejectedValueOnce(
      new Error("Failed query: insert into `TournamentRecord`", { cause: driverError }),
    );

    const result = await syncTournament(client);

    expect(result).toEqual({ success: true, message: "Tournament synchronized." });
    expect(insertValues).toHaveBeenCalledTimes(2);
    expect(updateRewardsMock).toHaveBeenCalledTimes(1);
  });

  it("does not pay again when the archived-name retry loses to a pending peer", async () => {
    const { client, insertValues } = createClient({
      recordResponses: [null, createTournamentRecord({ winnerId: null })],
    });
    insertValues
      .mockRejectedValueOnce(nameKeyConflict())
      .mockRejectedValueOnce(
        new Error("Duplicate entry 'tournament-1' for key 'PRIMARY'"),
      );

    const result = await syncTournament(client);

    expect(result).toEqual({ success: false, message: FINALIZATION_INCOMPLETE });
    expect(updateRewardsMock).not.toHaveBeenCalled();
    expect(client.update).not.toHaveBeenCalled();
  });

  it("keeps archived names within the column length", () => {
    const name = archivedTournamentRecordName("x".repeat(191), "MR1KargMi8l99v7FB2nkI");
    expect(name.length).toBe(191);
    expect(name.endsWith(" (MR1KargM)")).toBe(true);
  });
});
