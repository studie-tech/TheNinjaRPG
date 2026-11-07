"use client";

import { useMemo, useRef } from "react";
import { useGameScene } from "@/hooks/game-scene";
import Loader from "@/layout/Loader";
import WebGlError from "@/layout/WebGLError";
import {
  createSectorPreview,
  type SectorPreviewData,
} from "@/libs/rendering/scenes/sectorPreview";

type SectorPreviewProps = SectorPreviewData & {
  onMoveStructure?: (
    structure: { id: string; name: string },
    target: { x: number; y: number },
  ) => void;
};

/** Staff previews share the terrain and scenery used by the game renderers. */
const SectorPreview = (props: SectorPreviewProps) => {
  const mount = useRef<HTMLDivElement | null>(null);
  const current = useRef(props);
  current.current = props;
  const canMove = !!props.onMoveStructure;
  const key = useMemo(
    () => ({}),
    [
      props.map,
      props.sector,
      props.decorationAssets,
      props.terrainRegistry,
      props.structures,
      props.villageType,
      props.locations,
      props.mapAssets,
      canMove,
    ],
  );
  const { scene, error, isReady } = useGameScene(
    "sector-preview",
    mount,
    (element, signal, onError) =>
      createSectorPreview({
        mount: element,
        signal,
        onError,
        data: current.current,
        canMove: () => !!current.current.onMoveStructure,
        onMove: (structure, target) =>
          current.current.onMoveStructure?.(structure, target),
      }),
    key,
  );
  if (error) return <WebGlError />;
  return (
    <div className="relative w-full" aria-busy={!isReady}>
      <div ref={mount} className="w-full" />
      {!isReady && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader explanation="Loading sector preview" />
        </div>
      )}
      {isReady && !!scene.current?.missingAssets && (
        <p className="text-sm">
          Some scenery could not be loaded. Refresh to try again.
        </p>
      )}
    </div>
  );
};

export default SectorPreview;
