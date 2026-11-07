import { ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import type { Village } from "@/drizzle/schema";
import { useGameScene } from "@/hooks/game-scene";
import { useTutorialStep } from "@/hooks/tutorial";
import WebGlError from "@/layout/WebGLError";
import { createGlobeScene, type GlobeSceneState } from "@/libs/rendering/scenes/globe";
import type { GlobalMapData } from "@/libs/sector-map/world-types";
import { getReadableVillageHexColor } from "@/utils/color";
import { useUserData } from "@/utils/UserContext";

interface MapProps {
  highlights?: Village[];
  usersHighlighted?: {
    userId: string;
    sector: number;
    avatar: string | null;
    avatarLight: string | null;
  }[];
  userLocation?: boolean;
  hexasphere: GlobalMapData;
  showOwnership?: boolean;
  /** Slowly spin the globe while the user is idle (default on) */
  autoRotate?: boolean;
  actionExplanation?: string;
  focusSector?: number | null;
  /** Receive the picked world sector ID for travel, editing or war selection. */
  onTileClick?: (sector: number) => void;
}

const GlobalMap: React.FC<MapProps> = (props) => {
  const { data: userData } = useUserData();
  const { currentStep } = useTutorialStep();
  const [hoverSector, setHoverSector] = useState<number | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const { hexasphere, showOwnership } = props;
  const { data: ownershipData } = api.village.getSectorOwnerships.useQuery(
    { onlyOwnWar: true },
    { enabled: showOwnership },
  );
  // Objectives already done are not marked, so a quest that visits several
  // sectors only points at where the player still has to go.
  const questSectors =
    userData?.userQuests.flatMap((entry) => {
      const goals = userData.questData?.find((q) => q.id === entry.questId)?.goals;
      return entry.quest.content.objectives.flatMap((objective) =>
        "sector" in objective &&
        objective.sector &&
        !("hideLocation" in objective && objective.hideLocation) &&
        objective.task !== "dialog" &&
        !goals?.find((goal) => goal.id === objective.id)?.done
          ? [objective.sector]
          : [],
      );
    }) ?? [];
  const hasQuestMarkers =
    !!props.userLocation && !showOwnership && questSectors.length > 0;
  const actionExplanation = props.actionExplanation || "Click tile to move there";
  const state: GlobeSceneState = {
    map: hexasphere,
    highlights: props.highlights,
    usersHighlighted: props.usersHighlighted,
    user: userData,
    clanVillageId: userData?.clan?.villageId,
    userLocation: props.userLocation,
    showOwnership,
    ownership: ownershipData,
    autoRotate: props.autoRotate ?? true,
    isTravelStep: currentStep?.advanceOn === "travelArrive",
    focusSector: props.focusSector,
    questSectors,
  };
  const current = useRef({ state, props });
  current.current = { state, props };
  const { scene, error } = useGameScene(
    "globe",
    mountRef,
    async (mount, signal, onError) => {
      const instance = await createGlobeScene({
        mount,
        signal,
        onError,
        state: current.current.state,
        onHover: (sector) => setHoverSector(sector),
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

  const hoveredOwnership =
    showOwnership && hoverSector !== null
      ? ownershipData?.sectors.find((entry) => entry.sector === hoverSector)
      : undefined;
  const hoveredOwner = hoveredOwnership
    ? ownershipData?.colors.find((village) => village.id === hoveredOwnership.villageId)
    : undefined;
  const hoveredOwnerColor = getReadableVillageHexColor(hoveredOwner?.hexColor ?? "");
  const hoveredOwnerName =
    hoveredOwner?.mapName ??
    hoveredOwner?.name ??
    (hoveredOwnership ? "Claimed" : "Unclaimed");

  return (
    // The overlay labels anchor to this wrapper (the map itself), so they sit
    // on the globe no matter what page embeds the component
    <div className="relative">
      <div ref={mountRef} id={"tutorial-global-map"}></div>
      {error && <WebGlError />}
      <div className="pointer-events-none absolute top-0 left-0 m-5">
        <ul>
          {hoverSector !== null && showOwnership && (
            <li className="flex min-w-36 items-center gap-2 rounded-lg border border-white/20 bg-black/75 px-3 py-2 shadow-lg backdrop-blur-sm">
              <span
                className="h-3 w-3 shrink-0 rounded-sm border border-white/50 shadow-sm"
                style={{ backgroundColor: hoveredOwnerColor }}
              />
              <span className="flex min-w-0 flex-col">
                <span className="text-[10px] text-white/65 uppercase tracking-wide">
                  Sector {hoverSector} · Owned by
                </span>
                <span className="truncate font-semibold text-sm text-white">
                  {hoveredOwnerName}
                </span>
              </span>
            </li>
          )}
          {hasQuestMarkers && (
            <li className="flex flex-row items-center">
              <span className="mr-1 animate-pulse text-2xl text-orange-500">⬢</span>{" "}
              Quest
            </li>
          )}
          {props.focusSector !== undefined && props.focusSector !== null && (
            <li className="flex flex-row items-center">
              <span className="mr-1 animate-pulse text-2xl text-purple-500">⬢</span>{" "}
              Target
            </li>
          )}
        </ul>
      </div>
      <div className="pointer-events-none absolute top-0 right-0 m-5">
        <ul className="flex flex-col items-end gap-2">
          {hoverSector !== null && (
            <>
              <li>- Highlighting sector {hoverSector}</li>
              <li>- {actionExplanation}</li>
            </>
          )}
        </ul>
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
