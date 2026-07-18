"use client";

import { Images, MapPlus } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { useMap } from "@/hooks/map";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import MapError from "@/layout/MapError";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

const GlobalMap = dynamic(() => import("@/layout/Map"), { ssr: false });

/**
 * Manual page explaining world travel, rendered around the interactive globe.
 * For content staff it doubles as the map-editing entry point: double-clicking
 * a globe sector routes to /manual/world/sector-maps?sector=N.
 */
export default function ManualWorld() {
  const router = useRouter();
  const { data: userData } = useUserData();
  const { globe, mapError } = useMap();
  const { data: villages } = api.village.getAll.useQuery(undefined, {
    enabled: !!userData,
  });
  const canEditMaps = Boolean(userData && canChangeContent(userData.role));

  return (
    <ContentBox
      title="World"
      subtitle="Navigating the world"
      defaultBackHref="/manual"
      topRightContent={
        canEditMaps ? (
          <div className="flex flex-row gap-2">
            <Button asChild>
              <Link href="/manual/world/tilesets">
                <Images className="mr-2 h-5 w-5" />
                Tilesets
              </Link>
            </Button>
            <Button asChild>
              <Link href="/manual/world/sector-maps">
                <MapPlus className="mr-2 h-5 w-5" />
                Sector Maps
              </Link>
            </Button>
          </div>
        ) : undefined
      }
    >
      The world of Seichi is a vast and dangerous place. To navigate it, there are two
      levels of travel in this game; continent travel and local sector travel. Continent
      travel moves you between the major world regions, while local sector travel opens
      a hexagonal map where your character can explore and interact with other players.
      {canEditMaps && (
        <p className="mt-2 font-bold text-orange-500">
          As a content editor: double-click any sector on the globe to open its map
          editor.
        </p>
      )}
      <div className="mt-4">
        {mapError && <MapError />}
        {!mapError && !globe && <Loader explanation="Loading the world map" />}
        {globe && (
          <GlobalMap
            intersection={canEditMaps}
            hexasphere={globe}
            highlights={villages}
            actionExplanation="Double click a sector to edit its map"
            onTileClick={
              canEditMaps
                ? (sector) => {
                    if (sector !== null) {
                      router.push(`/manual/world/sector-maps?sector=${sector}`);
                    }
                  }
                : undefined
            }
          />
        )}
      </div>
    </ContentBox>
  );
}
