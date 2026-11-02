"use client";

import { ImageOff, Music2, Volume2 } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import type { GameAsset } from "@/drizzle/schema";
import ContentImage from "@/layout/ContentImage";
import Image from "@/layout/Image";
import { buildLpcCatalog, lpcFrame, spriteLayerSheets } from "@/libs/lpc/catalog";
import { cn } from "@/libs/shadui";
import { bunnyImageUrl, textureImageUrl } from "@/utils/image";

/** Show still artwork, opt-in animation playback, or a silent audio placeholder. */
export function GameAssetPreview({
  asset,
  className,
  play = false,
  background,
  renditionWidth = 320,
}: {
  asset: Pick<GameAsset, "name" | "image" | "type" | "frames" | "speed"> &
    Partial<Pick<GameAsset, "id" | "lpcConfig">>;
  className?: string;
  play?: boolean;
  background?: PreviewBackground;
  /** Static-image CDN width; fill layouts do not provide the Image wrapper a width. */
  renditionWidth?: number;
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const isAudio = asset.type === "SFX" || asset.type === "MUSIC";
  const handleError = useCallback(() => setFailedImage(asset.image), [asset.image]);
  const Icon = asset.type === "MUSIC" ? Music2 : Volume2;

  return (
    <div
      className={cn(
        "relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden",
        background === "checkerboard"
          ? "bg-white [background-image:conic-gradient(#e2e8f0_25%,transparent_0_50%,#e2e8f0_0_75%,transparent_0)] [background-size:16px_16px]"
          : background === "dark" || (!background && asset.type === "ANIMATION")
            ? "bg-slate-800"
            : background === "light"
              ? "bg-slate-100"
              : "bg-slate-100 dark:bg-slate-900",
        className,
      )}
    >
      {asset.type === "LPC" && asset.lpcConfig ? (
        <LpcThumbnail name={asset.name} config={asset.lpcConfig} />
      ) : isAudio ? (
        <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
          <Icon className="size-8" strokeWidth={1.5} />
          <div className="flex h-10 items-center gap-1" aria-hidden="true">
            {[12, 24, 36, 20, 32, 16, 28, 12].map((height, i) => (
              <span
                key={i}
                className="w-1 rounded-full bg-current opacity-35"
                style={{ height }}
              />
            ))}
          </div>
        </div>
      ) : failedImage === asset.image ? (
        <div className="text-muted-foreground flex flex-col items-center gap-2 text-xs">
          <ImageOff className="size-6" />
          Preview unavailable
        </div>
      ) : asset.type === "ANIMATION" ? (
        <div className="absolute inset-2 flex items-center justify-center [&_canvas]:!max-h-full [&_canvas]:!max-w-full [&_canvas]:object-contain">
          <ContentImage
            image={asset.image}
            alt={asset.name}
            frames={asset.frames}
            speed={asset.speed}
            paused={!play}
            onError={handleError}
            hideBorder
            className="!max-h-full !max-w-full"
          />
        </div>
      ) : (
        <Image
          src={bunnyImageUrl(asset.image, renditionWidth)}
          alt={asset.name}
          fill
          sizes="(max-width: 640px) 45vw, 240px"
          className="object-contain p-2"
          onError={handleError}
        />
      )}
    </div>
  );
}

/** Fit layered neutral poses to each card while preserving native atlas crops and logical offsets. */
function LpcThumbnail({
  name,
  config,
}: {
  name: string;
  config: NonNullable<GameAsset["lpcConfig"]>;
}) {
  const catalog = buildLpcCatalog([{ id: "preview", lpcConfig: config }]);
  const appearance = { version: 1 as const, body: "male" as const, layers: [] };
  const sheets = spriteLayerSheets(catalog, appearance, {
    profile: "preview",
    color: config.defaultColor,
    eyes: config.defaultEyes,
  });
  const hasStand = sheets.some((sheet) => catalog.layouts[sheet.layout]?.clips.stand);
  const layers = sheets.flatMap((sheet, index) => {
    if (hasStand && !catalog.layouts[sheet.layout]?.clips.stand) return [];
    const sample = lpcFrame(catalog, sheet, "stand", 2, 0);
    return sample ? [{ sheet, sample, index }] : [];
  });
  const size = Math.max(1, ...layers.map(({ sample }) => sample.size));
  return (
    <svg
      role="img"
      aria-label={name}
      viewBox={`0 0 ${size} ${size}`}
      className="pointer-events-none absolute inset-0 m-auto h-full w-full"
      style={{ maxWidth: size * 1.5, maxHeight: size * 1.5 }}
    >
      {/* A shared viewBox fits 64–192px cells into compact cards without scaling atlas coordinates. */}
      <foreignObject width={size} height={size}>
        <div className="relative isolate h-full w-full">
          {layers.map(({ sheet, sample, index }) => (
            <div
              key={`${sheet.image}-${index}`}
              className="absolute"
              style={{
                width: sample.width,
                height: sample.height,
                left: (size - sample.size) / 2 + (sample.trim?.x ?? 0),
                top: (size - sample.size) / 2 + (sample.trim?.y ?? 0),
                zIndex: sheet.z + 1000,
                backgroundImage: `url("${textureImageUrl(sheet.image, 0)}")`,
                backgroundPosition: `-${sample.x}px -${sample.y}px`,
                imageRendering: "pixelated",
              }}
            />
          ))}
        </div>
      </foreignObject>
    </svg>
  );
}

/** Choose contrasting backgrounds for inspecting transparent artwork. */
export function AssetPreviewBackgroundControls({
  value,
  onChange,
}: {
  value: PreviewBackground;
  onChange: (value: PreviewBackground) => void;
}) {
  return (
    <fieldset
      className="flex flex-wrap items-center gap-1.5"
      aria-label="Preview background"
    >
      <span className="text-muted-foreground mr-1 text-xs">Background</span>
      {(["light", "dark", "checkerboard"] as const).map((background) => (
        <Button
          type="button"
          key={background}
          variant="outline"
          size="sm"
          className={cn(
            "h-8 gap-1.5 px-2",
            value === background && "ring-primary ring-1",
          )}
          aria-label={`${background} preview background`}
          aria-pressed={value === background}
          onClick={() => onChange(background)}
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-3 rounded-sm border border-slate-400",
              background === "dark"
                ? "bg-slate-800"
                : background === "light"
                  ? "bg-slate-100"
                  : "bg-[size:6px_6px] bg-[conic-gradient(#94a3b8_25%,white_0_50%,#94a3b8_0_75%,white_0)]",
            )}
          />
          {background === "checkerboard"
            ? "Grid"
            : background === "dark"
              ? "Dark"
              : "Light"}
        </Button>
      ))}
    </fieldset>
  );
}

type PreviewBackground = "light" | "dark" | "checkerboard";
