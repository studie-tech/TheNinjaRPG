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
  HEX_ASPECT_RATIO,
} from "@/drizzle/constants";
import {
  type BattlefieldViewport,
  battlefieldSceneOf,
  sceneAssetIds,
  sceneSoundIds,
} from "@/libs/contentReview/battlefield";
import { EFFECT_ANIMATION_HEX_RATIO } from "@/libs/rendering/animation";
import {
  createBattlefieldPreview,
  type BattlefieldPreview as FieldPreview,
  previewHexWidth,
} from "@/libs/rendering/scenes/battlefieldPreview";

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
    const controller = new AbortController();
    let disposed = false;
    let preview: FieldPreview | null = null;
    let observer: IntersectionObserver | null = null;
    setIsUnsupported(false);
    void createBattlefieldPreview({
      signal: controller.signal,
      scene: JSON.parse(signature),
      assets: assets ?? [],
      viewport,
      background,
      zoom,
      sounds: JSON.parse(soundSignature),
    })
      .then((instance) => {
        if (disposed) {
          instance?.dispose();
          return;
        }
        if (!instance) {
          setIsUnsupported(true);
          return;
        }
        preview = instance;
        preview.canvas.style.width = "100%";
        preview.canvas.style.height = "auto";
        preview.canvas.style.maxWidth = `${preview.width}px`;
        mount.appendChild(preview.canvas);
        previewRef.current = preview;
        if (isSoundOnRef.current) preview.setSound(true);
        observer = new IntersectionObserver(([entry]) =>
          entry?.isIntersecting ? instance.play() : instance.pause(),
        );
        observer.observe(mount);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          console.error("Battlefield preview failed", error);
          setIsUnsupported(true);
        }
      });
    return () => {
      disposed = true;
      controller.abort();
      observer?.disconnect();
      if (previewRef.current === preview) previewRef.current = null;
      preview?.dispose();
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
        size: hexes are {Math.round(previewHexWidth(viewport))} px wide and 1×
        animations{" "}
        {Math.round(
          previewHexWidth(viewport) * HEX_ASPECT_RATIO * EFFECT_ANIMATION_HEX_RATIO,
        )}{" "}
        px tall, multiplied by each effect’s animation scale. Caster on the left, target
        on the right, ground effects on the tile between them.
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
