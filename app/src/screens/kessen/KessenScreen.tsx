"use client";

import "@/layout/kessen/kessen.css";
import "@/layout/kessen/hub/hub.css";
import "@/screens/kessen/hall.css";
import {
  BookOpen,
  Gift,
  GraduationCap,
  Layers,
  type LucideIcon,
  Package,
  Play,
  Swords,
  UserPlus,
  Users,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KESSEN_CARD_SELL_VALUES } from "@/drizzle/constants";
import { useKessenCollection } from "@/hooks/kessen/useKessenCollection";
import { useKessenDuel } from "@/hooks/kessen/useKessenDuel";
import {
  type KessenDeckSource,
  useKessenHub,
  useStartKessenMatch,
} from "@/hooks/kessen/useKessenHub";
import { useKessenMatch } from "@/hooks/kessen/useKessenMatch";
import {
  useKessenPvpLobby,
  useRankedQueuePolling,
} from "@/hooks/kessen/useKessenPvpLobby";
import { useNavigationRouter } from "@/hooks/navigation";
import { EmptyState } from "@/layout/EmptyState";
import { FeedbackAlert } from "@/layout/FeedbackAlert";
import { KessenQuestChallenge } from "@/layout/KessenQuestChallenge";
import { CardInspectDialog } from "@/layout/kessen/CardInspectDialog";
import { AcademyPanel } from "@/layout/kessen/hub/AcademyPanel";
import { CircuitMap } from "@/layout/kessen/hub/CircuitMap";
import { CollectionBook } from "@/layout/kessen/hub/CollectionBook";
import { DeckBuilder, type KessenDeckSaveInput } from "@/layout/kessen/hub/DeckBuilder";
import { DuelsPanel } from "@/layout/kessen/hub/DuelsPanel";
import { HallBox, type HallScene } from "@/layout/kessen/hub/HallBox";
import { HallHeader } from "@/layout/kessen/hub/HallHeader";
import {
  activeMatchStateText,
  catalogLookup,
  copyLimitOf,
  defaultDeck,
  type KessenDeckSummary,
  type KessenFindContext,
  kessenItemName,
  summarizeDeck,
  whereToFind,
} from "@/layout/kessen/hub/hubData";
import { type KessenStartRequest, NpcSheet } from "@/layout/kessen/hub/NpcSheet";
import { PackOpening } from "@/layout/kessen/hub/PackOpening";
import { PacksPanel } from "@/layout/kessen/hub/PacksPanel";
import { StarterChoice } from "@/layout/kessen/hub/StarterChoice";
import { useKessenMotion } from "@/layout/kessen/useKessenMotion";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import NavTabs from "@/layout/NavTabs";
import { QueryError } from "@/layout/QueryError";
import { QUEST_LOGBOOK_HREF } from "@/layout/QuestChallenge";
import Shop from "@/layout/Shop";
import {
  KESSEN_ACADEMY,
  KESSEN_ACADEMY_FIRST_LESSON,
  type KessenAcademyLessonKey,
} from "@/libs/kessen/academy";
import { other } from "@/libs/kessen/board";
import type { DeckFaction } from "@/libs/kessen/deck";
import type { KessenNpcKey } from "@/libs/kessen/npcs";
import { KESSEN_PACK_IDS } from "@/libs/kessen/packs";
import { findQuestChallenge } from "@/libs/quest/challenge";
import { showMutationToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import { formatTrpcErrorMessage } from "@/utils/error";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/utils/storage";
import { getUtcDayKey } from "@/utils/time";
import { useUserData, useUserDataSelector } from "@/utils/UserContext";
import type {
  KessenCatalogEntry,
  KessenDeckRow,
  KessenHub,
  KessenMatchPayload,
} from "@/validators/kessen";
import type { CardPackReveal } from "@/validators/weightedCache";

/**
 * The Card Hall: Lemu's first lesson for a first visit, the starter choice and its First
 * Bundle, then the Academy and the Circuit, duels against other players, the deck
 * builder, collection book and packs with the Card Master stall. The match table and the
 * pack ceremony take the hall's place inside its content box while they are open. An
 * unfinished match or duel reopens on arrival, and a duel that begins (an accepted
 * challenge, a ranked match) opens its table; `?tab=packs` (or `play`, `duels`, `decks`,
 * `collection`) opens that section, also when the table closes over it. Visitors
 * without an account get the guest hall (`KessenGuestHall`) instead.
 */
export function KessenScreen() {
  const { isClerkLoaded, isSignedIn } = useUserDataSelector(selectPlayer);
  // Visitors who look signed out get the guest hall at once, which also puts it in the
  // prerendered page; its tables wait until sign-in is confirmed, so a signed-in player
  // never starts a guest match. A signed-in player waits for the profile in the hall.
  if (!isSignedIn) return <KessenGuestHall ready={isClerkLoaded} />;
  // Search params need a Suspense boundary on a prerendered page; the hall then renders
  // in the browser only, so its remembered section never differs between the two sides.
  return (
    <Suspense fallback={<Loader explanation="Opening the Card Hall" />}>
      <KessenHall />
    </Suspense>
  );
}

// The table, its playback and its stylesheet load only when a match opens.
const KessenMatchView = dynamic(
  () => import("@/layout/kessen/match/MatchView").then((mod) => mod.KessenMatchView),
  { ssr: false, loading: () => <Loader explanation="Setting the table" /> },
);

// The guest hall and the in-browser NPC it plays stay out of a player's bundle; it still
// renders on the server, so the prerendered page holds it.
const KessenGuestHall = dynamic(() =>
  import("@/layout/kessen/hub/GuestHall").then((mod) => mod.KessenGuestHall),
);

function KessenHall() {
  const {
    data: player,
    isClerkLoaded,
    status: profileStatus,
    refreshUser,
  } = useUserDataSelector(selectPlayer);
  const userId = player?.userId;
  const { hub: hubQuery, catalog: catalogQuery } = useKessenHub(!!userId);
  const hub = hubQuery.data;
  const catalog = catalogQuery.data;
  const utils = api.useUtils();
  const collection = useKessenCollection();
  const { start, startLesson, isStarting } = useStartKessenMatch();
  const pvp = useKessenPvpLobby(!!userId);
  const lobby = pvp.lobby.data;
  const motion = useKessenMotion();

  const router = useNavigationRouter();
  const searchParams = useSearchParams();
  const linkedTab = tabOfParam(searchParams.get("tab"));
  // A quest's Duel at the Table opens from the logbook as `?quest=&objective=`.
  const challengeQuest = searchParams.get("quest");
  const challengeObjective = searchParams.get("objective");
  const challengeRequest =
    challengeQuest && challengeObjective
      ? { questId: challengeQuest, objectiveId: challengeObjective }
      : null;
  const { data: questUser } = useUserDataSelector(selectChallengeUser);
  const [tab, setTab] = useState<KessenTab>(() => linkedTab ?? storedTab());
  // A section link that arrives while the hall is open switches to its section.
  const [appliedLink, setAppliedLink] = useState(linkedTab);
  if (linkedTab !== appliedLink) {
    setAppliedLink(linkedTab);
    if (linkedTab) setTab(linkedTab);
  }
  // `undefined` until the hub first loads; its active match then opens and stays open
  // after it ends, so the result screen shows.
  const [chosenMatchId, setChosenMatchId] = useState<string | null | undefined>();
  const [selectedNpc, setSelectedNpc] = useState<KessenNpcKey | null>(null);
  const [lastStart, setLastStart] = useState<KessenStartRequest | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  // The lesson being started, so its own button shows the progress and the refusal.
  const [startingLesson, setStartingLesson] = useState<KessenAcademyLessonKey | null>(
    null,
  );
  const [starterError, setStarterError] = useState<string | null>(null);
  const [deckError, setDeckError] = useState<string | null>(null);
  const [deckFocus, setDeckFocus] = useState<string | null>(null);
  const [packError, setPackError] = useState<string | null>(null);
  const [openingUserItemId, setOpeningUserItemId] = useState<string | null>(null);
  const [opened, setOpened] = useState<OpenedPack | null>(null);
  const [inspected, setInspected] = useState<KessenCatalogEntry | null>(null);
  // The deck named when the Decks tab was opened from the hall, until the builder is used.
  const [openedDeck, setOpenedDeck] = useState<string | null>(null);
  // Set when the table closes, so the hall's first action takes the keyboard focus.
  const [leftTable, setLeftTable] = useState(false);

  if (chosenMatchId === undefined && hub) setChosenMatchId(hub.activeMatch?.id ?? null);
  const matchId =
    chosenMatchId === undefined ? (hub?.activeMatch?.id ?? null) : chosenMatchId;
  const match = useKessenMatch(matchId);
  // The duel at the table. A duel in progress opens on arrival and whenever a new one
  // begins (the lobby names it); once it ends its table stays open on the result.
  const [duelId, setDuelId] = useState<string | null>(null);
  const [seenDuelId, setSeenDuelId] = useState<string | null | undefined>();
  const activeDuelId = lobby?.activeMatch?.id ?? null;
  if (lobby && activeDuelId !== seenDuelId) {
    setSeenDuelId(activeDuelId);
    if (activeDuelId) setDuelId(activeDuelId);
  }
  const duel = useKessenDuel(duelId);
  const [duelError, setDuelError] = useState<string | null>(null);
  const queuePolling = useRankedQueuePolling(lobby, (found) => setDuelId(found));

  if (!isClerkLoaded) return <Loader explanation="Loading user data" />;
  if (!userId) {
    // A signed-in player whose profile did not load gets the reason and a retry; the
    // profile query does not retry on its own, so its error state is stable.
    if (profileStatus === "pending") return <Loader explanation="Loading user data" />;
    if (profileStatus !== "error") return <NoCharacter />;
    return (
      <HallError
        message="Your character could not be loaded. Try again in a moment."
        onRetry={() => void refreshUser()}
      />
    );
  }
  // Only a hall that never loaded shows the error: a failed background refetch keeps
  // the data in hand (and an open table) on screen.
  if ((!hub && hubQuery.isError) || (!catalog && catalogQuery.isError)) {
    return (
      <HallError
        message={`The Card Hall could not be loaded: ${(hubQuery.error ?? catalogQuery.error)?.message ?? "unknown error"}`}
        onRetry={() => void Promise.all([hubQuery.refetch(), catalogQuery.refetch()])}
      />
    );
  }
  if (!hub || !catalog) return <Loader explanation="Opening the Card Hall" />;

  const lookup = catalogLookup(catalog.cards);
  const summaries = hub.decks.map((deck) => summarizeDeck(deck, lookup, hub.owned));
  const playDeck = defaultDeck(summaries);
  const findContext: KessenFindContext = { packs: catalog.packs, circuit: hub.circuit };
  // The hub counts free copies only; listed ones still belong to the collection.
  const listed = hub.listed;
  const npcName = (key: KessenNpcKey) =>
    hub.circuit.find((entry) => entry.key === key)?.name ?? key;
  const ownedPacks = hub.packs;
  const selectedEntry = hub.circuit.find((entry) => entry.key === selectedNpc) ?? null;
  const packCount = ownedPacks.reduce((sum, pack) => sum + pack.quantity, 0);
  const incomingChallenges =
    lobby?.challenges.filter((challenge) => !challenge.outgoing).length ?? 0;

  const selectTab = (option: KessenTab) => {
    safeLocalStorageSetItem(TAB_STORAGE_KEY, option);
    // The section link has done its job; a reload reopens the section chosen last.
    if (linkedTab) router.replace("/kessen", { scroll: false });
    setTab(option);
    setOpenedDeck(null);
    // A plain visit to Decks reopens the edits in progress, not the deck opened last.
    setDeckFocus(null);
    setLeftTable(false);
  };

  /** Opens the Decks tab on a saved deck and names it where the focus lands. */
  const openDeck = (deck: { id: string; name: string } | null) => {
    selectTab("Decks");
    setDeckFocus(deck?.id ?? null);
    setOpenedDeck(deck?.name ?? null);
  };

  const openMatch = (id: string | null) => {
    setChosenMatchId(id);
    setSelectedNpc(null);
    if (id) setLeftTable(false);
  };

  /**
   * Back to the Circuit, whose banner holds the way back to the table: the active match
   * and every first-win pick still open (`hub.pendingPicks`). A section link that opened
   * the hall over its unfinished match leads to that section instead.
   */
  const closeTable = () => {
    openMatch(null);
    selectTab(linkedTab ?? "Play");
    setLeftTable(true);
  };

  const startMatch = async (request: KessenStartRequest) => {
    setStartError(null);
    setStartingLesson(null);
    const outcome = await start(request);
    if (!outcome.ok || !outcome.match) {
      setStartError(outcome.message);
      return false;
    }
    setLastStart(request);
    openMatch(outcome.match.id);
    return true;
  };

  /**
   * Opens an Academy lesson at Lemu's table; `replaceActive` concedes the unfinished
   * match first ("Try again" restarts the lesson this way). An unfinished lesson gives
   * way on its own, a Circuit match only when asked. A refusal stays next to the button
   * that asked.
   */
  const startLessonMatch = async (
    lessonKey: KessenAcademyLessonKey,
    replaceActive = false,
  ) => {
    if (isStarting) return;
    setStartError(null);
    setStartingLesson(lessonKey);
    const outcome = await startLesson({
      lessonKey,
      ...(replaceActive || hub.activeMatch?.mode === "lesson"
        ? { replaceActive: true }
        : {}),
    });
    if (!outcome.ok || !outcome.match) {
      setStartError(outcome.message);
      return;
    }
    setStartingLesson(null);
    openMatch(outcome.match.id);
  };

  const openDuel = (id: string) => {
    setDuelError(null);
    setDuelId(id);
    setSelectedNpc(null);
    setLeftTable(false);
  };

  const closeDuel = () => {
    setDuelId(null);
    setDuelError(null);
    selectTab(linkedTab ?? "Duels");
    setLeftTable(true);
  };

  /**
   * Opens one pack of a stack and shows its reveal; failures stay next to the button.
   * Resolves whether the reveal opened.
   */
  const openPack = async (userItemId: string, itemId: string) => {
    setPackError(null);
    setOpeningUserItemId(userItemId);
    const data = await collection
      .openPack(userItemId)
      .catch((error: unknown) => failure(error, "The pack could not be opened."));
    setOpeningUserItemId(null);
    const reveal = data.success && "reveal" in data ? data.reveal : undefined;
    if (reveal) setOpened({ reveal, itemId });
    else if (!data.success) setPackError(data.message);
    return reveal !== undefined;
  };

  const chooseStarter = async (faction: DeckFaction) => {
    setStarterError(null);
    const data = await collection
      .chooseStarter({ faction })
      .catch((error: unknown) =>
        failure(error, "The starter deck could not be granted."),
      );
    if (!data.success) {
      setStarterError(data.message);
      return;
    }
    selectTab("Play");
    setSelectedNpc(LESSON_NPC);
    // The First Bundle opens at once and its ceremony confirms the grant; the hub read
    // that confirmed the starter names its new stack. Without the ceremony a toast
    // confirms it instead.
    const bundle = utils.kessen.getHub
      .getData()
      ?.packs.find((pack) => pack.itemId === KESSEN_PACK_IDS.first);
    const revealed = bundle ? await openPack(bundle.userItemId, bundle.itemId) : false;
    if (!revealed)
      showMutationToast({
        success: true,
        message: `${data.message} Open it from the Packs tab.`,
      });
  };

  // Deck saves and deletes answer inside the builder: a refusal next to its buttons, a
  // success as a toast.
  const saveDeck = async (input: KessenDeckSaveInput) => {
    setDeckError(null);
    const data = await collection.saveDeck(input);
    if (!data.success) {
      setDeckError(data.message);
      return { ok: false };
    }
    showMutationToast({ success: true, message: data.message });
    return { ok: true, deckId: data.deck.id };
  };

  /** Resolves true once the deck is gone, so the builder can leave it. */
  const deleteDeck = async (deckId: string) => {
    setDeckError(null);
    const data = await collection
      .deleteDeck({ id: deckId })
      .catch((error: unknown) => failure(error, "The deck could not be deleted."));
    if (data.success) showMutationToast({ success: true, message: data.message });
    else setDeckError(data.message);
    return data.success;
  };

  const setAutoSell = (enabled: boolean) => {
    collection.setAutoSell({ enabled }).catch((error: unknown) =>
      showMutationToast({
        success: false,
        message: errorMessage(error, "The setting could not be saved."),
      }),
    );
  };

  const payload = match.match;

  const editDeck = () => {
    openMatch(null);
    openDeck(playDeck);
  };
  // The failure shows next to Rematch on the end screen; the pending start disables it.
  // A lesson leads on with its own buttons (Next lesson, Try again).
  const playedChallenge = payload?.challenge ?? null;
  const challengeWon = !!playedChallenge && payload?.result?.winner === 0;
  const rematch =
    payload && payload.mode !== "lesson"
      ? () => {
          if (challengeWon) return router.push(QUEST_LOGBOOK_HREF);
          if (isStarting) return;
          void startMatch(
            playedChallenge
              ? {
                  npcKey: payload.npcKey,
                  mode: "standard",
                  deck: lastStart?.challenge
                    ? lastStart.deck
                    : deckSourceOf(playDeck, hub),
                  challenge: playedChallenge,
                }
              : rematchRequest(payload, lastStart, playDeck, hub),
          );
        }
      : undefined;

  // After a duel: a friendly one challenges the same player again, a ranked one queues
  // again, both with the deck the hall plays with.
  const duelPayload = duel.match;
  const duelDeck = deckSourceOf(playDeck, hub);
  const duelOpponent = duelPayload
    ? duelPayload.players[other(duelPayload.seat)]
    : null;
  const duelRematch =
    duelPayload && duelOpponent
      ? async () => {
          setDuelError(null);
          if (duelPayload.kind === "FRIENDLY") {
            const outcome = await pvp.createChallenge({
              targetId: duelOpponent.userId,
              deck: duelDeck,
            });
            if (!outcome.ok) return setDuelError(outcome.message);
            showMutationToast({ success: true, message: outcome.message });
            closeDuel();
            return;
          }
          const outcome = await pvp.joinRankedQueue(duelDeck);
          if (!outcome.ok) return setDuelError(outcome.message);
          if (outcome.matchId) return openDuel(outcome.matchId);
          closeDuel();
        }
      : undefined;

  const table =
    duelId && duelPayload ? (
      <KessenMatchView
        key={duelPayload.id}
        payload={duelPayload}
        log={duel.log}
        catalog={catalog.cards}
        onAction={duel.play}
        onConcede={duel.concede}
        onClose={closeDuel}
        onRematch={duelRematch ? () => void duelRematch() : undefined}
        rematchLabel={
          duelPayload.kind === "FRIENDLY"
            ? `Challenge ${duelOpponent?.username ?? "them"} again`
            : "Queue again"
        }
        isStarting={pvp.isChallenging || pvp.isJoining}
        startError={duelError}
      />
    ) : duelId && duel.isPending ? (
      <Loader explanation="Loading your duel" />
    ) : duelId ? (
      <MatchUnavailable
        message={
          duel.error?.message ??
          "This duel could not be found. It may have ended in another window."
        }
        retrying={duel.isFetching}
        onRetry={() => void duel.refetch()}
        onBack={() => {
          setDuelId(null);
          void utils.kessenPvp.getLobby.invalidate();
        }}
      />
    ) : matchId && payload ? (
      <KessenMatchView
        key={payload.id}
        payload={payload}
        catalog={catalog.cards}
        onAction={match.play}
        onConcede={match.concede}
        onClose={closeTable}
        onRematch={rematch}
        rematchLabel={
          playedChallenge ? (challengeWon ? "Open logbook" : "Try again") : undefined
        }
        isStarting={isStarting}
        startError={startError}
        onEditDeck={payload.mode === "lesson" || playedChallenge ? undefined : editDeck}
        onClaimChoice={match.claimChoice}
        onStartLesson={(lessonKey, replaceActive) =>
          void startLessonMatch(lessonKey, replaceActive)
        }
      />
    ) : matchId && match.isPending ? (
      <Loader explanation="Loading your match" />
    ) : matchId ? (
      <MatchUnavailable
        message={
          match.error?.message ??
          "This match could not be found. It may have ended in another window."
        }
        retrying={match.isFetching}
        onRetry={() => void match.refetch()}
        onBack={() => {
          openMatch(null);
          void utils.kessen.getHub.invalidate();
        }}
      />
    ) : null;

  const reopenAnother = opened
    ? ownedPacks.find((pack) => pack.itemId === opened.reveal.packItemId)
    : undefined;
  const packCeremony = (
    <PackOpening
      layout="inline"
      open={opened !== null}
      reveal={opened?.reveal ?? null}
      cards={catalog.cards}
      packName={
        opened ? kessenItemName(opened.itemId, lookup, catalog.packs) : undefined
      }
      packImage={catalog.packs.find((pack) => pack.id === opened?.itemId)?.image}
      motion={motion}
      onClose={() => setOpened(null)}
      onOpenAnother={
        reopenAnother && !openingUserItemId
          ? () => void openPack(reopenAnother.userItemId, reopenAnother.itemId)
          : undefined
      }
    />
  );

  const lessonTitle = (key: KessenAcademyLessonKey | null) =>
    KESSEN_ACADEMY.find((lesson) => lesson.key === key)?.title ?? "your lesson";
  // The table or the pack ceremony takes the hall's place in the content box, whose
  // title then leads back to the hall.
  const scene: HallScene | null = opened
    ? {
        content: packCeremony,
        label: kessenItemName(opened.itemId, lookup, catalog.packs),
        onLeave: () => setOpened(null),
      }
    : table
      ? {
          content: table,
          label: duelId
            ? `Duel against ${duelOpponent?.username ?? "another player"}`
            : payload?.mode === "lesson"
              ? `Lesson: ${lessonTitle(payload.lesson ?? null)}`
              : payload
                ? `Match against ${npcName(payload.npcKey)}`
                : "Your match",
          onLeave: duelId ? closeDuel : closeTable,
        }
      : null;

  // The unfinished NPC match as a sentence's subject, for the notices that block a start.
  const npcMatchSubject = hub.activeMatch
    ? hub.activeMatch.lesson
      ? `Your lesson "${lessonTitle(hub.activeMatch.lesson)}"`
      : `Your match against ${npcName(hub.activeMatch.npcKey)}`
    : null;
  // Banner buttons back to the table: first-win picks left open, then the active match.
  const lobbyDuel = lobby?.activeMatch ?? null;
  const hallActions: HallActionEntry[] =
    matchId || duelId
      ? []
      : [
          ...(lobbyDuel
            ? [
                {
                  key: "duel",
                  kind: "resume",
                  matchId: lobbyDuel.id,
                  duel: true,
                  label: `Resume your duel vs ${lobbyDuel.opponent.username}`,
                  detail: lobbyDuel.yourTurn ? "Your turn" : "Their turn",
                  unfinished: `Your duel against ${lobbyDuel.opponent.username}`,
                } satisfies HallActionEntry,
              ]
            : []),
          ...hub.pendingPicks
            .filter((pick) => pick.matchId !== hub.activeMatch?.id)
            .map(
              (pick): HallActionEntry => ({
                key: `pick-${pick.matchId}`,
                kind: "pick",
                matchId: pick.matchId,
                label: `Choose your reward from ${npcName(pick.npcKey)}`,
              }),
            ),
          ...(hub.activeMatch
            ? [
                {
                  key: "resume",
                  kind: "resume",
                  matchId: hub.activeMatch.id,
                  label: hub.activeMatch.lesson
                    ? `Resume lesson: ${lessonTitle(hub.activeMatch.lesson)}`
                    : `Resume vs ${npcName(hub.activeMatch.npcKey)}`,
                  detail: activeMatchStateText(hub.activeMatch),
                  unfinished: npcMatchSubject ?? undefined,
                } satisfies HallActionEntry,
              ]
            : []),
        ];

  // The lesson and the starter choice show no tabs, counters or deck to manage yet.
  const onboarding = hub.needsLesson || hub.needsStarter;
  // A graduate's Academy folds to one row below the Circuit; until then it leads the tab.
  const academyPanel = (
    <AcademyPanel
      academy={hub.academy}
      pending={isStarting}
      startingKey={startingLesson}
      error={startingLesson ? startError : null}
      onStart={(lessonKey) => void startLessonMatch(lessonKey)}
    />
  );
  const openHallAction = (action: HallActionEntry) =>
    action.duel ? openDuel(action.matchId) : openMatch(action.matchId);
  const header = (
    <HallHeader
      today={onboarding ? null : hub.today}
      week={onboarding ? null : hub.week}
      deck={onboarding ? null : playDeck}
      onDeckClick={onboarding ? undefined : () => openDeck(playDeck)}
      actions={hallActions.map((action, index) => (
        <HallAction
          key={action.key}
          focusOnMount={leftTable && index === 0}
          onFocused={() => setLeftTable(false)}
          onClick={() => openHallAction(action)}
        >
          <span className="kh-hall-action-icon" aria-hidden>
            {action.kind === "pick" ? (
              <Gift />
            ) : (
              <Play className="kh-hall-action-play" />
            )}
          </span>
          <span className="kh-hall-action-text">
            <span className="kh-hall-action-label">{action.label}</span>
            {action.detail ? (
              <span className="kh-hall-action-detail">{action.detail}</span>
            ) : null}
          </span>
        </HallAction>
      ))}
    />
  );

  // A quest's Duel at the Table: its briefing takes the hall's place until a table opens.
  // An unfinished duel or match blocks a new start, so the briefing leads back to its
  // table; the duel comes first, as in the server's start guard. The match may be this
  // very duel, left for the hall.
  if (challengeRequest && !scene) {
    const found = questUser
      ? findQuestChallenge(questUser, challengeRequest, "win_kessen_challenge")
      : null;
    const resume = hallActions.find((action) => action.kind === "resume");
    const activeChallenge = hub.activeMatch?.challenge;
    const resumesThisDuel =
      !resume?.duel &&
      activeChallenge?.questId === challengeRequest.questId &&
      activeChallenge.objectiveId === challengeRequest.objectiveId;
    return (
      <HallBox subtitle="Duel at the Table" backHref={QUEST_LOGBOOK_HREF}>
        <KessenQuestChallenge
          challenge={found}
          opponent={hub.circuit.find((entry) => entry.key === found?.objective.npcKey)}
          decks={summaries}
          defaultDeckId={playDeck?.id}
          loanerFaction={hub.loanerFaction}
          isStarting={isStarting}
          error={startError}
          resume={
            resume?.unfinished
              ? {
                  label: resume.label,
                  unfinished: resume.unfinished,
                  isThisDuel: resumesThisDuel,
                  isPlayerDuel: resume.duel === true,
                  onOpen: () => openHallAction(resume),
                }
              : undefined
          }
          onStart={(deck, replaceActive) => {
            if (!found || isStarting) return;
            void startMatch({
              npcKey: found.objective.npcKey,
              mode: "standard",
              deck,
              challenge: challengeRequest,
              ...(replaceActive ? { replaceActive: true } : {}),
            });
          }}
        />
      </HallBox>
    );
  }

  // First visit: one button, Lemu's first lesson.
  const firstLesson = hub.academy.lessons[0] ?? null;
  if (hub.needsLesson) {
    return (
      <HallBox scene={scene} subtitle="Lemu's first lesson">
        <div className="flex flex-col gap-5">
          {header}
          <section
            className="bg-card flex flex-col gap-3 rounded-xl border p-3"
            aria-labelledby="kessen-lesson-title"
          >
            <p className="text-muted-foreground text-sm font-semibold">
              First visit · Lemu's Academy, lesson 1 of {hub.academy.total}
            </p>
            <h2 id="kessen-lesson-title" className="text-xl leading-tight font-black">
              {firstLesson?.title ?? "First Blood"}
            </h2>
            <p className="text-muted-foreground max-w-[560px]">
              A two-minute lesson with a fixed hand: rows, rounds and passing, and why
              giving up a round can win the match. It opens your starter deck and the
              Circuit; five more lessons teach the rest of the strategy.
            </p>
            <Button
              size="lg"
              className="self-start bg-amber-500 text-lg font-bold text-black hover:bg-amber-400"
              loading={isStarting}
              onClick={() => void startLessonMatch(KESSEN_ACADEMY_FIRST_LESSON)}
            >
              <GraduationCap className="mr-2 h-5 w-5" aria-hidden />
              {isStarting ? "Setting the table…" : "Start the first lesson"}
            </Button>
            {startError ? (
              <FeedbackAlert
                feedback={{ success: false, message: startError }}
                foreground
              />
            ) : null}
          </section>
        </div>
      </HallBox>
    );
  }

  // After the lesson: the starter faction, then the First Bundle opens.
  if (hub.needsStarter) {
    return (
      <HallBox scene={scene} subtitle="Choose your starter faction">
        <div className="flex flex-col gap-5">
          {header}
          <StarterChoice
            homeFaction={hub.homeFaction}
            cards={catalog.cards}
            onChoose={(faction) => void chooseStarter(faction)}
            pending={collection.isChoosingStarter || openingUserItemId !== null}
            error={starterError}
          />
        </div>
      </HallBox>
    );
  }

  // The opened deck is named above the builder, whose deck tabs can sit out of view; any
  // use of the builder retires the note, whose name could go stale.
  const deckBuilder = (
    <div
      className="flex flex-col gap-2"
      onPointerDownCapture={() => setOpenedDeck(null)}
      onKeyDownCapture={(event) => {
        if (event.key !== "Tab" && event.key !== "Shift") setOpenedDeck(null);
      }}
    >
      {openedDeck ? <OpenedDeckNote name={openedDeck} /> : null}
      <DeckBuilder
        key={deckFocus ?? "new"}
        cards={catalog.cards}
        owned={hub.owned}
        listed={listed}
        decks={hub.decks}
        userId={userId}
        dayKey={getUtcDayKey()}
        defaultFaction={hub.homeFaction ?? hub.loanerFaction}
        initialDeckId={deckFocus}
        findContext={findContext}
        onSave={saveDeck}
        onDelete={deleteDeck}
        pending={collection.isSavingDeck || collection.isDeletingDeck}
        error={deckError}
      />
    </div>
  );

  return (
    <HallBox
      scene={scene}
      subtitle={TAB_SUBTITLES[tab]}
      tabs={
        <HallTabs
          current={tab}
          onSelect={selectTab}
          packCount={packCount}
          duelCount={incomingChallenges}
          focusCurrent={leftTable && tab !== "Play"}
          onFocused={() => setLeftTable(false)}
        />
      }
    >
      <div className="flex flex-col gap-5">
        {tab === "Play" ? (
          <>
            {header}
            {hub.academy.graduated ? null : academyPanel}
            <CircuitMap
              circuit={hub.circuit}
              cards={catalog.cards}
              packs={catalog.packs}
              selectedKey={selectedNpc}
              activeMatch={hub.activeMatch}
              pendingPicks={hub.pendingPicks}
              onSelect={(key) => {
                setStartError(null);
                setSelectedNpc(key);
              }}
            />
            <NpcSheet
              // The sheet waits behind a scene, such as the First Bundle that opens
              // after the starter choice.
              open={selectedEntry !== null && scene === null}
              onOpenChange={(open) => !open && setSelectedNpc(null)}
              entry={selectedEntry}
              cards={catalog.cards}
              packs={catalog.packs}
              decks={summaries}
              defaultDeckId={playDeck?.id ?? null}
              circuit={hub.circuit}
              loanerFaction={hub.loanerFaction}
              needsLesson={hub.needsLesson}
              seenKeywords={hub.progress.seenKeywords}
              activeMatch={hub.activeMatch}
              pendingPicks={hub.pendingPicks}
              pending={isStarting}
              error={startError}
              onStart={(request) => void startMatch(request)}
              onStartLesson={(lessonKey, replaceActive) =>
                void startLessonMatch(lessonKey, replaceActive)
              }
              onResume={(id) => openMatch(id)}
            />
            {hub.academy.graduated ? academyPanel : null}
          </>
        ) : null}
        {tab === "Duels" ? (
          <DuelsPanel
            decks={summaries}
            defaultDeckId={playDeck?.id ?? null}
            loanerFaction={hub.loanerFaction}
            npcMatch={
              hub.activeMatch && npcMatchSubject
                ? { id: hub.activeMatch.id, label: npcMatchSubject }
                : null
            }
            queueMessage={queuePolling.message}
            onOpenDuel={openDuel}
            onResumeNpc={(id) => openMatch(id)}
          />
        ) : null}
        {tab === "Decks" ? deckBuilder : null}
        {tab === "Collection" ? (
          <CollectionBook
            cards={catalog.cards}
            owned={hub.owned}
            listed={listed}
            seenKeywords={hub.progress.seenKeywords}
            findContext={findContext}
            initialFaction={hub.progress.starterFaction ?? hub.homeFaction}
            onInspect={setInspected}
            viewerId={userId}
          />
        ) : null}
        {tab === "Packs" ? (
          <PacksPanel
            packs={ownedPacks}
            catalogPacks={catalog.packs}
            pity={hub.pity}
            autoSellSurplus={hub.autoSellSurplus}
            onAutoSellChange={setAutoSell}
            onOpen={(userItemId) => {
              const pack = ownedPacks.find((entry) => entry.userItemId === userItemId);
              if (pack) void openPack(pack.userItemId, pack.itemId);
            }}
            openingUserItemId={openingUserItemId}
            error={packError}
            stall={<CardMasterStall />}
          />
        ) : null}
      </div>
      <InspectDialog
        card={inspected}
        owned={hub.owned}
        listed={listed}
        decks={hub.decks}
        findContext={findContext}
        onClose={() => setInspected(null)}
        onOpenDeck={(deck) => {
          setInspected(null);
          openDeck(deck);
        }}
      />
    </HallBox>
  );
}

/** A hall that could not load: the reason and a retry. */
const HallError = ({ message, onRetry }: { message: string; onRetry: () => void }) => (
  <HallBox>
    <section
      className="flex flex-col items-center gap-2 py-6 text-center"
      aria-labelledby="kessen-hall-error"
    >
      <h2 id="kessen-hall-error" className="font-bold text-lg">
        The Card Hall is closed for a moment
      </h2>
      <QueryError
        layout="stacked"
        message={message}
        onRetry={onRetry}
        className="flex flex-col items-center gap-3"
        messageClassName="text-muted-foreground"
      />
    </section>
  </HallBox>
);

/** A match that could not be loaded: the reason, a retry and the way back to the hall. */
const MatchUnavailable = ({
  message,
  retrying,
  onRetry,
  onBack,
}: {
  message: string;
  retrying: boolean;
  onRetry: () => void;
  onBack: () => void;
}) => (
  <section className="flex flex-col gap-2 p-3" aria-labelledby="kessen-match-missing">
    <h2 id="kessen-match-missing" className="text-lg font-bold">
      Your match did not load
    </h2>
    <QueryError
      layout="panel"
      message={message}
      onRetry={onRetry}
      isRetrying={retrying}
    />
    <Button variant="outline" className="self-start" onClick={onBack}>
      Back to the Card Hall
    </Button>
  </section>
);

/** A signed-in account without a character: the cards belong to a character. */
const NoCharacter = () => (
  <HallBox>
    <EmptyState
      icon={Swords}
      title="Sit at the war table"
      description="Kessen keeps your cards, decks and Circuit wins on your character. Create one to take a seat."
      action={
        <Button asChild>
          <Link href="/register">
            <UserPlus className="mr-2 h-4 w-4" aria-hidden />
            Create a character
          </Link>
        </Button>
      }
    />
  </HallBox>
);

/**
 * The Card Master stall: the shared shop restricted to Kessen goods. Shops serve awake
 * players only, so the stall waits while the character is busy elsewhere.
 */
const CardMasterStall = () => {
  const { data: userData } = useUserData();
  if (!userData) return null;
  if (userData.status !== "AWAKE") {
    return (
      <p className="text-muted-foreground text-[13px]">
        The Card Master serves players who are awake. Come back once you are free.
      </p>
    );
  }
  return (
    <Shop
      userData={userData}
      cardStall
      restrictTypes={["CONSUMABLE", "CARD"]}
      defaultType="CONSUMABLE"
      minCost={1}
      title="Card Master"
      subtitle="Packs and single cards; limits reset at 00:00 UTC, weekly ones on Mondays."
      catalog={{
        heroTitle: "Card Master stall",
        heroDescription:
          "Paper and Village Bundles, plus common and rare singles. Epics, legendaries and leaders come from packs and the Circuit.",
        heroBadge: "Kessen goods",
        searchId: "kessen-stall-search",
        listId: false,
      }}
    />
  );
};

/**
 * The hall sections as the game's header tabs: an icon each, the open section's label
 * beside its icon, the challenges waiting counted on Duels and the unopened packs on
 * Packs.
 */
const HallTabs = ({
  current,
  onSelect,
  packCount = 0,
  duelCount = 0,
  focusCurrent = false,
  onFocused,
}: {
  current: KessenTab;
  onSelect: (tab: KessenTab) => void;
  packCount?: number;
  /** Challenges waiting for the player's answer. */
  duelCount?: number;
  /** Moves the keyboard focus to the open section's tab, as the table closes. */
  focusCurrent?: boolean;
  onFocused?: () => void;
}) => {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focusCurrent) return;
    ref.current?.querySelector<HTMLElement>('[aria-current="true"]')?.focus();
    onFocused?.();
  }, [focusCurrent, onFocused]);
  return (
    <nav ref={ref} aria-label="Card Hall sections" className="kh-hall-tabs">
      <NavTabs
        current={current}
        options={TABS}
        remember={false}
        icons={TAB_ICONS}
        iconOnlyOptions={TABS}
        labelClassName={(option) => (option === current ? "not-sr-only" : "")}
        counts={{ Packs: packCount, Duels: duelCount }}
        countLabels={{ Packs: "unopened packs", Duels: "challenges waiting" }}
        fontSize="text-base"
        listClassName="flex-nowrap gap-0.5"
        itemClassName={() => "mr-0 shrink-0"}
        className="min-h-[44px] min-w-[44px] px-2"
        onChange={(value) => {
          const next = TABS.find((option) => option === value);
          if (next) onSelect(next);
        }}
      />
    </nav>
  );
};

/**
 * The note that names the deck the Decks tab opened on. It takes the focus, so keyboard
 * and screen-reader players land on the deck's name instead of the page body.
 */
const OpenedDeckNote = ({ name }: { name: string }) => {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    ref.current?.scrollIntoView({ block: "nearest" });
  }, []);
  return (
    <p
      ref={ref}
      tabIndex={-1}
      data-opened-deck
      className="m-0 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
    >
      <Layers className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0">
        Opened <strong>{name}</strong>
      </span>
    </p>
  );
};

/**
 * A banner button back to the table. After the table closes the first one takes the
 * focus, which the table's unmount would otherwise drop to the page body.
 */
const HallAction = ({
  focusOnMount,
  onFocused,
  onClick,
  children,
}: {
  focusOnMount: boolean;
  onFocused: () => void;
  onClick: () => void;
  children: React.ReactNode;
}) => {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!focusOnMount) return;
    ref.current?.focus();
    onFocused();
  }, [focusOnMount, onFocused]);
  return (
    <Button ref={ref} className="kh-hall-action" onClick={onClick}>
      {children}
    </Button>
  );
};

/**
 * A collection card at full size (the shared inspect dialog) with the collection's facts
 * about it: copies held and listed, surplus with its sell value and the saved decks that
 * use it, or, for a missing card, where to find it. Opening a deck from it moves the
 * focus on to the note naming the opened deck.
 */
const InspectDialog = ({
  card,
  owned,
  listed,
  decks,
  findContext,
  onClose,
  onOpenDeck,
}: {
  card: KessenCatalogEntry | null;
  owned: Record<string, number>;
  listed: Record<string, number>;
  decks: readonly KessenDeckRow[];
  findContext: KessenFindContext;
  onClose: () => void;
  onOpenDeck: (deck: KessenDeckRow) => void;
}) => (
  <CardInspectDialog
    card={card}
    onClose={onClose}
    returnFocus={() => document.querySelector<HTMLElement>("[data-opened-deck]")}
  >
    {card ? (
      <InspectStatus
        card={card}
        owned={owned[card.id] ?? 0}
        listed={listed[card.id] ?? 0}
        decks={decks}
        findContext={findContext}
        onOpenDeck={onOpenDeck}
      />
    ) : null}
  </CardInspectDialog>
);

/**
 * The collection's facts under the inspected card: copies held against the deck limit,
 * listed copies, surplus and what it sells for, and the saved decks using it; for a card
 * not held, where to find it.
 */
const InspectStatus = ({
  card,
  owned,
  listed,
  decks,
  findContext,
  onOpenDeck,
}: {
  card: KessenCatalogEntry;
  /** Free copies; listed copies are counted apart. */
  owned: number;
  listed: number;
  decks: readonly KessenDeckRow[];
  findContext: KessenFindContext;
  onOpenDeck: (deck: KessenDeckRow) => void;
}) => {
  if (owned + listed > 0) {
    const limit = card.kind === "LEADER" ? 1 : copyLimitOf(card);
    const surplus = Math.max(0, owned - limit);
    // Leaders and Forbidden variants never sell.
    const sellValue =
      card.kind !== "LEADER" && card.variant !== "FORBIDDEN"
        ? KESSEN_CARD_SELL_VALUES[card.rarity]
        : null;
    const using = decks.filter(
      (deck) =>
        deck.leaderItemId === card.id ||
        deck.cards.some((entry) => entry.itemId === card.id),
    );
    return (
      <section className={STATUS_BOX} aria-label="In your collection">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-[10px] gap-y-[4px]">
          <dt className={STATUS_HEAD}>Held</dt>
          <dd>
            {owned + listed} held · up to {limit} {limit === 1 ? "copy" : "copies"} in a
            deck
          </dd>
          {listed > 0 ? (
            <>
              <dt className={STATUS_HEAD}>Listed</dt>
              <dd>
                {listed} in the auction house, kept out of decks until the listing ends
              </dd>
            </>
          ) : null}
          {surplus > 0 ? (
            <>
              <dt className={STATUS_HEAD}>Surplus</dt>
              <dd>
                +{surplus}
                {sellValue !== null
                  ? ` · sells for ${sellValue.toLocaleString()} ryo each`
                  : ""}
              </dd>
            </>
          ) : null}
          <dt className={STATUS_HEAD}>Decks</dt>
          <dd>
            {using.length === 0 ? (
              "Not in a saved deck"
            ) : (
              <ul className="flex flex-wrap gap-[6px]">
                {using.map((deck) => (
                  <li key={deck.id} className="min-w-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 max-w-full text-[13px] pointer-coarse:min-h-11"
                      aria-label={`Open ${deck.name} in the deck builder`}
                      onClick={() => onOpenDeck(deck)}
                    >
                      <Layers className="mr-1 h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{deck.name}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </dl>
      </section>
    );
  }
  const sources = whereToFind(card, findContext);
  return (
    <section className={STATUS_BOX} aria-label="Not in your collection">
      <p>
        <Badge variant="secondary" className="text-[12px]">
          Not in your collection
        </Badge>
      </p>
      {sources.length > 0 ? (
        <>
          <p className="mt-[6px]">Where to find it:</p>
          <ul className="mt-[2px] list-disc pl-[18px]">
            {sources.map((source) => (
              <li key={source}>{source}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-[6px]">No source is open right now.</p>
      )}
    </section>
  );
};

/** A rematch repeats the last start, or rebuilds it from the match and the deck chip. */
const rematchRequest = (
  payload: KessenMatchPayload,
  lastStart: KessenStartRequest | null,
  playDeck: KessenDeckSummary | null,
  hub: KessenHub,
): KessenStartRequest => {
  if (
    lastStart &&
    lastStart.npcKey === payload.npcKey &&
    lastStart.mode === payload.mode
  )
    return { ...lastStart, replaceActive: undefined };
  return {
    npcKey: payload.npcKey,
    mode: payload.mode === "ascended" ? "ascended" : "standard",
    deck: deckSourceOf(playDeck, hub),
  };
};

/** The hall's deck as a match source: ready, filled with borrowed copies, or the loaner. */
const deckSourceOf = (
  playDeck: KessenDeckSummary | null,
  hub: KessenHub,
): KessenDeckSource =>
  playDeck?.ready
    ? { source: "saved", deckId: playDeck.id }
    : playDeck?.fillable
      ? { source: "fill", deckId: playDeck.id }
      : { source: "loaner", faction: hub.loanerFaction };

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? formatTrpcErrorMessage(error) : fallback;

/** A request that threw, as the failed response the page already handles. */
const failure = (error: unknown, fallback: string) => ({
  success: false as const,
  message: errorMessage(error, fallback),
});

const selectPlayer = (profile: { userId: string }) => ({ userId: profile.userId });

/** What a quest challenge's briefing reads: the player's quests and position. */
const selectChallengeUser = (profile: NonNullable<UserWithRelations>) => ({
  userQuests: profile.userQuests,
  questData: profile.questData,
  sector: profile.sector,
  longitude: profile.longitude,
  latitude: profile.latitude,
});

const TABS = ["Play", "Duels", "Decks", "Collection", "Packs"] as const;

/** The content box subtitle names what each section is for, short enough for a phone. */
const TAB_SUBTITLES: Record<(typeof TABS)[number], string> = {
  Play: "Academy and Circuit",
  Duels: "Friendly and ranked duels",
  Decks: "Build your decks",
  Collection: "Your cards",
  Packs: "Packs and the Card Master",
};

const TAB_STORAGE_KEY = "kessenTab";

const LESSON_NPC: KessenNpcKey = "lemu";

const TAB_ICON_COMPONENTS: Record<KessenTab, LucideIcon> = {
  Play: Swords,
  Duels: Users,
  Decks: Layers,
  Collection: BookOpen,
  Packs: Package,
};

const TAB_ICONS = Object.fromEntries(
  TABS.map((option) => {
    const Icon = TAB_ICON_COMPONENTS[option];
    return [option, <Icon key={option} className="size-4 shrink-0" aria-hidden />];
  }),
);

/** The section a `?tab=` link names (any letter case), or null. */
const tabOfParam = (value: string | null): KessenTab | null =>
  TABS.find((option) => option.toLowerCase() === value?.toLowerCase()) ?? null;

/** The section the player last opened, else Play. */
const storedTab = (): KessenTab => {
  const stored = safeLocalStorageGetItem(TAB_STORAGE_KEY);
  return TABS.find((option) => option === stored) ?? "Play";
};

const STATUS_BOX = "rounded-md border bg-muted/40 p-3 leading-snug";

const STATUS_HEAD = "font-semibold";

type KessenTab = (typeof TABS)[number];

type OpenedPack = { reveal: CardPackReveal; itemId: string };

type HallActionEntry = {
  key: string;
  kind: "pick" | "resume";
  matchId: string;
  /** The match is a duel against another player. */
  duel?: boolean;
  label: string;
  /** Where the match stands, under the label ("Round 2 · 1–0 · your turn"). */
  detail?: string;
  /** A match to resume, as a sentence's subject ("Your duel against Rival"). */
  unfinished?: string;
};
