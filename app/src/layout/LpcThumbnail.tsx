import { useId } from "react";
import { cn } from "@/libs/shadui";
import { textureImageUrl } from "@/utils/image";
import type { LpcBody } from "@/validators/lpc";
import type { LpcConfig } from "@/validators/lpcAsset";

/** Static authored standing frames share browser image requests and never create render loops. */
export const LpcThumbnail = ({
  config,
  body = "male",
  className,
  label,
}: {
  config: LpcConfig;
  body?: LpcBody;
  className?: string;
  label: string;
}) => {
  const id = useId();
  const sheets = [
    ...(config.variants[`${body}/${config.defaultColor}/${config.defaultEyes}`] ?? []),
  ].sort((a, b) => a.z - b.z);
  const bounds = sheets.map((sheet) => {
    const layout = (sheet.travel ?? sheet).layout;
    return {
      x: (64 - layout.cell) / 2 + (layout.trim?.x ?? 0),
      y: (64 - layout.cell) / 2 + (layout.trim?.y ?? 0),
      width: layout.trim?.width ?? layout.cell,
      height: layout.trim?.height ?? layout.cell,
    };
  });
  const occupiedLeft = Math.min(...bounds.map((box) => box.x)),
    occupiedTop = Math.min(...bounds.map((box) => box.y));
  const right = Math.max(...bounds.map((box) => box.x + box.width)),
    bottom = Math.max(...bounds.map((box) => box.y + box.height));
  const viewBox = bounds.length
    ? `${occupiedLeft - 2} ${occupiedTop - 2} ${right - occupiedLeft + 4} ${bottom - occupiedTop + 4}`
    : "0 0 64 64";
  return (
    <svg
      viewBox={viewBox}
      role="img"
      aria-label={label}
      className={cn("size-20 shrink-0", className)}
      style={{ imageRendering: "pixelated" }}
    >
      {sheets.map((sheet, index) => {
        const atlas = sheet.travel ?? sheet;
        const { layout } = atlas;
        const frame = layout.clips.stand?.[2]?.[0] ?? layout.clips.walk?.[2]?.[0];
        if (frame === undefined) return null;
        const width = layout.trim?.width ?? layout.cell,
          height = layout.trim?.height ?? layout.cell;
        const gutter = layout.trim ? 1 : 0;
        const x = (frame % layout.columns) * (width + 2 * gutter) + gutter;
        const y = Math.floor(frame / layout.columns) * (height + 2 * gutter) + gutter;
        const rows = Math.ceil(
          (Math.max(...Object.values(layout.clips).flat(2)) + 1) / layout.columns,
        );
        const left = (64 - layout.cell) / 2 + (layout.trim?.x ?? 0),
          top = (64 - layout.cell) / 2 + (layout.trim?.y ?? 0);
        const clip = `${id}-${index}`;
        return (
          <g key={index}>
            <defs>
              <clipPath id={clip}>
                <rect x={left} y={top} width={width} height={height} />
              </clipPath>
            </defs>
            <image
              clipPath={`url(#${clip})`}
              href={textureImageUrl(atlas.image, 0)}
              x={left - x}
              y={top - y}
              width={layout.columns * (width + 2 * gutter)}
              height={rows * (height + 2 * gutter)}
            />
          </g>
        );
      })}
    </svg>
  );
};
