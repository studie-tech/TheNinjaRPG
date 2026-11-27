"use client";

import "../kessen.css";
import "./hub.css";
import "./circuit.css";
import "./guest.css";
import {
  BookOpen,
  BookText,
  Check,
  GraduationCap,
  Info,
  Layers,
  Lock,
  LogIn,
  type LucideIcon,
  Package,
  Play,
  RotateCcw,
  Swords,
  Trophy,
  UserPlus,
  Users,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useGuestKessenMatch } from "@/hooks/kessen/useGuestKessenMatch";
import { useKessenCatalog } from "@/hooks/kessen/useKessenHub";
import { FeedbackAlert } from "@/layout/FeedbackAlert";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { MiniGameGuestHero } from "@/layout/MiniGameGuestHero";
import { QueryError } from "@/layout/QueryError";
import { GuestGuidedLesson } from "@/layout/TutorialAssistant";
import { KESSEN_ACADEMY, type KessenAcademyLessonKey } from "@/libs/kessen/academy";
import { type DeckFaction, KESSEN_DECK_FACTIONS } from "@/libs/kessen/deck";
import { KESSEN_NPCS, type KessenNpc, type KessenNpcKey } from "@/libs/kessen/npcs";
import { KESSEN_FACTION_NAMES } from "@/libs/kessen/packs";
import { FactionSigil } from "../FactionSigil";
import { KESSEN_IMAGES } from "../kessenArt";
import { NpcPortrait } from "./CircuitMap";
import { HallBox, type HallScene } from "./HallBox";
import { KESSEN_FACTION_INFO, KESSEN_TIER_LABELS, tierPips } from "./hubData";

// The table, its playback and its stylesheet load only when a match opens.
const KessenMatchView = dynamic(
  () => import("@/layout/kessen/match/MatchView").then((mod) => mod.KessenMatchView),
  { ssr: false, loading: () => <Loader explanation="Setting the table" /> },
);

/**
 * The Card Hall for visitors without an account: the shared game introduction, all six Academy lessons with Lemu guiding every move, and practice matches
 * against every Circuit opponent with today's loaner deck of a faction the guest picks.
 * Matches run in the browser (`useGuestKessenMatch`) on the same table, engine and
 * opponents as a player's; nothing is saved or rewarded, and the collection, decks,
 * packs and duels show what an account unlocks. It renders in the prerendered page, so
 * crawlers read the same hall; tables open once `ready` confirms the visitor is signed
 * out and the catalog has loaded.
 */
export const KessenGuestHall = ({ ready }: { ready: boolean }) => {
  const catalogQuery = useKessenCatalog();
  const catalog = catalogQuery.data;
  const guest = useGuestKessenMatch(catalog?.cards);
  const [faction, setFaction] = useState<DeckFaction>(KESSEN_DECK_FACTIONS[0]);
  // Where the last start came from, so its refusal shows next to that button.
  const [startedFrom, setStartedFrom] = useState<"academy" | "practice" | null>(null);
  const canStart = ready && !!catalog;
  const payload = guest.payload;

  const startLesson = (lessonKey: KessenAcademyLessonKey) => {
    setStartedFrom("academy");
    guest.startLesson(lessonKey);
  };
  const startNpc = (npcKey: KessenNpcKey, deckFaction = faction) => {
    setStartedFrom("practice");
    guest.startNpc(npcKey, deckFaction);
  };

  const lessonsWon = guest.lessonsWon;
  const nextLesson =
    KESSEN_ACADEMY.find((lesson) => !lessonsWon.includes(lesson.key)) ??
    KESSEN_ACADEMY[0];
  const tableFaction = payload ? payload.view.seats[0].faction : faction;
  const table =
    payload && catalog ? (
      <KessenMatchView
        key={payload.id}
        payload={payload}
        catalog={catalog.cards}
        onAction={guest.play}
        onConcede={guest.concede}
        onClose={guest.close}
        onRematch={
          payload.mode === "lesson"
            ? undefined
            : () => startNpc(payload.npcKey, asDeckFaction(tableFaction, faction))
        }
        startError={guest.startError}
        onStartLesson={(lessonKey) => startLesson(lessonKey)}
        guestNote={<GuestEndNote />}
      />
    ) : null;
  const scene: HallScene | null =
    table && payload
      ? {
          content: table,
          label:
            payload.mode === "lesson"
              ? `Lesson: ${lessonTitle(payload.lesson)}`
              : `Practice against ${npcName(payload.npcKey)}`,
          onLeave: guest.close,
        }
      : null;

  return (
    <>
      <HallBox
        subtitle="Free to play in your browser"
        scene={scene}
        isGuest
        tabs={
          <Button asChild variant="ghost" size="sm">
            <Link href="/kessen?tab=rules">
              <BookText className="mr-1.5 size-4" aria-hidden />
              Rules
            </Link>
          </Button>
        }
      >
        <MiniGameGuestHero
          id="kessen"
          name="Kessen"
          logo={{ src: KESSEN_IMAGES.logo, width: 480, height: 240 }}
          background={KESSEN_IMAGES.hallHero}
          title="Master the war table"
          description="Three rows, three rounds and the art of passing at the right moment. Learn from Lemu in six short lessons, then take on the Circuit. No account needed."
          stats={[
            { value: `${KESSEN_ACADEMY.length}`, label: "lessons" },
            { value: `${KESSEN_NPCS.length}`, label: "opponents" },
            { value: `${KESSEN_DECK_FACTIONS.length}`, label: "factions" },
          ]}
          benefit={{
            title: "Keep cards and ryo",
            description:
              "Play with a free account to earn cards and ryo, keep your collection and build your own decks. Guest matches are practice only.",
          }}
          disabled={!canStart}
          playLabel={lessonsWon.length > 0 ? "Continue lessons" : undefined}
          onPlay={() => nextLesson && startLesson(nextLesson.key)}
        />
        {/* The failure shows from the first failed attempt, which the retries that
            follow would otherwise hide; until then the disabled starts say why. */}
        {!catalog && (catalogQuery.isError || catalogQuery.failureCount > 0) ? (
          <QueryError
            layout="panel"
            message="The cards could not be laid out."
            onRetry={() => void catalogQuery.refetch()}
            isRetrying={catalogQuery.isFetching}
          />
        ) : !canStart ? (
          <Loader explanation="Laying out the cards" />
        ) : null}
        <div className="kg-columns">
          <GuestAcademy
            lessonsWon={lessonsWon}
            nextKey={nextLesson?.key ?? null}
            disabled={!canStart}
            error={startedFrom === "academy" ? guest.startError : null}
            onStart={startLesson}
          />
          <GuestPractice
            faction={faction}
            onFaction={setFaction}
            disabled={!canStart}
            error={startedFrom === "practice" ? guest.startError : null}
            onStart={(npcKey) => startNpc(npcKey)}
          />
        </div>
        <LockedFeatures />
      </HallBox>
      <GuestGuidedLesson />
    </>
  );
};

/**
 * Lemu's six lessons, all open to a guest, the next one marked and the ones won on this
 * device ticked.
 */
const GuestAcademy = ({
  lessonsWon,
  nextKey,
  disabled,
  error,
  onStart,
}: {
  lessonsWon: readonly KessenAcademyLessonKey[];
  nextKey: KessenAcademyLessonKey | null;
  disabled: boolean;
  error: string | null;
  onStart: (lessonKey: KessenAcademyLessonKey) => void;
}) => (
  <section className="kh-panel kg-section" aria-labelledby="kessen-guest-academy">
    <header className="kg-section-head">
      <GraduationCap className="kg-section-icon" aria-hidden />
      <div className="min-w-0 flex-1">
        <h2 id="kessen-guest-academy" className="kh-heading text-[20px] leading-tight">
          Lemu's Academy
        </h2>
        <p className="kg-section-lead">
          Six short lessons, one idea each. Lemu points at every move.
        </p>
      </div>
      <Badge
        variant="secondary"
        className="shrink-0 text-[12px] tabular-nums"
        title="Lessons won on this device"
      >
        {lessonsWon.length}/{KESSEN_ACADEMY.length}
      </Badge>
    </header>
    <ol className="kg-lessons">
      {KESSEN_ACADEMY.map((lesson) => {
        const won = lessonsWon.includes(lesson.key);
        return (
          <li
            key={lesson.key}
            className="kg-lesson"
            data-next={lesson.key === nextKey ? "" : undefined}
          >
            <span
              className="kg-lesson-number"
              data-won={won ? "" : undefined}
              aria-hidden
            >
              {won ? <Check /> : lesson.order}
            </span>
            <div className="min-w-0 flex-1">
              <p className="kg-lesson-title">
                {lesson.title}
                {won ? <span className="sr-only"> (won)</span> : null}
              </p>
              <p className="kg-lesson-idea">{lesson.idea}</p>
            </div>
            <Button
              size="sm"
              variant={lesson.key === nextKey ? "default" : "outline"}
              className="kg-lesson-start"
              disabled={disabled}
              onClick={() => onStart(lesson.key)}
              aria-label={`${won ? "Replay" : "Start"} lesson ${lesson.order}, ${lesson.title}`}
            >
              {won ? (
                <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden />
              ) : (
                <Play className="mr-1 h-3.5 w-3.5" aria-hidden />
              )}
              {won ? "Replay" : "Start"}
            </Button>
          </li>
        );
      })}
    </ol>
    {error ? (
      <FeedbackAlert feedback={{ success: false, message: error }} foreground />
    ) : null}
  </section>
);

/**
 * Practice against the Circuit: the guest picks the faction of the loaner deck, then any
 * opponent, easiest first, each with its tier and house rule.
 */
const GuestPractice = ({
  faction,
  onFaction,
  disabled,
  error,
  onStart,
}: {
  faction: DeckFaction;
  onFaction: (faction: DeckFaction) => void;
  disabled: boolean;
  error: string | null;
  onStart: (npcKey: KessenNpcKey) => void;
}) => {
  const info = KESSEN_FACTION_INFO[faction];
  return (
    <section className="kh-panel kg-section" aria-labelledby="kessen-guest-practice">
      <header className="kg-section-head">
        <Swords className="kg-section-icon" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2
            id="kessen-guest-practice"
            className="kh-heading text-[20px] leading-tight"
          >
            Practice on the Circuit
          </h2>
          <p className="kg-section-lead">
            Twelve opponents from Genin to Kage. You play today's loaner deck of your
            faction.
          </p>
        </div>
      </header>
      <fieldset className="kg-factions-wrap">
        <legend className="kg-label">Your deck</legend>
        <div className="kg-factions">
          {KESSEN_DECK_FACTIONS.map((option) => (
            <label key={option} className="kg-faction">
              <input
                type="radio"
                name="kessen-guest-faction"
                value={option}
                className="sr-only"
                checked={option === faction}
                onChange={() => onFaction(option)}
              />
              <FactionSigil
                faction={option}
                renderSize={28}
                className="w-[28px] shrink-0"
                decorative
              />
              <span className="kg-faction-name">{KESSEN_FACTION_NAMES[option]}</span>
            </label>
          ))}
        </div>
        <p className="kg-faction-info" aria-live="polite">
          <strong>{KESSEN_FACTION_NAMES[faction]}</strong>
          {info.perk ? ` · ${info.perk}` : ""}: {info.perkText ?? info.identity}
        </p>
      </fieldset>
      <ul className="kg-npcs">
        {PRACTICE_NPCS.map((npc) => (
          <li key={npc.key} className="kg-npc" data-boss={npc.boss ? "" : undefined}>
            <NpcPortrait
              entry={{ key: npc.key, image: npc.image, lockReason: null }}
              size={52}
              className="kg-npc-portrait"
            />
            <div className="min-w-0 flex-1">
              <p className="kg-npc-name">{npc.name}</p>
              <p className="kg-npc-title">{npc.title}</p>
              <p className="kg-npc-meta">
                <TierMark npc={npc} />
                {npc.standard.houseRule ? (
                  <span className="kg-npc-rule" title={npc.standard.houseRule.text}>
                    {npc.standard.houseRule.name}
                  </span>
                ) : null}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="kg-npc-play"
              disabled={disabled}
              onClick={() => onStart(npc.key)}
              aria-label={`Play ${npc.name}, ${KESSEN_TIER_LABELS[npc.standard.tier]}`}
            >
              <Play className="mr-1 h-3.5 w-3.5" aria-hidden />
              Play
            </Button>
          </li>
        ))}
      </ul>
      {error ? (
        <FeedbackAlert feedback={{ success: false, message: error }} foreground />
      ) : null}
    </section>
  );
};

/** An opponent's tier as its name and difficulty pips. */
const TierMark = ({ npc }: { npc: KessenNpc }) => {
  const tier = npc.standard.tier;
  return (
    <span className="kg-tier" data-tier={tier}>
      <span className="kg-tier-pips" aria-hidden>
        {[1, 2, 3, 4].map((pip) => (
          <span key={pip} data-on={pip <= tierPips(tier) ? "" : undefined} />
        ))}
      </span>
      {KESSEN_TIER_LABELS[tier]}
    </span>
  );
};

/**
 * What an account adds, each as a locked tile that leads to the login: the collection,
 * decks, packs and the stall, the Circuit's rewards and duels against players.
 */
const LockedFeatures = () => (
  <section className="kh-panel kg-section" aria-labelledby="kessen-guest-locked">
    <header className="kg-section-head">
      <Lock className="kg-section-icon" aria-hidden />
      <div className="min-w-0 flex-1">
        <h2 id="kessen-guest-locked" className="kh-heading text-[20px] leading-tight">
          Keep what you win
        </h2>
        <p className="kg-section-lead">
          Guest matches are not saved and pay nothing. A free account opens the rest of
          the hall.
        </p>
      </div>
    </header>
    <ul className="kg-locked">
      {LOCKED.map(({ icon: Icon, title, cta }) => (
        <li key={title}>
          <Link href="/login" className="kg-locked-tile">
            <span className="kg-locked-icon" aria-hidden>
              <Icon />
              <Lock className="kg-locked-lock" />
            </span>
            <span className="min-w-0">
              <span className="kg-locked-title">{title}</span>
              <span className="kg-locked-cta">{cta}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
    <div className="kg-locked-actions">
      <Button asChild>
        <Link href="/login">
          <LogIn className="mr-2 h-4 w-4" aria-hidden />
          Log in
        </Link>
      </Button>
      <Button asChild variant="outline">
        <Link href="/signup">
          <UserPlus className="mr-2 h-4 w-4" aria-hidden />
          Create free account
        </Link>
      </Button>
    </div>
  </section>
);

/** The end screen's note in the rewards' place: nothing was kept, and how to keep it. */
const GuestEndNote = () => (
  <div className="km-reward-box">
    <h3 className="km-reward-title">Played as a guest</h3>
    <p className="km-reward-note">
      <Info aria-hidden />
      <span>
        Guest matches keep no cards and pay no ryo. Log in to keep cards, earn ryo and
        climb the Circuit.
      </span>
    </p>
    <div className="kg-end-actions">
      <Button asChild size="sm">
        <Link href="/login">
          <LogIn className="mr-2 h-4 w-4" aria-hidden />
          Log in
        </Link>
      </Button>
      <Button asChild size="sm" variant="secondary">
        <Link href="/signup">
          <UserPlus className="mr-2 h-4 w-4" aria-hidden />
          Create free account
        </Link>
      </Button>
    </div>
  </div>
);

const lessonTitle = (key: KessenAcademyLessonKey | null) =>
  KESSEN_ACADEMY.find((lesson) => lesson.key === key)?.title ?? "Lemu's Academy";

const npcName = (key: KessenNpcKey) =>
  KESSEN_NPCS.find((npc) => npc.key === key)?.name ?? "the Circuit";

/** The table's deck faction as a deck faction, else the picked one. */
const asDeckFaction = (value: string, fallback: DeckFaction): DeckFaction =>
  KESSEN_DECK_FACTIONS.find((option) => option === value) ?? fallback;

const TIER_ORDER = ["GENIN", "CHUNIN", "JONIN", "KAGE"] as const;

/** Every Circuit opponent, easiest first, in Circuit order within a tier. */
const PRACTICE_NPCS = [...KESSEN_NPCS].sort(
  (a, b) => TIER_ORDER.indexOf(a.standard.tier) - TIER_ORDER.indexOf(b.standard.tier),
);

const LOCKED: { icon: LucideIcon; title: string; cta: string }[] = [
  { icon: BookOpen, title: "Collection", cta: "Log in to keep the cards you win" },
  { icon: Layers, title: "Decks", cta: "Log in to build your own decks" },
  { icon: Package, title: "Packs and Card Master", cta: "Log in to open packs" },
  { icon: Trophy, title: "Circuit rewards", cta: "Log in to earn ryo and drops" },
  { icon: Users, title: "Duels and ranked", cta: "Log in to challenge players" },
];
