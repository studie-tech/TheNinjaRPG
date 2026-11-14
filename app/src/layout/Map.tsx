import { Cloud, Flag, ScrollText, ZoomIn, ZoomOut } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { MAP_WAR_TORN_BATTLEGROUND_SECTOR } from "@/drizzle/constants";
import type { Village } from "@/drizzle/schema";
import { useGameScene } from "@/hooks/game-scene";
import { useLocalStorage } from "@/hooks/localstorage";
import { useTutorialStep } from "@/hooks/tutorial";
import WebGlError from "@/layout/WebGLError";
import { getObjectiveImage } from "@/libs/objectives";
import {
  createGlobeScene,
  type GlobeHoverPoint,
  type GlobeLayers,
  type GlobeSceneState,
} from "@/libs/rendering/scenes/globe";
import type { GlobalMapData } from "@/libs/sector-map/world-types";
import { calcGlobalTravelTime } from "@/libs/travel";
import { getReadableVillageHexColor } from "@/utils/color";
import { selectUserWithoutPosition, useUserDataSelector } from "@/utils/UserContext";
import type { GlobeJourney } from "@/validators/travel";

interface MapProps {
  highlights?: Village[];
  usersHighlighted?: {
    userId: string;
    sector: number;
    avatar: string | null;
    avatarLight: string | null;
    username?: string;
  }[];
  userLocation?: boolean;
  hexasphere: GlobalMapData;
  showOwnership?: boolean;
  /** Slowly spin the globe while the user is idle (default on) */
  autoRotate?: boolean;
  actionExplanation?: string;
  focusSector?: number | null;
  /** Sector of a trip awaiting confirmation; the route arc keeps pointing at it. */
  routeTarget?: number | null;
  /** Confirmed journey whose marker follows the same deadline as the countdown. */
  journey?: GlobeJourney | null;
  /** Receive the picked world sector ID for travel, editing or war selection. */
  onTileClick?: (sector: number) => void;
}

const GlobalMap: React.FC<MapProps> = (props) => {
  const { data: userData, timeDiff } = useUserDataSelector(selectUserWithoutPosition);
  const { currentStep } = useTutorialStep();
  // Hover lives outside React state here so only the hover cards re-render per sector.
  const [hover] = useState(createHoverStore);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [layers, setLayers] = useLocalStorage<GlobeLayers>("globeLayers", {
    labels: true,
    quests: true,
    clouds: true,
  });
  const { hexasphere, showOwnership } = props;
  const { data: ownershipData } = api.village.getSectorOwnerships.useQuery(
    { onlyOwnWar: true },
    { enabled: showOwnership },
  );
  // Objectives already done are not marked, so a quest that visits several
  // sectors only points at where the player still has to go.
  const questGoals = useMemo(
    () =>
      userData?.userQuests.flatMap((entry) => {
        const goals = userData.questData?.find((q) => q.id === entry.questId)?.goals;
        return entry.quest.content.objectives.flatMap((objective) =>
          "sector" in objective &&
          objective.sector &&
          !("hideLocation" in objective && objective.hideLocation) &&
          objective.task !== "dialog" &&
          !goals?.find((goal) => goal.id === objective.id)?.done
            ? [
                {
                  sector: objective.sector,
                  quest: entry.quest.name,
                  goal: getObjectiveImage(objective).title,
                  details: plainText(objective.description),
                },
              ]
            : [],
        );
      }) ?? [],
    [userData],
  );
  const questSectors = useMemo(
    () => questGoals.map((goal) => goal.sector),
    [questGoals],
  );
  const hasQuestMarkers =
    !!props.userLocation && !showOwnership && questSectors.length > 0;
  const actionExplanation = props.actionExplanation || "Click tile to move there";
  const isTravelStep = currentStep?.advanceOn === "travelArrive";
  // Memoized so hover re-renders (the sector card) do not push a scene update.
  const state: GlobeSceneState = useMemo(
    () => ({
      map: hexasphere,
      highlights: props.highlights,
      usersHighlighted: props.usersHighlighted,
      user: userData,
      clanVillageId: userData?.clan?.villageId,
      userLocation: props.userLocation,
      showOwnership,
      ownership: ownershipData,
      autoRotate: props.autoRotate ?? true,
      isTravelStep,
      focusSector: props.focusSector,
      questSectors,
      timeDiff,
      routeTarget: props.routeTarget,
      journey: props.journey,
      layers,
    }),
    [
      hexasphere,
      props.highlights,
      props.usersHighlighted,
      userData,
      props.userLocation,
      showOwnership,
      ownershipData,
      props.autoRotate,
      isTravelStep,
      props.focusSector,
      questSectors,
      timeDiff,
      props.routeTarget,
      props.journey,
      layers,
    ],
  );
  const current = useRef({ state, props });
  // Layout effects run before the scene's factory effect, so it reads this render's values.
  useLayoutEffect(() => {
    current.current = { state, props };
  });
  const { scene, error } = useGameScene(
    "globe",
    mountRef,
    async (mount, signal, onError) => {
      const instance = await createGlobeScene({
        mount,
        signal,
        onError,
        state: current.current.state,
        onHover: hover.set,
        onClick: (sector) => current.current.props.onTileClick?.(sector),
      });
      if (!signal.aborted) instance.updateState(current.current.state);
      return instance;
    },
    hexasphere,
  );
  useEffect(() => {
    scene.current?.updateState(state);
  }, [state]);

  return (
    // The overlay labels anchor to this wrapper (the map itself), so they sit
    // on the globe no matter what page embeds the component
    <div className="relative h-full w-full" style={GLOBE_SKY_STYLE}>
      <div ref={mountRef} id={"tutorial-global-map"}></div>
      {error && <WebGlError />}
      <div className="pointer-events-none absolute top-0 left-0 m-5 text-white [text-shadow:0_1px_2px_rgb(0_0_0)]">
        <ul>
          {showOwnership && (
            <OwnerCard
              hover={hover}
              ownership={ownershipData}
              explanation={actionExplanation}
            />
          )}
        </ul>
      </div>
      {!showOwnership && (
        <SectorCard
          hover={hover}
          map={hexasphere}
          villages={props.highlights}
          fromSector={
            props.userLocation && userData?.status !== "TRAVEL"
              ? userData?.sector
              : undefined
          }
          quests={hasQuestMarkers ? questGoals : NO_GOALS}
          targets={props.usersHighlighted}
          focusSector={props.focusSector}
          focusLabel={userData?.status === "TRAVEL" ? "Destination" : "Search target"}
          explanation={actionExplanation}
        />
      )}
      <div className="absolute bottom-0 left-0 m-3 flex flex-col gap-2">
        {LAYER_TOGGLES.filter(
          (toggle) => toggle.key !== "quests" || props.userLocation,
        ).map(({ key, label, Icon }) => (
          <Button
            key={key}
            type="button"
            variant="secondary"
            size="icon"
            aria-label={`${layers[key] ? "Hide" : "Show"} ${label}`}
            aria-pressed={layers[key]}
            title={label}
            className={layers[key] ? "" : "opacity-50"}
            onClick={() => setLayers({ ...layers, [key]: !layers[key] })}
          >
            <Icon className="h-5 w-5" />
          </Button>
        ))}
      </div>
      <div className="absolute right-0 bottom-0 m-3 flex flex-col gap-2">
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label="Zoom in"
          onClick={() => scene.current?.zoom(0.8)}
        >
          <ZoomIn className="h-5 w-5" />
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label="Zoom out"
          onClick={() => scene.current?.zoom(1.25)}
        >
          <ZoomOut className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
};

export default GlobalMap;

/**
 * What the hovered sector holds (quests with their goal, bounty targets, the search
 * target, the village) and what reaching it costs. It opens beside the pointer, on
 * whichever side keeps it inside the map.
 */
const SectorCard: React.FC<{
  hover: HoverStore;
  map: GlobalMapData;
  villages?: Village[];
  fromSector?: number;
  quests: QuestGoal[];
  targets?: { sector: number; username?: string }[];
  focusSector?: number | null;
  focusLabel: string;
  explanation: string;
}> = ({
  hover,
  map,
  villages,
  fromSector,
  quests,
  targets,
  focusSector,
  focusLabel,
  explanation,
}) => {
  const hovered = useSyncExternalStore(hover.subscribe, hover.get, hover.get);
  if (!hovered) return null;
  const { sector, at } = hovered;
  const village = villages?.find((entry) => entry.sector === sector);
  const here = quests.filter((goal) => goal.sector === sector);
  const hunted = targets?.filter((user) => user.sector === sector) ?? [];
  const biome = BIOME_NAMES[map.tiles[sector]?.t ?? 1] ?? "Wilderness";
  const isHere = fromSector === sector;
  const seconds =
    fromSector !== undefined && !isHere
      ? calcGlobalTravelTime(fromSector, sector, map)
      : null;
  // Transform-only placement keeps moving the card on the compositor; it opens on the
  // side of the pointer that keeps it inside the map.
  const position: React.CSSProperties = at
    ? {
        left: 0,
        top: 0,
        transform: `translate(${at.x}px, ${at.y}px) translate(${
          at.x > at.width * 0.55 ? "calc(-100% - 18px)" : "18px"
        }, ${at.y > at.height * 0.6 ? "calc(-100% - 12px)" : "12px"})`,
      }
    : { top: 12, right: 12 };
  return (
    <div
      className="pointer-events-none absolute z-10 flex w-60 flex-col gap-1.5 rounded-lg border border-white/20 bg-black/85 px-3 py-2 text-white [contain:layout_paint]"
      style={position}
    >
      <span className="text-[10px] tracking-wide text-white/65 uppercase">
        Sector {sector} ·{" "}
        {sector === MAP_WAR_TORN_BATTLEGROUND_SECTOR ? "War zone" : biome}
      </span>
      {village && (
        <span
          className="truncate text-sm font-semibold"
          style={{ color: getReadableVillageHexColor(village.hexColor) }}
        >
          {village.mapName || village.name}
        </span>
      )}
      {here.map((goal) => (
        <span
          key={`${goal.quest}-${goal.goal}`}
          className="flex flex-col border-l-2 border-amber-400 pl-2"
        >
          <span className="text-sm font-semibold text-amber-300">{goal.quest}</span>
          <span className="text-xs">{goal.goal}</span>
          {goal.details && (
            <span className="line-clamp-2 text-xs text-white/70">{goal.details}</span>
          )}
        </span>
      ))}
      {hunted.length > 0 && (
        <span className="flex flex-col border-l-2 border-red-500 pl-2">
          <span className="text-sm font-semibold text-red-300">Bounty target</span>
          <span className="truncate text-xs">
            {hunted.map((user) => user.username ?? "Unknown").join(", ")}
          </span>
        </span>
      )}
      {focusSector === sector && (
        <span className="border-l-2 border-purple-400 pl-2 text-sm text-purple-200">
          {focusLabel}
        </span>
      )}
      {sector === MAP_WAR_TORN_BATTLEGROUND_SECTOR && (
        <span className="text-sm text-red-300">
          Free-for-all PvP: anyone can attack
        </span>
      )}
      <span className="flex items-center justify-between gap-2 text-xs text-white/65">
        <span>{isHere ? "You are here" : explanation}</span>
        {seconds !== null && (
          <span className="shrink-0 font-semibold text-white">
            {seconds === 0 ? "Instant" : `${seconds}s`}
          </span>
        )}
      </span>
    </div>
  );
};

/** Owner of the hovered sector in the ownership view. */
const OwnerCard: React.FC<{
  hover: HoverStore;
  ownership?: {
    sectors: { sector: number; villageId: string }[];
    colors: { id: string; hexColor: string; name: string; mapName?: string | null }[];
  };
  explanation: string;
}> = ({ hover, ownership, explanation }) => {
  const hovered = useSyncExternalStore(hover.subscribe, hover.get, hover.get);
  if (!hovered) return null;
  const { sector } = hovered;
  const owned = ownership?.sectors.find((entry) => entry.sector === sector);
  const owner = owned
    ? ownership?.colors.find((village) => village.id === owned.villageId)
    : undefined;
  return (
    <li className="flex min-w-36 items-center gap-2 rounded-lg border border-white/20 bg-black/85 px-3 py-2">
      <span
        className="h-3 w-3 shrink-0 rounded-sm border border-white/50 shadow-sm"
        style={{ backgroundColor: getReadableVillageHexColor(owner?.hexColor ?? "") }}
      />
      <span className="flex min-w-0 flex-col">
        <span className="text-[10px] tracking-wide text-white/65 uppercase">
          Sector {sector} · Owned by
        </span>
        <span className="truncate text-sm font-semibold text-white">
          {owner?.mapName ?? owner?.name ?? (owned ? "Claimed" : "Unclaimed")}
        </span>
        <span className="text-xs text-white/65">{explanation}</span>
      </span>
    </li>
  );
};

/**
 * The hovered sector and where the pointer was when it entered (canvas CSS pixels),
 * shared by the scene (writer) and the hover cards (readers). Snapshots only change
 * when the sector does, so moving within one sector re-renders nothing.
 */
const createHoverStore = () => {
  let hovered: { sector: number; at: GlobeHoverPoint | null } | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => hovered,
    set: (sector: number | null, at: GlobeHoverPoint | null) => {
      if ((hovered?.sector ?? null) === sector) return;
      hovered = sector === null ? null : { sector, at };
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

type HoverStore = ReturnType<typeof createHoverStore>;

/** An unfinished quest objective placed on the map. */
type QuestGoal = { sector: number; quest: string; goal: string; details: string };

const NO_GOALS: QuestGoal[] = [];

/** Objective text without markup, for a short preview. */
const plainText = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Names for the globe's terrain ids (`globalBiomeType`). */
const BIOME_NAMES = ["Ocean", "Grassland", "Desert", "Snowfield"];

const LAYER_TOGGLES = [
  { key: "labels", label: "village banners", Icon: Flag },
  { key: "quests", label: "quest markers", Icon: ScrollText },
  { key: "clouds", label: "clouds", Icon: Cloud },
] as const satisfies { key: keyof GlobeLayers; label: string; Icon: unknown }[];

/** Night sky behind the transparent globe canvas: a soft nebula over two tiled star layers. */
const GLOBE_SKY_STYLE: React.CSSProperties = {
  backgroundColor: "#0b1226",
  backgroundImage: [
    "radial-gradient(1px 1px at 23px 41px, rgba(255,255,255,0.85), transparent)",
    "radial-gradient(1px 1px at 131px 87px, rgba(255,255,255,0.6), transparent)",
    "radial-gradient(1.5px 1.5px at 71px 163px, rgba(255,244,214,0.9), transparent)",
    "radial-gradient(1px 1px at 187px 19px, rgba(214,230,255,0.7), transparent)",
    "radial-gradient(1px 1px at 47px 211px, rgba(255,255,255,0.5), transparent)",
    "radial-gradient(1.5px 1.5px at 59px 29px, rgba(214,230,255,0.8), transparent)",
    "radial-gradient(1px 1px at 113px 131px, rgba(255,255,255,0.45), transparent)",
    "radial-gradient(ellipse at 30% 25%, rgba(88,70,160,0.35), transparent 60%)",
    "radial-gradient(ellipse at 75% 80%, rgba(30,90,140,0.35), transparent 55%)",
  ].join(","),
  backgroundSize:
    "229px 229px, 229px 229px, 229px 229px, 229px 229px, 229px 229px, 157px 157px, 157px 157px, 100% 100%, 100% 100%",
};
