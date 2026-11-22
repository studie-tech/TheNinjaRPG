import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  KESSEN_ACADEMY_GRADUATION_PACK_ID,
  KESSEN_ACADEMY_LESSON_RYO,
} from "@/drizzle/constants";
import { legalActions } from "@/libs/kessen/abilities";
import {
  type AcademyCoachStep,
  type AcademyUiState,
  academyAdvice,
  academyCoach,
  academyDebrief,
  academyLessonFor,
  academyLessonLockReason,
  academyLessonStart,
  academyLessonState,
  academyLessonsCompleted,
  academyNpcAction,
  academyPassWarning,
  academyProgress,
  academyTaughtLine,
  completesAcademy,
  finishedFirstLesson,
  KESSEN_ACADEMY,
  KESSEN_ACADEMY_LESSON_KEYS,
  type KessenAcademyLessonKey,
  nextAcademyLesson,
} from "@/libs/kessen/academy";
import { academyPositionProblem } from "@/libs/kessen/academyPosition";
import {
  applyAction,
  boardTotals,
  previewState,
  stateHash,
  targetOptionsForView,
  viewFor,
} from "@/libs/kessen/engine";
import { createRng } from "@/libs/kessen/rng";
import type { KessenAction, MatchState, MatchView, Row } from "@/libs/kessen/types";
import { KESSEN_SEED_CATALOG } from "./fixtures/catalog";

const CATALOG = Object.fromEntries(KESSEN_SEED_CATALOG.map((card) => [card.id, card]));
const ROWS: Row[] = ["CLOSE", "RANGED", "JUTSU"];

type Policy = (state: MatchState) => KessenAction;

/** The lesson's start with Lemu's opening replies applied. */
const startOf = (key: KessenAcademyLessonKey) => {
  const start = academyLessonState(key, KESSEN_SEED_CATALOG);
  if ("error" in start) throw new Error(start.error);
  return lemuReplies(key, start.state);
};

const lemuReplies = (key: KessenAcademyLessonKey, state: MatchState) => {
  let current = state;
  for (let n = 0; n < 100 && current.phase === "play" && current.turn === 1; n++) {
    const action = academyNpcAction(key, viewFor(current, 1));
    const applied = applyAction(current, 1, action);
    if (!applied.ok)
      throw new Error(`Lemu ${JSON.stringify(action)}: ${applied.reason}`);
    current = applied.state;
  }
  return current;
};

/** Plays a lesson to its end with `policy` for the player and Lemu's script. */
const playLesson = (key: KessenAcademyLessonKey, policy: Policy) => {
  let state = startOf(key);
  const steps: (AcademyCoachStep | null)[] = [];
  for (let n = 0; n < 100 && !state.result; n++) {
    expect(state.phase).toBe("play");
    steps.push(academyCoach(key, viewFor(state, 0), idle));
    const applied = applyAction(state, 0, policy(state));
    if (!applied.ok) throw new Error(applied.reason);
    state = lemuReplies(key, applied.state);
  }
  return { state, steps, mistakes: steps.filter((step) => step?.tone === "mistake") };
};

const idle: AcademyUiState = { myTurn: true, card: null, action: null };

const power = (state: MatchState, id: string) =>
  CATALOG[state.inst[id] ?? ""]?.power ?? 0;
const plays = (state: MatchState) =>
  legalActions(state, 0, { dedupeCopies: true }).filter(
    (action) => action.t !== "pass",
  );
const wonIfPassing = (state: MatchState) => {
  const totals = boardTotals(state);
  return state.seats[1].passed && totals[0] > totals[1];
};
const compare = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++)
    if (a[i] !== b[i]) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
};
const rowRank = (action: KessenAction) =>
  "row" in action && action.row ? ROWS.indexOf(action.row) : 0;

/**
 * "Play your biggest card": the strongest printed card first, to the first open row,
 * aimed at the strongest enemy unit; the leader only when nothing else is left. It
 * passes once ahead of a passed Lemu.
 */
const biggestCard: Policy = (state) => {
  if (wonIfPassing(state)) return { t: "pass" };
  let best: { action: KessenAction; key: number[] } | null = null;
  for (const action of plays(state)) {
    const target = (action.t === "play" ? (action.targets ?? []) : []).reduce(
      (score, id) => {
        const unit = state.board[1][
          ROWS.find((row) => state.board[1][row].some((entry) => entry.id === id)) ??
            "CLOSE"
        ].find((entry) => entry.id === id);
        return score + (unit ? unit.stored * 100 + unit.seq : -1000);
      },
      0,
    );
    const key = [
      action.t === "leader" ? -1 : power(state, action.t === "play" ? action.card : ""),
      -rowRank(action),
      target,
    ];
    if (!best || compare(key, best.key) > 0) best = { action, key };
  }
  return best?.action ?? { t: "pass" };
};

/** Reads the preview: the play with the largest immediate swing, bigger cards first. */
const biggestSwing: Policy = (state) => {
  if (wonIfPassing(state)) return { t: "pass" };
  let best: { action: KessenAction; key: number[] } | null = null;
  for (const action of plays(state)) {
    const preview = previewState(state, 0, action);
    if (!preview.ok) continue;
    const { before, after } = preview.totals;
    const swing = after[0] - after[1] - (before[0] - before[1]);
    const key = [
      swing,
      action.t === "play" ? power(state, action.card) : 0,
      -rowRank(action),
    ];
    if (!best || compare(key, best.key) > 0) best = { action, key };
  }
  return best?.action ?? { t: "pass" };
};

const randomPolicy = (seed: string): Policy => {
  const rng = createRng(seed);
  return (state) => {
    const options = plays(state);
    if (wonIfPassing(state) && rng.int(2) === 0) return { t: "pass" };
    if (options.length === 0 || rng.int(8) === 0) return { t: "pass" };
    return options[rng.int(options.length)] as KessenAction;
  };
};

/**
 * Follows a move's coach steps on a simulated table: each step's ringed control is
 * tapped the way the table taps it, until the table sends an action. Every ringed
 * control must exist in the view.
 */
const tapThrough = (key: KessenAcademyLessonKey, view: MatchView) => {
  let ui: AcademyUiState = idle;
  const rings: string[] = [];
  for (let n = 0; n < 12; n++) {
    const step = academyCoach(key, view, ui);
    if (!step) throw new Error("no coach step");
    expect(step.tone).toBe("guide");
    rings.push(step.key ? `${step.target}:${step.key}` : step.target);
    const send = (action: KessenAction) => ({ action, step, rings });
    switch (step.target) {
      case "pass":
        return send({ t: "pass" });
      case "hand-card": {
        expect(view.seats[0].hand).toContain(step.key as string);
        const card = CATALOG[view.inst[step.key as string] ?? ""];
        ui = {
          ...ui,
          card: step.key as string,
          action:
            card?.kind === "TACTIC" ? { t: "play", card: step.key as string } : null,
        };
        break;
      }
      case "leader":
        expect(view.seats[0].leader).not.toBeNull();
        ui = { ...ui, card: null, action: { t: "leader" } };
        break;
      case "row": {
        const [side, row] = (step.key ?? "").split("-") as ["me" | "them", Row];
        expect(["me", "them"]).toContain(side);
        expect(ROWS).toContain(row);
        const status = ui.action ? targetOptionsForView(view, 0, ui.action) : null;
        if (status?.status === "need" && status.request.kind.endsWith("Row")) {
          const action = {
            ...ui.action,
            targets: [...(ui.action?.targets ?? []), row],
          } as Extract<KessenAction, { t: "play" | "leader" }>;
          if (targetOptionsForView(view, 0, action).status === "complete")
            return send(action);
          ui = { ...ui, action };
        } else if (ui.action?.t === "play" && ui.action.row === row) {
          return send(ui.action);
        } else {
          ui = { ...ui, action: { t: "play", card: ui.card as string, row } };
        }
        break;
      }
      case "unit": {
        const onBoard = [0, 1].some((side) =>
          ROWS.some((row) =>
            view.board[side as 0 | 1][row].some((unit) => unit.id === step.key),
          ),
        );
        expect(onBoard).toBe(true);
        const action = {
          ...ui.action,
          targets: [...(ui.action?.targets ?? []), step.key as string],
        } as Extract<KessenAction, { t: "play" | "leader" }>;
        if (targetOptionsForView(view, 0, action).status === "complete")
          return send(action);
        ui = { ...ui, action };
        break;
      }
      case "confirm":
        return send(ui.action as KessenAction);
      default:
        throw new Error(`unexpected target ${step.target}`);
    }
  }
  throw new Error("the coach never completed the move");
};

describe("Academy series", () => {
  it("lists six lessons in order, each paying the lesson ryo", () => {
    expect(KESSEN_ACADEMY.map((lesson) => lesson.key)).toEqual([
      ...KESSEN_ACADEMY_LESSON_KEYS,
    ]);
    expect(KESSEN_ACADEMY).toHaveLength(6);
    for (const lesson of KESSEN_ACADEMY) {
      expect(lesson.rewardRyo).toBe(KESSEN_ACADEMY_LESSON_RYO);
      expect(lesson.idea.length).toBeGreaterThan(20);
      expect(lesson.summary.length).toBeGreaterThan(10);
      expect(lesson.order).toBe(KESSEN_ACADEMY.indexOf(lesson) + 1);
    }
  });

  it("opens lessons in order and keeps completed ones replayable", () => {
    expect(academyLessonLockReason("first-blood", [])).toBeNull();
    expect(academyLessonLockReason("enough", [])).toBe('Finish "First Blood" first.');
    expect(academyLessonLockReason("enough", ["first-blood"])).toBeNull();
    expect(academyLessonLockReason("first-blood", ["first-blood"])).toBeNull();
    expect(nextAcademyLesson([])).toBe("first-blood");
    expect(nextAcademyLesson(["first-blood", "enough"])).toBe("cut-the-root");
    expect(nextAcademyLesson([...KESSEN_ACADEMY_LESSON_KEYS])).toBeNull();
    expect(
      completesAcademy("leaders-moment", KESSEN_ACADEMY_LESSON_KEYS.slice(0, 5)),
    ).toBe(true);
    expect(
      completesAcademy("leaders-moment", KESSEN_ACADEMY_LESSON_KEYS.slice(0, 4)),
    ).toBe(false);
  });

  it("recommends the open, unfinished lesson that teaches an opponent's keywords", () => {
    const opened = ["first-blood", "enough", "cut-the-root"];
    expect(academyLessonFor(["Terrain", "Meditate"], [])).toBeNull();
    expect(academyLessonFor(["Seal"], ["first-blood"])).toBeNull();
    expect(academyLessonFor(["Seal"], ["first-blood", "enough"])).toBe("cut-the-root");
    expect(academyLessonFor(["Terrain", "Meditate"], opened)).toBe("spread-out");
    expect(academyLessonFor(["Terrain", "Meditate"], [...opened, "spread-out"])).toBe(
      "grow-early",
    );
    expect(academyLessonFor(["Infiltrator"], [])).toBeNull();
    expect(academyLessonFor([], [])).toBeNull();
  });

  it("reads progress from the stored lesson map", () => {
    const stored = { enough: "m2", "first-blood": "m1", stale: "m0" };
    expect(academyLessonsCompleted(stored)).toEqual(["first-blood", "enough"]);
    expect(finishedFirstLesson(stored)).toBe(true);
    expect(finishedFirstLesson({})).toBe(false);
    expect(finishedFirstLesson(null)).toBe(false);
    const progress = academyProgress(stored, null);
    expect(progress).toMatchObject({
      completed: 2,
      total: 6,
      next: "cut-the-root",
      graduated: false,
      graduationPackId: KESSEN_ACADEMY_GRADUATION_PACK_ID,
    });
    expect(progress.lessons.map((lesson) => lesson.lockReason === null)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(academyProgress(stored, "m6").graduated).toBe(true);
  });

  it("keeps lesson code free of randomness and the wall clock", () => {
    for (const file of ["academy.ts", "academyLessons.ts", "academyPosition.ts"]) {
      const source = readFileSync(
        join(import.meta.dirname, "../../../src/libs/kessen", file),
        "utf8",
      );
      expect(source).not.toMatch(/Math\.random|Date\b|performance\.now/);
    }
  });
});

/** Naive lines each lesson must beat, and whether reading the preview alone wins. */
const EXPECTED: Record<KessenAcademyLessonKey, { previewWins: boolean }> = {
  "first-blood": { previewWins: false },
  enough: { previewWins: false },
  // The preview shows Sealing Lord Pengu as the biggest swing once its row is full.
  "cut-the-root": { previewWins: true },
  "spread-out": { previewWins: false },
  "grow-early": { previewWins: false },
  "leaders-moment": { previewWins: false },
};

describe.each([...KESSEN_ACADEMY_LESSON_KEYS])("lesson %s", (key) => {
  it("starts from a valid position of seed cards without mulligans", () => {
    const start = academyLessonState(key, KESSEN_SEED_CATALOG);
    if ("error" in start) throw new Error(start.error);
    expect(academyPositionProblem(start.state)).toBeNull();
    for (const card of Object.values(start.state.cards)) {
      expect(CATALOG[card.id]).toEqual(card);
    }
    expect(start.state.rules.r1MulliganCap).toBe(0);
    expect(start.state.knobs.laterMulligans).toBe(0);
    expect(academyLessonState(key, [])).toEqual({
      error: expect.stringContaining("Unknown Academy card"),
    });
  });

  it("is won by the taught line, every move ringed control by control", () => {
    let state = startOf(key);
    let moves = 0;
    for (let n = 0; n < 100 && !state.result; n++) {
      const view = viewFor(state, 0);
      const advice = academyAdvice(key, view);
      expect(advice?.kind).toBe("move");
      const { action, step } = tapThrough(key, view);
      expect(step.retry).toBe(false);
      expect(step.title.length).toBeGreaterThan(0);
      if (advice?.kind === "move") expect(action).toEqual(advice.action);
      const applied = applyAction(state, 0, action);
      if (!applied.ok) throw new Error(applied.reason);
      state = lemuReplies(key, applied.state);
      moves += 1;
    }
    expect(state.result).toEqual({ winner: 0 });
    expect(moves).toBeGreaterThan(1);
    const line = academyTaughtLine(key, KESSEN_SEED_CATALOG);
    if ("error" in line) throw new Error(line.error);
    expect(line.actions).toHaveLength(moves);
    expect(stateHash(line.state)).toBe(stateHash(state));
    expect("state" in academyLessonStart(key, KESSEN_SEED_CATALOG)).toBe(true);
  });

  it("loses the naive biggest-card line and explains the mistake", () => {
    const naive = playLesson(key, biggestCard);
    expect(naive.state.result?.winner).not.toBe(0);
    expect(naive.mistakes.length).toBeGreaterThan(0);
    for (const step of naive.mistakes) {
      expect(step?.retry).toBe(true);
      expect(step?.text.length).toBeGreaterThan(20);
    }
  });

  it("rewards reading the preview only where the lesson says so", () => {
    const greedy = playLesson(key, biggestSwing);
    expect(greedy.state.result?.winner === 0).toBe(EXPECTED[key].previewWins);
    if (!EXPECTED[key].previewWins) expect(greedy.mistakes.length).toBeGreaterThan(0);
  });

  it("keeps Lemu and the coach legal on random lines", () => {
    let wins = 0;
    for (let n = 0; n < 60; n++) {
      const run = playLesson(key, randomPolicy(`${key}:${n}`));
      if (run.state.result?.winner === 0) wins += 1;
    }
    // Lessons are won by their idea, not by chance.
    expect(wins).toBeLessThan(30);
    for (let n = 0; n < 30; n++) {
      const policy = randomPolicy(`coach:${key}:${n}`);
      let state = startOf(key);
      for (let m = 0; m < 100 && !state.result; m++) {
        const step = academyCoach(key, viewFor(state, 0), idle);
        if (step?.action) {
          expect(applyAction(state, 0, step.action).ok).toBe(true);
        }
        const playOn = academyCoach(key, viewFor(state, 0), { ...idle, playOn: true });
        if (playOn?.action) expect(applyAction(state, 0, playOn.action).ok).toBe(true);
        const applied = applyAction(state, 0, policy(state));
        if (!applied.ok) throw new Error(applied.reason);
        state = lemuReplies(key, applied.state);
      }
      expect(state.result).not.toBeNull();
    }
  });
});

describe("coach steps", () => {
  const view = viewFor(startOf("cut-the-root"), 0);

  it("rings the card, its row, then the target", () => {
    const first = academyCoach("cut-the-root", view, idle);
    expect(first).toMatchObject({ target: "hand-card", tone: "guide", retry: false });
    const card = first?.key as string;
    const row = academyCoach("cut-the-root", view, { ...idle, card });
    expect(row).toMatchObject({ target: "row", key: "me-CLOSE" });
    const target = academyCoach("cut-the-root", view, {
      ...idle,
      card,
      action: { t: "play", card, row: "CLOSE" },
    });
    expect(target?.target).toBe("unit");
    expect(view.inst[target?.key as string]).toBe("kessen-lord-pengu");
  });

  it("asks for the advised card when another one is selected", () => {
    const other = view.seats[0].hand?.find(
      (id) => view.inst[id] === "kessen-colossus",
    ) as string;
    const step = academyCoach("cut-the-root", view, { ...idle, card: other });
    expect(step?.target).toBe("hand-card");
    expect(step?.text).toStartWith("Not that one");
  });

  it("sends the player back when a target is wrong", () => {
    const first = academyCoach("cut-the-root", view, idle);
    const card = first?.key as string;
    const wrong = view.board[1].CLOSE.find(
      (unit) => view.inst[unit.id] === "kessen-cryverin",
    )?.id as string;
    const step = academyCoach("cut-the-root", view, {
      ...idle,
      card,
      action: { t: "play", card, row: "CLOSE", targets: [wrong] },
    });
    expect(step).toMatchObject({ target: "hand-card", key: card });
    expect(step?.text).toContain("start over");
  });

  it("explains a mistake and guides the recovery on request", () => {
    const run = playLesson("enough", biggestCard);
    const state = startOf("enough");
    const colossus = state.seats[0].hand.find(
      (id) => state.inst[id] === "kessen-colossus",
    ) as string;
    const applied = applyAction(state, 0, { t: "play", card: colossus, row: "CLOSE" });
    if (!applied.ok) throw new Error(applied.reason);
    const after = viewFor(applied.state, 0);
    const mistake = academyCoach("enough", after, idle);
    expect(mistake).toMatchObject({ tone: "mistake", target: "center", retry: true });
    expect(mistake?.title).toBe("You won by 8");
    const recovery = academyCoach("enough", after, { ...idle, playOn: true });
    expect(recovery).toMatchObject({ tone: "guide", target: "pass", retry: true });
    expect(run.mistakes[0]?.title).toBe("You won by 8");
  });

  it("is silent when the player cannot act", () => {
    expect(academyCoach("cut-the-root", view, { ...idle, myTurn: false })).toBeNull();
    expect(academyAdvice("cut-the-root", { ...view, turn: 1 })).toBeNull();
  });

  it("warns before a pass the coach did not ask for", () => {
    expect(academyPassWarning("cut-the-root", view)).toContain("Seal the source");
    const passing = viewFor(startOf("leaders-moment"), 0);
    expect(academyPassWarning("leaders-moment", passing)).toBeNull();
  });
});

describe("lesson debrief", () => {
  it("closes a won lesson with its idea", () => {
    const line = academyTaughtLine("enough", KESSEN_SEED_CATALOG);
    if ("error" in line) throw new Error(line.error);
    const lesson = KESSEN_ACADEMY[1];
    expect(academyDebrief("enough", viewFor(line.state, 0))).toEqual({
      won: true,
      title: "Lesson complete",
      text: lesson?.winLine as string,
      idea: lesson?.idea as string,
    });
    expect(academyDebrief("enough", viewFor(startOf("enough"), 0))).toBeNull();
  });

  it("names the pass that lost a lesson with cards in hand", () => {
    const passed = playLesson("cut-the-root", () => ({ t: "pass" }));
    expect(passed.state.result?.winner).toBe(1);
    const debrief = academyDebrief("cut-the-root", viewFor(passed.state, 0));
    expect(debrief).toMatchObject({ won: false, title: "A pass too soon" });
    expect(debrief?.text).toContain("You passed Round 3 with 4 cards in hand");
    const naive = playLesson("cut-the-root", biggestCard);
    expect(academyDebrief("cut-the-root", viewFor(naive.state, 0))).toMatchObject({
      won: false,
      title: "Not this time",
      text: KESSEN_ACADEMY[2]?.lossLine,
    });
  });
});
