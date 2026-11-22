/**
 * Plain-language lines for the match table: play-log entries, the pass facts, ghost
 * numbers and round summaries. Every line states what happens; none advises.
 */
import { other } from "@/libs/kessen/board";
import type { KessenHouseRule } from "@/libs/kessen/npcs";
import { ROW_LABELS } from "@/libs/kessen/text";
import type {
  KessenEvent,
  MatchRules,
  MatchView,
  PartialOption,
  PartialPreview,
  Row,
  Seat,
  TargetKind,
} from "@/libs/kessen/types";
import type { KessenAbilityKind } from "@/validators/itemCard";
import { safeTotals } from "./playback";

/**
 * One play-log line for an event, or null for bookkeeping events. `after` is the board
 * the event leads to; a card it reveals is known there (and to `names.kind`) but not yet
 * in `before`.
 */
export const describeEvent = (
  event: KessenEvent,
  before: MatchView,
  names: MatchNames,
  after?: MatchView,
): string | null => {
  const me = before.me;
  const who = (seat: Seat) => (seat === me ? "You" : names.opponent);
  const verb = (seat: Seat, mine: string, theirs: string) =>
    seat === me ? mine : theirs;
  const unitName = (id: string) => names.card(before.inst[id] ?? "");
  const sideName = (side: Seat) => (side === me ? "your" : `${names.opponent}'s`);
  switch (event.t) {
    case "roundStart": {
      const rule = houseRuleRoundNote(
        names.houseRule ?? null,
        before.rules,
        event.round,
      );
      return `Round ${event.round} begins; ${who(event.opener)} ${verb(event.opener, "open", "opens")}.${rule ? ` ${rule}` : ""}`;
    }
    case "drawn": {
      const count = event.cards.length;
      const drew =
        count > 0
          ? `${who(event.seat)} ${verb(event.seat, "draw", "draws")} ${plural(count, "card")}.`
          : null;
      const banked =
        event.banked > 0
          ? event.seat === me
            ? `Your hand is full, so you may replace ${plural(event.banked, "extra card")} next round.`
            : `${names.opponent}'s hand is full, so they may replace ${plural(event.banked, "extra card")} next round.`
          : null;
      return [drew, banked].filter(Boolean).join(" ") || null;
    }
    case "mulligan":
      return event.count === 0
        ? `${who(event.seat)} ${verb(event.seat, "keep", "keeps")} the hand.`
        : `${who(event.seat)} ${verb(event.seat, "replace", "replaces")} ${plural(event.count, "card")}.`;
    case "played": {
      const kind =
        before.cards[event.cardId]?.kind ??
        after?.cards[event.cardId]?.kind ??
        names.kind?.(event.cardId);
      if (kind !== "TACTIC") return null;
      return `${who(event.seat)} ${verb(event.seat, "play", "plays")} ${names.card(event.cardId)}.`;
    }
    case "leader":
      return `${who(event.seat)} ${verb(event.seat, "call", "calls")} on ${names.card(event.cardId)}.`;
    case "placed": {
      const card = names.card(event.cardId);
      const row = ROW_LABELS[event.row];
      switch (event.source) {
        case "hand":
          return event.owner === event.side
            ? `${who(event.owner)} ${verb(event.owner, "play", "plays")} ${card} to ${row} (${event.stored}).`
            : `${who(event.owner)} ${verb(event.owner, "plant", "plants")} ${card} in ${sideName(event.side)} ${row} (${event.stored}).`;
        case "gambit":
          return `${who(event.owner)} ${verb(event.owner, "open", "opens")} with a Shadow Clone (${event.stored}).`;
        case "summon":
        case "allHands":
          return `${card} is summoned to ${sideName(event.side)} ${row} (${event.stored}).`;
        case "revive":
          return `${card} returns from the discard to ${sideName(event.side)} ${row}.`;
        case "fence":
          return `${card} is fenced to ${sideName(event.side)} ${row}.`;
        case "tide":
          return `Returning Tide brings ${card} back to ${sideName(event.side)} ${row}.`;
      }
      return null;
    }
    case "damaged":
      return `${unitName(event.id)} takes ${event.amount} (now ${Math.max(0, event.stored)}).`;
    case "boosted": {
      const name = unitName(event.id);
      switch (event.cause) {
        case "meditate":
          return `${name} meditates: +${event.amount}.`;
        case "sun":
          return `Sun-Blessed: ${name} +${event.amount}.`;
        case "highNoon":
          return `${names.houseRule?.name ?? "House rule"}: ${name} +${event.amount}.`;
        case "carry":
          return `${name} carries +${event.amount} into the round.`;
        default:
          return `${name} +${event.amount}.`;
      }
    }
    case "destroyed":
      return event.cause === "purge"
        ? `${names.card(event.cardId)} is purged.`
        : event.cause === "depleted"
          ? `${names.card(event.cardId)} fades away.`
          : `${names.card(event.cardId)} is destroyed.`;
    case "sealed":
      return `${unitName(event.id)} is sealed.`;
    case "resilient":
      return `${unitName(event.id)} becomes Resilient.`;
    case "terrain":
      return event.on
        ? `Terrain grips ${sideName(event.side)} ${ROW_LABELS[event.row]}.`
        : `Terrain lifts from ${sideName(event.side)} ${ROW_LABELS[event.row]}.`;
    case "returned": {
      const name = event.id === "?" ? "A card" : unitName(event.id);
      const place =
        event.to === "hand"
          ? event.seat === me
            ? "your hand"
            : `${names.opponent}'s hand`
          : "the deck";
      return `${name} returns to ${place}.`;
    }
    case "fizzled":
      return `${ABILITY_LABELS[event.ability] ?? "The ability"} finds no target.`;
    case "passed":
      return event.auto
        ? `${who(event.seat)} ${verb(event.seat, "pass", "passes")} with no cards left.`
        : `${who(event.seat)} ${verb(event.seat, "pass", "passes")}.`;
    case "roundEnd": {
      const [mine, theirs] = mineTheirs(event.totals, me);
      const outcome =
        event.winner === null
          ? "a tie: both lose a lantern"
          : event.winner === me
            ? event.riggedOdds
              ? "you win the tie (Rigged Odds)"
              : "you win"
            : event.riggedOdds
              ? `${names.opponent} wins the tie (Rigged Odds)`
              : `${names.opponent} wins`;
      return `Round ${event.round}: you ${mine} – ${theirs} ${names.opponent}, ${outcome}.`;
    }
    case "leaderRecharged":
      return `${sideName(event.seat) === "your" ? "Your" : `${names.opponent}'s`} leader recharges.`;
    case "cleanup":
      return event.kept.length > 0
        ? `Carried into the next round: ${event.kept.map(unitName).join(", ")}.`
        : null;
    case "matchEnd":
      return event.winner === null
        ? "The match is a draw."
        : event.winner === me
          ? "You win the match."
          : `${names.opponent} wins the match.`;
    default:
      return null;
  }
};

/**
 * What passing now means, in facts. `armed` marks the one case that asks for a second
 * tap: the opponent has passed and passing loses or ties the round.
 */
export const passFacts = (view: MatchView, opponent: string): PassFacts => {
  const me = view.me;
  const them = other(me);
  const [mine, theirs] = mineTheirs(safeTotals(view), me);
  const myHand = view.seats[me].handCount;
  const theirHand = view.seats[them].handCount;
  const keep = `You keep ${plural(myHand, "card")}, they keep ${theirHand}.`;
  if (view.seats[them].passed) {
    const winner = roundWinnerIfEnded(view);
    if (winner === me) {
      return {
        armed: false,
        label: "Pass",
        line: `${opponent} passed. Passing now wins the round ${mine}–${theirs}.`,
      };
    }
    const lastLantern = view.seats[me].lanterns <= 1;
    const ends = lastLantern ? " That ends the match." : "";
    const label = `End round, keep ${plural(myHand, "card")}`;
    if (winner === null) {
      return {
        armed: true,
        label,
        line: `This round ties ${mine}–${theirs}; both lose a lantern. ${keep}${ends}`,
      };
    }
    const rigged = mine === theirs ? " (Rigged Odds)" : "";
    return {
      armed: true,
      label,
      line: `You lose this round ${mine}–${theirs}${rigged}. ${keep}${ends}`,
    };
  }
  const lead = mine - theirs;
  const hold = `${opponent} holds ${plural(theirHand, "card")}`;
  if (lead > 0 && !canStillScore(view, them)) {
    return {
      armed: false,
      label: "Pass",
      line: `${opponent} has no cards left. Passing now wins the round ${mine}–${theirs}.`,
    };
  }
  if (lead > 0) {
    const leaderOnly =
      theirHand === 0 ? `${opponent} holds only a leader ability` : hold;
    return {
      armed: false,
      label: "Pass",
      line: `You lead by ${lead}. ${leaderOnly} and needs ${lead + 1} to beat you.`,
    };
  }
  if (lead < 0) {
    return {
      armed: false,
      label: "Pass",
      line: `You trail by ${-lead}. ${hold}; you hold ${myHand}.`,
    };
  }
  return {
    armed: false,
    label: "Pass",
    line: `Tied at ${mine}. ${hold}; you hold ${myHand}.`,
  };
};

/** Whether a seat can still add power this round: cards in hand or an unused leader. */
const canStillScore = (view: MatchView, seat: Seat) => {
  const zone = view.seats[seat];
  return (
    !zone.passed && (zone.handCount > 0 || (zone.leader !== null && !zone.leaderUsed))
  );
};

/**
 * Who would win the round if it ended now: the higher total, or on a tie the one
 * Syndicate seat that spent a card this round (Rigged Odds), else null.
 */
export const roundWinnerIfEnded = (view: MatchView): Seat | null => {
  const totals = safeTotals(view);
  if (totals[0] !== totals[1]) return totals[0] > totals[1] ? 0 : 1;
  if (!view.knobs.riggedOdds || (view.round >= 3 && !view.knobs.riggedOddsR3))
    return null;
  const syndicate = ([0, 1] as const).filter(
    (seat) => view.seats[seat].faction === "SYNDICATE",
  );
  if (syndicate.length !== 1) return null;
  const seat = syndicate[0] as Seat;
  return view.seats[seat].played > 0 ? seat : null;
};

/**
 * The centre-band line: who needs how many points to take the round, as a sentence for
 * screen readers and a short chip ("They need" and the number). Null when the trailing
 * opponent can no longer score.
 */
export const needLine = (view: MatchView, opponent: string): NeedLine | null => {
  const [mine, theirs] = mineTheirs(safeTotals(view), view.me);
  const lead = mine - theirs;
  if (lead > 0) {
    if (!canStillScore(view, other(view.me))) return null;
    return {
      full: `${opponent} needs ${lead + 1} to win`,
      short: `They need ${lead + 1}`,
      lead: "They need",
      count: lead + 1,
    };
  }
  if (lead < 0) {
    return {
      full: `You need ${-lead + 1} to win`,
      short: `You need ${-lead + 1}`,
      lead: "You need",
      count: -lead + 1,
    };
  }
  return { full: "Tied", short: "Tied", lead: "Tied", count: null };
};

/**
 * What a house rule does as round `round` starts, for the round's stamp and the log; null
 * when the rule acts at no round start (a mulligan or Strike rule, which the rules panel
 * names for the whole match).
 */
export const houseRuleRoundNote = (
  rule: KessenHouseRule | null,
  rules: MatchRules,
  round: number,
): string | null => {
  if (!rule) return null;
  if (rules.r3PlacementBonus && round === 3) {
    return `${rule.name}: every unit placed from hand gets +${rules.r3PlacementBonus} this round.`;
  }
  const rows = (rules.startTerrain ?? [])
    .filter((entry) => entry.rounds.includes(round))
    .map((entry) => ROW_LABELS[entry.row]);
  if (rows.length > 0) {
    return `${rule.name}: both ${rows.join(" and ")} rows start under Terrain.`;
  }
  if (rules.carryBonus && round > 1) {
    return `${rule.name}: units kept from the last round get +${rules.carryBonus}.`;
  }
  return null;
};

/**
 * The house-rule bonus a unit placed from hand gets now ("High Noon +1"), named in its
 * ghost; null when no rule adds one this round.
 */
export const placementBonusNote = (
  rule: KessenHouseRule | null,
  rules: MatchRules,
  round: number,
): string | null =>
  rule && rules.r3PlacementBonus && round === 3
    ? `${rule.name} +${rules.r3PlacementBonus}`
    : null;

/** A ghost with a note put first in its detail line. */
export const withGhostNote = (ghost: Ghost, note: string | null): Ghost =>
  note ? { ...ghost, detail: [note, ghost.detail].filter(Boolean).join(" · ") } : ghost;

/**
 * Why a unit in hand has no row: the rows it may take, closed (each "Row full", or
 * another reason). `side` is the side it would join.
 */
export const noRowText = (
  reasons: readonly { row: Row; reason: string | null }[],
  own: boolean,
): string => {
  const full = reasons.filter((entry) => entry.reason === "Row full");
  const whose = own ? "your" : "their";
  if (full.length > 0 && full.length === reasons.length) {
    return full.length === 1
      ? `No row has room: ${whose} ${ROW_LABELS[(full[0] as { row: Row }).row]} row is full.`
      : `No row has room: ${whose} rows are full.`;
  }
  const reason = reasons.find((entry) => entry.reason)?.reason;
  return reason ? `No row can take it: ${reason}.` : "No row can take it now.";
};

/**
 * Whether a complete play changes nothing on the table: every ability finds no target
 * and no total, unit or hidden draw moves.
 */
export const playsForNoEffect = (
  preview: Pick<
    Extract<PartialPreview, { ok: true }>,
    "totals" | "kills" | "hidden" | "units" | "request"
  >,
  ghost: Ghost,
) =>
  preview.request === null &&
  ghost.fizzles.length > 0 &&
  ghost.gain === 0 &&
  ghost.theirChange === 0 &&
  preview.kills.length === 0 &&
  preview.hidden.length === 0 &&
  preview.units.every((unit) => unit.before === unit.after);

/**
 * The end screen's line when a match paid no ryo or drops. A first-win reward is paid
 * regardless, so the line then says so instead of calling the match practice.
 */
export const unrewardedNote = (reason: string, firstWinPaid: boolean) => {
  if (!firstWinPaid) return reason;
  const cause = reason
    .replace(/;\s*this match was practice\.?$/i, "")
    .replace(/\.$/, "");
  return `${cause}: no ryo or drops this time. The first-win reward is yours.`;
};

/** Ghost number of a placement or option: own change, their change, kills and hidden draws. */
export const ghostOf = (
  preview: Pick<
    Extract<PartialPreview, { ok: true }>,
    "totals" | "kills" | "hidden" | "units"
  > &
    Partial<Pick<Extract<PartialPreview, { ok: true }>, "events">>,
  me: Seat,
  names: MatchNames,
  cardOf: (instance: string) => string,
): Ghost => {
  const before = mineTheirs(preview.totals.before, me);
  const after = mineTheirs(preview.totals.after, me);
  const gain = after[0] - before[0];
  const theirChange = after[1] - before[1];
  const kills = preview.kills.map((id) => names.card(cardOf(id)));
  // A Summon adds units from the deck the preview cannot see; "+?" marks the open part.
  const partial = preview.hidden.includes("summon");
  const more = partial ? "+?" : "";
  // A play that only moves the opponent's total (an Infiltrator) shows their change; the
  // number stays short so it fits a tile, and `them` marks whose total it is.
  const them = gain === 0 && theirChange !== 0 && !partial;
  const fizzleKinds = (preview.events ?? []).flatMap((event) =>
    event.t === "fizzled" ? [event.ability] : [],
  );
  const fizzles = fizzleKinds.map((ability) => fizzleParts(ability).join(": "));
  const firstFizzle = fizzleKinds[0];
  return {
    gain,
    theirChange,
    kills,
    partial,
    them,
    // A play whose only gain is still hidden shows "+?" alone, never "+0+?".
    main: them
      ? signed(theirChange)
      : partial && gain === 0
        ? "+?"
        : `${signed(gain)}${more}`,
    totals: `${after[0]}${more} vs ${after[1]}`,
    totalsLine: `you ${after[0]}${partial ? " + ?" : ""} vs ${after[1]}`,
    detail: [
      gain !== 0 && theirChange !== 0
        ? `${names.opponent} ${signed(theirChange)}`
        : null,
      kills.length > 0 ? `kills ${kills.join(", ")}` : null,
      preview.hidden.includes("summon") ? "summons from the deck" : null,
      preview.hidden.includes("draw") ? "draws" : null,
      ...fizzles,
    ]
      .filter(Boolean)
      .join(" · "),
    after,
    fizzles,
    fizzleTile: firstFizzle ? fizzleParts(firstFizzle) : null,
  };
};

/** ["Strike", "no target"], ["Revive", "discard empty"]: an ability the play cannot use. */
const fizzleParts = (ability: KessenAbilityKind): [string, string] => [
  ABILITY_LABELS[ability] ?? "Ability",
  DISCARD_ABILITIES.has(ability) ? "discard empty" : "no target",
];

const DISCARD_ABILITIES = new Set<KessenAbilityKind>(["revive", "fence", "recall"]);

/** Short outcome label of one target option ("destroys", "−3", "sealed", "them −6"). */
export const optionOutcome = (
  option: Extract<PartialOption, { ok: true }>,
  ability: KessenAbilityKind,
  me: Seat,
  opponent: string,
): string => {
  if (option.kills.includes(option.target)) return "destroys";
  const unit = option.units.find((entry) => entry.id === option.target);
  if (ability === "seal" && unit) return "sealed";
  if (
    unit &&
    unit.before !== null &&
    unit.after !== null &&
    unit.before !== unit.after
  ) {
    return signed(unit.after - unit.before);
  }
  if (option.kills.length > 0) return `kills ${option.kills.length}`;
  const before = mineTheirs(option.totals.before, me);
  const after = mineTheirs(option.totals.after, me);
  const gain = after[0] - before[0];
  const theirChange = after[1] - before[1];
  if (gain !== 0) return signed(gain);
  if (theirChange !== 0) return `${opponent} ${signed(theirChange)}`;
  if (ability === "substitution" || ability === "recall") return "to hand";
  if (ability === "cycle") return "to deck";
  return "no change";
};

/**
 * Label of a row an automatic effect changes: "Terrain · −4" when Terrain falls on it,
 * "Terrain lifted" when it clears, otherwise the change of the row's total.
 */
export const rowEffectLabel = (terrain: boolean | null, change: number) => {
  const amount = change !== 0 ? ` · ${signed(change)}` : "";
  if (terrain === true) return `Terrain${amount}`;
  if (terrain === false) return `Terrain lifted${amount}`;
  return signed(change);
};

/** The instruction shown while a target is being chosen. */
export const targetPrompt = (
  kind: TargetKind,
  ability: KessenAbilityKind,
  optional: boolean,
) => {
  const label = ABILITY_LABELS[ability] ?? "Ability";
  const what: Record<TargetKind, string> = {
    enemyUnit: "an enemy unit",
    ownUnit: "one of your units",
    anyUnit: "a unit on either side",
    enemyRow: "an enemy row",
    ownRow: "one of your rows",
    anyRow: "a row",
    discard: "a card in your discard",
    enemyDiscard: "a card in their discard",
    hand: "a card in your hand",
  };
  return `${label}: choose ${what[kind]}${optional ? " (optional)" : ""}.`;
};

/** Facts of a finished round for the summary card. */
export const roundSummary = (
  event: Extract<KessenEvent, { t: "roundEnd" }>,
  before: MatchView,
  kept: { name: string; power: number }[],
  names: MatchNames,
): RoundSummaryData => {
  const me = before.me;
  const [mine, theirs] = mineTheirs(event.totals, me);
  const spentMine = before.seats[me].played;
  const spentTheirs = before.seats[other(me)].played;
  const won = event.winner === me;
  return {
    round: event.round,
    mine,
    theirs,
    outcome: event.winner === null ? "tie" : won ? "won" : "lost",
    riggedOdds: event.riggedOdds,
    spentMine,
    spentTheirs,
    kept,
    savedCards: won && spentMine < spentTheirs,
    line: `Round ${event.round}: you ${mine} – ${theirs} ${names.opponent} · you spent ${plural(spentMine, "card")}, they spent ${spentTheirs}${kept.length > 0 ? ` · carried: ${kept.map((entry) => `${entry.name} (${entry.power})`).join(", ")}` : ""}`,
  };
};

export const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/** A signed amount with a typographic minus ("+3", "−2", "+0"). */
export const signed = (value: number) =>
  value > 0 ? `+${value}` : value < 0 ? `−${-value}` : "+0";

/** `[mine, theirs]` from seat-ordered totals. */
export const mineTheirs = (
  totals: readonly [number, number],
  me: Seat,
): [number, number] => (me === 0 ? [totals[0], totals[1]] : [totals[1], totals[0]]);

const ABILITY_LABELS: Partial<Record<KessenAbilityKind, string>> = {
  strike: "Strike",
  empower: "Empower",
  summon: "Summon",
  revive: "Revive",
  substitution: "Substitution",
  grantResilient: "Resilient",
  purge: "Purge",
  terrain: "Terrain",
  clearSkies: "Clear Skies",
  seal: "Seal",
  draw: "Draw",
  fence: "Fence",
  recall: "Recall",
  allHands: "All Hands",
  cycle: "Cycle",
};

/**
 * Names the lines need: card names by card id, the opponent's name and, optionally, card
 * kinds from the catalog and the match's house rule.
 */
export interface MatchNames {
  card: (cardId: string) => string;
  opponent: string;
  kind?: (cardId: string) => string | undefined;
  houseRule?: KessenHouseRule | null;
}

/** The pass button's label and its fact line; `armed` asks for a confirming second tap. */
export interface PassFacts {
  armed: boolean;
  label: string;
  line: string;
}

/** The preview of a play: its effect on both totals, kills and abilities left unused. */
export interface Ghost {
  gain: number;
  theirChange: number;
  /** Names of the units the play destroys. */
  kills: string[];
  /** Units summoned from the deck are not counted yet, so the numbers are a floor. */
  partial: boolean;
  /** Only the opponent's total changes; `main` is their change. */
  them: boolean;
  /** The short signed number shown on the board ("+6"). */
  main: string;
  /** Both totals after the play, short enough for a tile ("11+? vs 30"). */
  totals: string;
  /** Both totals after the play in words, for the prompt ("you 11 + ? vs 30"). */
  totalsLine: string;
  detail: string;
  after: [number, number];
  /** Abilities of the play that find nothing to act on ("Strike: no target"). */
  fizzles: string[];
  /** The first of them as two short lines for a tile (["Strike", "no target"]). */
  fizzleTile: [string, string] | null;
}

/** The centre band's points-needed line in its sentence and chip forms. */
export interface NeedLine {
  /** The whole sentence, for screen readers. */
  full: string;
  /** Without the opponent's name ("They need 9"). */
  short: string;
  /** The words of the chip before its number ("They need"; "Tied" has no number). */
  lead: string;
  count: number | null;
}

/** A finished round from the player's side, for the round summary card. */
export interface RoundSummaryData {
  round: number;
  mine: number;
  theirs: number;
  outcome: "won" | "lost" | "tie";
  riggedOdds: boolean;
  spentMine: number;
  spentTheirs: number;
  kept: { name: string; power: number }[];
  /** Won the round having spent fewer cards than the opponent. */
  savedCards: boolean;
  line: string;
}
