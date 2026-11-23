import { atom, useSetAtom } from "jotai";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import {
  type ArrivalScene,
  type ArrivalSceneKind,
  arrivalSceneActors,
  planArrivalScene,
} from "@/libs/arrivalScene";
import { isWanderTile } from "@/libs/overworldWander";
import type { TravelScene } from "@/libs/rendering/scenes/travel";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import { getSectorTile } from "@/libs/sector-map/validation";
import type { SectorUser } from "@/libs/sector-map/world-types";
import { TUTORIAL_AMBUSH_STEP_ID, TUTORIAL_ARRIVAL_STEP_ID } from "@/libs/tutorial";

/** True while the ambush plays on the map, when its lesson has nothing to answer yet. */
export const arrivalScenePlayingAtom = atom(false);

/** Tutorial steps the sector map stages, each with how. */
const SCENE_KINDS: Record<string, ArrivalSceneKind> = {
  [TUTORIAL_ARRIVAL_STEP_ID]: "greeting",
  [TUTORIAL_AMBUSH_STEP_ID]: "ambush",
  "combat-rematch": "standoff",
};

/**
 * The opening of the Academy Trials on the sector map: Lemu's greeting, the ambush and the
 * wait for a rematch, staged around the player and drawn only for them. The figures are
 * added to what the renderer reads, so no map logic meets them. `flash` and `smoke` count
 * up when their overlay should play; a player who prefers reduced motion sees neither, and
 * the scene as it ends.
 */
export const useArrivalScene = (info: {
  stepId: string | undefined;
  /** The viewer's sector and where they stand in it, once the map shows it. */
  sector: number;
  map: NormalizedSectorMap | undefined;
  getPosition: () => { x: number; y: number } | undefined;
  /** The rendered map, once it shows; scenery may still be arriving. */
  scenery: ArrivalScenery | null | undefined;
  /** The server-corrected clock the renderer walks NPCs by. */
  getNow: () => number;
  /** Has the renderer reconcile its actors. */
  onCastChange: () => void;
}) => {
  const kind = info.stepId ? SCENE_KINDS[info.stepId] : undefined;
  const { data: art, isPending } = api.travel.getArrivalCast.useQuery(undefined, {
    enabled: !!kind,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [scene, setScene] = useState<{ plan: ArrivalScene; startAt: number }>();
  const [flash, setFlash] = useState(0);
  const [smoke, setSmoke] = useState(0);
  const lemuRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const infoRef = useRef(info);
  useLayoutEffect(() => {
    infoRef.current = info;
  });
  const setPlaying = useSetAtom(arrivalScenePlayingAtom);

  // Stage each scene once, where the player stands as its lesson opens on a loaded map.
  // Artwork that fails to load leaves its figures out rather than holding the lesson.
  const { scenery } = info;
  const [settled, setSettled] = useState<ArrivalScenery>();
  useEffect(() => {
    if (!kind || !scenery) return;
    let isCurrent = true;
    const settle = () => {
      if (isCurrent) setSettled(scenery);
    };
    const timer = setTimeout(settle, SCENERY_WAIT_MS);
    void scenery.sceneryReady().then(settle, settle);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [kind, scenery]);
  const isStageable =
    !!kind && !!scenery && settled === scenery && !!info.map && !isPending;
  useEffect(() => {
    if (!isStageable || !kind || !scenery) {
      setScene(undefined);
      return;
    }
    const { map, sector, getPosition, getNow } = infoRef.current;
    const player = getPosition();
    if (!map || !player) return;
    const isReduced = prefersReducedMotion();
    const now = getNow();
    const startAt = isReduced ? now - REDUCED_HEAD_START_MS : now;
    const plan = planArrivalScene({
      kind,
      player,
      isOpen: (tile) => isWanderTile(getSectorTile(map, tile), false),
      isCovered: (tile) => scenery.isTileCovered(sector, tile),
      startAt,
      previousLemu: lemuRef.current,
    });
    if (!plan) return;
    lemuRef.current = plan.cast
      .find((entry) => entry.role === "lemu")
      ?.walk.tiles.at(-1);
    setScene({ plan, startAt });
    if (plan.kind !== "ambush" || isReduced) return;
    setPlaying(true);
    setFlash((count) => count + 1);
    const timers = [
      setTimeout(() => setSmoke((count) => count + 1), plan.smokeAt),
      setTimeout(() => setPlaying(false), plan.endsAt),
    ];
    return () => {
      timers.forEach(clearTimeout);
      setPlaying(false);
    };
  }, [kind, isStageable, scenery, setPlaying]);

  // The frame loop asks for the merged list every frame; it is rebuilt only when the
  // players or the figures on the map change.
  const merged = useRef<{ users: SectorUser[]; key: string; result: SectorUser[] }>(
    undefined,
  );
  const withCast = (users: SectorUser[]): SectorUser[] => {
    if (!scene) return users;
    const elapsed = infoRef.current.getNow() - scene.startAt;
    const cast = arrivalSceneActors(
      scene.plan,
      elapsed,
      art ?? {},
      infoRef.current.sector,
    );
    const key = `${scene.startAt}:${cast
      .map((actor) => `${actor.userId}@${actor.npcWalk?.startAt}`)
      .join("|")}`;
    const previous = merged.current;
    if (previous?.users === users && previous.key === key) return previous.result;
    merged.current = { users, key, result: [...users, ...cast] };
    if (previous?.key !== key) infoRef.current.onCastChange();
    return merged.current.result;
  };
  const withCastRef = useRef(withCast);
  useLayoutEffect(() => {
    withCastRef.current = withCast;
  });

  return {
    withCast: (users: SectorUser[]) => withCastRef.current(users),
    marker: scene?.plan.marker ?? null,
    kind: scene?.plan.kind,
    flash,
    smoke,
  };
};

/** What the scene asks of the rendered map. */
type ArrivalScenery = Pick<TravelScene, "sceneryReady" | "isTileCovered">;

/** Longest the scene waits for scenery to stand its figures clear of. */
const SCENERY_WAIT_MS = 4000;

/** Long enough before now that a scene staged without motion has ended. */
const REDUCED_HEAD_START_MS = 60_000;

const prefersReducedMotion = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
