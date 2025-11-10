import { useState } from "react";
import { useTutorialStep } from "@/hooks/tutorial";
import { useUserData } from "@/utils/UserContext";
import { api } from "@/app/_trpc/client";
import { MapScene } from "@/components-r3f/scenes/MapScene";
import type { Village } from "@/drizzle/schema";
import type { GlobalTile } from "@/libs/travel/types";
import type { GlobalMapData } from "@/libs/travel/types";

interface MapProps {
  highlights?: Village[];
  usersHighlighted?: {
    userId: string;
    sector: number;
    avatar: string | null;
    avatarLight: string | null;
  }[];
  userLocation?: boolean;
  highlightedSector?: number;
  intersection: boolean;
  hexasphere: GlobalMapData;
  showOwnership?: boolean;
  actionExplanation?: string;
  onTileClick?: (sector: number | null, tile: GlobalTile | null) => void;
  onTileHover?: (sector: number | null, tile: GlobalTile | null) => void;
}

const Map: React.FC<MapProps> = (props) => {
  const { data: userData } = useUserData();
  const [hoverSector, setHoverSector] = useState<number | null>(null);
  const { hexasphere, highlightedSector, showOwnership } = props;
  const actionExplanation =
    props.actionExplanation || "Double click tile to move there";

  // Get sector ownerships if needed
  const { data: ownershipData } = api.village.getSectorOwnerships.useQuery(
    { onlyOwnWar: true },
    { enabled: showOwnership },
  );

  // Tutorial step
  const { currentStep } = useTutorialStep();
  const isTravelStep = currentStep?.title === "Travel";

  return (
    <>
      <div className="relative">
        {isTravelStep && (
          <div className="absolute top-2 left-2 z-10 bg-black/80 text-white p-2 rounded">
            {actionExplanation}
          </div>
        )}
        <MapScene
          hexasphere={hexasphere}
          highlights={props.highlights}
          usersHighlighted={props.usersHighlighted}
          userLocation={props.userLocation}
          userSector={userData?.sector}
          userAvatar={userData?.avatar}
          highlightedSector={highlightedSector}
          intersection={props.intersection}
          showOwnership={showOwnership}
          ownershipData={ownershipData}
          onTileClick={props.onTileClick}
          onTileHover={(sector, tile) => {
            setHoverSector(sector);
            props.onTileHover?.(sector, tile);
          }}
        />
      </div>
      {/* Overlay elements */}
      <div className="absolute left-0 top-0 m-5">
        <ul>
          {hoverSector && (
            <>
              <li className="flex flex-row items-center">
                <span className="text-2xl mr-1 animate-pulse text-orange-500">⬢</span>{" "}
                Quest
              </li>
              {highlightedSector && (
                <li className="flex flex-row items-center">
                  <span className="text-2xl mr-1 animate-pulse text-teal-500">⬢</span>{" "}
                  Highlight
                </li>
              )}
            </>
          )}
        </ul>
      </div>
      <div className="absolute right-0 top-0 m-5">
        <ul>
          {hoverSector && (
            <>
              <li>- Highlighting sector {hoverSector}</li>
              <li>- {actionExplanation}</li>
            </>
          )}
        </ul>
      </div>
    </>
  );
};

export default Map;
