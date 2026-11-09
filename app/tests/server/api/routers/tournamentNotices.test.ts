import { fetchEventNoticeState } from "@/queries/tournamentEvents";
import { describe, expect, it, mock } from "bun:test";
import {
  beginEventRound,
  createEventState,
  generateEventBracket,
} from "@/libs/tournament/events";

import type { DrizzleClient } from "@/server/db";
import {
  type EventParticipant,
  type EventTournamentState,
  eventTournamentConfigSchema,
} from "@/validators/tournament";

describe("event notices and participation", () => {
  it("does not mark an unregistered player as a participant", async () => {
    expect(await readNotices([])).toEqual({ notices: [], isEventParticipant: false });
  });

  it("retains participation for a registered seat between ready checks", async () => {
    const event = makeEvent();
    event.participants = [makeSeat("hero")];
    expect(await readNotices([event])).toEqual({
      notices: [],
      isEventParticipant: true,
    });
  });

  it("discards withdrawn seats, outgoing substitutes and missing event data", async () => {
    const event = makeEvent();
    event.participants = [
      { ...makeSeat("hero"), withdrawn: true },
      {
        ...makeSeat("replacement"),
        previousUsers: [{ userId: "hero", username: "hero" }],
      },
    ];
    expect(await readNotices([event, null])).toEqual({
      notices: [],
      isEventParticipant: false,
    });
  });

  it("counts a pending invitation as participation and returns its prompt", async () => {
    const event = makeEvent();
    event.participants = [{ ...makeSeat("hero"), accepted: false }];
    const result = await readNotices([event]);
    expect(result.isEventParticipant).toBe(true);
    expect(result.notices).toEqual([
      {
        tournamentId: "event-0",
        name: event.config.name,
        message: "You have a tournament invitation",
        deadline: event.config.registrationClosesAt,
      },
    ]);
  });

  it("keeps participants eligible after an invitation's response deadline", async () => {
    const event = makeEvent();
    event.config.registrationClosesAt = Date.now() - 1000;
    event.participants = [{ ...makeSeat("hero"), accepted: false }];
    expect(await readNotices([event])).toEqual({
      notices: [],
      isEventParticipant: true,
    });
  });

  it("returns a ready check and retains participation after the player accepts it", async () => {
    const event = makeEvent();
    event.participants = [makeSeat("hero"), makeSeat("foe")];
    generateEventBracket(
      event,
      event.participants.map((seat) => seat.id),
    );
    beginEventRound(event, Date.now() - 1000);
    const game = event.series[0]!.games[0]!;
    game.opensAt = Date.now() - 1000;
    game.deadline = Date.now() + 60000;
    const result = await readNotices([event]);
    expect(result.isEventParticipant).toBe(true);
    expect(result.notices[0]?.message).toBe("Your tournament match is ready");
    game.accepted.push("hero");
    expect(await readNotices([event])).toEqual({
      notices: [],
      isEventParticipant: true,
    });
  });
});

/** Read notice state through the existing single-query boundary without a shared SQL database. */
const readNotices = async (events: (EventTournamentState | null)[]) => {
  const findMany = mock(async () =>
    events.map((eventData, index) => ({ id: `event-${index}`, eventData })),
  );
  const client = { query: { tournament: { findMany } } } as unknown as DrizzleClient;
  const result = await fetchEventNoticeState(client, "hero");
  expect(findMany).toHaveBeenCalledTimes(1);
  return result;
};

const makeSeat = (userId: string): EventParticipant => ({
  id: `seat-${userId}`,
  userId,
  username: userId,
  invited: true,
  accepted: true,
  withdrawn: false,
  seed: 0,
  previousUsers: [],
  snapshot: { bracket: 0, pvpWins: 0, winRate: 0, masteredJutsu: 0 },
});

const makeEvent = () => ({
  ...createEventState(
    eventTournamentConfigSchema.parse({
      name: "Notice Cup",
      description: "Wake Island tournament",
      registration: "OPEN",
      format: "SINGLE_ELIMINATION",
      seeding: "RANDOM",
      rules: "OPEN",
      scheduling: "SIMULTANEOUS",
      capacity: 64,
      bestOf: 1,
      roundBestOf: [],
      minBracket: 0,
      maxBracket: 7,
      minPvpWins: 0,
      minWinRate: 0,
      minMasteredJutsu: 0,
      registrationClosesAt: Date.now() + 60000,
      endsAt: Date.now() + 3600000,
      rewards: {
        winner: {},
        runnerUp: {},
        semifinalist: {},
        participation: {},
        perWin: {},
      },
    }),
  ),
  status: "REGISTRATION" as EventTournamentState["status"],
});
