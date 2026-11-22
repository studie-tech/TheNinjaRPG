import { describe, expect, it } from "bun:test";
import { lessonMarks, lessonTargetSelector } from "@/layout/kessen/match/lesson";
import {
  describeEvent,
  ghostOf,
  houseRuleRoundNote,
  needLine,
  noRowText,
  passFacts,
  placementBonusNote,
  roundWinnerIfEnded,
  rowEffectLabel,
  withGhostNote,
} from "@/layout/kessen/match/matchText";
import { applyPlaybackEvent, buildPlayback } from "@/layout/kessen/match/playback";
import { rowEffectsOf, rowRequestAccepts } from "@/layout/kessen/match/useMatchTable";
import {
  academyCoach,
  academyLessonState,
  academyNpcAction,
  academyRowKey,
} from "@/libs/kessen/academy";
import {
  actingSeats,
  applyAction,
  boardTotals,
  redactEvents,
  viewFor,
} from "@/libs/kessen/engine";
import type {
  KessenEvent,
  MatchState,
  MatchView,
  TargetRequest,
} from "@/libs/kessen/types";
import { KESSEN_SEED_CATALOG } from "../../../libs/kessen/fixtures/catalog";

const names = {
  card: (cardId: string) =>
    KESSEN_SEED_CATALOG.find((card) => card.id === cardId)?.name ?? "?",
  opponent: "Lemu",
};

/** First Blood's starting position after Lemu's opening play. */
const lessonStart = () => {
  const lesson = academyLessonState("first-blood", KESSEN_SEED_CATALOG);
  if ("error" in lesson) throw new Error(lesson.error);
  let engine = lesson.state;
  while (actingSeats(engine).includes(1)) {
    const reply = applyAction(
      engine,
      1,
      academyNpcAction("first-blood", viewFor(engine, 1)),
    );
    if (!reply.ok) throw new Error(reply.reason);
    engine = reply.state;
  }
  return engine;
};

/** The lesson match after the human's action and Lemu's scripted replies. */
const play = (state: MatchState, action: Parameters<typeof applyAction>[2]) => {
  const human = applyAction(state, 0, action);
  if (!human.ok) throw new Error(human.reason);
  let engine = human.state;
  const events: KessenEvent[] = [...human.events];
  while (actingSeats(engine).includes(1)) {
    const reply = applyAction(
      engine,
      1,
      academyNpcAction("first-blood", viewFor(engine, 1)),
    );
    if (!reply.ok) throw new Error(reply.reason);
    engine = reply.state;
    events.push(...reply.events);
  }
  return { engine, events: redactEvents(events, 0) };
};

const firstPlay = (state: MatchState) => {
  const card = state.seats[0].hand[0] as string;
  return play(state, { t: "play", card, row: "CLOSE" });
};

describe("Kessen match playback", () => {
  it("folds the confirmed events into the confirmed board", () => {
    const start = lessonStart();
    const before = viewFor(start, 0);
    const { engine, events } = firstPlay(start);
    const steps = buildPlayback(before, events, true);
    expect(steps).toHaveLength(events.length);
    const last = events.reduce<MatchView>(applyPlaybackEvent, before);
    const after = viewFor(engine, 0);
    expect(boardTotals(last)).toEqual(boardTotals(after));
    expect(last.seats[0].hand).toEqual(after.seats[0].hand);
    expect(last.seats[1].handCount).toBe(after.seats[1].handCount);
    for (const side of [0, 1] as const) {
      for (const row of ["CLOSE", "RANGED", "JUTSU"] as const) {
        expect(last.board[side][row].map((unit) => unit.id)).toEqual(
          after.board[side][row].map((unit) => unit.id),
        );
      }
    }
    // The view the playback starts from is never mutated.
    expect(before).toEqual(viewFor(start, 0));
  });

  it("keeps a leaving unit on screen for its removal step", () => {
    const start = lessonStart();
    const view = viewFor(start, 0);
    const unit = view.board[0].RANGED[0] ?? view.board[1].RANGED[0];
    if (!unit) throw new Error("the lesson opens with a Shadow Clone on the board");
    const side = view.board[0].RANGED[0] ? 0 : 1;
    const destroyed: KessenEvent = {
      t: "destroyed",
      id: unit.id,
      cardId: view.inst[unit.id] as string,
      owner: side,
      side,
      row: "RANGED",
      cause: "strike",
    };
    const [step] = buildPlayback(view, [destroyed], true);
    expect(step?.frame.board[side].RANGED.some((entry) => entry.id === unit.id)).toBe(
      true,
    );
    expect(step?.fx?.kind).toBe("destroy");
    expect(
      applyPlaybackEvent(view, destroyed).board[side].RANGED.some(
        (entry) => entry.id === unit.id,
      ),
    ).toBe(false);
  });

  it("holds round ends and shortens steps without motion", () => {
    const start = lessonStart();
    const view = viewFor(start, 0);
    const roundEnd: KessenEvent = {
      t: "roundEnd",
      round: 1,
      totals: [10, 4],
      winner: 0,
      riggedOdds: false,
      lanterns: [2, 1],
    };
    const placed: KessenEvent = {
      t: "placed",
      id: start.seats[0].hand[0] as string,
      cardId: start.inst[start.seats[0].hand[0] as string] as string,
      owner: 0,
      side: 0,
      row: "CLOSE",
      source: "hand",
      stored: 5,
    };
    const still = buildPlayback(view, [placed, roundEnd], false);
    expect(still[0]?.duration).toBeLessThanOrEqual(140);
    expect(still[1]?.hold).toBe(true);
    const moving = buildPlayback(view, [placed, roundEnd], true);
    expect(moving[0]?.duration).toBeGreaterThan(still[0]?.duration ?? 0);
    expect(applyPlaybackEvent(view, roundEnd).seats[1].lanterns).toBe(1);
  });
});

describe("Kessen match text", () => {
  it("states pass facts and arms the second tap only for a losing pass", () => {
    const start = lessonStart();
    const view = viewFor(start, 0);
    const level = structuredClone(view);
    level.board = [
      { CLOSE: [], RANGED: [], JUTSU: [] },
      { CLOSE: [], RANGED: [], JUTSU: [] },
    ];
    expect(passFacts(level, "Lemu")).toMatchObject({ armed: false, label: "Pass" });
    expect(passFacts(level, "Lemu").line).toContain("Tied at 0");
    expect(needLine(level, "Lemu")).toEqual({
      full: "Tied",
      short: "Tied",
      lead: "Tied",
      count: null,
    });

    const behind = structuredClone(level);
    const lemuUnit = {
      id: "s1-0",
      owner: 1 as const,
      stored: 6,
      sealed: false,
      med: 0,
      res: false,
      seq: 1,
    };
    behind.inst["s1-0"] = start.inst["s1-0"] as string;
    behind.board[1].CLOSE = [lemuUnit];
    behind.seats[1].passed = true;
    const facts = passFacts(behind, "Lemu");
    expect(facts.armed).toBe(true);
    expect(facts.label).toBe(`End round, keep ${behind.seats[0].handCount} cards`);
    expect(facts.line).toMatch(/^You lose this round 0–\d+\./);
    expect(roundWinnerIfEnded(behind)).toBe(1);
    expect(needLine(behind, "Lemu")?.full).toMatch(/^You need \d+ to win$/);

    const ahead = structuredClone(behind);
    ahead.board = [behind.board[1], level.board[1]];
    ahead.board[0].CLOSE = [{ ...lemuUnit, owner: 0, id: "s1-0" }];
    expect(passFacts(ahead, "Lemu")).toMatchObject({ armed: false });
    expect(passFacts(ahead, "Lemu").line).toContain("Passing now wins the round");
  });

  it("says an opponent with no cards and no leader charge cannot score", () => {
    const start = lessonStart();
    const view = viewFor(start, 0);
    const ahead = structuredClone(view);
    ahead.board = [
      { CLOSE: [], RANGED: [], JUTSU: [] },
      { CLOSE: [], RANGED: [], JUTSU: [] },
    ];
    const id = Object.keys(ahead.inst).find((entry) => !entry.startsWith("s1"));
    ahead.board[0].CLOSE = [
      {
        id: id as string,
        owner: 0,
        stored: 7,
        sealed: false,
        med: 0,
        res: false,
        seq: 1,
      },
    ];
    ahead.seats[1].handCount = 0;
    ahead.seats[1].leaderUsed = true;
    const total = passFacts(ahead, "Kazehiko").line.match(/wins the round (\d+)–0/);
    expect(total).not.toBeNull();
    expect(passFacts(ahead, "Kazehiko").line).toStartWith(
      "Kazehiko has no cards left.",
    );
    expect(needLine(ahead, "Kazehiko")).toBeNull();
    // A leader charge can still add power, so the need line stays.
    ahead.seats[1].leaderUsed = false;
    ahead.seats[1].leader = ahead.seats[1].leader ?? "leader-card";
    expect(needLine(ahead, "Kazehiko")?.short).toMatch(/^They need \d+$/);
    expect(passFacts(ahead, "Kazehiko").line).toContain("holds only a leader ability");
  });

  it("writes log lines without hidden information", () => {
    const start = lessonStart();
    const before = viewFor(start, 0);
    const { events } = firstPlay(start);
    const lines = events
      .map((event) => describeEvent(event, before, names))
      .filter((line): line is string => line !== null);
    expect(lines[0]).toMatch(/^You play .+ to Taijutsu \(\d+\)\.$/);
    expect(lines.some((line) => line.startsWith("Lemu plays "))).toBe(true);
    expect(
      describeEvent(
        { t: "drawn", seat: 1, cards: ["?", "?"], banked: 0 },
        before,
        names,
      ),
    ).toBe("Lemu draws 2 cards.");
    expect(
      describeEvent({ t: "drawn", seat: 0, cards: [], banked: 1 }, before, names),
    ).toBe("Your hand is full, so you may replace 1 extra card next round.");
  });

  it("logs a tactic the event itself reveals", () => {
    const start = lessonStart();
    const before = viewFor(start, 0);
    const played: KessenEvent = {
      t: "played",
      seat: 1,
      id: "s1-9",
      cardId: "kessen-hidden-tactic",
    };
    // Unknown to the board shown before it, the card's kind comes from the catalog.
    expect(describeEvent(played, before, names)).toBeNull();
    expect(
      describeEvent(played, before, {
        ...names,
        kind: (cardId) => (cardId === "kessen-hidden-tactic" ? "TACTIC" : undefined),
      }),
    ).toMatch(/^Lemu plays /);
    // Or from the board it leads to.
    const after = structuredClone(before);
    after.cards["kessen-hidden-tactic"] = {
      ...(Object.values(before.cards)[0] as MatchView["cards"][string]),
      id: "kessen-hidden-tactic",
      kind: "TACTIC",
    };
    expect(describeEvent(played, before, names, after)).toMatch(/^Lemu plays /);
  });

  it("names the house rule where it acts", () => {
    const rule = {
      name: "High Noon",
      text: "In Round 3, every unit placed from hand gets +1 power.",
    };
    const rules = { r3PlacementBonus: 1 };
    expect(houseRuleRoundNote(rule, rules, 2)).toBeNull();
    expect(houseRuleRoundNote(rule, rules, 3)).toBe(
      "High Noon: every unit placed from hand gets +1 this round.",
    );
    expect(houseRuleRoundNote(null, rules, 3)).toBeNull();
    expect(
      houseRuleRoundNote(
        { name: "Fog Bank", text: "" },
        { startTerrain: [{ row: "JUTSU", rounds: [1] }] },
        1,
      ),
    ).toBe("Fog Bank: both Ninjutsu rows start under Terrain.");
    expect(placementBonusNote(rule, rules, 3)).toBe("High Noon +1");
    expect(placementBonusNote(rule, rules, 2)).toBeNull();
    const ghost = ghostOf(
      { totals: { before: [3, 0], after: [9, 0] }, kills: [], hidden: [], units: [] },
      0,
      names,
      () => "",
    );
    expect(withGhostNote(ghost, "High Noon +1")).toMatchObject({
      main: "+6",
      detail: "High Noon +1",
    });
  });

  it("says why a unit has no row", () => {
    expect(noRowText([{ row: "CLOSE", reason: "Row full" }], true)).toBe(
      "No row has room: your Taijutsu row is full.",
    );
    expect(
      noRowText(
        [
          { row: "CLOSE", reason: "Row full" },
          { row: "RANGED", reason: "Row full" },
        ],
        false,
      ),
    ).toBe("No row has room: their rows are full.");
  });
});

describe("Lemu's coach marks", () => {
  it("rings the advised hand card, then its row, from the table's draft", () => {
    const view = viewFor(lessonStart(), 0);
    const pick = academyCoach("first-blood", view, {
      myTurn: true,
      card: null,
      action: null,
    });
    expect(pick).toMatchObject({ target: "hand-card", tone: "guide", retry: false });
    const card = pick?.key as string;
    const row = academyCoach("first-blood", view, { myTurn: true, card, action: null });
    expect(row).toMatchObject({ target: "row" });
    expect(row?.key?.startsWith("me-")).toBe(true);
    expect(
      academyCoach("first-blood", view, { myTurn: false, card, action: null }),
    ).toBe(null);
  });

  it("names each target by its data-lesson attributes", () => {
    expect(lessonTargetSelector({ target: "pass" })).toBe(
      '[data-lesson-target="pass"]',
    );
    expect(
      lessonTargetSelector({ target: "row", key: academyRowKey("them", "CLOSE") }),
    ).toBe('[data-lesson-target="row"][data-lesson-key="them-CLOSE"]');
    expect(lessonTargetSelector({ target: "unit", key: "s1-2" })).toBe(
      '[data-lesson-target="unit"][data-lesson-key="s1-2"]',
    );
  });

  it("marks the board units and hand cards Lemu's words name, whole names only", () => {
    const view = viewFor(lessonStart(), 0);
    const unitId = Object.values(view.board[1]).flat()[0]?.id as string;
    const unitName = names.card(view.inst[unitId] as string);
    const handId = view.seats[0].hand?.[0] as string;
    const handName = names.card(view.inst[handId] as string);
    const marks = lessonMarks(view, [
      `${unitName}'s power is high.`,
      `Play ${handName}.`,
    ]);
    expect(marks).toContainEqual({
      selector: lessonTargetSelector({ target: "unit", key: unitId }),
      label: unitName,
    });
    expect(marks).toContainEqual({
      selector: lessonTargetSelector({ target: "hand-card", key: handId }),
      label: handName,
    });
    expect(lessonMarks(view, [`${unitName}s are everywhere.`])).not.toContainEqual(
      expect.objectContaining({ label: unitName }),
    );
    expect(lessonMarks(view, [undefined, ""])).toEqual([]);
  });
});

describe("Kessen draft previews", () => {
  it("marks ghost numbers that leave out units summoned from the deck", () => {
    const ghost = ghostOf(
      {
        totals: { before: [3, 0], after: [6, 0] },
        kills: [],
        hidden: ["summon"],
        units: [],
      },
      0,
      names,
      () => "",
    );
    expect(ghost).toMatchObject({
      partial: true,
      main: "+3+?",
      totals: "6+? vs 0",
      totalsLine: "you 6 + ? vs 0",
      detail: "summons from the deck",
    });
  });

  it("shows a hidden gain alone, never as +0+?", () => {
    const ghost = ghostOf(
      {
        totals: { before: [11, 30], after: [11, 30] },
        kills: [],
        hidden: ["summon"],
        units: [],
      },
      0,
      names,
      () => "",
    );
    expect(ghost).toMatchObject({ main: "+?", totalsLine: "you 11 + ? vs 30" });
  });

  it("keeps an opponent-only change short enough for a tile", () => {
    const ghost = ghostOf(
      {
        totals: { before: [7, 17], after: [7, 23] },
        kills: [],
        hidden: [],
        units: [],
      },
      0,
      { ...names, opponent: "Kaze no Seirei" },
      () => "",
    );
    expect(ghost).toMatchObject({ them: true, main: "+6", totals: "7 vs 23" });
    expect(ghost.main).not.toContain("Kaze");
  });

  it("names an ability the play cannot use", () => {
    const ghost = ghostOf(
      {
        totals: { before: [3, 0], after: [8, 0] },
        kills: [],
        hidden: [],
        units: [],
        events: [
          { t: "fizzled", ability: "strike", source: "a" },
          { t: "fizzled", ability: "revive", source: "a" },
        ],
      },
      0,
      names,
      () => "",
    );
    expect(ghost.fizzles).toEqual(["Strike: no target", "Revive: discard empty"]);
    // The tile shows the first one on two short lines.
    expect(ghost.fizzleTile).toEqual(["Strike", "no target"]);
    expect(ghost.detail).toBe("Strike: no target · Revive: discard empty");
  });

  it("offers a chosen-row Terrain only on the sides it would afflict", () => {
    const view = (casterFaction: string) =>
      ({
        round: 1,
        seats: [{ faction: casterFaction }, { faction: "AKASUMI" }],
        knobs: { permafrost: true, permafrostR3: true },
        terrain: [
          { CLOSE: false, RANGED: false, JUTSU: false },
          { CLOSE: false, RANGED: false, JUTSU: true },
        ],
      }) as unknown as MatchView;
    const request: TargetRequest = {
      kind: "anyRow",
      options: ["CLOSE", "RANGED", "JUTSU"],
      optional: false,
      ability: "terrain",
      source: "leader",
    };
    // Permafrost keeps a Hyorin caster's own rows clear.
    const hyorin = view("HYORIN");
    expect(rowRequestAccepts(request, hyorin, 0, 0, "CLOSE")).toBe(false);
    expect(rowRequestAccepts(request, hyorin, 0, 1, "CLOSE")).toBe(true);
    expect(rowRequestAccepts(request, hyorin, 0, 1, "JUTSU")).toBe(false);
    const other = view("AKIKAZE");
    expect(rowRequestAccepts(request, other, 0, 0, "CLOSE")).toBe(true);
    expect(rowRequestAccepts(request, other, 0, 1, "CLOSE")).toBe(true);
  });

  it("names a row an automatic Terrain falls on, with its total after the play", () => {
    const unit = (id: string, stored: number) => ({
      id,
      med: 0,
      res: false,
      seq: 0,
      owner: 1,
      sealed: false,
      stored,
    });
    const view = {
      board: [
        { CLOSE: [], RANGED: [], JUTSU: [] },
        { CLOSE: [unit("a", 6), unit("b", 10)], RANGED: [unit("c", 4)], JUTSU: [] },
      ],
    } as unknown as MatchView;
    const powers = new Map([
      ["a", 6],
      ["b", 10],
      ["c", 4],
    ]);
    const effects = rowEffectsOf(view, powers, {
      units: [
        { id: "a", cardId: "x", side: 1, row: "CLOSE", before: 6, after: 4 },
        { id: "b", cardId: "x", side: 1, row: "CLOSE", before: 10, after: 8 },
        { id: "c", cardId: "x", side: 1, row: "RANGED", before: 4, after: 4 },
        { id: "n", cardId: "y", side: 0, row: "JUTSU", before: null, after: 8 },
      ],
      events: [{ t: "terrain", side: 1, row: "CLOSE", on: true, source: "n" }],
    });
    expect(effects.get("1:CLOSE")).toEqual({
      side: 1,
      row: "CLOSE",
      after: 12,
      label: "Terrain · −4",
    });
    // An unchanged row has no entry; the placed unit's own row is reported as a gain.
    expect(effects.has("1:RANGED")).toBe(false);
    expect(effects.get("0:JUTSU")?.label).toBe("+8");
    expect(rowEffectLabel(true, 0)).toBe("Terrain");
    expect(rowEffectLabel(false, 3)).toBe("Terrain lifted · +3");
  });
});
