import { memo, useEffect, useRef } from "react";
import type { CsSfx } from "@/drizzle/constants";
import { useGameScene } from "@/hooks/game-scene";
import { useLpcCatalogLoader } from "@/hooks/lpc";
import WebGlError from "@/layout/WebGLError";
import type { CsStage } from "@/libs/chakraStorm/content";
import type { RosterCharacter } from "@/libs/rendering/primitives/rosterArt";
import {
  type ChakraStormSceneView,
  createChakraStormScene,
} from "@/libs/rendering/scenes/chakraStorm";
import type { SpriteAppearance } from "@/validators/lpc";

/** The battlefield canvas; live run data reaches the renderer through refs, not renders. */
const ChakraStormArenaInner = (props: ChakraStormArenaProps) => {
  const mount = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  const loadLpcCatalog = useLpcCatalogLoader();
  const { error } = useGameScene(
    "chakra-storm",
    mount,
    async (element, signal, onError) =>
      createChakraStormScene({
        mount: element,
        signal,
        onError,
        seed: props.runId,
        stage: props.stage,
        lpcCatalog: await loadLpcCatalog().catch(() => undefined),
        appearance: props.appearance,
        roster: props.roster,
        onFrame: (delta) => latest.current.onFrame(delta),
        playSound: (cue, volume) => latest.current.playSound(cue, volume),
        getView: () => latest.current.getView(),
      }),
    props.runId,
  );
  if (error) return <WebGlError />;
  return (
    <div
      ref={mount}
      className="absolute inset-0 touch-none overflow-hidden select-none [&>canvas]:absolute [&>canvas]:inset-0"
    />
  );
};

export const ChakraStormArena = memo(ChakraStormArenaInner);

interface ChakraStormArenaProps {
  runId: string;
  stage: CsStage;
  appearance: SpriteAppearance;
  roster: (RosterCharacter & { level: number })[];
  onFrame: (delta: number) => void;
  playSound: (cue: CsSfx, volume: number) => void;
  getView: () => ChakraStormSceneView;
}
