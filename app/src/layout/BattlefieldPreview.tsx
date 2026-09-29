"use client";

import { RotateCcw, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  COMBAT_BIOMES,
  type CombatBiome,
  type ContentProposalEntityType,
} from "@/drizzle/constants";
import {
  type BattlefieldViewport,
  battlefieldSceneOf,
  sceneAssetIds,
  sceneSoundIds,
} from "@/libs/contentReview/battlefield";
import {
  createBattlefieldPreview,
  type BattlefieldPreview as FieldPreview,
  previewHexWidth,
} from "@/libs/threejs/battlefieldPreview";
import { EFFECT_ANIMATION_SIZE } from "@/libs/threejs/combat";

interface BattlefieldPreviewProps {
  entityType: ContentProposalEntityType;
  /** Null for an entry that does not exist yet. */
  entityId: string | null;
  /** The entity's editable fields, current or proposed. */
  fields: Record<string, unknown>;
  /** URLs of suggested sounds that are not in the catalog yet, by the id the fields hold. */
  sounds?: Record<string, string>;
}

/**
 * An entity's effects drawn by the combat renderer on a small battlefield at the game's own
 * hex size, looping through their appear, active and disappear phases, with their sounds on
 * request.
 */
export const BattlefieldPreview: React.FC<BattlefieldPreviewProps> = (props) => {
  const { entityType, entityId, fields, sounds } = props;
  const mountRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<FieldPreview | null>(null);
  // Muted until asked: the field loops, and a desk full of suggestions should stay quiet.
  const [isSoundOn, setIsSoundOn] = useState(false);
  const isSoundOnRef = useRef(false);
  const [viewport, setViewport] = useState<BattlefieldViewport>("desktop");
  const [zoom, setZoom] = useState(1);
  const [background, setBackground] = useState<CombatBiome>("ground");
  const [isUnsupported, setIsUnsupported] = useState(false);
  const scene = battlefieldSceneOf(entityType, entityId, fields);
  const signature = JSON.stringify(scene);
  const soundSignature = JSON.stringify(sounds ?? {});
  const soundIds = sceneSoundIds(scene);
  const ids = [...new Set([...sceneAssetIds(scene), ...soundIds])].filter(
    (assetId) => !sounds?.[assetId],
  );
  const { data: assets } = api.misc.getAllGameAssetNames.useQuery(
    { ids },
    { enabled: ids.length > 0 },
  );
  const isReady = !!scene && (ids.length === 0 || !!assets);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !isReady) return;
    const preview = createBattlefieldPreview({
      scene: JSON.parse(signature),
      assets: assets ?? [],
      viewport,
      background,
      zoom,
      sounds: JSON.parse(soundSignature),
    });
    if (!preview) {
      setIsUnsupported(true);
      return;
    }
    // Never wider than a player's screen shows it, and narrower only when the panel is.
    preview.canvas.style.width = "100%";
    preview.canvas.style.height = "auto";
    preview.canvas.style.maxWidth = `${preview.width}px`;
    mount.appendChild(preview.canvas);
    previewRef.current = preview;
    if (isSoundOnRef.current) preview.setSound(true);
    // Animate only while the field is on screen.
    const observer = new IntersectionObserver(([entry]) =>
      entry?.isIntersecting ? preview.play() : preview.pause(),
    );
    observer.observe(mount);
    return () => {
      observer.disconnect();
      previewRef.current = null;
      preview.dispose();
    };
  }, [signature, soundSignature, isReady, assets, viewport, background, zoom]);

  if (!scene) {
    return <p className="text-xs opacity-70">Draws nothing on the battlefield.</p>;
  }
  if (isUnsupported) {
    return (
      <p className="text-xs opacity-70">
        This browser cannot draw the battlefield (WebGL is unavailable).
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Toggle
          options={[
            ["desktop", "Desktop"],
            ["phone", "Phone"],
          ]}
          value={viewport}
          onChange={setViewport}
        />
        <Toggle
          options={[
            [1, "1×"],
            [2, "Zoom 2×"],
          ]}
          value={zoom}
          onChange={setZoom}
        />
        <Select
          value={background}
          onValueChange={(value) => setBackground(value as CombatBiome)}
        >
          <SelectTrigger className="h-7 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COMBAT_BIOMES.map((biome) => (
              <SelectItem key={biome} value={biome}>
                {BIOME_LABELS[biome]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          onClick={() => previewRef.current?.replay()}
        >
          <RotateCcw className="mr-1 h-3 w-3" /> Replay
        </Button>
        {soundIds.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            aria-pressed={isSoundOn}
            onClick={() => {
              const next = !isSoundOn;
              isSoundOnRef.current = next;
              setIsSoundOn(next);
              previewRef.current?.setSound(next);
            }}
          >
            {isSoundOn ? (
              <Volume2 className="mr-1 h-3 w-3" />
            ) : (
              <VolumeX className="mr-1 h-3 w-3" />
            )}
            {isSoundOn ? "Sound on" : "Sound off"}
          </Button>
        )}
      </div>
      <div
        ref={mountRef}
        className="w-fit max-w-full overflow-hidden rounded-md border bg-card [&>canvas]:block"
      />
      <p className="text-xs opacity-70">
        Drawn by the combat renderer at {viewport === "desktop" ? "desktop" : "phone"}{" "}
        size: hexes are {Math.round(previewHexWidth(viewport))} px wide and animations{" "}
        {EFFECT_ANIMATION_SIZE} px. Caster on the left, target on the right, ground
        effects on the tile between them.
      </p>
    </div>
  );
};

/** Segmented control that picks one of a few values. */
const Toggle = <T extends string | number>(props: {
  options: [T, string][];
  value: T;
  onChange: (value: T) => void;
}) => (
  <div className="flex overflow-hidden rounded-md border">
    {props.options.map(([option, label]) => (
      <button
        key={String(option)}
        type="button"
        className={`px-2 py-1 ${props.value === option ? "bg-primary text-primary-foreground" : ""}`}
        onClick={() => props.onChange(option)}
      >
        {label}
      </button>
    ))}
  </div>
);

/** Names in the background picker; the combat biome key is spelled "dessert". */
const BIOME_LABELS: Record<CombatBiome, string> = {
  ocean: "Ocean",
  ground: "Ground",
  dessert: "Desert",
  ice: "Ice",
  snow: "Snow",
  arena: "Arena",
  default: "Default",
};
