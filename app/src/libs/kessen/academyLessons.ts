/**
 * The Kessen Academy's lessons: one strategic idea each, taught in a prepared position
 * that is only won by using it. Every lesson is data plus two pure functions of a
 * redacted view: Lemu's scripted reply and the coach's advice for the player's turn.
 * Code data, versioned with the engine; the lesson tests play the taught line and the
 * naive lines through the engine.
 */
import type { AcademyPositionSpec } from "./academyPosition";
import { rawPower, rowTotal as stateRowTotal } from "./board";
import { boardTotals } from "./engine";
import { ROWS } from "./rules";
import type { KessenKeyword } from "./text";
import { ROW_LABELS } from "./text";
import type {
  KessenAction,
  MatchRules,
  MatchState,
  MatchView,
  Row,
  Seat,
} from "./types";

export const KESSEN_ACADEMY_LESSON_KEYS = [
  "first-blood",
  "enough",
  "cut-the-root",
  "spread-out",
  "grow-early",
  "leaders-moment",
] as const;
export type KessenAcademyLessonKey = (typeof KESSEN_ACADEMY_LESSON_KEYS)[number];

/** What the coach recommends on the player's turn, or why the last move was worse. */
export type AcademyAdvice =
  | {
      kind: "move";
      /** The fully specified action the coach asks for. */
      action: KessenAction;
      title: string;
      /** The call to action. */
      text: string;
      /** The strategic reason, one or two sentences. */
      why?: string;
      /** Pulse the hand-size badge. */
      badge?: boolean;
    }
  | {
      kind: "mistake";
      title: string;
      /** What went wrong, in the position the player now sees. */
      text: string;
      why?: string;
      /** The best way on from here; the player may also restart the lesson. */
      action: KessenAction | null;
    };

export interface AcademyLessonDefinition {
  key: KessenAcademyLessonKey;
  title: string;
  /** The idea in one sentence, for the summary card. */
  idea: string;
  /** A short line for the Academy list. */
  summary: string;
  /** Lemu's opening words. */
  intro: string;
  /** Closing line of a won lesson. */
  winLine: string;
  /** What a lost lesson teaches, with the invitation to try again. */
  lossLine: string;
  /** Keywords the lesson introduces. */
  keywords: readonly KessenKeyword[];
  position: AcademyPositionSpec;
  /** Lemu's scripted action from its own view. */
  lemu: (view: MatchView) => KessenAction;
  /** The coach's advice on the player's turn; null when there is nothing to say. */
  advise: (view: MatchView) => AcademyAdvice | null;
}

/** Lessons start without mulligans: every card in hand is part of the lesson. */
const LESSON_RULES = {
  r1MulliganCap: 0,
  knobs: { laterMulligans: 0, maxBanked: 0 },
} satisfies MatchRules;

const C = {
  arashima: "kessen-arashima-stormcaller",
  colossus: "kessen-colossus",
  cryverin: "kessen-cryverin",
  enrai: "kessen-enrai-no-oni",
  kajioka: "kessen-kajioka",
  mei: "kessen-mei-back-alley-enforcer",
  musashi: "kessen-musashi-ken-swordsman",
  pengu: "kessen-lord-pengu",
  clansman: "kessen-hyouga-yui-clansman",
  fireball: "kessen-fireball",
  princess: "kessen-subaku-princess",
  kuraokami: "kessen-kuraokami-kami-of-the-night-snow",
  typhoonTear: "kessen-typhoon-tear",
  owlcat: "kessen-owlcat",
  kugatsunagi: "kessen-kugatsunagi",
  ava: "kessen-ava-the-snow-terror",
  mosswolf: "kessen-mosswolf",
  hisame: "kessen-leader-hisame-dune-warden",
} as const;

// ---------------------------------------------------------------------------
// View helpers (the player's view for advice, Lemu's view for its script)

const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

/** Board totals from `view.me`'s side: [mine, theirs]. */
const sides = (view: MatchView): [number, number] => {
  const totals = boardTotals(view);
  return [totals[view.me], totals[other(view.me)]];
};

const lead = (view: MatchView) => {
  const [mine, theirs] = sides(view);
  return mine - theirs;
};

/** Displayed total of one row of a view. */
const rowTotal = (view: MatchView, side: Seat, row: Row) =>
  stateRowTotal(view as unknown as MatchState, side, row);

/** A row's total without Terrain: what it is worth once the skies clear. */
const clearRowTotal = (view: MatchView, side: Seat, row: Row) =>
  view.board[side][row].reduce(
    (sum, unit) => sum + rawPower(view as unknown as MatchState, { unit, side, row }),
    0,
  );

const theyPassed = (view: MatchView) => view.seats[other(view.me)].passed;

/** Hand instances of `cardId`, in hand order. */
const inHand = (view: MatchView, cardId: string) =>
  (view.seats[view.me].hand ?? []).filter((id) => view.inst[id] === cardId);

const firstInHand = (view: MatchView, cardId: string) =>
  inHand(view, cardId)[0] ?? null;

/** Units of `cardId` on a side, in canonical order. */
const unitsOf = (view: MatchView, side: Seat, cardId: string) =>
  ROWS.flatMap((row) =>
    view.board[side][row]
      .filter((unit) => view.inst[unit.id] === cardId)
      .map((unit) => ({ ...unit, row })),
  );

const cardPower = (view: MatchView, id: string) =>
  view.cards[view.inst[id] ?? ""]?.power ?? 0;

const nameOf = (view: MatchView, cardId: string) => view.cards[cardId]?.name ?? "it";

/** Hand units sorted strongest first (ties: hand order). */
const strongestFirst = (view: MatchView) =>
  [...(view.seats[view.me].hand ?? [])]
    .map((id, index) => ({ id, index, power: cardPower(view, id) }))
    .sort((a, b) => b.power - a.power || a.index - b.index)
    .map((entry) => entry.id);

/** A row with space for `id` (its printed row, or the first open row for Any row). */
const openRow = (
  view: MatchView,
  side: Seat,
  id: string,
  prefer: readonly Row[] = ROWS,
) => {
  const card = view.cards[view.inst[id] ?? ""];
  if (card?.kind !== "UNIT" || card.row === null) return null;
  const rows = card.row === "ANY" ? prefer : [card.row];
  return rows.find((row) => view.board[side][row].length < view.knobs.rowCap) ?? null;
};

/** Plays `id` to an open row, or null when it has none. */
const placeOn = (
  view: MatchView,
  id: string,
  prefer?: readonly Row[],
): KessenAction | null => {
  const row = openRow(view, view.me, id, prefer);
  return row ? { t: "play", card: id, row } : null;
};

/**
 * Lemu's default duel: while the player is still in the round, Lemu plays its strongest
 * card; once the player has passed it plays strongest first until it leads, then passes.
 */
const duel = (
  view: MatchView,
  prefer?: readonly Row[],
  except: readonly string[] = [],
): KessenAction => {
  if (theyPassed(view) && lead(view) > 0) return { t: "pass" };
  for (const id of strongestFirst(view)) {
    if (except.includes(view.inst[id] ?? "")) continue;
    const play = placeOn(view, id, prefer);
    if (play) return play;
  }
  return { t: "pass" };
};

/** The player's strongest playable card as advice, or Pass when nothing is playable. */
const spendStrongest = (
  view: MatchView,
  copy: {
    title: string;
    text: (name: string) => string;
    why?: string;
    badge?: boolean;
  },
): AcademyAdvice => {
  for (const id of strongestFirst(view)) {
    const action = placeOn(view, id);
    if (action) {
      return {
        kind: "move",
        action,
        title: copy.title,
        text: copy.text(nameOf(view, view.inst[id] ?? "")),
        why: copy.why,
        badge: copy.badge,
      };
    }
  }
  return {
    kind: "move",
    action: { t: "pass" },
    title: "Nothing left to play",
    text: "Tap Pass.",
  };
};

const passAdvice = (title: string, text: string, why?: string): AcademyAdvice => ({
  kind: "move",
  action: { t: "pass" },
  title,
  text,
  why,
});

/** The closing advice of a decisive round: pass once Lemu has passed behind. */
const winByPassing = (view: MatchView): AcademyAdvice | null =>
  theyPassed(view) && lead(view) > 0
    ? passAdvice(
        "Take it",
        "Tap Pass.",
        "Lemu has passed and you lead. Passing now ends the round in your favour.",
      )
    : null;

// ---------------------------------------------------------------------------
// 1. First Blood: rows, rounds and passing

const firstBlood: AcademyLessonDefinition = {
  key: "first-blood",
  title: "First Blood",
  idea: "A round you give away cheaply buys you the last one: enter Round 3 with more cards.",
  summary: "Rows, rounds and passing; why giving up a round can win the match.",
  intro:
    "Welcome to the war table. Two lanterns each: lose a round, lose a lantern. Win two rounds and the match is yours.",
  winLine: "You won by saving cards. That's the whole secret.",
  lossLine:
    "Lemu kept more cards for the last round. Try again: give Lemu Round 2 for free and keep your hand.",
  keywords: [],
  position: {
    round: 1,
    opener: 1,
    turn: 1,
    history: [],
    rules: LESSON_RULES,
    seats: [
      {
        hand: [C.kajioka, C.musashi, C.enrai, C.kajioka, C.arashima],
        deck: [C.musashi, C.kajioka, C.kajioka],
      },
      {
        hand: [C.arashima, C.arashima, C.colossus, C.kajioka, C.mei],
        deck: [C.arashima, C.cryverin, C.enrai],
      },
    ],
  },
  lemu: (view) => {
    const me = view.me;
    if (view.round === 1) {
      // Lemu answers twice with its small cards, then saves the rest.
      const spent = view.seats[me].played;
      if (!theyPassed(view)) {
        const small = spent < 2 ? firstInHand(view, C.arashima) : null;
        return small ? { t: "play", card: small, row: "RANGED" } : { t: "pass" };
      }
      if (lead(view) > 0) return { t: "pass" };
      return duel(view);
    }
    return duel(view);
  },
  advise: (view) => {
    const me = view.me;
    const played = view.seats[me].played;
    if (view.round === 1) {
      const pass = winByPassing(view);
      if (pass) {
        return {
          ...pass,
          title: "Take the round",
          why: "Lemu passed while behind. Pass now: the round is yours, and every card you keep is a card for the rounds to come.",
        };
      }
      if (played === 0) {
        const card = firstInHand(view, C.kajioka);
        if (card) {
          return {
            kind: "move",
            action: { t: "play", card, row: "RANGED" },
            title: "Your first card",
            text: "Tap Kajioka, then your Bukijutsu row.",
            why: "Kajioka fits any row. The ghost number shows exactly what it adds before you commit.",
          };
        }
      }
      const musashi = played === 1 ? firstInHand(view, C.musashi) : null;
      if (musashi) {
        return {
          kind: "move",
          action: { t: "play", card: musashi, row: "CLOSE" },
          title: "Higher total wins",
          text: "Tap Musashi and play it to your Taijutsu row.",
          why: "When you both pass, the higher total wins the round. Musashi only fits Taijutsu.",
        };
      }
      return spendStrongest(view, {
        title: lead(view) > 0 ? "Higher total wins" : "Get ahead",
        text: (name) => `Play ${name}.`,
        why: "When you both pass, the higher total wins the round.",
      });
    }
    if (view.round === 2) {
      if (played > 0) {
        return {
          kind: "mistake",
          title: "That card was wasted",
          text: "Lemu has one lantern left, so it will spend whatever it takes to win this round. Every card you play here is one fewer for Round 3.",
          why: "Pass now and keep the rest.",
          action: { t: "pass" },
        };
      }
      return {
        kind: "move",
        action: { t: "pass" },
        title: "Give this round away",
        text: "Tap Pass.",
        why: "You won Round 1. Lemu must win this round and will throw in its best cards. Let it: the last round decides, and you will enter it holding more cards.",
        badge: true,
      };
    }
    const pass = winByPassing(view);
    if (pass) return { ...pass, title: "Win the match" };
    const [mine, theirs] = [view.seats[me].handCount, view.seats[other(me)].handCount];
    return spendStrongest(view, {
      title: "Spend your lead",
      text: (name) => `Play ${name}.`,
      why:
        mine > theirs
          ? `You hold ${mine} ${mine === 1 ? "card" : "cards"}, Lemu ${theirs}: the round you gave away paid for this one. ${mine === 1 ? "Play it." : "Play them all."}`
          : "The last round decides. Play your cards.",
      badge: true,
    });
  },
};

// ---------------------------------------------------------------------------
// 2. Enough Is Enough: spend only what you must

const enough: AcademyLessonDefinition = {
  key: "enough",
  title: "Enough Is Enough",
  idea: "Winning a round by 1 is as good as winning it by 30. Save the rest.",
  summary: "Win a round with the smallest card that does it, then pass.",
  intro:
    "You lost Round 1, so you must win this one. Lemu has passed at 11 and kept four cards for Round 3. How much do you really need?",
  winLine: "One point was enough, and the power you kept won Round 3.",
  lossLine:
    "You won Round 2 with more than you needed, and Round 3 missed exactly that. Try again with the smallest card that wins.",
  keywords: [],
  position: {
    round: 2,
    opener: 1,
    turn: 0,
    history: [{ winner: 1, totals: [18, 21] }],
    rules: LESSON_RULES,
    seats: [
      {
        hand: [C.colossus, C.enrai, C.kajioka, C.arashima, C.cryverin],
        deck: [C.arashima],
        board: { CLOSE: [C.musashi] },
        played: 1,
      },
      {
        hand: [C.colossus, C.musashi, C.enrai, C.arashima],
        deck: [C.arashima],
        board: { RANGED: [C.kajioka], JUTSU: [C.arashima] },
        passed: true,
        played: 2,
      },
    ],
  },
  lemu: (view) => duel(view, ["RANGED", "JUTSU", "CLOSE"]),
  advise: (view) => {
    const me = view.me;
    if (view.round === 2) {
      const margin = lead(view);
      const extra = view.seats[me].played - 1;
      if (margin > 1 || extra > 1) {
        return {
          kind: "mistake",
          title: `You won by ${margin}`,
          text: "One point ahead was enough. The power you spent beyond that is power you will miss in Round 3.",
          why: "Pass now and keep the rest.",
          action: { t: "pass" },
        };
      }
      if (margin > 0)
        return passAdvice(
          "That is enough",
          "Tap Pass.",
          "You lead by 1 and Lemu has passed, so the round is yours. Keep every other card.",
        );
      const card = firstInHand(view, C.arashima);
      const action = card ? placeOn(view, card, ["JUTSU", "RANGED", "CLOSE"]) : null;
      if (action) {
        return {
          kind: "move",
          action,
          title: "Just enough",
          text: "Tap Arashima, your smallest card, and play it.",
          why: "Lemu stopped at 11 and you have 7. Arashima's 5 makes 12: a win by 1 is a win.",
        };
      }
      return spendStrongest(view, {
        title: "Get ahead",
        text: (name) => `Play ${name}.`,
      });
    }
    const pass = winByPassing(view);
    if (pass) return { ...pass, title: "Win the match" };
    return spendStrongest(view, {
      title: "The power you kept",
      text: (name) => `Play ${name}.`,
      why: firstInHand(view, C.colossus)
        ? "Both of you play everything now. Your Colossus is still in hand because Round 2 cost you only 5."
        : "Both of you play everything now: the power you kept decides.",
    });
  },
};

// ---------------------------------------------------------------------------
// 3. Cut the Root: Strike and Seal versus raw power

const cutTheRoot: AcademyLessonDefinition = {
  key: "cut-the-root",
  title: "Cut the Root",
  idea: "Hit what makes the other cards strong, not the biggest number on the board.",
  summary: "Seal and Strike the source of Rally and Bond.",
  intro:
    "Round 3 decides. Lemu's rows are pumped: Lord Pengu Rallies its Taijutsu row, and two Subaku Princesses Bond with each other.",
  winLine: "You cut the roots, and Lemu's big numbers withered.",
  lossLine:
    "Your Seal and Strike hit the biggest numbers, not their sources. Try again: Seal Lord Pengu and Strike a Princess.",
  keywords: ["Seal", "Strike", "Rally", "Bond"],
  position: {
    round: 3,
    opener: 1,
    turn: 0,
    history: [
      { winner: 0, totals: [30, 26] },
      { winner: 1, totals: [12, 19] },
    ],
    rules: LESSON_RULES,
    seats: [
      {
        hand: [C.clansman, C.fireball, C.colossus, C.kajioka],
        board: {
          CLOSE: [C.musashi, C.enrai],
          RANGED: [C.kajioka],
          JUTSU: [C.arashima],
        },
        played: 4,
      },
      {
        hand: [C.musashi, C.mei],
        board: {
          CLOSE: [C.pengu, C.cryverin, C.enrai],
          RANGED: [C.princess, C.princess],
        },
        played: 5,
      },
    ],
  },
  lemu: (view) => duel(view),
  advise: (view) => {
    const them = other(view.me);
    const pengu = unitsOf(view, them, C.pengu)[0] ?? null;
    const princesses = unitsOf(view, them, C.princess);
    const clansman = firstInHand(view, C.clansman);
    const fireball = firstInHand(view, C.fireball);
    if (!clansman && pengu && !pengu.sealed) {
      return {
        kind: "mistake",
        title: "The Seal missed the source",
        text: `Seal removes Rally, Bond, Meditate and Resilient from the unit it hits. ${nameOf(view, C.pengu)}, the source of every +2 in its row, is still unsealed.`,
        why: "Restart and Seal Lord Pengu: every other unit in its row drops by 2.",
        action: null,
      };
    }
    if (!fireball && princesses.length === 2) {
      return {
        kind: "mistake",
        title: "The Strike missed the bond",
        text: "Fireball took 5 off one unit, but both Subaku Princesses still Bond. Striking a 4-power Princess destroys it and breaks the other one's Bond as well.",
        why: "Restart and Strike a Subaku Princess.",
        action: null,
      };
    }
    if (clansman && pengu && !pengu.sealed) {
      return {
        kind: "move",
        action: {
          t: "play",
          card: clansman,
          row: "CLOSE",
          targets: [pengu.id],
        },
        title: "Seal the source",
        text: "Tap Hyouga Yui Clansman, your Taijutsu row, then Lord Pengu.",
        why: "Lord Pengu's Rally gives every other unit in its row +2. Those 9s are only 9 because of it: Seal Pengu and the whole row drops.",
      };
    }
    const princess = princesses[princesses.length - 1];
    if (fireball && princess && princesses.length === 2) {
      return {
        kind: "move",
        action: { t: "play", card: fireball, targets: [princess.id] },
        title: "Break the bond",
        text: "Tap Fireball, then a Subaku Princess.",
        why: "Each Princess shows 6 only because the other one is there. Strike 5 destroys one, and the other loses its Bond too.",
      };
    }
    const pass = winByPassing(view);
    if (pass) return { ...pass, title: "Win the match" };
    return spendStrongest(view, {
      title: "Now the raw power",
      text: (name) => `Play ${name}.`,
      why: "With the roots cut, your big cards finish the job.",
    });
  },
};

// ---------------------------------------------------------------------------
// 4. Spread Out: Terrain, Clear Skies and Purge

/** Lemu's control hand: Purge a row of 10 or more, Terrain a crowded row, then units. */
const spreadOutLemu = (view: MatchView): KessenAction => {
  const enemy = other(view.me);
  const rows = rowTotals(view, enemy);
  const tear = firstInHand(view, C.typhoonTear);
  const purgeable = ROWS.filter((row) => (rows[row] ?? 0) >= view.knobs.purgeThreshold);
  if (tear && purgeable.length > 0) {
    const row = purgeable.reduce((best, row) =>
      (rows[row] ?? 0) > (rows[best] ?? 0) ? row : best,
    );
    return { t: "play", card: tear, targets: [row] };
  }
  const kami = firstInHand(view, C.kuraokami);
  const crowded = ROWS.some(
    (row) => view.board[enemy][row].length >= 2 && !view.terrain[enemy][row],
  );
  if (theyPassed(view) && lead(view) > 0) return { t: "pass" };
  const units = duel(
    view,
    ROWS.filter((row) => !view.terrain[view.me][row]),
    [C.kuraokami],
  );
  // Kuraokami waits for a crowded row, or comes down once Lemu has nothing else.
  if (kami && (crowded || units.t === "pass"))
    return { t: "play", card: kami, row: "JUTSU" };
  return units;
};

const rowTotals = (view: MatchView, side: Seat) => {
  const out: Partial<Record<Row, number>> = {};
  for (const row of ROWS) out[row] = rowTotal(view, side, row);
  return out;
};

const spreadOut: AcademyLessonDefinition = {
  key: "spread-out",
  title: "Spread Out",
  idea: "A crowded row is what Terrain and Purge feed on: spread out, and keep Clear Skies for after the storm.",
  summary: "Terrain, Purge and Clear Skies punish one big row.",
  intro:
    "Round 3 decides. Lemu plays control: Kuraokami brings snow to your most crowded row, and Typhoon Tear destroys the strongest unit of any row worth 10 or more.",
  winLine: "Lemu's storm found nothing worth freezing or blowing away.",
  lossLine:
    "One crowded row gave Lemu's Terrain and Purge their targets. Try again: one unit per row first, never 10 in a row, and Clear Skies only after the snow.",
  keywords: ["Terrain", "Purge", "Clear Skies", "Unyielding"],
  position: {
    round: 3,
    opener: 0,
    turn: 0,
    history: [
      { winner: 1, totals: [20, 24] },
      { winner: 0, totals: [27, 22] },
    ],
    rules: LESSON_RULES,
    seats: [
      { hand: [C.kajioka, C.kajioka, C.arashima, C.owlcat, C.kugatsunagi] },
      { hand: [C.kuraokami, C.typhoonTear, C.cryverin, C.arashima] },
    ],
  },
  lemu: spreadOutLemu,
  advise: (view) => {
    const me = view.me;
    const them = other(me);
    const lemuDiscard = view.seats[them].discard.map((id) => view.inst[id]);
    if (lemuDiscard.includes(C.typhoonTear)) {
      return {
        kind: "mistake",
        title: "Typhoon Tear found a target",
        text: "One of your rows reached 10, so Lemu's Purge destroyed its strongest unit. Two small rows are worth as much as one big row and give Purge nothing.",
        why: "Restart and keep every row under 10.",
        action: spendSpread(view),
      };
    }
    const skies = unitsOf(view, me, C.kugatsunagi)[0];
    const kamiInHand = !ROWS.some((row) =>
      view.board[them][row].some((unit) => view.inst[unit.id] === C.kuraokami),
    );
    if (skies && kamiInHand) {
      return {
        kind: "mistake",
        title: "Clear Skies before the storm",
        text: "Kugatsunagi's Clear Skies found no Terrain to clear. Lemu's snow is still to come, and now nothing will lift it.",
        why: "Restart and hold Kugatsunagi until Kuraokami has played its Terrain.",
        action: spendSpread(view),
      };
    }
    const crowded = ROWS.find((row) => view.board[me][row].length >= 3);
    if (crowded) {
      return {
        kind: "mistake",
        title: `Your ${ROW_LABELS[crowded]} row is crowded`,
        text: "Terrain takes 2 from every unit in a row, so a crowded row loses the most, and a big row feeds Purge.",
        why: "Restart and spread your units across all three rows.",
        action: spendSpread(view),
      };
    }
    const snowed = ROWS.find((row) => view.terrain[me][row]);
    const kugatsunagi = firstInHand(view, C.kugatsunagi);
    if (snowed && kugatsunagi) {
      return {
        kind: "move",
        action: {
          t: "play",
          card: kugatsunagi,
          row: safeRow(view, kugatsunagi) ?? "JUTSU",
        },
        title: "Now clear the skies",
        text: "Tap Kugatsunagi and play it to a row that stays under 10.",
        why: `Kuraokami's snow takes 2 from each of your ${ROW_LABELS[snowed]} units. Kugatsunagi's Clear Skies lifts it, and Kuraokami ignores Terrain only because it is Unyielding.`,
      };
    }
    const pass = winByPassing(view);
    if (pass) return { ...pass, title: "Win the match" };
    const action = spendSpread(view);
    if (action?.t !== "play") return passAdvice("Nothing left to play", "Tap Pass.");
    const card = view.inst[action.card] ?? "";
    const row = action.row as Row;
    const units = view.board[me][row].length;
    return {
      kind: "move",
      action,
      title: units === 0 ? "One unit per row" : "Still under 10",
      text: `Tap ${nameOf(view, card)}, then your ${ROW_LABELS[row]} row.`,
      why:
        units === 0
          ? "Lemu's Terrain lands on your most crowded row and its Purge on any row worth 10 or more. Start a new row."
          : `That row stays under 10, so Typhoon Tear has nothing to destroy there.`,
    };
  },
};

/** The spread line: strongest card first (Clear Skies held back) to a row that stays under 10. */
const spendSpread = (view: MatchView): KessenAction | null => {
  const hand = strongestFirst(view).filter((id) => view.inst[id] !== C.kugatsunagi);
  const held = firstInHand(view, C.kugatsunagi);
  for (const id of held ? [...hand, held] : hand) {
    const row = safeRow(view, id);
    if (row) return { t: "play", card: id, row };
  }
  for (const id of hand) {
    const play = placeOn(view, id);
    if (play) return play;
  }
  return { t: "pass" };
};

/**
 * The open row for `id` with the fewest units that stays under the Purge threshold even
 * once Terrain is cleared.
 */
const safeRow = (view: MatchView, id: string): Row | null => {
  const card = view.cards[view.inst[id] ?? ""];
  if (card?.kind !== "UNIT" || card.row === null) return null;
  const rows = card.row === "ANY" ? ROWS : [card.row];
  let best: Row | null = null;
  for (const row of rows) {
    const units = view.board[view.me][row].length;
    if (units >= view.knobs.rowCap) continue;
    if (clearRowTotal(view, view.me, row) + card.power >= view.knobs.purgeThreshold)
      continue;
    if (best === null || units < view.board[view.me][best].length) best = row;
  }
  return best;
};

// ---------------------------------------------------------------------------
// 5. Grow Early: Meditate

const growEarly: AcademyLessonDefinition = {
  key: "grow-early",
  title: "Grow Early",
  idea: "A unit that grows is worth the most on your first turn; plain power can wait.",
  summary: "Play Meditate units first, and keep the round going while they grow.",
  intro:
    "Round 3 decides, and you hold two Meditate units: they gain power at the start of each of your turns until they have gained 6, or until you pass.",
  winLine: "Your growers had the whole round to grow.",
  lossLine:
    "Your Meditate units came down last and had no turns left to grow. Try again: growers first, big cards later.",
  keywords: ["Meditate"],
  position: {
    round: 3,
    opener: 0,
    turn: 0,
    history: [
      { winner: 1, totals: [22, 25] },
      { winner: 0, totals: [26, 20] },
    ],
    rules: LESSON_RULES,
    seats: [
      { hand: [C.colossus, C.musashi, C.ava, C.cryverin, C.mosswolf] },
      { hand: [C.colossus, C.enrai, C.musashi, C.kajioka, C.kajioka, C.arashima] },
    ],
  },
  lemu: (view) => duel(view, ["RANGED", "JUTSU", "CLOSE"]),
  advise: (view) => {
    const me = view.me;
    const growers = [C.ava, C.mosswolf];
    const placed = ROWS.flatMap((row) => view.board[me][row]);
    const plainFirst = placed.some(
      (unit) => !growers.includes(view.inst[unit.id] as never),
    );
    const growerLeft = growers.some((card) => firstInHand(view, card));
    if (plainFirst && growerLeft) {
      return {
        kind: "mistake",
        title: "The grower waited",
        text: "Every turn a Meditate unit spends in your hand is a turn it does not grow. Your plain units are worth the same whenever you play them.",
        why: "Restart and play Ava, then Mosswolf, first.",
        action: growerAction(view),
      };
    }
    const pass = winByPassing(view);
    if (pass) {
      const growing = placed.some(
        (unit) =>
          growers.includes(view.inst[unit.id] as never) &&
          unit.med < view.knobs.meditateCap,
      );
      const hand = view.seats[me].hand ?? [];
      if (!growing || hand.length === 0) return { ...pass, title: "Win the match" };
    }
    const ava = firstInHand(view, C.ava);
    if (ava) {
      return {
        kind: "move",
        action: { t: "play", card: ava, row: "CLOSE" },
        title: "Growers first",
        text: "Tap Ava the Snow Terror and play it.",
        why: "Meditate 2: Ava gains 2 at the start of each of your turns, up to +6. Played now it grows three times; played last, never.",
      };
    }
    const moss = firstInHand(view, C.mosswolf);
    if (moss) {
      return {
        kind: "move",
        action: { t: "play", card: moss, row: "CLOSE" },
        title: "The other grower",
        text: "Tap Mosswolf and play it.",
        why: "Mosswolf gains 1 every turn you take. The longer it stands, the bigger it gets.",
      };
    }
    return spendStrongest(view, {
      title: "Keep the round going",
      text: (name) => `Play ${name}.`,
      why: "Meditate stops once you pass, so play your plain cards while the growers grow.",
    });
  },
};

const growerAction = (view: MatchView): KessenAction | null => {
  for (const card of [C.ava, C.mosswolf]) {
    const id = firstInHand(view, card);
    const play = id ? placeOn(view, id) : null;
    if (play) return play;
  }
  return null;
};

// ---------------------------------------------------------------------------
// 6. The Leader's Moment

const leadersMoment: AcademyLessonDefinition = {
  key: "leaders-moment",
  title: "The Leader's Moment",
  idea: "Your leader acts once per match: save it for the round that decides, and the moment it is worth the most.",
  summary: "Hold the leader ability for the decisive round and a full row.",
  intro:
    "You lead with Hisame, Dune Warden. Once per match, Sunflare gives +3 to every unit in one of your rows. You won Round 1; Lemu must win this one.",
  winLine: "Sunflare landed on a full row in the round that mattered.",
  lossLine:
    "Sunflare was spent before it could decide anything. Try again: give Lemu Round 2, then use Sunflare on your fullest row in Round 3.",
  keywords: ["Empower"],
  position: {
    round: 2,
    opener: 0,
    turn: 0,
    history: [{ winner: 0, totals: [24, 19] }],
    rules: LESSON_RULES,
    seats: [
      {
        leader: C.hisame,
        hand: [C.musashi, C.enrai, C.cryverin, C.mei, C.kajioka],
        deck: [C.arashima],
      },
      {
        hand: [C.colossus, C.colossus, C.enrai, C.musashi, C.kajioka, C.mei],
        deck: [C.colossus],
      },
    ],
  },
  lemu: (view) => duel(view, ["RANGED", "JUTSU", "CLOSE"]),
  advise: (view) => {
    const me = view.me;
    const seat = view.seats[me];
    if (view.round === 2) {
      if (seat.leaderUsed) {
        return {
          kind: "mistake",
          title: "Sunflare is gone",
          text: "Lemu must win this round and will outspend you. Your leader acts once per match, and now Round 3 has to be won without it.",
          why: "Restart, pass Round 2 and keep Sunflare.",
          action: { t: "pass" },
        };
      }
      if (seat.played > 0) {
        return {
          kind: "mistake",
          title: "A round you cannot win",
          text: "Lemu holds two Colossi and must win this round. Every card you play here is missing in Round 3.",
          why: "Pass now and keep the rest, and keep Sunflare.",
          action: { t: "pass" },
        };
      }
      return {
        kind: "move",
        action: { t: "pass" },
        title: "Not this round",
        text: "Tap Pass.",
        why: "Lemu must win Round 2 and will spend its Colossi on it. Let it: your cards and your leader wait for Round 3.",
        badge: true,
      };
    }
    const close = view.board[me].CLOSE.length;
    if (seat.leaderUsed && close < 4 && !theyPassed(view)) {
      return {
        kind: "mistake",
        title: "Sunflare is spent",
        text: "Sunflare gives +3 to each unit in one row, once per match. Used before your Taijutsu row was full, it gave far less than the +15 a full row takes.",
        why: "Restart: give Lemu Round 2, then fill Taijutsu before Sunflare.",
        action: null,
      };
    }
    const fillable = strongestFirst(view).some(
      (id) => openRow(view, me, id, ["CLOSE"]) === "CLOSE",
    );
    if (!seat.leaderUsed && close > 0 && (close >= view.knobs.rowCap || !fillable)) {
      return {
        kind: "move",
        action: { t: "leader", targets: ["CLOSE"] },
        title: "Now, Sunflare",
        text: "Tap your leader, then your Taijutsu row.",
        why: `${close} units in Taijutsu: Sunflare gives each of them +3, ${close * 3} in one turn.`,
      };
    }
    const pass = winByPassing(view);
    if (pass && seat.leaderUsed) return { ...pass, title: "Win the match" };
    const card = strongestFirst(view).find(
      (id) => openRow(view, me, id, ["CLOSE"]) === "CLOSE",
    );
    if (card && !seat.leaderUsed) {
      return {
        kind: "move",
        action: { t: "play", card, row: "CLOSE" },
        title: "Fill the row",
        text: `Tap ${nameOf(view, view.inst[card] ?? "")} and play it to Taijutsu.`,
        why: "Sunflare gives +3 to every unit in one row. Fill Taijutsu before you use it.",
      };
    }
    return spendStrongest(view, {
      title: "Finish it",
      text: (name) => `Play ${name}.`,
    });
  },
};

export const KESSEN_ACADEMY_LESSONS: readonly AcademyLessonDefinition[] = [
  firstBlood,
  enough,
  cutTheRoot,
  spreadOut,
  growEarly,
  leadersMoment,
];
