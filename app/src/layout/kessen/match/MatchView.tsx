"use client";

import "../kessen.css";
import "./kessenMatch.css";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  academyCoach,
  academyDebrief,
  academyPassWarning,
  KESSEN_ACADEMY,
  type KessenAcademyLessonKey,
} from "@/libs/kessen/academy";
import type { KessenAction } from "@/libs/kessen/types";
import { safeSessionStorageGetItem, safeSessionStorageSetItem } from "@/utils/storage";
import type { KessenMatchLog } from "@/validators/kessen";
import { KESSEN_IMAGES, kessenLandscapeUrl } from "../kessenArt";
import { useKessenMotion } from "../useKessenMotion";
import { DuelClock, DuelEndScreen } from "./DuelOverlays";
import { LessonNotice, LessonSpotlight, RetryRow } from "./LessonSpotlight";
import { lessonMarks } from "./lesson";
import { type HandSort, OpponentBar, PlayerBar } from "./MatchBars";
import { MatchBoard } from "./MatchBoard";
import { ActionBar, PromptStrip } from "./MatchControls";
import { HandStrip } from "./MatchHand";
import {
  BigPlayStamp,
  MatchEndScreen,
  MulliganScreen,
  RoundEndOverlay,
} from "./MatchOverlays";
import {
  Discards,
  InspectPanel,
  MatchOptions,
  PlayLog,
  RulesGlossary,
  TargetPicker,
} from "./MatchPanels";
import {
  isPickerKind,
  type KessenMatchCatalog,
  type KessenTableOutcome,
  type KessenTablePayload,
  useMatchTable,
} from "./useMatchTable";

/**
 * The Kessen match table inside the page's content box: the opponent's bar, the six rows
 * and centre band, the player's bar, the hand and the actions, in a frame as tall as the
 * screen leaves below the content box's title. Plays are drafted locally with exact ghost
 * numbers and sent once complete; the server's events then play back in order. The log,
 * discards, rules, options and the inspected card open in sheets over the board, so the
 * board keeps the width. A frame short of height in landscape (a phone on its side) docks
 * the prompt, the whole hand and the actions beside the board, so the rows are sized from
 * the full height. A lesson adds Lemu's coach over the table; a duel adds the turn clock
 * and the other player's seat. A spectator (`spectating`) watches a duel read-only, from
 * seat 0's side with both hands hidden.
 */
export const KessenMatchView = ({
  payload,
  log,
  catalog,
  onAction,
  onConcede,
  onClose,
  onRematch,
  rematchLabel,
  isStarting = false,
  startError = null,
  onEditDeck,
  onClaimChoice,
  onStartLesson,
  guestNote,
  spectating = false,
}: KessenMatchViewProps) => {
  const motion = useKessenMotion();
  const [frame, setFrame] = useState<HTMLElement | null>(null);
  // Docked tables show the whole hand beside the board already.
  const docked = useDockedFrame(frame);
  const table = useMatchTable({
    payload,
    log,
    catalog,
    onAction,
    onConcede: () => onConcede() ?? undefined,
    motion,
    spectating,
  });
  const [sheet, setSheet] = useState<Sheet>(null);
  const [logTab, setLogTab] = useState<LogTab>("log");
  const [sort, setSort] = useState<HandSort>("row");

  const picker =
    table.request && isPickerKind(table.request.kind) && table.request.kind !== "hand";
  const showEnd = table.over && !table.playing;
  const roundEndShown = table.roundEnd !== null && table.step?.event.t === "roundEnd";
  // Behind a round or match result the table takes no focus or taps.
  const covered = showEnd || roundEndShown;

  const { lesson, duel } = table;
  const version = table.confirmed.version;
  const lessonKey = table.npcMatch?.lesson ?? null;
  const lessonInfo = lessonKey
    ? (KESSEN_ACADEMY.find((entry) => entry.key === lessonKey) ?? null)
    : null;
  const heading = lessonInfo
    ? { order: lessonInfo.order, total: KESSEN_ACADEMY.length, title: lessonInfo.title }
    : null;
  // Lemu's opening words come first, once per lesson match in this tab.
  const introKey = `${INTRO_KEY_PREFIX}${table.confirmed.id}`;
  const [introDone, setIntroDone] = useState(
    () => !lessonInfo || safeSessionStorageGetItem(introKey) !== null,
  );
  const finishIntro = () => {
    safeSessionStorageSetItem(introKey, "1");
    setIntroDone(true);
  };
  // "Play on" after a mistake and the pass question each belong to one board version.
  const [playOnAt, setPlayOnAt] = useState<number | null>(null);
  const [passAskAt, setPassAskAt] = useState<number | null>(null);
  const passAsk = passAskAt === version;
  const coachFree =
    !!lessonKey &&
    introDone &&
    !passAsk &&
    table.myTurn &&
    !table.playing &&
    !table.pending &&
    !table.mulliganOpen &&
    !covered;
  const coach =
    lessonKey && coachFree
      ? academyCoach(lessonKey, table.view, {
          myTurn: true,
          card: table.draft.card,
          action: table.draft.action,
          playOn: playOnAt === version,
        })
      : null;
  const passWarning =
    lessonKey && table.canAct ? academyPassWarning(lessonKey, table.view) : null;
  const retryLesson = lessonKey ? () => onStartLesson?.(lessonKey, true) : undefined;
  const nextInfo = lessonInfo ? (KESSEN_ACADEMY[lessonInfo.order] ?? null) : null;
  const debrief = lessonKey && showEnd ? academyDebrief(lessonKey, table.view) : null;
  const lessonEnd =
    debrief && lessonKey
      ? {
          debrief,
          next: nextInfo,
          onNext: () => (nextInfo ? onStartLesson?.(nextInfo.key, false) : undefined),
          onRetry: () => onStartLesson?.(lessonKey, true),
          factionPerks: nextInfo === null,
        }
      : null;
  // The inspected card opens over the board or over the sheet it was read from (a
  // discard, the whole hand); opening a sheet closes it.
  const inspectSheetOpen = table.inspectOpen;
  const boardUrl = kessenLandscapeUrl(KESSEN_IMAGES.board, 1024);

  // A confirmed play closes the sheets over the board (the table closes the inspected
  // card), so its playback and the opponent's reply are seen on the rows; a sheet opened
  // during playback stays.
  const busy = table.pending || table.playing;
  useEffect(() => {
    if (busy) setSheet(null);
  }, [busy]);

  // An opened table brings the content box to the top of the screen, where the frame
  // fits, and its title's way back to the hall takes the focus unless an overlay (the
  // mulligan) or the lesson guide in the activity dock has it.
  useEffect(() => {
    if (!frame) return;
    const box = frame.closest("[data-content-box]");
    box?.scrollIntoView({ block: "start" });
    const focused = document.activeElement;
    if (!frame.contains(focused) && !focused?.closest("[data-activity-dock]"))
      box
        ?.querySelector<HTMLElement>("[data-content-box-back]")
        ?.focus({ preventScroll: true });
  }, [frame]);

  // Escape steps back out of the inspected card, a sheet or a draft; at the top level it
  // does nothing, so a stray key never leaves the table.
  const closeAll = () => {
    if (table.inspectOpen) table.closeInspect();
    else if (sheet) setSheet(null);
    else if (table.draft.card || table.draft.action) table.cancel();
  };

  const handSheetOpen = sheet === "hand" && !docked;
  const sheetOpen = picker || handSheetOpen || sheet === "log" || inspectSheetOpen;
  const closeTopSheet = () => {
    if (table.inspectOpen) table.closeInspect();
    else if (picker) table.cancel();
    else setSheet(null);
  };

  const openSheet = (next: Sheet) => {
    table.closeInspect();
    setSheet(next);
  };

  const openDiscards = () => {
    setLogTab("discards");
    openSheet("log");
  };

  const openRules = () => {
    setLogTab("rules");
    openSheet("log");
  };

  const main = (
    <main
      className="km-main"
      aria-label="Kessen table"
      data-covered={roundEndShown ? "" : undefined}
      style={{ "--km-board-art": `url("${boardUrl}")` } as React.CSSProperties}
    >
      {/* The stage (board and both bars) and the dock (prompt, hand and actions) stack in
          one column, or sit side by side on short landscape screens. */}
      <div className="km-stage" inert={covered || undefined}>
        <OpponentBar
          table={table}
          onOpenDiscards={openDiscards}
          onOpenRules={openRules}
        />
        <div className="km-board">
          <MatchBoard
            table={table}
            pulseBadge={coach?.badge === true}
            lesson={lesson}
          />
          <BigPlayStamp table={table} />
        </div>
        <PlayerBar
          table={table}
          sort={sort}
          onSort={() => setSort(nextSort(sort))}
          onOpenDiscards={openDiscards}
        />
      </div>
      {/* A finished match keeps no hand or Pass behind its result. */}
      <div className="km-dock" inert={covered || undefined}>
        {duel && !showEnd ? (
          <div className="km-prompt-group">
            <DuelClock table={table} duel={duel} />
            <PromptStrip table={table} />
          </div>
        ) : (
          <PromptStrip table={table} />
        )}
        {showEnd ? null : (
          <>
            <div className="km-hand-wrap">
              <HandStrip table={table} sort={sort} />
            </div>
            <ActionBar
              table={table}
              lesson={lesson}
              onPassRequest={passWarning ? () => setPassAskAt(version) : undefined}
              onOpenHand={() => openSheet(sheet === "hand" ? null : "hand")}
              onOpenLog={() => openSheet(sheet === "log" ? null : "log")}
            />
          </>
        )}
      </div>
      <RoundEndOverlay
        table={table}
        clock={
          duel && !table.decidingRound ? (
            <DuelClock table={table} duel={duel} />
          ) : undefined
        }
      />
      {table.mulliganOpen ? (
        <MulliganScreen
          key={`mull-${table.confirmed.view.round}`}
          table={table}
          clock={duel ? <DuelClock table={table} duel={duel} /> : undefined}
        />
      ) : null}
      {showEnd && duel ? (
        <DuelEndScreen
          table={table}
          duel={duel}
          onClose={onClose}
          onRematch={onRematch}
          rematchLabel={rematchLabel}
          isStarting={isStarting}
          startError={startError}
        />
      ) : showEnd ? (
        <MatchEndScreen
          table={table}
          lesson={lesson}
          academy={lessonEnd}
          onClose={onClose}
          onRematch={onRematch}
          isStarting={isStarting}
          startError={startError}
          onEditDeck={onEditDeck}
          onClaimChoice={onClaimChoice}
          guestNote={guestNote}
          rematchLabel={rematchLabel}
        />
      ) : null}
      {heading && lessonInfo && !introDone && !showEnd ? (
        <LessonNotice lesson={heading} title={lessonInfo.title} lead={lessonInfo.intro}>
          <Button
            type="button"
            decoration="gold"
            className="w-full sm:w-auto"
            onClick={finishIntro}
          >
            Begin
          </Button>
        </LessonNotice>
      ) : null}
      {heading && passAsk && passWarning ? (
        <LessonNotice
          lesson={heading}
          title="Pass now?"
          tone="mistake"
          lead={passWarning}
          marks={lessonMarks(table.view, [passWarning])}
        >
          <Button
            type="button"
            decoration="gold"
            className="w-full sm:w-auto"
            onClick={() => setPassAskAt(null)}
          >
            Keep playing
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => {
              setPassAskAt(null);
              table.pass();
            }}
          >
            Pass anyway
          </Button>
        </LessonNotice>
      ) : null}
      {heading && coach?.tone === "mistake" ? (
        <LessonNotice
          lesson={heading}
          title={coach.title}
          tone="mistake"
          lead={coach.text}
          why={coach.why}
          marks={lessonMarks(table.view, [coach.title, coach.text, coach.why])}
        >
          {retryLesson ? (
            <RetryRow onRetry={retryLesson} retrying={isStarting} error={startError} />
          ) : null}
          {coach.action ? (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setPlayOnAt(version)}
            >
              Play on
            </Button>
          ) : null}
        </LessonNotice>
      ) : heading && coach ? (
        <LessonSpotlight
          step={coach}
          lesson={heading}
          marks={lessonMarks(table.view, [coach.title, coach.text, coach.why])}
          onRetry={retryLesson}
          retrying={isStarting}
          retryError={startError}
        />
      ) : null}
    </main>
  );

  // Escape steps out of the table's own layers; keys from dialogs it portals elsewhere
  // and keys a control already handled pass by.
  return (
    <section
      ref={setFrame}
      className="kessen-match kessen-scene"
      aria-label={`Kessen${table.spectating ? `: ${table.selfName}` : ""} against ${table.opponentName}, round ${table.view.round}`}
      data-motion={motion ? "on" : "off"}
      data-button-sfx="off"
      onKeyDown={(event) => {
        if (
          event.key !== "Escape" ||
          event.defaultPrevented ||
          !(event.target instanceof Node) ||
          !event.currentTarget.contains(event.target)
        )
          return;
        event.preventDefault();
        closeAll();
      }}
    >
      <div className="km-layout" inert={sheetOpen || undefined}>
        {main}
      </div>
      {sheetOpen ? (
        // Sheets cover the whole table over a dimmed backdrop; a tap on it closes the top one.
        <div className="km-sheet-layer">
          <button
            type="button"
            className="km-sheet-scrim"
            aria-label="Close"
            tabIndex={-1}
            onClick={closeTopSheet}
            data-button-sfx="off"
          />
          {picker ? (
            <div className="km-sheet">
              <SheetHead title="Choose a card" onClose={table.cancel} />
              <TargetPicker table={table} />
            </div>
          ) : null}
          {handSheetOpen ? (
            <div className="km-sheet">
              <SheetHead title="Your hand" onClose={() => setSheet(null)} />
              <div className="km-sheet-body">
                <HandStrip
                  table={table}
                  sort={sort}
                  layout="grid"
                  onPicked={() => setSheet(null)}
                />
              </div>
            </div>
          ) : null}
          {sheet === "log" ? (
            <div className="km-sheet">
              <SheetHead title="Table" onClose={() => setSheet(null)} />
              <Tabs
                value={logTab}
                onValueChange={(value) => setLogTab(value as LogTab)}
                className="flex min-h-0 flex-1 flex-col"
              >
                <TabsList
                  aria-label="Table sheet"
                  className="km-tabs grid shrink-0 grid-cols-4"
                >
                  {LOG_TABS.map((tab) => (
                    <TabsTrigger key={tab.id} value={tab.id} className="km-tab">
                      {tab.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
                <TabsContent value="log" className="km-sheet-body">
                  <PlayLog table={table} />
                </TabsContent>
                <TabsContent value="discards" className="km-sheet-body">
                  <Discards table={table} />
                </TabsContent>
                <TabsContent value="rules" className="km-sheet-body">
                  <RulesGlossary table={table} />
                </TabsContent>
                <TabsContent value="options" className="km-sheet-body">
                  <MatchOptions table={table} />
                </TabsContent>
              </Tabs>
            </div>
          ) : null}
          {inspectSheetOpen ? (
            <div className="km-sheet km-sheet-inspect">
              <SheetHead title="Card" onClose={table.closeInspect} />
              <div className="km-sheet-body">
                <InspectPanel table={table} />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

const SheetHead = ({ title, onClose }: { title: string; onClose: () => void }) => (
  <div className="km-sheet-head">
    <h3 className="km-panel-title">{title}</h3>
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="km-hit h-8 w-8"
      onClick={onClose}
      aria-label="Close"
    >
      <X className="h-4 w-4" aria-hidden />
    </Button>
  </div>
);

/**
 * Whether the table's frame is short and in landscape (a phone on its side), the docked
 * layout of kessenMatch.css: the hand already shows in full beside the board.
 */
const useDockedFrame = (frame: HTMLElement | null) => {
  const [docked, setDocked] = useState(false);
  useEffect(() => {
    if (!frame) return;
    const measure = () => {
      const { width, height } = frame.getBoundingClientRect();
      setDocked(height <= DOCKED_MAX_HEIGHT && width > height);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [frame]);
  return docked;
};

/** Mirrors the docked container queries of kessenMatch.css. */
const DOCKED_MAX_HEIGHT = 500;

/** Session storage key (plus the match id) of a lesson whose opening words were read. */
const INTRO_KEY_PREFIX = "kessen:lessonIntro:";

const nextSort = (sort: HandSort): HandSort =>
  sort === "row" ? "power" : sort === "power" ? "order" : "row";

const LOG_TABS: { id: LogTab; label: string }[] = [
  { id: "log", label: "Log" },
  { id: "discards", label: "Discards" },
  { id: "rules", label: "Rules" },
  { id: "options", label: "Options" },
];

type Sheet = "hand" | "log" | null;
type LogTab = "log" | "discards" | "rules" | "options";

/** The match table's payload, card data and the callbacks its page binds. */
export interface KessenMatchViewProps {
  /** A match against an NPC (or a lesson), or the viewer's seat at a duel. */
  payload: KessenTablePayload;
  /** The confirmed play log; at a duel it plays back the opponent's turns. */
  log?: KessenMatchLog | null;
  /** Card display data: the catalog entries (list, record or map by card id). */
  catalog: KessenMatchCatalog;
  /** Sends one decision; resolves with the confirmed payload and its events. */
  onAction: (action: KessenAction) => Promise<KessenTableOutcome>;
  onConcede: () => Promise<KessenTableOutcome> | undefined;
  /** Leaves the table; an active match stays open. */
  onClose: () => void;
  /** Rematch, or at a duel "Challenge again" / "Queue again". */
  onRematch?: () => void;
  rematchLabel?: string;
  /** A match start (a rematch or a lesson) is in flight; its button waits for it. */
  isStarting?: boolean;
  /** Why the last start failed, shown next to its button. */
  startError?: string | null;
  onEditDeck?: () => void;
  /** Claims a pending first-win pick (`result.firstWin.choice`). */
  onClaimChoice?: (itemId: string) => Promise<KessenTableOutcome>;
  /** Starts an Academy lesson; `replaceActive` concedes this one first ("Try again"). */
  onStartLesson?: (lessonKey: KessenAcademyLessonKey, replaceActive: boolean) => void;
  /** A guest's match: shown on the end screen in place of rewards. */
  guestNote?: React.ReactNode;
  /** Watches a duel without a seat: nothing can be played, and both hands stay hidden. */
  spectating?: boolean;
}
