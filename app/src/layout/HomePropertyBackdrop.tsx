import { useId } from "react";
import {
  type CombatBiome,
  HOME_FLOOR_TILES,
  HOME_ROOM_IDS,
  HOME_WALL_PAINTS,
  type HomeType,
  HomeTypeDetails,
  IMG_HOME_PROPERTIES,
} from "@/drizzle/constants";
import Image from "@/layout/Image";
import { HOME_ART_PLANS, type HomeArtPolygon } from "@/libs/homeRoomGeometry";
import { STRUCTURE_GROUND_TERRAIN } from "@/libs/sector-map/terrains";
import { bunnyImageUrl, transformImageUrl } from "@/utils/image";
import type { HomeRoomStyle } from "@/validators/home";

/** One complete painting supplies the property and depth masks, so walls and scenery always join. */
export const HomePropertyBackdrop = ({
  homeType,
  cameraScale,
  biome = "ground",
  styles,
  onError,
}: {
  homeType: HomeType;
  cameraScale: number;
  biome?: CombatBiome;
  styles: HomeRoomStyle[];
  onError?: () => void;
}) => {
  const id = useId();
  const plan = HOME_ART_PLANS[homeType];
  const terrain = STRUCTURE_GROUND_TERRAIN[
    biome
  ] as keyof (typeof IMG_HOME_PROPERTIES)[HomeType];
  const src = IMG_HOME_PROPERTIES[homeType][terrain];
  // A single media-selected URL keeps the painting and every depth mask pixel-identical.
  // Zoomed views use the original dimensions rather than magnifying the mobile overview.
  const mobileSrc = bunnyImageUrl(
    src,
    Math.round(plan.size * cameraScale) > 100 ? 1448 : 960,
  );
  const fullSrc = bunnyImageUrl(src, 1448);
  const size = { width: `${plan.size}%`, height: `${plan.size}%` };
  return (
    <>
      <div
        data-home-art={homeType}
        data-home-biome={terrain}
        className="pointer-events-none absolute"
        style={size}
      >
        <picture className="absolute inset-0">
          <source media="(max-width: 768px)" srcSet={mobileSrc} />
          <Image
            src={fullSrc}
            alt={`${HomeTypeDetails[homeType].name} interior and garden`}
            fill
            unoptimized
            className="select-none"
            loading="eager"
            fetchPriority="high"
            onError={onError}
          />
        </picture>
      </div>
      {styles.map((style) => {
        const index = HOME_ROOM_IDS.indexOf(style.room);
        const surfaces = plan.floorSurfaces[index];
        const texture = HOME_FLOOR_TILES[style.floor];
        if (!surfaces || !texture) return null;
        return (
          <svg
            key={style.room}
            aria-hidden
            className="pointer-events-none absolute"
            data-home-room-style={style.room}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ ...size, zIndex: 1 }}
          >
            <defs>
              {/* Share the painting origin across rooms; undo its aspect stretch for the 4:3 textures. */}
              <pattern
                id={`${id}-${style.room}-texture`}
                patternUnits="userSpaceOnUse"
                x={0}
                y={0}
                width={32}
                height={24}
                patternTransform={`scale(${1 / plan.aspectRatio} 1)`}
              >
                {/* The painting supplies the floor if this optional finish fails to load. */}
                <image
                  href={transformImageUrl(texture)}
                  width={32}
                  height={24}
                  preserveAspectRatio="xMidYMid meet"
                />
              </pattern>
              <clipPath id={`${id}-${style.room}-floor`}>
                {surfaces.map((polygon, index) => (
                  <polygon
                    key={index}
                    points={polygon.map(([x, y]) => `${x},${y}`).join(" ")}
                  />
                ))}
              </clipPath>
            </defs>
            <rect
              width={100}
              height={100}
              fill={`url(#${id}-${style.room}-texture)`}
              clipPath={`url(#${id}-${style.room}-floor)`}
            />
          </svg>
        );
      })}
      {plan.foreground.map(({ polygon, depth }, index) => (
        <div
          key={index}
          aria-hidden
          data-home-foreground={depth}
          className="pointer-events-none absolute"
          style={{
            ...size,
            zIndex: Math.round((depth * plan.size) / 10),
            clipPath: `polygon(${polygon.map(([x, y]) => `${x}% ${y}%`).join(",")})`,
          }}
        >
          <picture className="absolute inset-0">
            <source media="(max-width: 768px)" srcSet={mobileSrc} />
            <Image
              src={fullSrc}
              alt=""
              fill
              unoptimized
              className="select-none"
              loading="eager"
              onError={onError}
            />
          </picture>
          {/* The foreground restores original artwork, so its wall finish must share this depth. */}
          {styles.flatMap((style) =>
            (plan.paint[HOME_ROOM_IDS.indexOf(style.room)] ?? [])
              .filter((panel) => homeArtBoundsOverlap(panel, polygon))
              .map((panel, index) => (
                <HomeWallPaint
                  key={`${style.room}-${index}`}
                  roomStyle={style}
                  polygon={panel}
                  size={100}
                  isForeground
                />
              )),
          )}
        </div>
      ))}
      {styles.flatMap((style) =>
        (plan.paint[HOME_ROOM_IDS.indexOf(style.room)] ?? []).map((polygon, panel) => (
          <HomeWallPaint
            key={`${style.room}-${panel}`}
            roomStyle={style}
            polygon={polygon}
            size={plan.size}
          />
        )),
      )}
    </>
  );
};

/**
 * Composite paint at each artwork layer's depth so furniture keeps its occlusion.
 * Size uses world percentages for the base painting and 100% inside a clipped foreground copy.
 */
const HomeWallPaint = ({
  roomStyle,
  polygon,
  size,
  isForeground = false,
}: {
  roomStyle: HomeRoomStyle;
  polygon: HomeArtPolygon;
  size: number;
  isForeground?: boolean;
}) => (
  <svg
    aria-hidden
    data-home-wall-paint={isForeground ? undefined : roomStyle.room}
    data-home-foreground-paint={isForeground ? roomStyle.room : undefined}
    className="pointer-events-none absolute"
    viewBox="0 0 100 100"
    preserveAspectRatio="none"
    style={{
      width: `${size}%`,
      height: `${size}%`,
      mixBlendMode: "color",
      opacity: 0.7,
      zIndex: 0,
    }}
  >
    <polygon
      points={polygon.map(([x, y]) => `${x},${y}`).join(" ")}
      fill={HOME_WALL_PAINTS[roomStyle.paint]}
      fillRule="evenodd"
    />
  </svg>
);

/** Bounding boxes only cull invisible copies; the foreground's exact clip still defines coverage. */
const homeArtBoundsOverlap = (a: HomeArtPolygon, b: HomeArtPolygon) =>
  Math.min(...a.map(([x]) => x)) < Math.max(...b.map(([x]) => x)) &&
  Math.max(...a.map(([x]) => x)) > Math.min(...b.map(([x]) => x)) &&
  Math.min(...a.map(([, y]) => y)) < Math.max(...b.map(([, y]) => y)) &&
  Math.max(...a.map(([, y]) => y)) > Math.min(...b.map(([, y]) => y));
