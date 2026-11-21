"use client";

import { KESSEN_FACTION_NAMES } from "@/libs/kessen/packs";
import "../kessen.css";
import "./hub.css";
import "./circuit.css";
import { Gift, Lock, Maximize, ZoomIn, ZoomOut } from "lucide-react";
import type React from "react";
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import Image from "@/layout/Image";
import type { KessenNpcKey } from "@/libs/kessen/npcs";
import { cn } from "@/libs/shadui";
import type {
  KessenCatalogEntry,
  KessenCircuitEntry,
  KessenHub,
  KessenPackEntry,
} from "@/validators/kessen";
import { FactionSigil } from "../FactionSigil";
import { WaxSealGlyph } from "../glyphs";
import { KESSEN_IMAGES, kessenRenditionWidth } from "../kessenArt";
import {
  activeMatchStateText,
  ascendedFirstWinRewardLines,
  catalogLookup,
  circuitPinPosition,
  firstWinRewardLines,
  KESSEN_TIER_LABELS,
  type KessenActiveMatchState,
  kessenWinText,
  lockProgressText,
  mapPinOrder,
  npcPortrait,
  npcPortraitKind,
  tierPips,
} from "./hubData";
import {
  centerOn,
  clampView,
  ensureVisible,
  FIT_VIEW,
  labelsShown,
  MAP_DESIGN_WIDTH,
  type MapView,
  maxZoomFor,
  panBy,
  pinScale,
  sameView,
  ZOOM_STEP,
  zoomAt,
} from "./mapView";

/**
 * The Kessen Circuit: NPC portraits pinned on the painted map of Seichi. The map fits its
 * frame at every width and its pins scale with it, so the composition is the same on a
 * phone and a desktop; zoom buttons, a pinch or ctrl/cmd + wheel bring it closer, and a
 * drag pans it while zoomed in (`mapView.ts`). Where the fitted pins would print their
 * names under 11 px, only the pin in hand (selected, hovered or focused) shows its name
 * plate until the player zooms in; the details strip under the map names it in full.
 * Locked opponents are ink silhouettes with their unlock condition, beaten ones carry a
 * wax seal; each shows tier pips, faction sigil and its first-win reward. An unfinished
 * match is named on its pin (in place of the pips, so the plate keeps its height) and in
 * the strip, with its round and score when known. The strip describes the pin under the
 * pointer or focus (else the selected one), so no card ever covers another pin, and keeps
 * a legend of the marks shown. A gift badge marks a first-win reward still to win or, for
 * a beaten opponent, one won but not yet chosen (`pendingPicks`). Pins take focus by
 * difficulty, then in reading order across the map.
 */
export const CircuitMap = ({
  circuit,
  cards,
  packs = [],
  selectedKey,
  activeNpcKey,
  activeMatchState,
  pendingPicks = [],
  onSelect,
  className,
}: {
  circuit: readonly KessenCircuitEntry[];
  /** Catalog cards, for first-win reward names. */
  cards: readonly KessenCatalogEntry[];
  packs?: readonly KessenPackEntry[];
  selectedKey?: KessenNpcKey | null;
  /** NPC of the player's unfinished match. */
  activeNpcKey?: KessenNpcKey | null;
  /** Round and score of that match, when the page knows them. */
  activeMatchState?: KessenActiveMatchState | null;
  /** Won matches whose first-win card is still to be chosen. */
  pendingPicks?: KessenHub["pendingPicks"];
  onSelect: (key: KessenNpcKey) => void;
  className?: string;
}) => {
  const lookup = catalogLookup(cards);
  const frameRef = useRef<HTMLDivElement>(null);
  const { view, glide, width, maxZoom, update } = useMapView(frameRef);
  /** The pin under the pointer or keyboard focus. */
  const [preview, setPreview] = useState<KessenNpcKey | null>(null);
  const picks = new Set(pendingPicks.map((pick) => pick.npcKey));
  const pins = circuit.map((entry) => ({
    entry,
    position: circuitPinPosition(entry),
    reward: firstWinRewardLines(entry, lookup, packs),
    ascendedReward: ascendedFirstWinRewardLines(entry, lookup, packs),
    lock: lockProgressText(entry.lockReason, entry, circuit, "standard", false),
    pick: picks.has(entry.key),
  }));
  const mapPins = mapPinOrder(pins);
  const detailKey = preview ?? selectedKey ?? activeNpcKey ?? null;
  const detail = pins.find(({ entry }) => entry.key === detailKey) ?? null;
  const showsAscendedOpen = circuit.some(
    (entry) => ascendedOpen(entry) && !entry.ascendedFirstWinAt,
  );
  const showsAscendedBeaten = circuit.some(
    (entry) => ascendedOpen(entry) && entry.ascendedFirstWinAt,
  );
  const showsReward = pins.some(({ entry, reward, ascendedReward, pick }) =>
    giftShown(entry, reward, ascendedReward, pick),
  );
  const showsLocked = circuit.some((entry) => circuitState(entry) === "locked");
  const showsLive = circuit.some((entry) => entry.key === activeNpcKey);
  const focusPin =
    pins.find(({ entry }) => entry.key === (selectedKey ?? activeNpcKey)) ??
    pins.find(({ entry }) => circuitState(entry) === "open") ??
    null;
  const scale = pinScale(width || MAP_DESIGN_WIDTH, view.zoom);
  const zoomed = view.zoom > 1.001;
  const liveLine = activeMatchState
    ? `${activeMatchStateText(activeMatchState)} · select to resume`
    : "Match in progress · select to resume";
  /**
   * The zoom buttons work towards the opponent in hand (selected, live or next to beat):
   * zooming in holds it where it stands, or centres it when it is out of view; zooming
   * out keeps it in view.
   */
  const zoomBy = (factor: number) =>
    update((current) => {
      const target = focusPin?.position;
      const next = current.zoom * factor;
      if (!target) return zoomAt(current, next, 0.5, 0.5, maxZoom);
      const u = target.x / 100;
      const v = target.y / 100;
      const at = { x: current.x + u * current.zoom, y: current.y + v * current.zoom };
      const inView = at.x > 0.05 && at.x < 0.95 && at.y > 0.05 && at.y < 0.95;
      if (factor > 1)
        return inView
          ? zoomAt(current, next, at.x, at.y, maxZoom)
          : centerOn(next, u, v, maxZoom);
      return keepPinInView(
        zoomAt(current, next, 0.5, 0.5, maxZoom),
        target,
        pinScale(width, next),
        width,
      );
    }, true);
  return (
    <section className={cn("kh-circuit", className)} aria-label="The Kessen Circuit">
      <div
        ref={frameRef}
        className="kh-map"
        data-zoomed={zoomed ? "" : undefined}
        data-compact={labelsShown(scale) ? undefined : ""}
        style={{ "--kh-pin-scale": scale.toFixed(3) } as React.CSSProperties}
      >
        <div
          className="kh-map-layer"
          data-glide={glide ? "" : undefined}
          style={{
            width: `${view.zoom * 100}%`,
            height: `${view.zoom * 100}%`,
            transform: `translate3d(${(view.x / view.zoom) * 100}%, ${(view.y / view.zoom) * 100}%, 0)`,
          }}
        >
          <div className="kh-map-art" aria-hidden>
            {/* The largest paint of the hall. */}
            <Image
              src={KESSEN_IMAGES.circuitMap}
              alt=""
              width={1024}
              height={683}
              draggable={false}
              priority
              fetchPriority="high"
            />
          </div>
          <ol className="kh-map-pins">
            {mapPins.map(({ entry, position, reward, ascendedReward, lock, pick }) => (
              <li
                key={entry.key}
                className="kh-pin-slot"
                style={{ left: `${position.x}%`, top: `${position.y}%` }}
              >
                <CircuitPin
                  entry={entry}
                  reward={reward}
                  ascendedReward={ascendedReward}
                  lock={lock}
                  pick={pick}
                  selected={selectedKey === entry.key}
                  active={activeNpcKey === entry.key}
                  liveLine={liveLine}
                  onSelect={onSelect}
                  onPreview={setPreview}
                  onFocus={() =>
                    update(
                      (current) => keepPinInView(current, position, scale, width),
                      true,
                    )
                  }
                />
              </li>
            ))}
          </ol>
        </div>
        <div className="kh-map-vignette" aria-hidden />
      </div>
      <div className="kh-map-info">
        {/* The pins' labels carry the same text, so the details stay out of the tree. */}
        <div className="kh-map-info-body" aria-hidden>
          {detail ? (
            <PinDetails
              entry={detail.entry}
              reward={detail.reward}
              ascendedReward={detail.ascendedReward}
              lock={detail.lock}
              pick={detail.pick}
              active={activeNpcKey === detail.entry.key}
              liveLine={liveLine}
            />
          ) : (
            <p className="kh-map-info-hint">
              Choose an opponent on the map to see the match and challenge them.
            </p>
          )}
        </div>
        <fieldset className="kh-map-zoom">
          <legend className="sr-only">Map zoom</legend>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="kh-map-zoom-button"
            aria-label="Zoom out"
            title="Zoom out"
            disabled={!zoomed}
            onClick={() => zoomBy(1 / ZOOM_STEP)}
          >
            <ZoomOut aria-hidden />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="kh-map-zoom-button"
            aria-label="Zoom in"
            title="Zoom in"
            disabled={view.zoom >= maxZoom - 0.001}
            onClick={() => zoomBy(ZOOM_STEP)}
          >
            <ZoomIn aria-hidden />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="kh-map-zoom-button"
            aria-label="Show the whole map"
            title="Show the whole map"
            disabled={!zoomed}
            onClick={() => update(() => FIT_VIEW, true)}
          >
            <Maximize aria-hidden />
          </Button>
        </fieldset>
        <p className="kh-map-legend" aria-hidden>
          <span className="kh-map-legend-item">
            <span className="kh-pips">
              <span className="kh-pip" data-on="" />
              <span className="kh-pip" />
            </span>
            Difficulty
          </span>
          <span className="kh-map-legend-item">
            <span className="kh-pin-seal kh-legend-seal">
              <WaxSealGlyph />
            </span>
            Beaten
          </span>
          {showsAscendedOpen ? (
            <span className="kh-map-legend-item">
              <AscendedMark />
              Ascended rematch open
            </span>
          ) : null}
          {showsAscendedBeaten ? (
            <span className="kh-map-legend-item">
              <AscendedMark beaten />
              Ascended beaten
            </span>
          ) : null}
          {showsReward ? (
            <span className="kh-map-legend-item">
              <span className="kh-pin-reward kh-legend-mark">
                <Gift className="h-[10px] w-[10px]" />
              </span>
              First-win reward
            </span>
          ) : null}
          {showsLocked ? (
            <span className="kh-map-legend-item">
              <span className="kh-pin-lock kh-legend-mark">
                <Lock className="h-[9px] w-[9px]" />
              </span>
              Locked
            </span>
          ) : null}
          {showsLive ? (
            <span className="kh-map-legend-item">
              <span className="kh-pin-live kh-legend-mark" />
              Live match
            </span>
          ) : null}
        </p>
      </div>
    </section>
  );
};

/**
 * A portrait pin on the map. Hover and keyboard focus describe it in the details strip;
 * a gift badge marks an unclaimed first-win reward without hovering.
 */
const CircuitPin = ({
  entry,
  reward,
  ascendedReward,
  lock,
  pick,
  selected,
  active,
  liveLine,
  onSelect,
  onPreview,
  onFocus,
}: CircuitItemProps & {
  onPreview: (key: KessenNpcKey | null) => void;
  /** Keeps the focused pin inside a zoomed map. */
  onFocus: () => void;
}) => {
  const state = circuitState(entry);
  const leave = () => onPreview(null);
  return (
    <button
      type="button"
      className="kh-pin"
      data-state={state}
      data-boss={entry.boss ? "" : undefined}
      data-selected={selected ? "" : undefined}
      aria-pressed={selected}
      aria-label={circuitLabel(
        entry,
        reward,
        ascendedReward,
        lock,
        pick,
        active ? liveLine : null,
      )}
      onClick={() => onSelect(entry.key)}
      onPointerEnter={() => onPreview(entry.key)}
      onPointerLeave={leave}
      onFocus={() => {
        onPreview(entry.key);
        onFocus();
      }}
      onBlur={leave}
    >
      <span className="kh-pin-portrait">
        <NpcPortrait entry={entry} size={64} />
        {state === "beaten" ? (
          <span className="kh-pin-seal" aria-hidden>
            <WaxSealGlyph />
          </span>
        ) : null}
        {state === "locked" ? (
          <span className="kh-pin-lock" aria-hidden>
            <Lock />
          </span>
        ) : null}
        <span className="kh-pin-sigil" aria-hidden>
          <FactionSigil
            faction={entry.faction}
            renderSize={28}
            className="w-full"
            decorative
          />
        </span>
        {active ? <span className="kh-pin-live" aria-hidden /> : null}
        {giftShown(entry, reward, ascendedReward, pick) ? (
          <span className="kh-pin-reward" aria-hidden>
            <Gift />
          </span>
        ) : null}
      </span>
      <span className="kh-pin-plate">
        <span className="kh-pin-name">{entry.name}</span>
        {/* The live tag takes the pips' line, so the plate never grows into a neighbour;
            the label still reads the tier. */}
        {active ? (
          <span className="kh-pin-live-tag" aria-hidden>
            Live match
          </span>
        ) : (
          <TierPips entry={entry} />
        )}
      </span>
    </button>
  );
};

/** The details strip under the map: who, where, and the next reward or the lock. */
const PinDetails = ({
  entry,
  reward,
  ascendedReward,
  lock,
  pick,
  active,
  liveLine,
}: {
  entry: KessenCircuitEntry;
  reward: string[];
  ascendedReward: string[];
  lock: string | null;
  pick: boolean;
  active: boolean;
  liveLine: string;
}) => {
  const state = circuitState(entry);
  return (
    <>
      <p className="kh-map-info-title">
        <span className="kh-map-info-name">{entry.name}</span> · {entry.title}
        <span className="kh-map-info-place"> · {entry.location}</span>
      </p>
      <p className="kh-map-info-line">
        {active ? (
          <span data-live>{liveLine}</span>
        ) : lock ? (
          <span data-lock>
            <Lock className="h-[12px] w-[12px] shrink-0" aria-hidden />
            {withoutPeriod(lock)}
          </span>
        ) : pick ? (
          <span data-reward>{PICK_WAITING} · select to choose it</span>
        ) : reward.length > 0 ? (
          <span data-reward>First win: {reward.join(", ")}</span>
        ) : ascendedReward.length > 0 ? (
          <span data-reward>
            {ASCENDED_FIRST_WIN}: {ascendedReward.join(", ")}
          </span>
        ) : state === "beaten" ? (
          <span>{beatenText(entry)}</span>
        ) : null}
      </p>
    </>
  );
};

/**
 * Tier pips (Genin 1 to Kage 4), plus the Ascended mark once the rematch is open. The
 * pin's or row's label reads both, so the pips stay out of the accessibility tree.
 */
const TierPips = ({ entry }: { entry: KessenCircuitEntry }) => {
  const pips = tierPips(entry.tier);
  return (
    <span className="kh-pips" aria-hidden>
      {[1, 2, 3, 4].map((pip) => (
        <span key={pip} className="kh-pip" data-on={pip <= pips ? "" : undefined} />
      ))}
      {ascendedOpen(entry) ? (
        <AscendedMark
          beaten={Boolean(entry.ascendedFirstWinAt)}
          title={
            entry.ascendedFirstWinAt
              ? "Ascended rematch beaten"
              : "Ascended rematch open"
          }
        />
      ) : null}
    </span>
  );
};

/**
 * The Ascended mark: a gold crest rising over a bar, the same glyph as the Ascended badge
 * of the NPC sheet; filled once the Ascended rematch is beaten.
 */
export const AscendedMark = ({
  beaten = false,
  title,
  className,
}: {
  beaten?: boolean;
  title?: string;
  className?: string;
}) => (
  <span
    className={cn("kh-ascended", className)}
    data-beaten={beaten ? "" : undefined}
    title={title}
  >
    <svg viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M8 2.2 13 8.4h-3.1v2.4H6.1V8.4H3z" />
      <path d="M3.2 12.6h9.6v1.6H3.2z" />
    </svg>
  </span>
);

/** Round NPC portrait; locked opponents render as an ink silhouette. */
export const NpcPortrait = ({
  entry,
  size,
  className,
}: {
  entry: Pick<KessenCircuitEntry, "key" | "image" | "lockReason">;
  size: number;
  className?: string;
}) => {
  const width = kessenRenditionWidth(size);
  return (
    <span
      className={cn("kh-portrait", className)}
      data-locked={entry.lockReason ? "" : undefined}
      data-kind={npcPortraitKind(entry)}
    >
      <Image
        src={npcPortrait(entry)}
        alt=""
        width={width}
        height={width}
        draggable={false}
      />
    </span>
  );
};

/** Whether an opponent's Ascended rematch is open. */
const ascendedOpen = (entry: KessenCircuitEntry) =>
  entry.ascendedTier !== null && entry.ascendedLockReason === null;

/**
 * Win count of an opponent by mode, with the state of its Ascended rematch once open
 * (left out with `withAscendedOpen = false` when a reward line already says so).
 */
const beatenText = (entry: KessenCircuitEntry, withAscendedOpen = true) => {
  const wins = kessenWinText(entry);
  return [
    entry.firstWinAt ? "Beaten" : null,
    wins.ascended ? "Ascended beaten" : null,
    wins.total ?? `${entry.wins} ${entry.wins === 1 ? "win" : "wins"}`,
    withAscendedOpen && !wins.ascended && ascendedOpen(entry)
      ? "Ascended rematch open"
      : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
};

const withoutPeriod = (text: string) => text.replace(/\.$/, "");

/**
 * The map's zoom and pan: the frame's width (measured before paint), the view clamped to
 * it, and `update`, which applies a view change (`glide` animates it, for buttons and
 * focus; gestures follow the fingers). Pinch and one-finger pan come from touch events,
 * mouse drags from pointer events and ctrl/cmd + wheel zooms at the pointer; a plain wheel
 * and a vertical swipe over the fitted map still scroll the page. A drag that moved the
 * map swallows the click that ends it, so it never selects a pin.
 */
const useMapView = (frameRef: RefObject<HTMLDivElement | null>) => {
  const [width, setWidth] = useState(0);
  const [state, setState] = useState<{ view: MapView; glide: boolean }>({
    view: FIT_VIEW,
    glide: false,
  });
  const maxZoom = maxZoomFor(width);
  const update = (change: (view: MapView) => MapView, glide = false) =>
    setState((current) => {
      const view = clampView(change(clampView(current.view, maxZoom)), maxZoom);
      return sameView(view, current.view) && glide === current.glide
        ? current
        : { view, glide };
    });

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => setWidth(frame.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [frameRef]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    /** Gestures change the view relative to its latest state, frame by frame. */
    const apply = (change: (view: MapView, limit: number) => MapView) =>
      setState((current) => {
        const limit = maxZoomFor(frame.clientWidth);
        const view = clampView(change(clampView(current.view, limit), limit), limit);
        return sameView(view, current.view) && !current.glide
          ? current
          : { view, glide: false };
      });
    const zoomedIn = () => frame.hasAttribute("data-zoomed");
    const point = (x: number, y: number) => {
      const rect = frame.getBoundingClientRect();
      return {
        x: (x - rect.left) / Math.max(1, rect.width),
        y: (y - rect.top) / Math.max(1, rect.height),
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      };
    };
    let moved = false;
    let last: { x: number; y: number; distance: number; fingers: number } | null = null;
    const touchState = (touches: TouchList) => {
      const a = touches[0];
      const b = touches[1];
      if (!a) return null;
      if (!b) return { x: a.clientX, y: a.clientY, distance: 0, fingers: 1 };
      return {
        x: (a.clientX + b.clientX) / 2,
        y: (a.clientY + b.clientY) / 2,
        distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        fingers: 2,
      };
    };
    /** Where a one-finger touch began: a tap that drifts under 6 px still selects. */
    let origin: { x: number; y: number } | null = null;
    const onTouchStart = (event: TouchEvent) => {
      last = touchState(event.touches);
      if (event.touches.length === 1 && last) {
        moved = false;
        origin = { x: last.x, y: last.y };
      } else moved = true;
    };
    const onTouchMove = (event: TouchEvent) => {
      const next = touchState(event.touches);
      const previous = last;
      if (!next || !previous || next.fingers !== previous.fingers) {
        last = next;
        return;
      }
      // One finger over the fitted map scrolls the page.
      if (next.fingers === 1 && !zoomedIn()) return;
      if (event.cancelable) event.preventDefault();
      const at = point(next.x, next.y);
      const dx = (next.x - previous.x) / at.width;
      const dy = (next.y - previous.y) / at.height;
      if (!origin || Math.hypot(next.x - origin.x, next.y - origin.y) > 6) moved = true;
      const ratio =
        next.fingers === 2 && previous.distance > 0
          ? next.distance / previous.distance
          : 1;
      apply((view, limit) =>
        panBy(
          zoomAt(view, view.zoom * ratio, at.x - dx, at.y - dy, limit),
          dx,
          dy,
          limit,
        ),
      );
      last = next;
    };
    const onTouchEnd = (event: TouchEvent) => {
      last = touchState(event.touches);
    };
    let drag: { id: number; x: number; y: number; active: boolean } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      moved = false;
      if (!zoomedIn()) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, active: false };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dxPx = event.clientX - drag.x;
      const dyPx = event.clientY - drag.y;
      if (!drag.active) {
        if (Math.hypot(dxPx, dyPx) < 5) return;
        drag.active = true;
        moved = true;
        frame.setPointerCapture(event.pointerId);
        frame.setAttribute("data-dragging", "");
      }
      const at = point(event.clientX, event.clientY);
      drag.x = event.clientX;
      drag.y = event.clientY;
      apply((view, limit) => panBy(view, dxPx / at.width, dyPx / at.height, limit));
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      if (frame.hasPointerCapture(event.pointerId))
        frame.releasePointerCapture(event.pointerId);
      frame.removeAttribute("data-dragging");
      drag = null;
    };
    const onClick = (event: MouseEvent) => {
      if (!moved) return;
      moved = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      const factor = Math.exp((-event.deltaY * lines) / 300);
      const at = point(event.clientX, event.clientY);
      apply((view, limit) => zoomAt(view, view.zoom * factor, at.x, at.y, limit));
    };
    const options = { passive: false } as const;
    frame.addEventListener("touchstart", onTouchStart, options);
    frame.addEventListener("touchmove", onTouchMove, options);
    frame.addEventListener("touchend", onTouchEnd);
    frame.addEventListener("touchcancel", onTouchEnd);
    frame.addEventListener("pointerdown", onPointerDown);
    frame.addEventListener("pointermove", onPointerMove);
    frame.addEventListener("pointerup", onPointerEnd);
    frame.addEventListener("pointercancel", onPointerEnd);
    frame.addEventListener("click", onClick, true);
    frame.addEventListener("wheel", onWheel, options);
    return () => {
      frame.removeEventListener("touchstart", onTouchStart);
      frame.removeEventListener("touchmove", onTouchMove);
      frame.removeEventListener("touchend", onTouchEnd);
      frame.removeEventListener("touchcancel", onTouchEnd);
      frame.removeEventListener("pointerdown", onPointerDown);
      frame.removeEventListener("pointermove", onPointerMove);
      frame.removeEventListener("pointerup", onPointerEnd);
      frame.removeEventListener("pointercancel", onPointerEnd);
      frame.removeEventListener("click", onClick, true);
      frame.removeEventListener("wheel", onWheel);
    };
  }, [frameRef]);

  return {
    view: clampView(state.view, maxZoom),
    glide: state.glide,
    width,
    maxZoom,
    update,
  };
};

/**
 * Pans a zoomed map just enough to show the whole pin at `position` (percent of the map)
 * at pin scale `scale`: its portrait reaches 36 design px above the anchor and its name
 * plate about 72 below, so the box kept in view is centred 18 px under the anchor.
 */
const keepPinInView = (
  view: MapView,
  position: { x: number; y: number },
  scale: number,
  width: number,
) => {
  if (view.zoom <= 1 || width <= 0) return view;
  const height = (width * 2) / 3;
  return ensureVisible(
    view,
    position.x / 100,
    position.y / 100 + (18 * scale) / (height * view.zoom),
    (58 * scale) / width,
    (58 * scale) / height,
    maxZoomFor(width),
  );
};

/**
 * Whether the gift badge shows: a first-win reward still to win in either mode, or one
 * to choose.
 */
const giftShown = (
  entry: KessenCircuitEntry,
  reward: string[],
  ascendedReward: string[],
  pick: boolean,
) =>
  pick ||
  (circuitState(entry) === "open" && reward.length > 0) ||
  ascendedReward.length > 0;

const PICK_WAITING = "First-win reward waiting";

const ASCENDED_FIRST_WIN = "Ascended first win";

/** Locked, open (not beaten yet) or beaten. */
export const circuitState = (entry: KessenCircuitEntry) =>
  entry.lockReason ? "locked" : entry.firstWinAt ? "beaten" : "open";

const circuitLabel = (
  entry: KessenCircuitEntry,
  reward: string[],
  ascendedReward: string[],
  lock: string | null,
  /** Whether a won first-win card is still to be chosen. */
  pick: boolean,
  /** The unfinished match's line when it is against this opponent. */
  live: string | null,
) => {
  const parts = [
    `${entry.name}, ${entry.title}`,
    entry.location,
    `${KESSEN_FACTION_NAMES[entry.faction]}, ${KESSEN_TIER_LABELS[entry.tier]} difficulty`,
  ];
  if (lock) parts.push(`Locked: ${lock.replace(/\.$/, "")}`);
  else if (entry.firstWinAt || entry.wins > 0)
    parts.push(
      `${entry.firstWinAt ? "Beaten, " : ""}${kessenWinText(entry).total ?? `${entry.wins} ${entry.wins === 1 ? "win" : "wins"}`}`,
    );
  if (ascendedOpen(entry))
    parts.push(
      entry.ascendedFirstWinAt
        ? "Ascended rematch beaten"
        : entry.ascendedTier
          ? `Ascended rematch open, ${KESSEN_TIER_LABELS[entry.ascendedTier]}`
          : "Ascended rematch open",
    );
  if (pick) parts.push(`${PICK_WAITING} to be chosen`);
  else if (reward.length > 0) parts.push(`First win: ${reward.join(", ")}`);
  if (!pick && ascendedReward.length > 0)
    parts.push(`${ASCENDED_FIRST_WIN}: ${ascendedReward.join(", ")}`);
  if (live) parts.push(live.replace(/ · /g, ", "));
  return parts.join(". ");
};

type CircuitItemProps = {
  entry: KessenCircuitEntry;
  reward: string[];
  /** The next Ascended first win; empty while it is locked or claimed. */
  ascendedReward: string[];
  /** Lock reason with the player's progress; null when open. */
  lock: string | null;
  /** Whether a won first-win card is still to be chosen. */
  pick: boolean;
  selected: boolean;
  active: boolean;
  /** What the live match's line says, e.g. "Match in progress · select to resume". */
  liveLine: string;
  onSelect: (key: KessenNpcKey) => void;
};
