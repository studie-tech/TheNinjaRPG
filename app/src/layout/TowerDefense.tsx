import type React from "react";
import { memo, useEffect, useRef } from "react";
import type { GameAsset } from "@/drizzle/schema";
import { useGameScene } from "@/hooks/game-scene";
import WebGlError from "@/layout/WebGLError";
import { createTowerDefenseScene } from "@/libs/rendering/scenes/towerDefense";
import type {
  EntityStore,
  HexPosition,
  HitEvent,
  RuntimeState,
} from "@/validators/towerDefense";

/** Stable entity refs allow server updates to reach the renderer without a React render. */
const TowerDefenseInner = (props: TowerDefenseProps) => {
  const mount = useRef<HTMLDivElement>(null),
    latest = useRef(props);
  latest.current = props;
  const { scene, error } = useGameScene(
    "tower-defense",
    mount,
    (element, signal, onError) =>
      createTowerDefenseScene({
        mount: element,
        signal,
        onError,
        seed: props.seed,
        initialGridSize: props.initialGridSize,
        initialPlayerPosition: props.initialPlayerPosition,
        onFrame: (delta) => latest.current.onFrame(delta),
        getSnapshot: () => ({
          active: latest.current.active,
          entities: latest.current.entitiesRef.current,
          runtime: latest.current.runtimeStateRef.current,
          hits: latest.current.playerHitEventsRef.current,
          impactAsset: latest.current.impactAsset,
          sfxUrl: latest.current.sfxUrl,
          sfxEnabled: latest.current.sfxEnabledRef.current,
        }),
        onTileClick: (position) => latest.current.onTileClick(position),
      }),
    props.seed,
  );
  useEffect(() => {
    scene.current?.refresh();
  }, [props.active, scene]);
  if (error) return <WebGlError />;
  return <div ref={mount} className="w-full" />;
};
const TowerDefense = memo(TowerDefenseInner);
export default TowerDefense;

interface TowerDefenseProps {
  active: boolean;
  onFrame: (delta: number) => void;
  seed: string;
  initialGridSize: number;
  initialPlayerPosition: HexPosition;
  onTileClick: (position: HexPosition) => void;
  entitiesRef: React.RefObject<EntityStore>;
  runtimeStateRef: React.RefObject<RuntimeState>;
  playerHitEventsRef: React.RefObject<HitEvent[]>;
  impactAsset?: GameAsset;
  sfxUrl?: string;
  sfxEnabledRef: React.RefObject<boolean | undefined>;
}
