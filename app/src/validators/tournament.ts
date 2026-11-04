import { z } from "zod";
import {
  EVENT_TOURNAMENT_MAX_CAPACITY,
  EVENT_TOURNAMENT_MIN_CAPACITY,
  MAX_PVP_BRACKET,
} from "@/drizzle/constants";
import { ObjectiveReward } from "@/validators/rewards";

export const tournamentCreateSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(3).max(88),
  image: z.string(),
  description: z.string().trim().min(3).max(500),
  type: z.literal("CLAN"),
  rewards: ObjectiveReward,
});

export type TournamentCreateSchema = z.infer<typeof tournamentCreateSchema>;
export type TournamentCreateSchemaInput = z.input<typeof tournamentCreateSchema>;

/** Allowed best-of settings, shared by the default and per-round overrides. */
const seriesLength = z.union([z.literal(1), z.literal(3), z.literal(5)]);
/** Staff configuration; schedule values are Unix milliseconds and rewards use quest schemas. */
export const eventTournamentConfigSchema = z
  .object({
    name: z.string().trim().min(3).max(88),
    description: z.string().trim().min(3).max(500),
    registration: z.enum(["OPEN", "INVITE_ONLY"]),
    format: z.enum(["SINGLE_ELIMINATION", "DOUBLE_ELIMINATION", "ROUND_ROBIN"]),
    seeding: z.enum(["RANDOM", "PVP_WINS"]),
    rules: z.enum(["OPEN", "RANKED", "AI"]),
    scheduling: z.enum(["SIMULTANEOUS", "SEQUENTIAL"]),
    capacity: z
      .number()
      .int()
      .min(EVENT_TOURNAMENT_MIN_CAPACITY)
      .max(EVENT_TOURNAMENT_MAX_CAPACITY),
    bestOf: seriesLength,
    roundBestOf: z.array(seriesLength).max(64),
    minBracket: z.number().int().min(0).max(MAX_PVP_BRACKET),
    maxBracket: z.number().int().min(0).max(MAX_PVP_BRACKET),
    minPvpWins: z.number().int().min(0),
    minWinRate: z.number().min(0).max(100),
    minMasteredJutsu: z.number().int().min(0),
    registrationClosesAt: z.number().int().positive(),
    endsAt: z.number().int().positive(),
    rewards: z.object({
      winner: ObjectiveReward,
      runnerUp: ObjectiveReward,
      semifinalist: ObjectiveReward,
      participation: ObjectiveReward,
      perWin: ObjectiveReward,
    }),
  })
  .refine((v) => v.minBracket <= v.maxBracket, "Minimum bracket exceeds maximum")
  .refine(
    (v) => v.endsAt > v.registrationClosesAt,
    "Tournament must end after registration",
  );

/** Shared identity for authenticated event reads and mutations. */
export const eventTournamentIdSchema = z.object({ tournamentId: z.string().min(1) });
/** An omitted tournament ID creates a draft; an existing ID edits an editable draft. */
export const eventTournamentSaveSchema = z.object({
  tournamentId: z.string().optional(),
  config: eventTournamentConfigSchema,
});
/** Staff commands; the router validates each action's fields and current event phase. */
export const eventTournamentActionSchema = eventTournamentIdSchema.extend({
  action: z.enum([
    "PUBLISH",
    "SEED",
    "BEGIN",
    "CANCEL",
    "INVITE",
    "REMOVE_INVITE",
    "SUBSTITUTE",
  ]),
  userId: z.string().optional(),
  seatId: z.string().optional(),
  seriesId: z.string().optional(),
  scheduledAt: z.number().int().positive().optional(),
  payRewards: z.boolean().optional(),
});
/** Player commands for registration, advisory series readiness and timed match acceptance. */
export const eventTournamentPlayerSchema = eventTournamentIdSchema.extend({
  action: z.enum(["JOIN", "WITHDRAW", "DECLINE", "ACCEPT", "READY", "NOT_READY"]),
  seriesId: z.string().optional(),
});

/** Validated staff settings persisted with the event state. */
export type EventTournamentConfig = z.infer<typeof eventTournamentConfigSchema>;
/**
 * A stable bracket seat whose current player may be substituted between games.
 * Entry statistics are frozen; former holders remain available for earned reward attribution.
 */
export type EventParticipant = {
  id: string;
  userId: string;
  username: string;
  invited: boolean;
  accepted: boolean;
  withdrawn: boolean;
  seed: number;
  snapshot: {
    bracket: number;
    pvpWins: number;
    winRate: number;
    masteredJutsu: number;
  };
  previousUsers: { userId: string; username: string }[];
};
/** A seat, a completed series' result, or an empty bye in the bracket graph. */
export type EventSlot =
  | { seatId: string }
  | { seriesId: string; result: "WINNER" | "LOSER" }
  | null;
/** One ready check and battle; its identity survives launch recovery. Times are Unix milliseconds. */
export type EventGame = {
  id: string;
  battleId: string;
  status: "READY" | "STARTING" | "FIGHTING" | "COMPLETE";
  opensAt: number;
  deadline: number;
  accepted: string[];
  userIds: string[];
  /** Winning user ID, unlike the seat IDs used by EventSeries. */
  winnerId: string | null;
  outcome: "BATTLE" | "NO_SHOW" | "DOUBLE_NO_SHOW" | "DRAW" | null;
};
/** A best-of series whose seats, winnerId and loserId refer to stable participant seat IDs. */
export type EventSeries = {
  id: string;
  round: number;
  bracket: "WINNERS" | "LOSERS" | "FINAL" | "LEAGUE";
  slots: [EventSlot, EventSlot];
  seats: [string | null, string | null];
  resolved: boolean;
  complete: boolean;
  winnerId: string | null;
  loserId: string | null;
  /** The player who earned this series win, preserved across later substitutions. */
  winnerUserId: string | null;
  bestOf: 1 | 3 | 5;
  scores: [number, number];
  dodges: [number, number];
  games: EventGame[];
  /** Advisory readiness for this series before staff opens its first match. */
  readyUserIds?: string[];
  begun: boolean;
  scheduledAt: number | null;
};
/**
 * Event JSON updated through the Tournament row's separate version CAS.
 * PREPARED retains the staff start gate; standings contain participant seat IDs.
 */
export type EventTournamentState = {
  config: EventTournamentConfig;
  status: "DRAFT" | "REGISTRATION" | "PREPARED" | "RUNNING" | "COMPLETED" | "CANCELLED";
  participants: EventParticipant[];
  series: EventSeries[];
  activeRound: number | null;
  scheduledRoundAt: number | null;
  finishedAt: number | null;
  payRewards: boolean;
  standings: (string | null)[];
  audit: { userId: string; action: string; at: number }[];
};
