import { z } from "zod";
import type {
  ItemRarity,
  KessenMatchKind,
  KessenMatchStatus,
  KessenTier,
  UserRank,
  UserRequestState,
} from "@/drizzle/constants";
import type { KessenDeckCard } from "@/drizzle/schema";
import type {
  KessenAcademyLessonKey,
  KessenAcademyProgress,
} from "@/libs/kessen/academy";
import { type DeckFaction, KESSEN_DECK_FACTIONS } from "@/libs/kessen/deck";
import type { KessenNpcKey, KessenNpcMode } from "@/libs/kessen/npcs";
import type {
  KessenCard,
  KessenEvent,
  MatchState,
  MatchView,
  Seat,
} from "@/libs/kessen/types";
import { type KessenFaction, KessenRows } from "@/validators/itemCard";
import type { QuestChallengeRequest } from "@/validators/questChallenge";

/** Factions a deck is built around (every faction but Neutral). */
export const kessenDeckFactionSchema = z.enum(KESSEN_DECK_FACTIONS);

/** Instance ids (`s0-12`, `t-1`); generous bounds, the engine validates. */
const kessenInstanceId = z.string().min(1).max(32);
const kessenTargetList = z.array(kessenInstanceId).max(12);

/** One player decision; the engine validates it against the stored match. */
export const kessenActionSchema = z.discriminatedUnion("t", [
  z.strictObject({
    t: z.literal("play"),
    card: kessenInstanceId,
    row: z.enum(KessenRows).optional(),
    targets: kessenTargetList.optional(),
  }),
  z.strictObject({
    t: z.literal("leader"),
    row: z.enum(KessenRows).optional(),
    targets: kessenTargetList.optional(),
  }),
  z.strictObject({ t: z.literal("pass") }),
  z.strictObject({ t: z.literal("mull"), cards: z.array(kessenInstanceId).max(10) }),
]);

/**
 * The deck a match is played with: a saved deck, today's loaner of a faction, or a
 * saved deck whose missing copies are filled with borrowed cards.
 */
export const kessenDeckSourceSchema = z.discriminatedUnion("source", [
  z.strictObject({ source: z.literal("saved"), deckId: z.string().min(1).max(191) }),
  z.strictObject({ source: z.literal("loaner"), faction: kessenDeckFactionSchema }),
  z.strictObject({ source: z.literal("fill"), deckId: z.string().min(1).max(191) }),
]);
export type KessenDeckSource = z.infer<typeof kessenDeckSourceSchema>;

/**
 * A deck source as one string (`saved:<id>`, `fill:<id>`, `loaner:<FACTION>`): how a
 * pending challenge keeps the challenger's deck in `UserRequest.relatedId`.
 */
export const encodeKessenDeckSource = (deck: KessenDeckSource) =>
  deck.source === "loaner" ? `loaner:${deck.faction}` : `${deck.source}:${deck.deckId}`;

/** The deck source `encodeKessenDeckSource` wrote, or null for any other text. */
export const decodeKessenDeckSource = (
  text: string | null | undefined,
): KessenDeckSource | null => {
  const split = text?.indexOf(":") ?? -1;
  if (!text || split < 1) return null;
  const source = text.slice(0, split);
  const value = text.slice(split + 1);
  const parsed = kessenDeckSourceSchema.safeParse(
    source === "loaner" ? { source, faction: value } : { source, deckId: value },
  );
  return parsed.success ? parsed.data : null;
};

export type KessenMode = KessenNpcMode;

/** A first-win reward that still waits for the player's pick. */
export type KessenFirstWinChoice =
  /** Pick one of `options` (item ids) with `kessen.claimFirstWinChoice`. */
  | { kind: "items"; options: string[]; claimed: string | null }
  /** Pick one standard legendary not yet owned with `kessen.claimFirstWinChoice`. */
  | { kind: "unownedLegendary"; options: string[]; claimed: string | null }
  /** Pick a faction with `kessenCollection.chooseStarter`. */
  | { kind: "starterFaction" };

/** What a finished match paid, as shown on the match-end screen. */
export interface KessenMatchResult {
  /** Engine winner (seat 0 is the player); null for a draw or a match that did not finish. */
  winner: Seat | null;
  rewarded: boolean;
  /** Why the match paid no reward; null when rewarded. */
  reason: string | null;
  ryo: number;
  /** The drop table's card, then a Kage win's Forbidden variant, each when rolled. */
  drops: {
    itemId: string;
    rarity: ItemRarity;
    forbidden: boolean;
    /** Every card of that rarity was maxed, so a surplus copy was granted. */
    surplus: boolean;
    /** Ryo the surplus copy was auto-sold for (auto-sell enabled); null when granted. */
    soldFor: number | null;
  }[];
  /** First win against this NPC and mode: granted items and a pending choice. */
  firstWin: { itemIds: string[]; choice: KessenFirstWinChoice | null } | null;
  /** The week's first rewarded win granted a Paper Bundle. */
  weeklyFirstWinPack: boolean;
  /** This match completed its Academy lesson for the first time. */
  lessonCompleted: boolean;
  /** An Academy lesson's reward; null for every other match. */
  academy: {
    lesson: KessenAcademyLessonKey;
    /** Ryo the first completion paid (also counted in `ryo`); 0 for a replay. */
    ryo: number;
    /** The pack granted for completing the whole Academy with this lesson. */
    graduationPackId: string | null;
  } | null;
}

/** One match as the player sees it; `view` is redacted for seat 0. */
export interface KessenMatchPayload {
  id: string;
  /** Optimistic-concurrency version; send it back with every action. */
  version: number;
  status: KessenMatchStatus;
  npcKey: KessenNpcKey;
  mode: KessenMode;
  /** The Academy lesson of a lesson match; null for every other match. */
  lesson: KessenAcademyLessonKey | null;
  tier: KessenTier;
  startedAt: Date;
  /** The quest objective a challenge match is played for; absent for every other match. */
  challenge?: QuestChallengeRequest | null;
  view: MatchView;
  /** Card item ids that were lent for this match (loaner or fill). */
  borrowed: string[];
  result: KessenMatchResult | null;
}

/**
 * The play log of a duel as its viewer may see it, oldest event first. It reflects the
 * match at `version`; `inst` names every instance the events refer to.
 */
export interface KessenMatchLog {
  version: number;
  events: KessenEvent[];
  inst: Record<string, string>;
}

/** What `kessen.getMatch` returns and caches. */
export interface KessenMatchQuery {
  match: KessenMatchPayload | null;
}

/** One card of the public catalog, with display fields. */
export type KessenCatalogEntry = KessenCard & {
  image: string;
  artUrl: string;
  focalX: number;
  focalY: number;
  flavor: string;
  /** Title of a leader's ability (e.g. "Sunflare"); null for other cards. */
  abilityName: string | null;
  /** Collection book number; null for leaders, variants and tokens. */
  number: number | null;
};

/** Slot odds of a pack tier in basis points (out of 10,000). */
export type KessenPackOdds = Record<ItemRarity | "FORBIDDEN", number>;

/** A card pack of the catalog with the odds and slots read from its stored caches. */
export interface KessenPackEntry {
  id: string;
  name: string;
  image: string;
  description: string;
  odds: { normal: KessenPackOdds; rareSlot: KessenPackOdds };
  /** Cards the pack opens per slot kind; `kessenPackSlotLabels` words them. */
  slots: KessenPackSlots;
  /** Factions of the cards the pack can grant. */
  factions: KessenFaction[];
}

/** How many cards a pack's normal slots and its last (rare) slot hold. */
export interface KessenPackSlots {
  normal: number;
  rareSlot: number;
}

/** What `kessen.getCatalog` returns: every card and pack, the same for every player. */
export interface KessenCatalog {
  /** Hash of the engine-relevant card fields (`catalogFingerprint`). */
  fingerprint: string;
  cards: KessenCatalogEntry[];
  packs: KessenPackEntry[];
}

/** A saved deck of the player. */
export interface KessenDeckRow {
  id: string;
  name: string;
  leaderItemId: string;
  cards: KessenDeckCard[];
  updatedAt: Date;
}

/** One NPC of the Circuit with the player's record against it. */
export interface KessenCircuitEntry {
  key: KessenNpcKey;
  name: string;
  title: string;
  location: string;
  image: string;
  faction: DeckFaction;
  boss: boolean;
  champion: boolean;
  tier: KessenTier;
  ascendedTier: KessenTier | null;
  /** Why the standard match is locked; null when it can be challenged. */
  lockReason: string | null;
  /** Null when the Ascended rematch can be challenged or the NPC has none. */
  ascendedLockReason: string | null;
  wins: number;
  firstWinAt: Date | null;
  ascendedFirstWinAt: Date | null;
  /** Items the next standard first win grants (empty once claimed). */
  firstWinPreview: string[];
  houseRule: { name: string; text: string } | null;
  teaches: string[];
  /** The unfinished Academy lesson that teaches this opponent's keywords, if any. */
  recommendedLesson: KessenAcademyLessonKey | null;
}

/** One stack of unopened packs in the inventory. */
export interface KessenOwnedPack {
  userItemId: string;
  itemId: string;
  name: string;
  quantity: number;
}

/** Everything the Card Hall lobby needs for the signed-in player. */
export interface KessenHub {
  progress: {
    lessonCompleted: boolean;
    starterGranted: boolean;
    starterFaction: DeckFaction | null;
    seenKeywords: string[];
  };
  /** Owned copies per card item id, excluding copies listed in the auction house. */
  owned: Record<string, number>;
  /** Copies per card item id listed in the auction house; still the player's. */
  listed: Record<string, number>;
  /** The player's unopened pack stacks. */
  packs: KessenOwnedPack[];
  decks: KessenDeckRow[];
  circuit: KessenCircuitEntry[];
  today: {
    rewarded: number;
    rewardedCap: number;
    drops: number;
    dropsCap: number;
  };
  /** This week's counters; weeks start Monday 00:00 UTC. */
  week: {
    /** True while this week's first rewarded win still grants a Paper Bundle. */
    firstWinPack: boolean;
  };
  activeMatch: {
    id: string;
    npcKey: KessenNpcKey;
    mode: KessenMode;
    /** The Academy lesson of an active lesson match. */
    lesson: KessenAcademyLessonKey | null;
    /** The quest objective of an active quest challenge match. */
    challenge: QuestChallengeRequest | null;
    /** Round being played, 1 to 3. */
    round: number;
    /** Rounds won so far, `[player, opponent]`. */
    roundWins: [number, number];
    /** Whether the player is to act (a mulligan or a play). */
    yourTurn: boolean;
  } | null;
  /** Finished matches whose first-win card pick is still open, newest first. */
  pendingPicks: { matchId: string; npcKey: KessenNpcKey }[];
  /** Lemu's Academy: every lesson with its standing, and the recommended next one. */
  academy: KessenAcademyProgress;
  homeFaction: DeckFaction | null;
  loanerFaction: DeckFaction;
  needsLesson: boolean;
  needsStarter: boolean;
  pity: { epicIn: number; legendaryIn: number };
  autoSellSurplus: boolean;
}

/**
 * What `KessenMatch.state` stores: the engine state plus the match context the server
 * needs on every turn, so a turn is one read. `pool` holds the catalog cards taken at
 * the start that the AI and the payout read (`npcMatchPool`); `aiDeck` is the NPC's
 * list, one id per copy.
 */
export interface KessenStoredMatch {
  engine: MatchState;
  mode: KessenMode;
  /** The Academy lesson of a lesson match; null for every other match. */
  lesson: KessenAcademyLessonKey | null;
  /**
   * The `win_kessen_challenge` objective a quest challenge match is played for: its win
   * records the objective and the match pays nothing else. Absent for every other match.
   */
  challenge?: QuestChallengeRequest | null;
  pool: KessenCard[];
  aiDeck: string[];
  borrowed: string[];
  /** Cards played from hand, `[human, npc]`, for the reward eligibility guard. */
  plays: [number, number];
  /** Set when the match ends; first-win choices are claimed by rewriting it. */
  result: KessenMatchResult | null;
  /**
   * The payout a match that ended through play still has to settle: stored by its
   * finishing turn next to a result that pays nothing, removed by the settled result.
   */
  settlement?: KessenSettlement | null;
}

/** The payout planned when a match ends through play, before its claims run. */
export interface KessenSettlement {
  lesson: boolean;
  /** A quest challenge match, which claims no reward, first win or Circuit record. */
  challenge?: boolean;
  /** A lesson match's Academy claim: its first completion, ryo and the series pack. */
  academy: {
    lesson: KessenAcademyLessonKey;
    first: boolean;
    ryo: number;
    /** This completion would complete the series (from the planning snapshot). */
    graduation: boolean;
  } | null;
  mode: KessenMode;
  win: boolean;
  dayKey: string;
  weekKey: string;
  dropRoll: boolean;
  /** Ryo of the rewarded part, including an auto-sold surplus drop. */
  ryo: number;
  /** Drop and weekly first-win pack, paid with the rewarded claim. */
  rewardItems: { itemId: string; quantity: number }[];
  /** Paid with the first-win claim. */
  firstWinItems: { itemId: string; quantity: number }[];
  firstWinBadge: string | null;
  firstWinTitle: string | null;
  seenKeywords: string[];
  /** The `win_card_duel` event of an eligible win. */
  objective: { npcKey: string; tier: KessenTier } | null;
  /** The result as paid in full; the claims decide which parts are kept. */
  result: KessenMatchResult;
}

/** Events returned with every confirmed turn, redacted for seat 0. */
export type { KessenEvent };

/** A player in a duel, as both seats see them (a snapshot taken when the match began). */
export interface KessenPvpPlayer {
  userId: string;
  username: string;
  avatar: string | null;
  level: number;
  villageName: string | null;
  /** Ranked rating when the match began; null in friendly duels. */
  rating: number | null;
}

/** A rating before and after a rated match. */
export interface KessenRatingChange {
  before: number;
  after: number;
  delta: number;
}

/** How a duel ended. `void` duels (rules changed, a clashing match) have no winner and no rating. */
export type KessenPvpEnd = "play" | "concede" | "timeout" | "void";

/** The stored result of a duel, in engine seats. */
export interface KessenPvpResult {
  winner: Seat | null;
  endedBy: KessenPvpEnd;
  /** Seat whose concession or timeouts ended the duel; null otherwise. */
  loserBy: Seat | null;
  /** Rating changes per seat once applied; null when the duel changed no rating. */
  ratings: [KessenRatingChange, KessenRatingChange] | null;
  /** What the winner was paid; null when nothing was paid. */
  reward: { seat: Seat; ryo: number; packItemId: string | null } | null;
  /** Why a ranked duel changed no rating or paid no reward; null otherwise. */
  note: string | null;
  /** True until the ranked claims of the duel have run. */
  settling: boolean;
}

/**
 * The ranked claims a finished duel still has to run, planned from one snapshot. The
 * claims hold only while what they were planned from still stands; otherwise the
 * settlement plans them again from the players' current progress.
 */
export interface KessenPvpSettlement {
  dayKey: string;
  weekKey: string;
  /** Planned rating changes per seat; null when the duel is unrated. */
  ratings: [KessenRatingChange, KessenRatingChange] | null;
  /** Rated matches each seat had finished when its rating change was planned. */
  played: [number, number];
  /** The winner's planned reward; the daily cap claim decides whether it is paid. */
  reward: { seat: Seat; userId: string; ryo: number; packItemId: string | null } | null;
  /** The `win_card_duel` event of the winner, when the win counts for quests. */
  objectiveUserId: string | null;
  /** The result as settled in full; the claims decide which parts are kept. */
  result: KessenPvpResult;
}

/**
 * What `KessenMatch.state` stores for a duel. `log` holds every event unredacted and
 * never leaves the server; each seat reads it through `redactEvents`.
 */
export interface KessenStoredPvpMatch {
  engine: MatchState;
  players: [KessenPvpPlayer, KessenPvpPlayer];
  /** Card item ids lent to each seat (loaner or fill). */
  borrowed: [string[], string[]];
  /** Cards played from hand per seat, for the ranked reward guard. */
  plays: [number, number];
  log: KessenEvent[];
  /** Missed clocks per seat. */
  timeouts: [number, number];
  result: KessenPvpResult | null;
  settlement?: KessenPvpSettlement | null;
}

/** A duel's result as one seat sees it. */
export interface KessenPvpViewResult {
  /** Engine seat of the winner; compare with `seat`. Null for a draw or a void duel. */
  winner: Seat | null;
  outcome: "win" | "loss" | "draw" | "void";
  endedBy: KessenPvpEnd;
  loserBy: Seat | null;
  /** The viewer's and the opponent's rating change; null when unrated. */
  rating: { you: KessenRatingChange; opponent: KessenRatingChange } | null;
  /** What the viewer was paid; null otherwise. */
  reward: { ryo: number; packItemId: string | null } | null;
  note: string | null;
  settling: boolean;
}

/** One duel as one of its players sees it. `view` is redacted for `seat`. */
export interface KessenPvpMatchPayload {
  id: string;
  kind: Exclude<KessenMatchKind, "NPC">;
  /** Optimistic-concurrency version; send it back with every action. */
  version: number;
  status: KessenMatchStatus;
  startedAt: Date;
  finishedAt: Date | null;
  /** The viewer's engine seat (`view.me`). */
  seat: Seat;
  players: [KessenPvpPlayer, KessenPvpPlayer];
  view: MatchView;
  clock: {
    /** When the acting seats' clock runs out; null once the match is over. */
    deadline: Date | null;
    /** Seats that owe a decision now (both during a mulligan step). */
    acting: Seat[];
    /** The server time of this payload, to correct the client's clock. */
    serverNow: Date;
    turnSeconds: number;
    mulliganSeconds: number;
    timeouts: [number, number];
    maxTimeouts: number;
  };
  /** Card item ids lent to the viewer for this match. */
  borrowed: string[];
  result: KessenPvpViewResult | null;
}

/** What `kessenPvp.getMatch` returns; `log` is the viewer's redacted play log. */
export interface KessenPvpMatchQuery {
  match: KessenPvpMatchPayload | null;
  log: KessenMatchLog | null;
}

/** A friendly challenge as one of its two players sees it. */
export interface KessenChallenge {
  id: string;
  /** True when the viewer sent it. */
  outgoing: boolean;
  status: UserRequestState;
  createdAt: Date;
  expiresAt: Date;
  /** The other player. */
  opponent: {
    userId: string;
    username: string;
    level: number;
    rank: UserRank;
    villageName: string | null;
  };
  /** The match an accepted challenge started. */
  matchId: string | null;
}

/** The player's duel in progress, if any, without its state. */
export interface KessenPvpActiveMatch {
  id: string;
  kind: Exclude<KessenMatchKind, "NPC">;
  seat: Seat;
  opponent: { userId: string; username: string };
  deadline: Date | null;
  /** Whether the viewer owes a decision now. */
  yourTurn: boolean;
}

/** Everything the duel lobby needs for the signed-in player. */
export interface KessenPvpLobby {
  lessonCompleted: boolean;
  ranked: {
    rating: number;
    played: number;
    wins: number;
    losses: number;
    draws: number;
    rewardedToday: number;
    rewardedCap: number;
    weeklyWins: number;
    weeklyPackWins: number;
    winRyo: number;
  };
  activeMatch: KessenPvpActiveMatch | null;
  /** Pending challenges only, newest first. */
  challenges: KessenChallenge[];
  queue: { queuedAt: Date; matchId: string | null } | null;
  /** Players currently in the ranked queue. */
  queueCount: number;
}

/** One row of the ranked ladder. */
export interface KessenLeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  avatar: string | null;
  level: number;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
}

/** What `kessenPvp.getLeaderboard` returns: the top of the ladder and the viewer's place. */
export interface KessenLeaderboard {
  entries: KessenLeaderboardEntry[];
  /** The viewer's place; null before their first rated match. */
  you: KessenLeaderboardEntry | null;
}
