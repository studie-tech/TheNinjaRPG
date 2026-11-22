import { afterEach, beforeEach, describe, expect, it, mock, vi } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { getDefaultStore, useAtomValue } from "jotai";
import * as mediaQuery from "@/hooks/useMediaQuery";
import { RoundEndOverlay } from "@/layout/kessen/match/MatchOverlays";
import { KessenMatchView } from "@/layout/kessen/match/MatchView";
import {
  type KessenTableOutcome,
  type MatchTable,
  useMatchTable,
} from "@/layout/kessen/match/useMatchTable";
import { guidedLessonAtom } from "@/layout/tutorial/guidedLesson";
import { academyLessonState, academyNpcAction } from "@/libs/kessen/academy";
import {
  actingSeats,
  applyAction,
  createMatch,
  redactEvents,
  viewFor,
} from "@/libs/kessen/engine";
import { KESSEN_PACK_IDS } from "@/libs/kessen/packs";
import type {
  CreateMatchInput,
  KessenAction,
  KessenEvent,
  MatchState,
  MatchView,
} from "@/libs/kessen/types";
import type {
  KessenCatalogEntry,
  KessenMatchLog,
  KessenMatchPayload,
  KessenPvpMatchPayload,
  KessenPvpPlayer,
} from "@/validators/kessen";
import { KESSEN_SEED_CATALOG } from "../../../libs/kessen/fixtures/catalog";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../../setup/browserGlobals";

const catalog = KESSEN_SEED_CATALOG as unknown as KessenCatalogEntry[];

/**
 * A practice match against Lemu with fixed vanilla decks and the opener's free Shadow
 * Clone in Bukijutsu, so every table test starts from the same board.
 */
const practiceInput = (): CreateMatchInput => ({
  seed: "table:practice",
  seats: [
    { leaderId: null, deck: PRACTICE_DECKS.human.map(cardId), shuffle: false },
    { leaderId: null, deck: PRACTICE_DECKS.lemu.map(cardId), shuffle: false },
  ],
  rules: {
    r1MulliganCap: 0,
    gambitRow: "RANGED",
    knobs: { laterMulligans: 0, maxBanked: 0, gambitPower: 3 },
  },
  cards: KESSEN_SEED_CATALOG,
});

/** Lemu's practice reply: its first card into Taijutsu, or a pass once the player passed. */
const practiceReply = (view: MatchView): KessenAction => {
  if (view.phase === "mulligan") return { t: "mull", cards: [] };
  const opponent = view.me === 0 ? 1 : 0;
  const card = view.seats[view.me].hand?.[0];
  if (view.seats[opponent].passed || !card) return { t: "pass" };
  return view.board[view.me].CLOSE.length < view.knobs.rowCap
    ? { t: "play", card, row: "CLOSE" }
    : { t: "pass" };
};

const PRACTICE_DECKS = {
  human: [
    "musashi-ken-swordsman",
    "kajioka",
    "enrai-no-oni",
    "colossus",
    "mei-back-alley-enforcer",
    "cryverin",
    "musashi-ken-swordsman",
    "enrai-no-oni",
    "cryverin",
    "mei-back-alley-enforcer",
    "kajioka",
    "arashima-stormcaller",
    "kajioka",
  ],
  lemu: [
    "arashima-stormcaller",
    "cryverin",
    "colossus",
    "musashi-ken-swordsman",
    "kajioka",
    "arashima-stormcaller",
    "enrai-no-oni",
    "arashima-stormcaller",
    "kajioka",
    "arashima-stormcaller",
    "kajioka",
    "arashima-stormcaller",
    "arashima-stormcaller",
  ],
};

const cardId = (slug: string) => `kessen-${slug}`;

const practiceMatch = () => createMatch(practiceInput());

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

const payloadOf = (state: MatchState, version = 1): KessenMatchPayload => ({
  id: "match-1",
  version,
  status: state.phase === "over" ? "FINISHED" : "ACTIVE",
  npcKey: "lemu",
  mode: "standard",
  lesson: null,
  tier: "GENIN",
  startedAt: new Date(0),
  view: viewFor(state, 0),
  borrowed: [],
  result: null,
});

/** A local stand-in for `kessen.playTurn`: the human action, then Lemu's reply. */
const localServer = (
  initial: MatchState,
  reply: (view: MatchView) => KessenAction = practiceReply,
  payload: (state: MatchState, version: number) => KessenMatchPayload = payloadOf,
) => {
  let state = initial;
  let version = 1;
  const onAction = mock(async (action: KessenAction): Promise<KessenTableOutcome> => {
    const human = applyAction(state, 0, action);
    if (!human.ok) return { ok: false, message: human.reason };
    let engine = human.state;
    const events: KessenEvent[] = [...human.events];
    while (actingSeats(engine).includes(1)) {
      const answer = applyAction(engine, 1, reply(viewFor(engine, 1)));
      if (!answer.ok) break;
      engine = answer.state;
      events.push(...answer.events);
    }
    state = engine;
    version += 1;
    return {
      ok: true,
      payload: payload(state, version),
      events: redactEvents(events, 0),
    };
  });
  return { onAction };
};

const renderTable = (state: MatchState, onAction = localServer(state).onAction) =>
  render(
    <KessenMatchView
      payload={payloadOf(state)}
      catalog={catalog}
      onAction={onAction}
      onConcede={() => undefined}
      onClose={() => undefined}
    />,
  );

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true, scrollIntoView: true });
  vi.spyOn(mediaQuery, "useMediaQuery").mockImplementation(() => false);
});

afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

describe("Academy lesson table", () => {
  // The opening words are read once per lesson match in a tab.
  beforeEach(() => globalThis.sessionStorage?.clear());
  afterEach(() => getDefaultStore().set(guidedLessonAtom, null));
  const lessonPayload = (state: MatchState, version = 1): KessenMatchPayload => ({
    ...payloadOf(state, version),
    mode: "lesson",
    lesson: "first-blood",
  });
  /** The step the table registers with the tutorial assistant, with its answers. */
  const guided = () => getDefaultStore().get(guidedLessonAtom)?.step;
  const GuidedAnswers = () => <>{useAtomValue(guidedLessonAtom)?.step.footer}</>;
  const renderLesson = (onAction?: ReturnType<typeof localServer>["onAction"]) => {
    const state = lessonStart();
    const server =
      onAction ??
      localServer(state, (view) => academyNpcAction("first-blood", view), lessonPayload)
        .onAction;
    const onStartLesson = mock(() => undefined);
    render(
      <>
        <KessenMatchView
          payload={lessonPayload(state)}
          catalog={catalog}
          onAction={server}
          onConcede={() => undefined}
          onClose={() => undefined}
          onStartLesson={onStartLesson}
        />
        <GuidedAnswers />
      </>,
    );
    return { onAction: server, onStartLesson };
  };

  it("opens with Lemu's words, then coaches the advised card and its row", () => {
    renderLesson();
    expect(guided()?.title).toBe("First Blood");
    expect(guided()?.eyebrow).toBe("Lesson 1 of 6 · First Blood");
    expect(guided()?.blocking).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Begin" }));
    expect(guided()?.blocking).toBeUndefined();
    expect(guided()?.action).toMatch(/Tap Kajioka/);
    const kajioka = document.querySelector<HTMLButtonElement>(
      '.km-hand-card[data-lesson-card="kessen-kajioka"]',
    );
    // The assistant's spotlight rings the advised card.
    expect(
      document.querySelector(guided()?.target ?? "")?.closest(".km-hand-card"),
    ).toBe(kajioka);
    fireEvent.click(kajioka as HTMLButtonElement);
    expect(guided()?.action).toMatch(/Tap your Bukijutsu row/);
  });

  it("asks before a pass Lemu advises against", async () => {
    const onAction = mock(async (): Promise<KessenTableOutcome> => ({ ok: true }));
    renderLesson(onAction);
    fireEvent.click(screen.getByRole("button", { name: "Begin" }));
    const pass = document.querySelector<HTMLButtonElement>(".km-btn-pass");
    fireEvent.click(pass as HTMLButtonElement);
    expect(guided()?.title).toBe("Pass now?");
    expect(guided()?.blocking).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Keep playing" }));
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(pass as HTMLButtonElement);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pass anyway" }));
    });
    expect(onAction).toHaveBeenCalledWith({ t: "pass" });
  });
});

describe("KessenMatchView", () => {
  it("drafts a play locally and sends it once confirmed", async () => {
    const state = practiceMatch();
    const { onAction } = localServer(state);
    renderTable(state, onAction);
    expect(document.querySelectorAll('[data-lesson-target="hand"]').length).toBe(1);
    expect(document.querySelectorAll('[data-lesson-target="hand-card"]').length).toBe(
      state.seats[0].hand.length,
    );

    const hand = document.querySelectorAll<HTMLButtonElement>(".km-hand-card");
    expect(hand.length).toBe(state.seats[0].hand.length);
    fireEvent.click(hand[0] as HTMLButtonElement);
    const legal = document.querySelector('.km-row[data-state="legal"] .km-row-hit');
    expect(legal).toBeTruthy();
    // Rows carry their lesson targets, keyed by side and row.
    const lit = document.querySelector('.km-row[data-side="me"][data-state="legal"]');
    expect(lit?.getAttribute("data-lesson-key")).toBe(
      `me-${lit?.getAttribute("data-row")}`,
    );
    // Every row the card cannot go to dims; the placing side names the reason.
    const closed = document.querySelectorAll('.km-row[data-state="illegal"]');
    expect(closed.length).toBeGreaterThan(0);
    expect(
      document.querySelector('.km-row[data-side="me"] .km-row-reason'),
    ).toBeTruthy();
    expect(document.querySelector(".km-ghost-slot")?.textContent).toMatch(/^\+\d+/);
    expect(onAction).not.toHaveBeenCalled();

    fireEvent.click(legal as Element);
    const confirm = document.querySelector<HTMLButtonElement>(".km-row-confirm");
    expect(confirm).toBeTruthy();
    expect(onAction).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(confirm as HTMLButtonElement);
    });
    expect(onAction).toHaveBeenCalledTimes(1);
    const sent = onAction.mock.calls[0]?.[0] as KessenAction;
    if (sent.t !== "play") throw new Error("expected a play");
    expect(state.seats[0].hand).toContain(sent.card);
    expect(sent.row).toBeDefined();

    // The confirmed events play back; Skip jumps to the confirmed board.
    const skip = screen.getByRole("button", { name: "Skip" });
    await act(async () => {
      fireEvent.click(skip);
    });
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
  });

  it("plays the card when a unit in the chosen row is tapped, instead of inspecting it", async () => {
    const state = practiceMatch();
    const { onAction } = localServer(state);
    renderTable(state, onAction);
    // Pick a hand unit whose row already holds a unit (the opening Shadow Clone).
    const cards = [...document.querySelectorAll<HTMLButtonElement>(".km-hand-card")];
    let unitInRow: HTMLButtonElement | null = null;
    for (const card of cards) {
      fireEvent.click(card);
      unitInRow = document.querySelector<HTMLButtonElement>(
        '.km-row[data-state="legal"] .km-unit',
      );
      if (unitInRow) break;
      fireEvent.click(card);
    }
    if (!unitInRow) throw new Error("expected a legal row holding a unit");
    // The first tap on the tile chooses its row, the second plays there.
    fireEvent.click(unitInRow);
    expect(document.querySelector('.km-row[data-state="chosen"]')).toBeTruthy();
    expect(document.querySelector(".km-sheet")).toBeNull();
    const again = document.querySelector<HTMLButtonElement>(
      '.km-row[data-state="chosen"] .km-unit',
    );
    await act(async () => {
      fireEvent.click(again as HTMLButtonElement);
    });
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".km-sheet")).toBeNull();
  });

  it("closes the table sheet once a play is confirmed", async () => {
    const state = practiceMatch();
    const { onAction } = localServer(state);
    renderTable(state, onAction);
    fireEvent.click(
      screen.getByRole("button", { name: "Play log, discards and options" }),
    );
    expect(document.querySelector(".km-sheet")).toBeTruthy();
    fireEvent.click(document.querySelector(".km-hand-card") as Element);
    fireEvent.click(
      document.querySelector('.km-row[data-state="legal"] .km-row-hit') as Element,
    );
    await act(async () => {
      fireEvent.click(document.querySelector(".km-row-confirm") as Element);
    });
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".km-sheet")).toBeNull();
  });

  it("steps back on Escape but never leaves the table from the top level", () => {
    const state = practiceMatch();
    const onClose = mock(() => undefined);
    render(
      <KessenMatchView
        payload={payloadOf(state)}
        catalog={catalog}
        onAction={localServer(state).onAction}
        onConcede={() => undefined}
        onClose={onClose}
      />,
    );
    const card = document.querySelector(".km-hand-card") as HTMLElement;
    card.focus();
    fireEvent.click(card);
    expect(document.querySelector('.km-row[data-state="legal"]')).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(document.querySelector('.km-row[data-state="legal"]')).toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector(".kessen-match")).toBeTruthy();
  });

  it("sits in the page as a region, its content box's way back focused", () => {
    const state = practiceMatch();
    render(
      <div data-content-box="">
        <button type="button" data-content-box-back="">
          Card Hall
        </button>
        <KessenMatchView
          payload={payloadOf(state)}
          catalog={catalog}
          onAction={localServer(state).onAction}
          onConcede={() => undefined}
          onClose={() => undefined}
        />
      </div>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    const table = screen.getByRole("region", { name: /^Kessen against .+, round 1$/ });
    expect(
      table.querySelector("button[aria-label^='Back to the Card Hall']"),
    ).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Card Hall" }),
    );
  });

  it("opens a card over the sheet it was read from and closes it first on Escape", () => {
    const state = practiceMatch();
    renderTable(state);
    fireEvent.click(screen.getByRole("button", { name: "Show the whole hand" }));
    const grid = document.querySelector(".km-sheet .km-hand-card") as Element;
    fireEvent.contextMenu(grid);
    expect(document.querySelector(".km-sheet-inspect .km-inspect-face")).toBeTruthy();
    fireEvent.keyDown(document.querySelector(".km-sheet-inspect") as Element, {
      key: "Escape",
    });
    expect(document.querySelector(".km-sheet-inspect")).toBeNull();
    expect(screen.getByRole("heading", { name: "Your hand" })).toBeTruthy();
  });

  it("names an Ascended house rule on the opponent's bar and atop the rules", () => {
    const state = practiceMatch();
    render(
      <KessenMatchView
        payload={{ ...payloadOf(state), npcKey: "hisame", mode: "ascended" }}
        catalog={catalog}
        onAction={localServer(state).onAction}
        onConcede={() => undefined}
        onClose={() => undefined}
      />,
    );
    const chip = document.querySelector<HTMLButtonElement>(".km-house-chip");
    expect(chip?.textContent).toBe("High Noon");
    fireEvent.click(chip as HTMLButtonElement);
    expect(document.querySelector(".km-sheet .km-house-line")?.textContent).toMatch(
      /^House rule · High Noon In Round 3/,
    );
  });

  it("keeps the house rule readable once the opponent passes, stamping their total", () => {
    const state = practiceMatch();
    const passed = structuredClone(state);
    passed.seats[1].passed = true;
    passed.phase = "play";
    passed.turn = 0;
    render(
      <KessenMatchView
        payload={{ ...payloadOf(passed), npcKey: "junko", mode: "ascended" }}
        catalog={catalog}
        onAction={localServer(passed).onAction}
        onConcede={() => undefined}
        onClose={() => undefined}
      />,
    );
    const bar = document.querySelector(".km-bar-them");
    // The chip keeps the name column to itself; the stamp hangs from the total.
    expect(bar?.querySelector(".km-bar-name .km-passed")).toBeNull();
    expect(bar?.querySelector(".km-house-chip")?.textContent).toBe("Blood Moon");
    const total = bar?.querySelector(".km-side-total");
    expect(total?.querySelector(".km-passed")?.textContent).toBe("Passed");
    expect(total?.getAttribute("aria-label")).toMatch(/total \d+, passed$/);
    expect(document.querySelector(".km-bar-me .km-passed")).toBeNull();
  });

  it("drops a card from the inspector once it leaves the hand and the board", () => {
    const state = practiceMatch();
    const view = (payload: KessenMatchPayload) => (
      <KessenMatchView
        payload={payload}
        catalog={catalog}
        onAction={localServer(state).onAction}
        onConcede={() => undefined}
        onClose={() => undefined}
      />
    );
    const { rerender } = render(view(payloadOf(state)));
    const panel = () => document.querySelector(".km-sheet-inspect .km-inspect");
    const card = document.querySelector(".km-hand-card") as HTMLButtonElement;
    // A right-click opens the card at reading size.
    fireEvent.contextMenu(card);
    expect(panel()?.querySelector(".km-inspect-face")).toBeTruthy();

    // The hand goes to the discard: the panel falls back to the leaders.
    const discarded = structuredClone(state);
    discarded.seats[0].discard.push(...discarded.seats[0].hand);
    discarded.seats[0].hand = [];
    rerender(view(payloadOf(discarded, 2)));
    expect(panel()?.querySelector(".km-inspect-face")).toBeNull();
    expect(panel()?.textContent).toContain("Long-press or right-click a card");

    // Read from the discard (opened from the deck count), it stays while it remains there.
    fireEvent.click(screen.getAllByRole("button", { name: /Open discards$/ })[0]!);
    expect(panel()).toBeNull();
    const pile = document.querySelector<HTMLButtonElement>(
      `.km-discards button[aria-label^="Inspect"]`,
    );
    fireEvent.click(pile as HTMLButtonElement);
    expect(panel()?.querySelector(".km-inspect-face")).toBeTruthy();
  });

  it("shows a rejected play's message next to the action and frees the hand to retry", async () => {
    const state = practiceMatch();
    const onAction = mock(async () => ({ ok: false, message: "Not your turn" }));
    renderTable(state, onAction);
    const draftPlay = async () => {
      fireEvent.click(document.querySelector(".km-hand-card") as Element);
      fireEvent.click(
        document.querySelector('.km-row[data-state="legal"] .km-row-hit') as Element,
      );
      await act(async () => {
        fireEvent.click(document.querySelector(".km-row-confirm") as Element);
      });
    };
    await draftPlay();
    expect(screen.getByRole("alert").textContent).toBe("Not your turn");
    // Nothing stays pending or half-drafted: the same play can be drafted and sent again.
    expect(screen.queryByText("Sending your play…")).toBeNull();
    expect(document.querySelector('.km-row[data-state="chosen"]')).toBeNull();
    await draftPlay();
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it("recovers from a thrown request and drops a draft made on an older board", async () => {
    const state = practiceMatch();
    const onAction = mock(async (): Promise<KessenTableOutcome> => {
      throw new Error("network");
    });
    const view = render(
      <KessenMatchView
        payload={payloadOf(state)}
        catalog={catalog}
        onAction={onAction}
        onConcede={() => undefined}
        onClose={() => undefined}
      />,
    );
    fireEvent.click(document.querySelector(".km-hand-card") as Element);
    fireEvent.click(
      document.querySelector('.km-row[data-state="legal"] .km-row-hit') as Element,
    );
    await act(async () => {
      fireEvent.click(document.querySelector(".km-row-confirm") as Element);
    });
    expect(screen.getByRole("alert").textContent).toMatch(/Try again/);
    expect(screen.queryByText("Sending your play…")).toBeNull();
    // A new draft, then a refetched board (the unknown outcome) replaces it.
    fireEvent.click(document.querySelector(".km-hand-card") as Element);
    expect(document.querySelector('.km-row[data-state="legal"]')).toBeTruthy();
    view.rerender(
      <KessenMatchView
        payload={payloadOf(state, 2)}
        catalog={catalog}
        onAction={onAction}
        onConcede={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(document.querySelector('.km-row[data-state="legal"]')).toBeNull();
  });

  it("reads a mulligan card on hover without marking it, and marks it on tap", async () => {
    const state = practiceMatch();
    const mulligan = structuredClone(state);
    mulligan.phase = "mulligan";
    mulligan.seats[0].mull = 2;
    const onAction = mock(async () => ({ ok: true }));
    render(
      <KessenMatchView
        payload={{ ...payloadOf(mulligan), mode: "standard" }}
        catalog={catalog}
        onAction={onAction}
        onConcede={() => undefined}
        onClose={() => undefined}
      />,
    );
    const cards = document.querySelectorAll<HTMLButtonElement>(".km-mull-card");
    expect(cards.length).toBeGreaterThan(1);
    const second = cards[1] as HTMLButtonElement;
    fireEvent.pointerEnter(second, { pointerType: "mouse" });
    expect(second.getAttribute("aria-pressed")).toBe("false");
    const name = second.parentElement?.querySelector(".km-card-name")?.textContent;
    expect(name).toBeTruthy();
    expect(document.querySelector(".km-mull-detail .km-prompt-name")?.textContent).toBe(
      name,
    );
    fireEvent.click(second);
    expect(second.getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Replace 1" }));
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("names a rewarded pack on the end screen", () => {
    const state = practiceMatch();
    render(
      <KessenMatchView
        payload={{
          ...payloadOf(state),
          mode: "standard",
          status: "FINISHED",
          result: {
            winner: 0,
            rewarded: true,
            reason: null,
            ryo: 100,
            drops: [],
            firstWin: { itemIds: [KESSEN_PACK_IDS.paper], choice: null },
            weeklyFirstWinPack: false,
            lessonCompleted: false,
            academy: null,
          },
        }}
        catalog={catalog}
        onAction={localServer(state).onAction}
        onConcede={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(document.querySelector(".km-reward-pack figcaption")?.textContent).toBe(
      "Paper BundleFirst win",
    );
  });

  it("asks for a selection and a Claim before claiming a first-win pick", async () => {
    const state = practiceMatch();
    const options = catalog
      .filter((card) => card.kind === "UNIT" && card.rarity === "EPIC")
      .slice(0, 2)
      .map((card) => card.id);
    const onClaimChoice = mock(async () => ({ ok: true }));
    render(
      <KessenMatchView
        payload={{
          ...payloadOf(state),
          mode: "ascended",
          status: "FINISHED",
          result: {
            winner: 0,
            rewarded: false,
            reason: "Daily reward limit reached; this match was practice.",
            ryo: 0,
            drops: [],
            firstWin: {
              itemIds: [],
              choice: { kind: "items", options, claimed: null },
            },
            weeklyFirstWinPack: false,
            lessonCompleted: false,
            academy: null,
          },
        }}
        catalog={catalog}
        onAction={localServer(state).onAction}
        onConcede={() => undefined}
        onClose={() => undefined}
        onRematch={() => undefined}
        onClaimChoice={onClaimChoice}
      />,
    );
    const take = document.querySelector<HTMLButtonElement>(".km-choice-take");
    expect(take?.disabled).toBe(true);
    const cards = document.querySelectorAll<HTMLButtonElement>(".km-choice-card");
    expect(cards.length).toBe(2);
    // Hover only reads the card.
    fireEvent.pointerEnter(cards[0] as HTMLButtonElement, { pointerType: "mouse" });
    expect(cards[0]?.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(cards[1] as HTMLButtonElement);
    expect(onClaimChoice).not.toHaveBeenCalled();
    expect(cards[1]?.getAttribute("aria-pressed")).toBe("true");
    const name = catalog.find((card) => card.id === options[1])?.name;
    expect(take?.textContent).toBe(`Claim ${name}`);
    // While the pick waits, Claim leads: no end-screen action is the primary.
    expect(document.querySelectorAll(".km-match-end [data-primary]").length).toBe(0);
    await act(async () => {
      fireEvent.click(take as HTMLButtonElement);
    });
    expect(onClaimChoice).toHaveBeenCalledWith(options[1]);
    // The first-win reward is paid, so the daily cap line does not call it practice.
    expect(document.querySelector(".km-reward-note")?.textContent).not.toContain(
      "practice",
    );
    // No hand or Pass stays behind the result.
    expect(document.querySelector(".km-btn-pass")).toBeNull();
    expect(document.querySelector(".km-hand")).toBeNull();
  });

  it("sets the rewards beside the result and marks NEW only on a first copy", () => {
    const state = practiceMatch();
    const units = catalog.filter((card) => card.kind === "UNIT");
    const [surplus, drop] = units;
    const legendary = units.find((card) => card.rarity === "LEGENDARY");
    if (!surplus || !drop || !legendary) throw new Error("the catalog has units");
    const result = (claimed: string | null) => ({
      winner: 0 as const,
      rewarded: true,
      reason: null,
      ryo: 1500,
      drops: [
        {
          itemId: surplus.id,
          rarity: surplus.rarity,
          forbidden: false,
          surplus: true,
          soldFor: null,
        },
        {
          itemId: drop.id,
          rarity: drop.rarity,
          forbidden: false,
          surplus: false,
          soldFor: null,
        },
      ],
      firstWin: {
        itemIds: [],
        choice: { kind: "unownedLegendary" as const, options: [legendary.id], claimed },
      },
      weeklyFirstWinPack: true,
      lessonCompleted: false,
      academy: null,
    });
    const view = (claimed: string | null) => (
      <KessenMatchView
        payload={{
          ...payloadOf(state),
          mode: "ascended",
          status: "FINISHED",
          result: result(claimed),
        }}
        catalog={catalog}
        onAction={localServer(state).onAction}
        onConcede={() => undefined}
        onClose={() => undefined}
        onRematch={() => undefined}
        onClaimChoice={async () => ({ ok: true })}
      />
    );
    const { rerender } = render(view(null));
    const end = document.querySelector(".km-match-end");
    expect(end?.hasAttribute("data-split")).toBe(true);
    expect(end?.hasAttribute("data-pick")).toBe(true);
    // Ryo and the daily bundle share one line group above the cards.
    expect(document.querySelectorAll(".km-reward-lines .km-reward-line").length).toBe(
      2,
    );
    // A drop may be a further copy, so neither drop carries the ribbon.
    expect(document.querySelectorAll(".km-reward-cards .kc-new").length).toBe(0);
    rerender(view(legendary.id));
    expect(end?.hasAttribute("data-pick")).toBe(false);
    const ribbons = [...document.querySelectorAll(".km-reward-card")].map(
      (figure) => figure.querySelector(".kc-new") !== null,
    );
    expect(ribbons).toEqual([false, false, true]);
  });

  it("keeps an unrewarded result in one centred column", () => {
    const state = practiceMatch();
    render(
      <KessenMatchView
        payload={{
          ...payloadOf(state),
          mode: "standard",
          status: "CONCEDED",
          result: {
            winner: 1,
            rewarded: false,
            reason: "Conceded matches pay no reward.",
            ryo: 0,
            drops: [],
            firstWin: null,
            weeklyFirstWinPack: false,
            lessonCompleted: false,
            academy: null,
          },
        }}
        catalog={catalog}
        onAction={localServer(state).onAction}
        onConcede={() => undefined}
        onClose={() => undefined}
        onRematch={() => undefined}
      />,
    );
    expect(document.querySelector(".km-match-end")?.hasAttribute("data-split")).toBe(
      false,
    );
    expect(document.querySelector(".km-reward-note")?.textContent).toBe(
      "Conceded matches pay no reward.",
    );
  });

  it("keeps the NPC's Circuit victory line off a won quest duel", () => {
    const state = practiceMatch();
    render(
      <KessenMatchView
        payload={{
          ...payloadOf(state),
          status: "FINISHED",
          challenge: { questId: "quest-1", objectiveId: "duel" },
          result: {
            winner: 0,
            rewarded: false,
            reason: null,
            ryo: 0,
            drops: [],
            firstWin: null,
            weeklyFirstWinPack: false,
            lessonCompleted: false,
            academy: null,
          },
        }}
        catalog={catalog}
        onAction={localServer(state).onAction}
        onConcede={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(document.querySelector(".km-match-end h2")?.textContent).toBe("You won");
    expect(document.querySelector(".km-end-bark")).toBeNull();
    expect(document.querySelector(".km-reward-note")?.textContent).toBe(
      "Quest duels pay nothing but the quest objective.",
    );
  });

  it("reads Terrain as Permafrost for a Hyorin player and labels the hand sizes", () => {
    const state = practiceMatch();
    state.seats[0].faction = "HYORIN";
    state.knobs = { ...state.knobs, permafrost: true, permafrostR3: true };
    state.phase = "play";
    render(
      <KessenMatchView
        payload={{ ...payloadOf(state), npcKey: "hisame", mode: "ascended" }}
        catalog={catalog}
        onAction={localServer(state).onAction}
        onConcede={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(document.querySelector(".km-edge-badge .km-edge-label")?.textContent).toBe(
      "Hand",
    );
    fireEvent.click(document.querySelector(".km-house-chip") as HTMLButtonElement);
    const terrain = [
      ...document.querySelectorAll(".km-sheet .km-glossary-list li"),
    ].find((item) => item.textContent?.startsWith("Terrain"));
    expect(terrain?.textContent).toContain("Permafrost: afflicts only the enemy's row");
    expect(terrain?.textContent).toContain("Hisame's Terrain afflicts both sides.");
  });

  it("says so when a mulligan tap goes past the limit", () => {
    const state = practiceMatch();
    const mulligan = structuredClone(state);
    mulligan.phase = "mulligan";
    mulligan.seats[0].mull = 1;
    render(
      <KessenMatchView
        payload={{ ...payloadOf(mulligan), mode: "standard" }}
        catalog={catalog}
        onAction={mock(async () => ({ ok: true }))}
        onConcede={() => undefined}
        onClose={() => undefined}
      />,
    );
    const cards = document.querySelectorAll<HTMLButtonElement>(".km-mull-card");
    fireEvent.click(cards[0] as HTMLButtonElement);
    expect(document.querySelector(".km-mull-limit")).toBeNull();
    fireEvent.click(cards[1] as HTMLButtonElement);
    expect(cards[1]?.getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector(".km-mull-detail .km-mull-limit")?.textContent).toBe(
      "Up to 1 card: unmark one first.",
    );
    fireEvent.click(cards[0] as HTMLButtonElement);
    expect(document.querySelector(".km-mull-limit")).toBeNull();
  });

  it("leads from the finished lesson to the faction choice", () => {
    const state = practiceMatch();
    const onClose = mock(() => undefined);
    render(
      <KessenMatchView
        payload={{
          ...payloadOf(state),
          mode: "lesson",
          lesson: "first-blood",
          status: "FINISHED",
          result: {
            winner: 0,
            rewarded: false,
            reason: "Lessons pay only their first-win reward.",
            ryo: 0,
            drops: [],
            firstWin: { itemIds: [], choice: { kind: "starterFaction" } },
            weeklyFirstWinPack: false,
            lessonCompleted: true,
            academy: { lesson: "first-blood", ryo: 250, graduationPackId: null },
          },
        }}
        catalog={catalog}
        onAction={localServer(state).onAction}
        onConcede={() => undefined}
        onClose={onClose}
      />,
    );
    const primary = screen.getByRole("button", { name: "Choose your faction" });
    expect(primary.hasAttribute("data-primary")).toBe(true);
    expect(screen.queryByRole("button", { name: "Leave table" })).toBeNull();
    expect(screen.queryByText("Lessons pay only their first-win reward.")).toBeNull();
    expect(screen.getAllByText(/starter faction waits/).length).toBe(1);
    // The table behind the result takes no focus.
    expect(document.querySelector(".km-stage")?.hasAttribute("inert")).toBe(true);
    fireEvent.click(primary);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("asks for a second tap only when passing loses the round after they passed", async () => {
    const state = practiceMatch();
    // Lemu plays its Round 1 script and passes once ahead of a passed player.
    const lemu = structuredClone(state);
    lemu.seats[1].passed = true;
    // Without the opener's Shadow Clone, so the player stands at 0.
    lemu.board[0].RANGED = [];
    lemu.board[1].CLOSE = [
      { id: "s1-0", owner: 1, stored: 9, sealed: false, med: 0, res: false, seq: 1 },
    ];
    lemu.seats[1].hand = lemu.seats[1].hand.filter((id) => id !== "s1-0");
    lemu.phase = "play";
    lemu.turn = 0;
    const onAction = mock(async () => ({ ok: true }));
    render(
      <KessenMatchView
        payload={{ ...payloadOf(lemu), mode: "standard" }}
        catalog={catalog}
        onAction={onAction}
        onConcede={() => undefined}
        onClose={() => undefined}
      />,
    );
    const pass = document.querySelector<HTMLButtonElement>(".km-btn-pass");
    expect(pass?.textContent).toBe(
      `End round, keep ${lemu.seats[0].hand.length} cards`,
    );
    fireEvent.click(pass as HTMLButtonElement);
    expect(onAction).not.toHaveBeenCalled();
    expect(pass?.hasAttribute("data-armed")).toBe(true);
    expect(document.querySelector(".km-prompt")?.textContent).toMatch(
      /^You lose this round 0–9\./,
    );
    await act(async () => {
      fireEvent.click(pass as HTMLButtonElement);
    });
    expect(onAction).toHaveBeenCalledWith({ t: "pass" });
  });

  it("reads the player's leader in the inspect sheet from its medallion", () => {
    const input = practiceInput();
    const state = createMatch({
      ...input,
      seats: [
        { ...input.seats[0], leaderId: "kessen-leader-hisame-dune-warden" },
        input.seats[1],
      ] as typeof input.seats,
    });
    renderTable(state);
    const card = document.querySelector(".km-hand-card") as HTMLButtonElement;
    fireEvent.click(card);
    fireEvent.click(card);
    expect(document.querySelector(".km-inspect-leader")).toBeNull();
    fireEvent.click(document.querySelector(".km-bar-me .km-bar-medallion") as Element);
    const panel = document.querySelectorAll(".km-sheet-inspect .km-inspect-leader");
    expect(panel.length).toBe(1);
    expect(panel[0]?.textContent).toContain("Your leader");
  });

  it("scores the deciding round's banner in rounds and keeps the points in the line", () => {
    const table = {
      roundEnd: {
        round: 3,
        mine: 0,
        theirs: 3,
        outcome: "lost",
        riggedOdds: false,
        spentMine: 0,
        spentTheirs: 1,
        kept: [],
        savedCards: false,
        line: "Round 3: you 0 – 3 Lemu",
      },
      step: {
        event: {
          t: "roundEnd",
          round: 3,
          totals: [0, 3],
          winner: 1,
          riggedOdds: false,
          lanterns: [0, 1],
        },
      },
      holding: true,
      decidingRound: true,
      me: 0,
      them: 1,
      opponentName: "Lemu",
      npc: null,
      confirmed: {
        view: {
          result: { winner: 1 },
          history: [
            { round: 1, totals: [10, 12], winner: 1, riggedOdds: false },
            { round: 2, totals: [14, 9], winner: 0, riggedOdds: false },
            { round: 3, totals: [0, 3], winner: 1, riggedOdds: false },
          ],
        },
      },
      continuePlayback: () => undefined,
    } as unknown as MatchTable;
    render(<RoundEndOverlay table={table} />);
    const banner = document.querySelector(".km-brush-banner");
    expect(banner?.querySelector("h2")?.textContent).toBe("Round 3 lostMatch lost");
    expect(banner?.querySelector(".km-brush-score")?.textContent).toBe(
      "1 –to 2 in rounds",
    );
    expect(document.querySelector(".km-summary-card")?.textContent).toContain("0 – 3");
  });
});

describe("Spectating a duel", () => {
  const player = (userId: string, username: string): KessenPvpPlayer => ({
    userId,
    username,
    avatar: null,
    level: 10,
    villageName: null,
    rating: null,
  });
  const watched = (
    state: MatchState,
    patch: Partial<KessenPvpMatchPayload> = {},
  ): KessenPvpMatchPayload => ({
    id: "duel-1",
    kind: "FRIENDLY",
    version: 4,
    status: "ACTIVE",
    startedAt: new Date(0),
    finishedAt: null,
    seat: 0,
    players: [player("a", "Aiko"), player("b", "Botan")],
    view: viewFor(state, null),
    clock: {
      deadline: new Date(Date.now() + 60_000),
      acting: actingSeats(state),
      serverNow: new Date(),
      turnSeconds: 60,
      mulliganSeconds: 30,
      timeouts: [0, 0],
      maxTimeouts: 3,
    },
    borrowed: [],
    result: null,
    ...patch,
  });
  const renderWatched = (payload: KessenPvpMatchPayload) => {
    const onAction = mock(
      async (): Promise<KessenTableOutcome> => ({ ok: false, message: "No." }),
    );
    const onConcede = mock(() => undefined);
    render(
      <KessenMatchView
        payload={payload}
        catalog={catalog}
        onAction={onAction}
        onConcede={onConcede}
        onClose={() => undefined}
        spectating
      />,
    );
    return { onAction, onConcede };
  };

  it("names both players and offers no play, hand or concession", () => {
    const state = practiceMatch();
    const { onAction } = renderWatched(watched(state));
    // Each hand's size sits in its player's bar; the board takes the hand strip's room.
    expect(document.querySelector(".km-hand-wrap")).toBeNull();
    expect(document.querySelector(".km-edge-badge")).toBeNull();
    expect(
      document.querySelector('.km-bar-me [title="Cards in hand"]')?.textContent,
    ).toBe(`Aiko holds${state.seats[0].hand.length} cards`);
    expect(
      document.querySelector('.km-bar-them [title="Cards in hand"]')?.textContent,
    ).toBe(`Botan holds${state.seats[1].hand.length} cards`);
    expect(document.querySelector(".km-bar-me .km-bar-title")?.textContent).toBe(
      "Aiko",
    );
    expect(document.querySelector(".km-prompt")?.textContent).toBe(
      `${state.turn === 0 ? "Aiko" : "Botan"} is choosing a play…`,
    );
    expect(screen.getByText("Spectating: both hands stay hidden.")).toBeTruthy();
    for (const name of ["Pass", "Show the whole hand", "Sort hand by power"])
      expect(screen.queryByRole("button", { name })).toBeNull();
    for (const row of document.querySelectorAll<HTMLElement>(".km-row-hit"))
      fireEvent.click(row);
    expect(onAction).not.toHaveBeenCalled();
    // The first seat's side is named for its player, never addressed as the viewer's.
    expect(screen.getByRole("button", { name: /^Aiko's deck / })).toBeTruthy();
    expect(screen.getByLabelText(/^Aiko's total \d/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /^Aiko's Taijutsu, total/ }),
    ).toBeTruthy();
    expect(document.body.innerHTML).not.toMatch(/\bYour\b/);

    fireEvent.click(
      screen.getByRole("button", { name: "Play log, discards and options" }),
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Discards" }));
    expect(screen.getByRole("region", { name: "Aiko's discard" })).toBeTruthy();
    expect(screen.getByText(/^Aiko's discard/)).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Options" }));
    expect(screen.queryByRole("button", { name: /Concede/ })).toBeNull();
  });

  it("names the winner and how the duel ended", () => {
    const state = practiceMatch();
    renderWatched(
      watched(state, {
        status: "CONCEDED",
        clock: { ...watched(state).clock, deadline: null, acting: [] },
        result: {
          winner: 1,
          outcome: "loss",
          endedBy: "concede",
          loserBy: 0,
          rating: null,
          reward: null,
          note: null,
          settling: false,
        },
      }),
    );
    const end = document.querySelector(".km-match-end");
    expect(end?.querySelector("h2")?.textContent).toBe("Botan won");
    expect(end?.textContent).toContain("Aiko conceded");
    expect(end?.textContent).toContain("Friendly duel between Aiko and Botan");
  });
});

describe("A newer version arriving during a playback", () => {
  type Version = { payload: KessenMatchPayload; log: KessenMatchLog };
  type Version3 = [Version, Version, Version];
  type Version4 = [...Version3, Version];
  /** The practice match's confirmed versions, each with the play log it arrives with. */
  const versions = async (...plays: ((view: MatchView) => KessenAction)[]) => {
    const state = practiceMatch();
    const { onAction } = localServer(state);
    const list: Version[] = [
      { payload: payloadOf(state), log: { version: 1, events: [], inst: {} } },
    ];
    for (const play of plays) {
      const previous = list[list.length - 1] as Version;
      const outcome = await onAction(play(previous.payload.view));
      const payload = outcome.payload as KessenMatchPayload;
      const events = [...previous.log.events, ...(outcome.events ?? [])];
      list.push({ payload, log: { version: payload.version, events, inst: {} } });
    }
    return list;
  };
  const firstCard = (view: MatchView): KessenAction => ({
    t: "play",
    card: view.seats[0].hand?.[0] as string,
    row: "CLOSE",
  });
  const pass = (): KessenAction => ({ t: "pass" });
  const renderTableState = (first: Version) =>
    renderHook(
      ({ payload, log }: Version) =>
        useMatchTable({
          payload,
          log,
          catalog,
          onAction: async () => ({ ok: false }),
          onConcede: () => undefined,
          motion: false,
        }),
      { initialProps: first },
    );

  it("waits for the playback, then plays its events from the board shown", async () => {
    const [v1, v2, v3] = (await versions(firstCard, firstCard)) as Version3;
    const table = renderTableState(v1);
    table.rerender(v2);
    const step = table.result.current.step;
    expect(step).not.toBeNull();
    table.rerender(v3);
    expect(table.result.current.step).toBe(step);
    act(() => table.result.current.skipPlayback());
    // Only the events the newer version added play back.
    expect(v3.log.events.slice(v2.log.events.length)).toContainEqual(
      table.result.current.step?.event as KessenEvent,
    );
    act(() => table.result.current.skipPlayback());
    expect(table.result.current.playing).toBe(false);
    expect(table.result.current.view).toEqual(v3.payload.view);
  });

  it("keeps a held round summary until Continue", async () => {
    const [, v2, v3, v4] = (await versions(firstCard, pass, firstCard)) as Version4;
    const table = renderTableState(v2);
    table.rerender(v3);
    await waitFor(() => expect(table.result.current.holding).toBe(true));
    const summary = table.result.current.step;
    table.rerender(v4);
    expect(table.result.current.holding).toBe(true);
    expect(table.result.current.step).toBe(summary);
    act(() => table.result.current.continuePlayback());
    await waitFor(() => expect(table.result.current.playing).toBe(false));
    expect(table.result.current.view).toEqual(v4.payload.view);
  });

  it("ends on the newest board when its log arrives late", async () => {
    const [v1, v2, v3] = (await versions(firstCard, firstCard)) as Version3;
    const table = renderTableState(v1);
    table.rerender(v2);
    table.rerender({ payload: v3.payload, log: v2.log });
    act(() => table.result.current.skipPlayback());
    table.rerender(v3);
    expect(table.result.current.playing).toBe(false);
    expect(table.result.current.view).toEqual(v3.payload.view);
  });
});
