import { memo, useEffect, useRef } from "react";
import type { TdSfx } from "@/drizzle/constants";
import type { GameAsset } from "@/drizzle/schema";
import { useGameScene } from "@/hooks/game-scene";
import { useLpcCatalogLoader } from "@/hooks/lpc";
import WebGlError from "@/layout/WebGLError";
import {
  createTowerDefenseScene,
  type TowerDefenseRosterEntry,
  type TowerDefenseSceneView,
} from "@/libs/rendering/scenes/towerDefense";
import { cn } from "@/libs/shadui";
import type { SpriteAppearance } from "@/validators/lpc";

/** The arena canvas; live run data reaches the renderer through refs, not renders. */
const TowerDefenseArenaInner = (props: TowerDefenseArenaProps) => {
  const mount = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  const loadLpcCatalog = useLpcCatalogLoader();
  const { error } = useGameScene(
    "tower-defense",
    mount,
    async (element, signal, onError) =>
      createTowerDefenseScene({
        mount: element,
        signal,
        onError,
        seed: props.runId,
        lpcCatalog: await loadLpcCatalog().catch(() => undefined),
        appearance: props.appearance,
        roster: props.roster,
        hitAsset: props.hitAsset,
        smokeAsset: props.smokeAsset,
        onFrame: (delta) => latest.current.onFrame(delta),
        playSound: (cue, volume) => latest.current.playSound(cue, volume),
        getView: () => latest.current.getView(),
        onTap: (point, hit) => latest.current.onTap(point, hit),
      }),
    props.runId,
  );
  if (error) return <WebGlError />;
  // The box sets the canvas size: 5:4 within the page, or the whole stage in full screen.
  return (
    <div
      ref={mount}
      className={cn(
        "relative w-full touch-none select-none overflow-hidden [&>canvas]:absolute [&>canvas]:inset-0",
        props.fill ? "h-full" : "aspect-[5/4] max-h-[70vh] min-h-[320px]",
      )}
    />
  );
};

export const TowerDefenseArena = memo(TowerDefenseArenaInner);

interface TowerDefenseArenaProps {
  runId: string;
  appearance: SpriteAppearance;
  roster: TowerDefenseRosterEntry[];
  hitAsset?: GameAsset;
  smokeAsset?: GameAsset;
  /** Fill the container's height, as in full screen, instead of sizing from the width. */
  fill?: boolean;
  onFrame: (delta: number) => void;
  playSound: (cue: TdSfx, volume: number) => void;
  getView: () => TowerDefenseSceneView;
  onTap: (
    point: { x: number; y: number },
    hit: { enemyId?: number; lootId?: number },
  ) => void;
}
