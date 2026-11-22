"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { terrainSides } from "@/libs/kessen/abilities";
import { displayedPower, findUnit, other } from "@/libs/kessen/board";
import { previewPartial, rowOptionsForView } from "@/libs/kessen/engine";
import { kessenNpc, npcVariant } from "@/libs/kessen/npcs";
import { ROWS } from "@/libs/kessen/rules";
import { ROW_LABELS } from "@/libs/kessen/text";
import type {
  KessenAction,
  KessenEvent,
  MatchState,
  MatchView,
  PartialOption,
  Row,
  Seat,
  TargetRequest,
  UnitDelta,
} from "@/libs/kessen/types";
import { haptics } from "@/libs/native";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/utils/storage";
import type {
  KessenCatalogEntry,
  KessenMatchLog,
  KessenMatchPayload,
  KessenPvpMatchPayload,
} from "@/validators/kessen";
import type { KessenCardDisplay } from "../kessenArt";
import {
  describeEvent,
  type Ghost,
  ghostOf,
  type MatchNames,
  needLine,
  noRowText,
  optionOutcome,
  passFacts,
  placementBonusNote,
  playsForNoEffect,
  type RoundSummaryData,
  roundSummary,
  rowEffectLabel,
  withGhostNote,
} from "./matchText";
import { buildPlayback, type PlaybackStep, safeTotals } from "./playback";

/**
 * State of the match table: the confirmed payload, the play being drafted (card, row
 * and targets, previewed with the local engine), the event playback after each
 * confirmed turn, and the play log. Nothing is sent before a play is complete. At a
 * duel the opponent's turns arrive as newer payloads; with the play log in step, their
 * events play back like the player's own. A spectator (`spectating`) watches a duel from
 * seat 0's side: both seats are named and nothing can be drafted or sent.
 */
export const useMatchTable = ({
  payload,
  log: matchLog = null,
  catalog,
  onAction,
  onConcede,
  motion,
  spectating = false,
}: {
  payload: KessenTablePayload;
  /** The confirmed play log; at a duel it plays back the opponent's turns. */
  log?: KessenMatchLog | null;
  catalog: KessenMatchCatalog;
  onAction: (action: KessenAction) => Promise<KessenTableOutcome>;
  onConcede: () => Promise<KessenTableOutcome | undefined> | undefined;
  motion: boolean;
  spectating?: boolean;
}) => {
  const [local, setLocal] = useState<KessenTablePayload | null>(null);
  const confirmed =
    local && local.id === payload.id && local.version > payload.version
      ? local
      : payload;
  const duel = isDuelPayload(confirmed) ? confirmed : null;
  const npcMatch = isDuelPayload(confirmed) ? null : confirmed;
  // A draft belongs to the board version it was made on; a newer board (a refetch after
  // an unknown outcome, or another window's play) discards it, since its card may have moved.
  const [drafted, setDrafted] = useState({
    version: confirmed.version,
    draft: EMPTY_DRAFT,
  });
  const draft = drafted.version === confirmed.version ? drafted.draft : EMPTY_DRAFT;
  const setDraft = (next: Draft) =>
    setDrafted({ version: confirmed.version, draft: next });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [quickPlay, setQuickPlayState] = useState(false);
  const [sent, setSent] = useState<SentPlacement | null>(null);
  const playbackSerial = useRef(0);

  // Quick play is a per-device convenience, read after mount so markup hydrates equally.
  useEffect(() => setQuickPlayState(readQuickPlay()), []);

  const npc = npcMatch ? kessenNpc(npcMatch.npcKey) : null;
  const opponent = duel ? duel.players[other(duel.seat)] : null;
  const opponentName = opponent?.username ?? npc?.name ?? "Opponent";
  // The rule of the variant being played (an Ascended rematch or a boss), for the whole match.
  const houseRule =
    npc && npcMatch ? (npcVariant(npc, npcMatch.mode)?.houseRule ?? null) : null;
  const lesson = npcMatch?.mode === "lesson";
  const lookup = useMemo(() => catalogLookup(catalog), [catalog]);
  const cardDisplay = (cardId: string): KessenCardDisplay | null =>
    lookup.get(cardId) ?? confirmed.view.cards[cardId] ?? null;
  // The seat a spectator sees from, named where a seat reads "you".
  const self = spectating && duel ? duel.players[duel.seat].username : undefined;
  const names: MatchNames = {
    card: (cardId) => cardDisplay(cardId)?.name ?? "A card",
    opponent: opponentName,
    self,
    kind: (cardId) => cardDisplay(cardId)?.kind,
    houseRule,
  };

  const step = playback ? (playback.steps[playback.index] ?? null) : null;
  const view = step ? step.frame : confirmed.view;
  const me = view.me;
  const them = other(me);
  const playing = playback !== null;
  const over = confirmed.status !== "ACTIVE" || confirmed.view.phase === "over";
  const myTurn =
    !spectating &&
    !over &&
    view.phase === "play" &&
    view.turn === me &&
    !view.seats[me].passed &&
    view.result === null;
  const canAct = myTurn && !pending && !playing;
  const mulliganOpen =
    !spectating &&
    !over &&
    !playing &&
    confirmed.view.phase === "mulligan" &&
    confirmed.view.seats[me].mullPending &&
    (confirmed.view.seats[me].mull ?? 0) > 0;

  // The inspector follows a card only while it is in the hand or on the board (or in a
  // discard opened to read it): a card that left them falls back to the leaders.
  const inspected =
    inspection && stillInspectable(view, me, inspection) ? inspection.key : null;
  const setInspected = (key: string | null) =>
    setInspection(key === null ? null : { key, fromDiscard: false });
  /**
   * Opens a discard card at reading size; it stays inspected while it remains in that
   * discard.
   */
  const inspectDiscard = (instance: string) => {
    setInspection({ key: instance, fromDiscard: true });
    setInspectOpen(true);
  };

  const instanceCard = (instance: string) => {
    const cardId = view.inst[instance];
    return cardId ? cardDisplay(cardId) : null;
  };

  // The drafted action with its next choice and the outcome of every option. It stays
  // computed while the play is being sent, so the chosen row keeps its projected total.
  const drafting = myTurn && !playing;
  const preview =
    drafting && draft.action ? previewPartial(view, me, draft.action) : null;
  const request: TargetRequest | null = canAct && preview?.ok ? preview.request : null;

  // Every row of the selected unit: the legal ones with their ghost numbers, the others
  // with the reason they are closed. Once a target is being chosen the rows step back.
  // A unit placed from hand this round gets the house rule's bonus, named in its ghost.
  const placementNote = placementBonusNote(houseRule, view.rules, view.round);
  const rowChoices: RowChoice[] =
    canAct && draft.card && (!draft.action || (draft.action.t === "play" && !request))
      ? placementChoices(view, me, draft.card, names, placementNote)
      : [];
  const options: TargetOption[] =
    preview?.ok && request
      ? preview.options.map((option) => ({
          target: option.target,
          ok: option.ok,
          reason: option.ok ? null : option.reason,
          outcome: option.ok
            ? optionOutcome(option, request.ability, me, opponentName)
            : "",
          danger: option.ok && option.kills.includes(option.target),
          completes: option.ok && option.next === null,
          option,
        }))
      : [];
  const ready =
    canAct && preview?.ok === true && (request === null || request.optional);
  const draftPlacesUnit =
    draft.action?.t === "play" &&
    draft.action.row !== undefined &&
    view.cards[view.inst[draft.action.card] ?? ""]?.kind === "UNIT";
  const draftGhost =
    preview?.ok === true
      ? withGhostNote(
          ghostOf(preview, me, names, (id) => view.inst[id] ?? ""),
          draftPlacesUnit ? placementNote : null,
        )
      : null;
  // A complete play whose every ability finds nothing: it can still be played, as a
  // secondary "Play for no effect".
  const draftNoEffect =
    preview?.ok === true &&
    draftGhost !== null &&
    playsForNoEffect(preview, draftGhost);
  // Hand cards that cannot do anything now, with the reason: a unit with no open row, a
  // tactic that cannot be played or would find no target.
  const handNotes = canAct ? handBlockNotes(view, me, names) : EMPTY_NOTES;
  const draftError = preview && !preview.ok ? preview.reason : null;
  const draftUnits = preview?.ok ? preview.units : [];
  const draftKills = preview?.ok ? preview.kills : [];

  // ---------------------------------------------------------------- playback

  const startPlayback = (
    start: MatchView,
    events: KessenTableOutcome["events"],
    sentCard: string | null,
  ) => {
    if (!events || events.length === 0) return;
    const steps = buildPlayback(start, events, motion);
    if (steps.length === 0) return;
    // The player's own card already stood in its row as the ghost: it settles there
    // instead of dropping in again.
    for (const entry of steps) {
      if (
        entry.fx?.kind === "placed" &&
        entry.event.t === "placed" &&
        entry.event.id === sentCard
      ) {
        entry.fx = { ...entry.fx, kind: "settle" };
      }
    }
    playbackSerial.current += 1;
    setPlayback({ steps, index: firstStop(steps, 0), serial: playbackSerial.current });
  };

  const finishPlayback = (current: Playback) => {
    setLog((previous) => [...previous, ...stepLines(current.steps, names)].slice(-200));
    setPlayback(null);
  };

  // The play log's length at each version it was seen with, so a newer payload that
  // arrives without this seat's own request (the opponent's turn, a timeout) plays back
  // the events added since the board shown last. One that arrives during a playback waits
  // for it to end, so a held round summary stays until Continue or Skip.
  const logLengths = useRef(new Map<number, number>());
  const [shownVersion, setShownVersion] = useState(confirmed.version);
  const [shownView, setShownView] = useState(confirmed.view);
  useEffect(() => {
    if (matchLog) logLengths.current.set(matchLog.version, matchLog.events.length);
  }, [matchLog]);
  useEffect(() => {
    if (pending || playing || confirmed.version <= shownVersion) return;
    const from = logLengths.current.get(shownVersion);
    const fromView = shownView;
    setShownVersion(confirmed.version);
    setShownView(confirmed.view);
    if (from === undefined || !matchLog || matchLog.version !== confirmed.version)
      return;
    startPlayback(fromView, matchLog.events.slice(from), null);
  }, [confirmed.version, pending, playing, matchLog]);

  // Every round end waits for the player, the deciding one too, so its summary and the
  // opponent's line are read before the match result.
  const holding = step?.hold === true && playback !== null;
  const decidingRound = playback !== null && endsMatch(playback.steps);

  // The sent unit keeps standing in its row, with the projected total, until the
  // playback step that places it.
  const sentShown =
    sent && (pending || playing) && !findUnit(view, sent.card) ? sent : null;
  useEffect(() => {
    if (!sent) return;
    if (findUnit(view, sent.card) || (!pending && !playing)) setSent(null);
  }, [sent, view, pending, playing]);

  useEffect(() => {
    if (!playback) return;
    const current = playback.steps[playback.index];
    if (!current) {
      finishPlayback(playback);
      return;
    }
    if (current.bigPlay) void haptics.impact("HEAVY");
    if (current.event.t === "roundEnd" && current.event.winner === me) {
      void haptics.notify("SUCCESS");
    }
    if (holding) return;
    const timer = window.setTimeout(() => {
      setPlayback((state) => {
        if (!state || state.serial !== playback.serial) return state;
        return { ...state, index: firstStop(state.steps, state.index + 1) };
      });
    }, current.duration);
    return () => window.clearTimeout(timer);
  }, [playback, holding]);

  /** Leaves a held round summary and plays on. */
  const continuePlayback = () => {
    setPlayback((state) =>
      state ? { ...state, index: firstStop(state.steps, state.index + 1) } : state,
    );
  };

  /** Jumps to the confirmed board. */
  const skipPlayback = () => {
    if (playback) finishPlayback(playback);
  };

  const visibleLog = playback
    ? [...log, ...stepLines(playback.steps.slice(0, playback.index + 1), names)]
    : log;

  const roundEnd =
    step && step.event.t === "roundEnd"
      ? summaryOf(step, step.event, playback, names, cardDisplay)
      : null;

  // ---------------------------------------------------------------- actions

  /**
   * Sends a complete play. A rejection shows its reason in the prompt bar and clears the
   * draft, so the hand is free to draft the play again (or another one) at once.
   */
  const send = async (action: KessenAction) => {
    if (pending) return;
    setPending(true);
    setMessage(null);
    // The inspect sheet would cover the rows the play resolves on.
    setInspectOpen(false);
    const start = confirmed.view;
    const placement = sentPlacementOf(start, me, action);
    setSent(placement);
    let result: KessenTableOutcome;
    try {
      result = await onAction(action);
    } catch {
      result = {
        ok: false,
        message: "The table could not reach the server. Try again.",
      };
    }
    setPending(false);
    if (result.payload) {
      setLocal(result.payload);
      // This request's own events play back below; the board it reached is the one shown.
      setShownVersion(result.payload.version);
      setShownView(result.payload.view);
    }
    if (!result.ok) {
      setMessage(result.message || "That play was not accepted. Try again.");
      setDraft(EMPTY_DRAFT);
      setSent(null);
      return;
    }
    setDraft(EMPTY_DRAFT);
    if (action.t === "play" || action.t === "leader") void haptics.impact("LIGHT");
    startPlayback(start, result.events, placement?.card ?? null);
  };

  const selectCard = (instance: string) => {
    setMessage(null);
    if (!canAct) {
      setInspected(instance);
      return;
    }
    if (draft.card === instance) {
      setDraft(EMPTY_DRAFT);
      return;
    }
    setInspected(instance);
    const card = view.cards[view.inst[instance] ?? ""];
    if (card?.kind === "TACTIC") {
      setDraft({ card: instance, action: { t: "play", card: instance } });
      return;
    }
    setDraft({ card: instance, action: null });
  };

  const startLeader = () => {
    setMessage(null);
    if (!canAct) return;
    if (draft.action?.t === "leader") {
      setDraft(EMPTY_DRAFT);
      return;
    }
    // The panel reads the ability being aimed, not the card inspected before it.
    setInspected(`leader:${me}`);
    setDraft({ card: null, action: { t: "leader" } });
  };

  const chooseTarget = (target: string) => {
    if (!draft.action || !request) return;
    const option = options.find((entry) => entry.target === target);
    if (!option) return;
    if (!option.ok) {
      setMessage(option.reason);
      return;
    }
    const action = {
      ...draft.action,
      targets: [...(draft.action.targets ?? []), target],
    };
    if (option.completes) {
      void send(action);
      return;
    }
    setDraft({ ...draft, action });
  };

  const tapRow = (side: Seat, row: Row) => {
    setMessage(null);
    if (!canAct) return;
    if (request && isRowKind(request.kind)) {
      const sideMatches = rowRequestAccepts(request, view, me, side, row);
      if (sideMatches && request.options.includes(row)) chooseTarget(row);
      else setMessage("Choose one of the highlighted rows.");
      return;
    }
    if (!draft.card) return;
    const choice = rowChoices.find((entry) => entry.row === row && entry.side === side);
    const current = draft.action?.t === "play" ? draft.action : null;
    if (current?.row === row && side === placementSide(view, draft.card, me) && ready) {
      void send(current);
      return;
    }
    if (current && current.row !== undefined) {
      // A row is placed already: tapping another legal row moves the ghost there.
      if (choice?.legal) {
        setDraft({ card: draft.card, action: { t: "play", card: draft.card, row } });
      } else if (choice) setMessage(choice.reason ?? "That row is not available.");
      return;
    }
    if (!choice) return;
    if (!choice.legal) {
      setMessage(choice.reason ?? "That row is not available.");
      return;
    }
    const action: KessenAction = { t: "play", card: draft.card, row };
    if (choice.complete && quickPlay) {
      void send(action);
      return;
    }
    setDraft({ card: draft.card, action });
  };

  /**
   * A tap on a unit tile. While a unit from the hand is being placed, the tile is part of
   * its row's lane, so the tap chooses (or confirms) that row; it inspects otherwise.
   * Long-press and hover inspect in every case.
   */
  const tapUnit = (id: string, side: Seat, row: Row) => {
    if (canAct && request && isUnitKind(request.kind)) {
      if (request.options.includes(id)) chooseTarget(id);
      else inspect(id);
      return;
    }
    if (canAct && draft.card && rowChoices.length > 0) {
      tapRow(side, row);
      return;
    }
    inspect(id);
  };

  /** Shows a card at reading size (the inspect sheet on phones). */
  const inspect = (key: string) => {
    setInspected(key);
    setInspectOpen(true);
  };

  const confirm = () => {
    if (draft.action && ready) void send(draft.action);
  };

  const cancel = () => {
    setDraft(EMPTY_DRAFT);
    setMessage(null);
  };

  const pass = () => {
    setDraft(EMPTY_DRAFT);
    void send({ t: "pass" });
  };

  const mulligan = (cards: string[]) => {
    void send({ t: "mull", cards });
  };

  const concede = async () => {
    if (pending) return;
    setPending(true);
    setMessage(null);
    let result: KessenTableOutcome | undefined;
    try {
      result = await onConcede();
    } catch {
      result = {
        ok: false,
        message: "The table could not reach the server. Try again.",
      };
    }
    setPending(false);
    if (result?.payload) {
      setLocal(result.payload);
      setShownVersion(result.payload.version);
      setShownView(result.payload.view);
    }
    if (result && !result.ok)
      setMessage(result.message || "The match could not be conceded.");
  };

  const setQuickPlay = (enabled: boolean) => {
    setQuickPlayState(enabled);
    // Storage can be unavailable (private windows); the toggle still applies here.
    safeLocalStorageSetItem(QUICK_PLAY_KEY, enabled ? "1" : "0");
  };

  // ------------------------------------------------------------------ board

  const powers = unitPowers(view);
  const rowEffects = draftRowEffects(
    view,
    powers,
    preview?.ok ? preview : null,
    rowChoices,
  );
  const facts = passFacts(view, opponentName);
  const sideTotals = projectedTotals(view, powers, sentShown);
  const needText = needLine(view, opponentName, self);

  return {
    motion,
    confirmed,
    duel,
    npcMatch,
    lesson,
    view,
    me,
    them,
    npc,
    opponent,
    opponentName,
    spectating,
    /** "You", or the watched seat's name for a spectator. */
    selfName: self ?? "You",
    /** "Your", or the watched seat's name for a spectator. */
    selfPossessive: self ? `${self}'s` : "Your",
    names,
    cardDisplay,
    instanceCard,
    powers,
    facts,
    over,
    myTurn,
    canAct,
    pending,
    playing,
    step,
    holding,
    decidingRound,
    roundEnd,
    sent: sentShown,
    mulliganOpen,
    houseRule,
    placementNote,
    handNotes,
    draftNoEffect,
    message,
    setMessage,
    draft,
    rowChoices,
    request,
    options,
    ready,
    draftGhost,
    draftError,
    draftUnits,
    draftKills,
    sideTotals,
    rowEffects,
    needText,
    inspected,
    setInspected,
    inspectDiscard,
    inspect,
    inspectOpen,
    closeInspect: () => setInspectOpen(false),
    quickPlay,
    setQuickPlay,
    log: visibleLog,
    selectCard,
    startLeader,
    chooseTarget,
    tapRow,
    tapUnit,
    confirm,
    cancel,
    pass,
    mulligan,
    concede,
    continuePlayback,
    skipPlayback,
  };
};

/** Displayed power of every unit on a board, by instance id. */
export const unitPowers = (view: MatchView) => {
  const out = new Map<string, number>();
  const state = view as unknown as MatchState;
  for (const side of [0, 1] as const) {
    for (const row of ROWS) {
      for (const unit of view.board[side][row]) {
        try {
          out.set(unit.id, displayedPower(state, { unit, side, row }));
        } catch {
          out.set(unit.id, unit.stored);
        }
      }
    }
  }
  return out;
};

/** Row totals of one side from the unit powers. */
export const rowTotalOf = (
  view: MatchView,
  powers: Map<string, number>,
  side: Seat,
  row: Row,
) => view.board[side][row].reduce((sum, unit) => sum + (powers.get(unit.id) ?? 0), 0);

/** Row total after a previewed play: the displayed power of every unit left in the row. */
export const rowAfterOf = (units: readonly UnitDelta[], side: Seat, row: Row) =>
  units.reduce(
    (sum, unit) =>
      unit.side === side && unit.row === row && unit.after !== null
        ? sum + unit.after
        : sum,
    0,
  );

/** The side a unit in hand joins (the opponent's for Infiltrators). */
export const placementSide = (view: MatchView, instance: string, me: Seat): Seat => {
  const card = view.cards[view.inst[instance] ?? ""];
  const infiltrator = card?.abilities.some((ability) => ability.k === "infiltrator");
  return infiltrator ? other(me) : me;
};

/** Whether a target request asks for a row. */
export const isRowKind = (kind: TargetRequest["kind"]) =>
  kind === "enemyRow" || kind === "ownRow" || kind === "anyRow";

/**
 * Whether a row request takes `row` on `side`. A chosen-row Terrain only offers the
 * sides it would afflict (Permafrost keeps the player's own rows clear).
 */
export const rowRequestAccepts = (
  request: TargetRequest,
  view: MatchView,
  me: Seat,
  side: Seat,
  row: Row,
) => {
  if (request.kind === "anyRow") {
    return (
      request.ability !== "terrain" ||
      (terrainSides(view, me).includes(side) && !view.terrain[side][row])
    );
  }
  return request.kind === "enemyRow" ? side !== me : side === me;
};

/** Whether a target request asks for a unit on the board. */
export const isUnitKind = (kind: TargetRequest["kind"]) =>
  kind === "enemyUnit" || kind === "ownUnit" || kind === "anyUnit";

/** Whether a target request picks a card from a discard or the hand. */
export const isPickerKind = (kind: TargetRequest["kind"]) =>
  kind === "discard" || kind === "enemyDiscard" || kind === "hand";

const catalogLookup = (catalog: KessenMatchCatalog) => {
  if (catalog instanceof Map) return catalog;
  const map = new Map<string, KessenCardDisplay>();
  const entries = Array.isArray(catalog) ? catalog : Object.values(catalog);
  for (const entry of entries) map.set(entry.id, entry);
  return map;
};

/** The play-log lines of played-back steps. */
const stepLines = (steps: readonly PlaybackStep[], names: MatchNames) =>
  steps
    .map((entry) => describeEvent(entry.event, entry.before, names, entry.frame))
    .filter((line): line is string => line !== null);

/** The next step at or after `from` that takes time or waits; past the end when none. */
const firstStop = (steps: PlaybackStep[], from: number) => {
  let index = from;
  while (index < steps.length) {
    const entry = steps[index] as PlaybackStep;
    if (entry.duration > 0 || entry.hold) break;
    index += 1;
  }
  return index;
};

const endsMatch = (steps: PlaybackStep[]) =>
  steps.some((entry) => entry.event.t === "matchEnd");

const summaryOf = (
  step: PlaybackStep,
  event: Extract<KessenEvent, { t: "roundEnd" }>,
  playback: Playback | null,
  names: MatchNames,
  cardDisplay: (cardId: string) => KessenCardDisplay | null,
): RoundSummaryData => {
  const cleanup = playback?.steps.find(
    (entry, index) => index > playback.index && entry.event.t === "cleanup",
  );
  const keptIds = cleanup?.event.t === "cleanup" ? cleanup.event.kept : [];
  const powers = unitPowers(step.frame);
  const kept = keptIds.map((id) => ({
    name: cardDisplay(step.frame.inst[id] ?? "")?.name ?? "A unit",
    power: powers.get(id) ?? 0,
  }));
  return roundSummary(event, step.before, kept, names);
};

const readQuickPlay = () => safeLocalStorageGetItem(QUICK_PLAY_KEY) === "1";

/** Device storage of the quick-play toggle (a complete row tap plays at once). */
const QUICK_PLAY_KEY = "kessen:quickPlay";

/**
 * All six rows for a unit in hand: the placement rows with their ghost numbers, and every
 * other row closed with a short reason ("Taijutsu only", "Row full"); empty for other cards.
 */
const placementChoices = (
  view: MatchView,
  me: Seat,
  cardInstance: string,
  names: MatchNames,
  bonusNote: string | null,
): RowChoice[] => {
  const card = view.cards[view.inst[cardInstance] ?? ""];
  if (card?.kind !== "UNIT") return [];
  const placements = rowOptionsForView(view, me, cardInstance);
  const side = placementSide(view, cardInstance, me);
  const closed: RowChoice[] = [];
  for (const rowSide of [me, other(me)] as const) {
    for (const row of ROWS) {
      if (placements.some((entry) => entry.row === row && entry.side === rowSide)) {
        continue;
      }
      const reason =
        rowSide !== side
          ? side === me
            ? "Your side only"
            : "Their side only"
          : card.row && card.row !== "ANY"
            ? `${ROW_LABELS[card.row]} only`
            : "Not this row";
      closed.push({
        row,
        side: rowSide,
        legal: false,
        reason,
        ghost: null,
        rowAfter: null,
        needsTarget: false,
        complete: false,
        outcome: null,
      });
    }
  }
  const open = placements.map((option): RowChoice => {
    if (!option.legal) {
      return {
        ...option,
        ghost: null,
        rowAfter: null,
        needsTarget: false,
        complete: false,
        outcome: null,
      };
    }
    const preview = previewPartial(view, me, {
      t: "play",
      card: cardInstance,
      row: option.row,
    });
    if (!preview.ok) {
      return {
        ...option,
        legal: false,
        reason: preview.reason,
        ghost: null,
        rowAfter: null,
        needsTarget: false,
        complete: false,
        outcome: null,
      };
    }
    return {
      ...option,
      ghost: withGhostNote(
        ghostOf(preview, me, names, (id) => view.inst[id] ?? ""),
        bonusNote,
      ),
      rowAfter: rowAfterOf(preview.units, option.side, option.row),
      needsTarget: preview.request !== null && !preview.request.optional,
      complete: preview.request === null,
      outcome: { units: preview.units, events: preview.events },
    };
  });
  return [...open, ...closed];
};

/**
 * Why each card in hand can do nothing now: a unit with no open row ("No row has room:
 * your Taijutsu row is full."), a tactic the rules refuse, or one whose abilities would
 * all find no target. Cards absent from the map are playable.
 */
const handBlockNotes = (view: MatchView, me: Seat, names: MatchNames) => {
  const notes = new Map<string, string>();
  for (const instance of view.seats[me].hand ?? []) {
    try {
      const note = handBlockNote(view, me, names, instance);
      if (note) notes.set(instance, note);
    } catch {
      // A hint only: a board the local engine cannot read leaves the card undimmed.
    }
  }
  return notes;
};

const handBlockNote = (
  view: MatchView,
  me: Seat,
  names: MatchNames,
  instance: string,
): string | null => {
  const card = view.cards[view.inst[instance] ?? ""];
  if (!card) return null;
  if (card.kind === "UNIT") {
    const rows = rowOptionsForView(view, me, instance);
    return rows.length > 0 && rows.every((entry) => !entry.legal)
      ? noRowText(rows, placementSide(view, instance, me) === me)
      : null;
  }
  if (card.kind !== "TACTIC") return null;
  const preview = previewPartial(view, me, { t: "play", card: instance });
  if (!preview.ok) return preview.reason;
  if (preview.request && preview.options.every((option) => !option.ok)) {
    return "No legal target now.";
  }
  const ghost = ghostOf(preview, me, names, (id) => view.inst[id] ?? "");
  return playsForNoEffect(preview, ghost)
    ? `No effect now: ${ghost.fizzles.join(", ")}.`
    : null;
};

const EMPTY_NOTES: ReadonlyMap<string, string> = new Map();

/** The unit a play puts on the board, with its projected power and row total. */
const sentPlacementOf = (
  view: MatchView,
  me: Seat,
  action: KessenAction,
): SentPlacement | null => {
  if (action.t !== "play" || action.row === undefined) return null;
  const card = view.cards[view.inst[action.card] ?? ""];
  if (card?.kind !== "UNIT") return null;
  const preview = previewPartial(view, me, action);
  if (!preview.ok) return null;
  const side = placementSide(view, action.card, me);
  return {
    card: action.card,
    side,
    row: action.row,
    power: preview.units.find((unit) => unit.id === action.card)?.after ?? null,
    rowAfter: rowAfterOf(preview.units, side, action.row),
  };
};

/**
 * Side totals of the board shown. While a sent unit still stands in its row as a ghost,
 * its side counts the row at the ghost's projected total, so the row and side numbers
 * change in the same frame.
 */
const projectedTotals = (
  view: MatchView,
  powers: Map<string, number>,
  sent: SentPlacement | null,
): [number, number] => {
  const totals = safeTotals(view);
  if (!sent) return totals;
  const now = rowTotalOf(view, powers, sent.side, sent.row);
  const projected: [number, number] = [totals[0], totals[1]];
  projected[sent.side] += sent.rowAfter - now;
  return projected;
};

/**
 * Rows the drafted play changes, keyed by `rowEffectKey`. Before a unit's row is chosen,
 * only the effects every open row would cause are kept, on rows other than the open ones.
 */
const draftRowEffects = (
  view: MatchView,
  powers: Map<string, number>,
  preview: PreviewOutcome | null,
  choices: readonly RowChoice[],
): ReadonlyMap<string, RowEffect> => {
  const open = choices.filter((choice) => choice.legal && choice.outcome);
  if (open.length > 0) {
    const [first, ...rest] = open.map((choice) =>
      rowEffectsOf(view, powers, choice.outcome as PreviewOutcome),
    );
    const shared = new Map<string, RowEffect>();
    for (const [key, effect] of first ?? []) {
      const everywhere = rest.every(
        (other) =>
          other.get(key)?.after === effect.after &&
          other.get(key)?.label === effect.label,
      );
      const onOpenRow = open.some(
        (choice) => rowEffectKey(choice.side, choice.row) === key,
      );
      if (everywhere && !onOpenRow) shared.set(key, effect);
    }
    return shared;
  }
  return preview ? rowEffectsOf(view, powers, preview) : EMPTY_EFFECTS;
};

/** Every row whose total or Terrain a previewed play changes. */
export const rowEffectsOf = (
  view: MatchView,
  powers: Map<string, number>,
  outcome: PreviewOutcome,
) => {
  const effects = new Map<string, RowEffect>();
  for (const side of [0, 1] as const) {
    for (const row of ROWS) {
      let terrain: boolean | null = null;
      for (const event of outcome.events) {
        if (event.t === "terrain" && event.side === side && event.row === row) {
          terrain = event.on;
        }
      }
      const after = rowAfterOf(outcome.units, side, row);
      const change = after - rowTotalOf(view, powers, side, row);
      if (change === 0 && terrain === null) continue;
      effects.set(rowEffectKey(side, row), {
        side,
        row,
        after,
        label: rowEffectLabel(terrain, change),
      });
    }
  }
  return effects;
};

export const rowEffectKey = (side: Seat, row: Row) => `${side}:${row}`;

const EMPTY_EFFECTS: ReadonlyMap<string, RowEffect> = new Map();

/**
 * Whether an inspected key still names something on the table: catalog cards and leaders
 * always do; a card instance while it is in the viewer's hand or on the board, or, when it
 * was read from a discard, while it is in either discard.
 */
export const stillInspectable = (view: MatchView, me: Seat, inspection: Inspection) => {
  const { key, fromDiscard } = inspection;
  if (key.startsWith("card:") || key.startsWith("leader:")) return true;
  if (view.seats[me].hand?.includes(key) || findUnit(view, key)) return true;
  return fromDiscard && view.seats.some((zone) => zone.discard.includes(key));
};

const EMPTY_DRAFT: Draft = { card: null, action: null };

/** What the table shows: a match against an NPC (or a lesson), or a duel seat's view. */
export type KessenTablePayload = KessenMatchPayload | KessenPvpMatchPayload;

/** Whether the table shows a duel (PvP payloads carry `kind`). */
export const isDuelPayload = (
  payload: KessenTablePayload,
): payload is KessenPvpMatchPayload => "kind" in payload;

/** What a sent decision resolves with; `message` explains a rejection. */
export interface KessenTableOutcome {
  ok: boolean;
  payload?: KessenTablePayload;
  events?: KessenEvent[];
  message?: string;
}

/** A card lookup: catalog entries as a list, a record by id, or a map. */
export type KessenMatchCatalog =
  | readonly KessenCatalogEntry[]
  | Readonly<Record<string, KessenCatalogEntry>>
  | ReadonlyMap<string, KessenCardDisplay>;

type PlayOrLeader = Extract<KessenAction, { t: "play" | "leader" }>;

interface Draft {
  /** Selected hand card instance. */
  card: string | null;
  /** The play being built; null while a unit still waits for its row. */
  action: PlayOrLeader | null;
}

interface Playback {
  steps: PlaybackStep[];
  index: number;
  serial: number;
}

/** One row a selected unit could take: open with its ghost, or closed with a reason. */
export interface RowChoice {
  row: Row;
  side: Seat;
  legal: boolean;
  reason: string | null;
  ghost: Ghost | null;
  /** The row's total after the placement. */
  rowAfter: number | null;
  /** A target is chosen after the row. */
  needsTarget: boolean;
  /** The play is complete with this row. */
  complete: boolean;
  /** The placement's previewed unit powers and events; null for a closed row. */
  outcome: PreviewOutcome | null;
}

/** What a previewed play does to the board. */
interface PreviewOutcome {
  units: readonly UnitDelta[];
  events: readonly KessenEvent[];
}

/**
 * A row the drafted play changes beyond the rows it is placed or aimed at, such as a
 * Deploy's automatic Terrain on the enemy row with the most units: its total after the
 * play and a short label.
 */
export interface RowEffect {
  side: Seat;
  row: Row;
  after: number;
  label: string;
}

/** A unit play on its way to the server, shown in its row until playback places it. */
export interface SentPlacement {
  card: string;
  side: Seat;
  row: Row;
  power: number | null;
  rowAfter: number;
}

/** One option of a target request with its short outcome; `danger` marks a kill. */
export interface TargetOption {
  target: string;
  ok: boolean;
  reason: string | null;
  outcome: string;
  danger: boolean;
  /** Choosing it completes the play, which commits it. */
  completes: boolean;
  option: PartialOption;
}

/** The match table state and handlers every table component reads. */
export type MatchTable = ReturnType<typeof useMatchTable>;

/** The inspected key and whether it was read from a discard. */
export interface Inspection {
  key: string;
  fromDiscard: boolean;
}
