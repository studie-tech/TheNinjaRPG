"use client";

import "../kessen.css";
import "./hub.css";
import "./packs.css";
import { Coins } from "lucide-react";
import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import Image from "@/layout/Image";
import { KESSEN_PACK_IDS } from "@/libs/kessen/packs";
import { haptics } from "@/libs/native";
import { cn } from "@/libs/shadui";
import type { KessenCatalogEntry } from "@/validators/kessen";
import type { CardPackReveal } from "@/validators/weightedCache";
import { CardBack } from "../CardBack";
import { CardFace, kessenCardLabel } from "../CardFace";
import { CardInspectDialog } from "../CardInspectDialog";
import {
  KESSEN_IMAGES,
  KESSEN_RARITY_LABELS,
  type KessenCardDisplay,
  type KessenRarityTier,
  kessenLandscapeUrl,
  kessenPackArt,
} from "../kessenArt";
import { useKessenMotion } from "../useKessenMotion";
import { catalogLookup, kessenItemName } from "./hubData";
import { PityLine } from "./PacksPanel";
import { useReturnFocus } from "./useReturnFocus";

/**
 * Pack opening on the dimmed war table: the seal glows and the paper tears along a ragged
 * edge with warm light in the gap; once the tear has run, five face-down cards deal out
 * with an edge glow that telegraphs their rarity, rarest last (on phones the last two
 * slots are the large ones). Tap a card to flip it or reveal them all; a revealed card
 * opens full size with its keywords. A legendary dims the table and rises to the centre
 * of the stage under sweeping rays (its slot stays empty until the lift settles back); a
 * Forbidden card also spills ink smoke and makes the lanterns flicker; an epic lifts in
 * its slot under a short violet burst while the table dims a little. New cards carry a
 * ribbon, surplus copies say where they went, and the pity counters appear once every
 * card is face up (the server reports them after the opening, so earlier they would give
 * the pull away). The First Bundle closes on a welcome instead. Without motion every
 * stage is shown in its final state and flips are instant.
 * The Card Hall plays it in place inside its content box (`layout="inline"`), where it
 * scrolls into view and the sealed pack takes the focus; elsewhere (the item page) it
 * opens in a dialog sized to the ceremony. Closing returns focus to the control that
 * opened the pack, or to `returnFocusTo`.
 */
export const PackOpening = ({
  open,
  reveal,
  cards,
  packName,
  packImage,
  onClose,
  onOpenAnother,
  anotherLabel = "Open another",
  motion,
  returnFocusTo,
  layout = "dialog",
}: {
  open: boolean;
  /** `openPack`'s reveal; a new object restarts the ceremony. */
  reveal: CardPackReveal | null;
  /** Catalog cards, for the revealed faces. */
  cards: readonly KessenCatalogEntry[];
  packName?: string;
  /** The pack item's image, which a staff-created pack shows as its art. */
  packImage?: string;
  onClose: () => void;
  /** Shown once every card is face up, e.g. while more packs of the kind remain. */
  onOpenAnother?: () => void;
  anotherLabel?: string;
  motion?: boolean;
  /** Focus target after closing when the opener has left the page. */
  returnFocusTo?: () => HTMLElement | null | undefined;
  /** In place on the page, or in a dialog over it. */
  layout?: "inline" | "dialog";
}) => {
  const shown = open && reveal !== null;
  const returnFocus = useReturnFocus(returnFocusTo);
  const [stageElement, setStageElement] = useState<HTMLElement | null>(null);
  // Layout effects run before the ceremony takes the focus, so the opener is still
  // active; the passive cleanup runs once the page around it is back.
  useLayoutEffect(() => {
    if (shown) returnFocus.onOpenAutoFocus();
  }, [shown]);
  useEffect(() => {
    if (!shown) return;
    return () => returnFocus.onCloseAutoFocus(new Event("close"));
  }, [shown]);
  // The ceremony's first control takes the focus; in place, the ceremony also comes into
  // view.
  useEffect(() => {
    if (!stageElement) return;
    if (layout === "inline") stageElement.scrollIntoView({ block: "nearest" });
    stageElement
      .querySelector<HTMLElement>(CEREMONY_FOCUS)
      ?.focus({ preventScroll: true });
  }, [stageElement, layout]);
  if (!shown || !reveal) return null;
  const name = packName ?? kessenItemName(reveal.packItemId, catalogLookup(cards));
  const ceremony = (
    <PackCeremony
      key={revealKey(reveal)}
      reveal={reveal}
      name={name}
      image={packImage}
      cards={cards}
      onClose={onClose}
      onOpenAnother={onOpenAnother}
      anotherLabel={anotherLabel}
      motion={motion}
    />
  );
  if (layout === "inline") {
    return (
      <section
        ref={setStageElement}
        className="kh-opening"
        data-layout="inline"
        aria-label={name}
      >
        {ceremony}
      </section>
    );
  }
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        ref={setStageElement}
        data-layout="dialog"
        showCloseButton={false}
        className="kh-opening kessen-scene max-w-[calc(100%-1rem)] gap-0 overflow-hidden border-[var(--kessen-gold-lo)] p-0 md:max-w-[720px]"
        onOpenAutoFocus={(event) => event.preventDefault()}
        // Focus goes back through `returnFocus` once the ceremony unmounts.
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DialogTitle className="sr-only">{name}</DialogTitle>
        <DialogDescription className="sr-only">
          The cards of your {name}, face down until you turn them over.
        </DialogDescription>
        {ceremony}
      </DialogContent>
    </Dialog>
  );
};

const PackCeremony = ({
  reveal,
  name,
  image,
  cards,
  onClose,
  onOpenAnother,
  anotherLabel,
  motion,
}: {
  reveal: CardPackReveal;
  name: string;
  image?: string;
  cards: readonly KessenCatalogEntry[];
  onClose: () => void;
  onOpenAnother?: () => void;
  anotherLabel: string;
  motion?: boolean;
}) => {
  const motionOn = useKessenMotion(motion);
  const lookup = catalogLookup(cards);
  // Rarest last: the reveal builds to the best pull, which takes a large phone slot.
  const slots = reveal.cards
    .map((slot) => ({
      slot,
      card: lookup[slot.itemId] ?? placeholderCard(slot),
      tier: (slot.forbidden ? "FORBIDDEN" : slot.rarity) as KessenRarityTier,
    }))
    .sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
  const [playedStage, setStage] = useState<Stage>(motionOn ? "sealed" : "fanned");
  // Motion can settle off after the first render (the reduced-motion query reads late);
  // without motion every stage shows in its final state.
  const stage: Stage = motionOn ? playedStage : "fanned";
  const [flipped, setFlipped] = useState<boolean[]>(() => slots.map(() => false));
  const [spotlight, setSpotlight] = useState<number | null>(null);
  /** An epic in its short reveal beat. */
  const [epicBeat, setEpicBeat] = useState<number | null>(null);
  const [queue, setQueue] = useState<number[]>([]);
  /** A revealed card opened full size. */
  const [inspecting, setInspecting] = useState<number | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of pending) window.clearTimeout(id);
    };
  }, []);

  const later = (ms: number, run: () => void) => {
    timers.current.push(window.setTimeout(run, ms));
  };

  const tearOpen = () => {
    if (stage !== "sealed") return;
    if (!motionOn) {
      setStage("fanned");
      return;
    }
    setStage("opening");
    void haptics.impact("LIGHT");
    later(OPENING_MS, () => setStage("fanned"));
  };

  const flip = (index: number) => {
    if (stage !== "fanned" || flipped[index] || spotlight !== null) return false;
    setFlipped((current) => current.map((value, i) => (i === index ? true : value)));
    const tier = slots[index]?.tier;
    if (tier === "LEGENDARY" || tier === "FORBIDDEN") {
      void haptics.impact("HEAVY");
      if (motionOn) {
        setSpotlight(index);
        later(FLIP_MS + HOLD_MS + SPOTLIGHT_TAIL_MS, () => setSpotlight(null));
      }
    } else if (tier === "EPIC") {
      void haptics.impact("MEDIUM");
      if (motionOn) {
        setEpicBeat(index);
        later(FLIP_MS + EPIC_BEAT_MS, () =>
          setEpicBeat((current) => (current === index ? null : current)),
        );
      }
    }
    return true;
  };

  // Reveal all: flip the remaining cards one by one, waiting out any spotlight or epic beat.
  useEffect(() => {
    if (
      queue.length === 0 ||
      spotlight !== null ||
      epicBeat !== null ||
      stage !== "fanned"
    )
      return;
    const id = window.setTimeout(
      () => {
        const [next, ...rest] = queue;
        if (next !== undefined) flip(next);
        setQueue(rest);
      },
      motionOn ? REVEAL_STAGGER_MS : 0,
    );
    return () => window.clearTimeout(id);
  });

  const hidden = flipped.flatMap((value, index) => (value ? [] : [index]));
  const allRevealed = hidden.length === 0;
  const spotlit = spotlight === null ? null : (slots[spotlight] ?? null);
  const spotlightTier = spotlit?.tier ?? null;
  const newCount = reveal.cards.filter((slot) => slot.isNew).length;
  const soldRyo = reveal.cards.reduce((sum, slot) => sum + (slot.soldFor ?? 0), 0);
  const hasSurplus = reveal.cards.some((slot) => slot.surplus && slot.soldFor === null);
  const best = bestTier(slots.map(({ tier }) => tier));
  const bestCount = slots.filter(({ tier }) => tier === best).length;
  const isFirstBundle = reveal.packItemId === KESSEN_PACK_IDS.first;

  return (
    <div
      className="kh-ceremony"
      data-stage={stage}
      data-motion={motionOn ? "on" : "off"}
      data-spotlight={spotlightTier ?? undefined}
      data-epic={epicBeat === null ? undefined : ""}
      style={{
        backgroundImage: `url(${kessenLandscapeUrl(KESSEN_IMAGES.board, 1536)})`,
      }}
    >
      <div className="kh-ceremony-dim" aria-hidden />
      <div className="kh-lanterns" aria-hidden>
        <span />
        <span />
      </div>
      <header className="kh-ceremony-head">
        <h2 className="kh-ceremony-title">{name}</h2>
        <p className="kh-ceremony-sub" aria-live="polite">
          {stage === "sealed"
            ? "Tap the pack to break the seal."
            : stage === "opening"
              ? "The seal breaks…"
              : allRevealed
                ? summaryLine(newCount, soldRyo, best, bestCount)
                : "Tap a card to turn it over."}
        </p>
      </header>

      <div className="kh-ceremony-stage">
        {stage === "sealed" || stage === "opening" ? (
          <button
            type="button"
            className="kh-pack-sealed"
            onClick={tearOpen}
            disabled={stage !== "sealed"}
            aria-label={`Open the ${name}`}
          >
            {/* Warm light behind the paper: it swells at the seal and fills the tear. */}
            <span className="kh-pack-glow" aria-hidden />
            {(["top", "bottom"] as const).map((half) => (
              <span key={half} className="kh-pack-half" data-half={half}>
                <span className="kh-pack-paper">
                  <Image
                    src={kessenPackArt(reveal.packItemId, image)}
                    alt=""
                    width={768}
                    height={768}
                    priority
                  />
                </span>
              </span>
            ))}
          </button>
        ) : null}

        {/* The cards deal once the tear has run, so the fan never covers it. */}
        {stage === "fanned" ? (
          <ol className="kh-fan" aria-label="Pack cards">
            {slots.map(({ slot, card, tier }, index) => {
              const isFlipped = flipped[index] ?? false;
              return (
                <li
                  key={`${slot.itemId}-${index}`}
                  className="kh-fan-slot"
                  style={{ "--i": index, "--n": slots.length } as React.CSSProperties}
                  data-spot={spotlight === index ? "" : undefined}
                  data-epic={epicBeat === index ? "" : undefined}
                >
                  {epicBeat === index ? (
                    <span className="kh-epic-burst" aria-hidden />
                  ) : null}
                  <button
                    type="button"
                    className="kh-flip"
                    data-flipped={isFlipped ? "" : undefined}
                    data-tier={tier}
                    data-button-sfx="off"
                    onClick={() => (isFlipped ? setInspecting(index) : flip(index))}
                    aria-haspopup={isFlipped ? "dialog" : undefined}
                    aria-label={
                      isFlipped
                        ? `${kessenCardLabel(card, { isNew: slot.isNew })}. Open full size`
                        : `Card ${index + 1} of ${slots.length}, face down, tap to reveal`
                    }
                  >
                    {/* The label carries the card; the face stays out of the
                        accessibility tree so a face-down pull is never announced. */}
                    <span className="kh-flip-inner" aria-hidden>
                      <span className="kh-flip-face" data-side="back">
                        <CardBack telegraph={tier} renderSize={190} motion={motionOn} />
                      </span>
                      <span
                        className="kh-flip-face"
                        data-side="front"
                        inert={!isFlipped || undefined}
                      >
                        <CardFace
                          card={card}
                          renderSize={240}
                          isNew={slot.isNew}
                          motion={motionOn}
                          aria-hidden
                        />
                      </span>
                    </span>
                  </button>
                  <span
                    className="kh-fan-note"
                    data-visible={isFlipped ? "" : undefined}
                  >
                    {isFlipped ? <SlotNote slot={slot} tier={tier} /> : " "}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : null}

        {/* A legendary or Forbidden pull rises to the centre while the table holds. */}
        {spotlit ? (
          <div className="kh-spotlight" data-tier={spotlit.tier} aria-hidden>
            <span className="kh-rays" />
            {spotlit.tier === "FORBIDDEN" ? (
              <span className="kh-smoke">
                <span />
                <span />
                <span />
              </span>
            ) : null}
            <span className="kh-spotlight-card">
              <CardFace
                card={spotlit.card}
                renderSize={320}
                isNew={spotlit.slot.isNew}
                motion={motionOn}
                aria-hidden
              />
            </span>
          </div>
        ) : null}
      </div>

      <footer className="kh-ceremony-foot">
        {allRevealed ? (
          <>
            {hasSurplus ? (
              <p className="kh-ceremony-note">
                Surplus: you hold every card of that rarity at its copy limit, so the
                extra copy waits in your inventory to sell, or sells itself with
                auto-sell.
              </p>
            ) : null}
            {isFirstBundle ? (
              <p className="kh-ceremony-welcome">{welcomeLine(best, bestCount)}</p>
            ) : (
              <PityLine pity={reveal.pity} className="kh-ceremony-pity" />
            )}
          </>
        ) : isFirstBundle ? (
          <p className="kh-ceremony-pity">
            An Epic or better is guaranteed in this bundle.
          </p>
        ) : null}
        <div className="kh-ceremony-actions">
          {stage === "sealed" ? (
            <Button
              size="lg"
              decoration="gold"
              className={CEREMONY_BUTTON}
              onClick={tearOpen}
            >
              Break the seal
            </Button>
          ) : !allRevealed ? (
            <Button
              size="lg"
              className={CEREMONY_BUTTON}
              disabled={stage !== "fanned" || queue.length > 0}
              onClick={() => setQueue(hidden)}
            >
              Reveal all
            </Button>
          ) : (
            <>
              {onOpenAnother ? (
                <Button size="lg" className={CEREMONY_BUTTON} onClick={onOpenAnother}>
                  {anotherLabel}
                </Button>
              ) : null}
              <Button
                size="lg"
                variant={onOpenAnother ? "secondary" : "default"}
                className={cn(
                  CEREMONY_BUTTON,
                  onOpenAnother && "border border-[var(--kessen-gold-lo)]",
                )}
                onClick={onClose}
              >
                {isFirstBundle ? "To the table" : "Done"}
              </Button>
            </>
          )}
        </div>
      </footer>
      <RevealInspect
        pull={inspecting === null ? null : (slots[inspecting] ?? null)}
        motion={motionOn}
        onClose={() => setInspecting(null)}
      />
    </div>
  );
};

/**
 * A revealed card at full size with its keywords and where its copy went; closing
 * returns to the card in the fan.
 */
const RevealInspect = ({
  pull,
  motion,
  onClose,
}: {
  pull: {
    slot: CardPackReveal["cards"][number];
    card: KessenCardDisplay;
    tier: KessenRarityTier;
  } | null;
  motion: boolean;
  onClose: () => void;
}) => (
  <CardInspectDialog
    card={pull?.card ?? null}
    isNew={pull?.slot.isNew}
    motion={motion}
    description={
      pull ? `${KESSEN_RARITY_LABELS[pull.tier]} card from this pack.` : undefined
    }
    closeLabel="Back to the pack"
    scene
    onClose={onClose}
  >
    {pull && (pull.slot.soldFor !== null || pull.slot.surplus) ? (
      <p className="text-muted-foreground text-[13px]">
        {pull.slot.soldFor !== null
          ? `Surplus copy sold for ${pull.slot.soldFor.toLocaleString()} ryo`
          : "Surplus copy: kept in your inventory to sell"}
      </p>
    ) : null}
  </CardInspectDialog>
);

/** Caption under a revealed card: rarity, NEW, or where a surplus copy went. */
const SlotNote = ({
  slot,
  tier,
}: {
  slot: CardPackReveal["cards"][number];
  tier: KessenRarityTier;
}) => {
  if (slot.soldFor !== null) {
    return (
      <span className="kh-note-sold">
        <Coins className="h-[13px] w-[13px] shrink-0" aria-hidden />+
        {slot.soldFor.toLocaleString()} ryo
        <span className="sr-only"> for a surplus copy</span>
      </span>
    );
  }
  if (slot.surplus)
    return (
      <span className="kh-note-surplus">
        Surplus<span className="sr-only">: a surplus copy</span>
      </span>
    );
  // The card's own ribbon marks a new card.
  return (
    <span className="kh-note-tier" data-tier={tier}>
      {KESSEN_RARITY_LABELS[tier]}
    </span>
  );
};

/** The closing headline: the best pull first, then new cards and surplus ryo. */
const summaryLine = (
  newCount: number,
  soldRyo: number,
  best: KessenRarityTier,
  bestCount: number,
) => {
  const parts = [
    newCount === 0
      ? "No new cards"
      : `${newCount} new ${newCount === 1 ? "card" : "cards"}`,
  ];
  if (soldRyo > 0) parts.push(`${soldRyo.toLocaleString()} ryo from surplus`);
  return `${bestPullLine(best, bestCount)}${parts.join(" · ")}.`;
};

/** The headline's opening for an epic or rarer best pull, counting its copies. */
const bestPullLine = (best: KessenRarityTier, count: number) => {
  const many = count > 1 ? (COUNT_WORDS[count] ?? String(count)) : null;
  switch (best) {
    case "FORBIDDEN":
      return many ? `${many} Forbidden cards! ` : "A Forbidden card! ";
    case "LEGENDARY":
      return many ? `${many} legendaries! ` : "A legendary! ";
    case "EPIC":
      return many ? `${many} epic pulls. ` : "An epic pull. ";
    default:
      return "";
  }
};

/** The First Bundle's closing line: its best cards, and where to find them again. */
const welcomeLine = (best: KessenRarityTier, count: number) =>
  best === "COMMON" || best === "RARE"
    ? "Your first cards wait in your Collection."
    : count > 1
      ? `Your first ${PLURAL_TIER_LABELS[best]}. Find them in your Collection.`
      : `Your first ${KESSEN_RARITY_LABELS[best]}. Find it in your Collection.`;

const PLURAL_TIER_LABELS: Record<KessenRarityTier, string> = {
  COMMON: "Commons",
  RARE: "Rares",
  EPIC: "Epics",
  LEGENDARY: "Legendaries",
  FORBIDDEN: "Forbidden cards",
};

const COUNT_WORDS: Record<number, string> = {
  2: "Two",
  3: "Three",
  4: "Four",
  5: "Five",
};

const TIER_ORDER: readonly KessenRarityTier[] = [
  "COMMON",
  "RARE",
  "EPIC",
  "LEGENDARY",
  "FORBIDDEN",
];

/** The rarest tier among the pulls. */
const bestTier = (tiers: readonly KessenRarityTier[]) =>
  tiers.reduce<KessenRarityTier>(
    (top, tier) => (TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf(top) ? tier : top),
    "COMMON",
  );

/** Identity of a reveal, so a new pack restarts the ceremony. */
const revealKey = (reveal: CardPackReveal) =>
  `${reveal.packItemId}:${reveal.cards.map((slot) => slot.itemId).join(",")}:${reveal.pity.epicIn}:${reveal.pity.legendaryIn}`;

/** Face for a card missing from the loaded catalog. */
const placeholderCard = (slot: CardPackReveal["cards"][number]): KessenCardDisplay => ({
  id: slot.itemId,
  name: "Unknown card",
  rarity: slot.rarity,
  kind: "UNIT",
  faction: "NEUTRAL",
  row: "CLOSE",
  power: 0,
  provision: 0,
  abilities: [],
  leaderBonus: 0,
  variant: slot.forbidden ? "FORBIDDEN" : "STANDARD",
  isCollectible: true,
});

type Stage = "sealed" | "opening" | "fanned";

/** The control that takes the focus as the ceremony opens. */
const CEREMONY_FOCUS = ".kh-pack-sealed, .kh-flip, button";

/** The ceremony's footer buttons: large lettering and a full touch target. */
const CEREMONY_BUTTON = "h-auto min-h-[44px] min-w-[132px] px-6 font-bold text-[15px]";

/** Cord and tear before the fan; keep in step with the keyframes in packs.css. */
const OPENING_MS = 1150;
const FLIP_MS = 520;
/** The epic's lift and violet burst after its flip; keep in step with `kh-epic-lift`. */
const EPIC_BEAT_MS = 700;
const HOLD_MS = 600;
const SPOTLIGHT_TAIL_MS = 380;
const REVEAL_STAGGER_MS = 260;
