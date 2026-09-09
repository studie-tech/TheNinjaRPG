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

const GlobalMap = dynamic(() => import("@/layout/Map"), { ssr: false });

export const ManualWorldEditor: React.FC = () => {
  const router = useRouter();
  const { globe, mapError } = useMap();
  const { data: villages } = api.village.getAll.useQuery(undefined);

  return (
    <ContentBox
      title="World"
      subtitle="Map editing tools"
      defaultBackHref="/manual"
      topRightContent={
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
      }
    >
      <p>
        Player travel docs are in the{" "}
        <Link
          href="/guide/world"
          className="font-bold text-orange-500 hover:text-orange-700"
        >
          world guide
        </Link>
        . Click a sector on the globe to open its map editor.
      </p>
      <div className="mt-4">
        {mapError && <MapError />}
        {!mapError && !globe && <Loader explanation="Loading the world map" />}
        {globe && (
          <GlobalMap
            intersection={true}
            hexasphere={globe}
            highlights={villages}
            actionExplanation="Click a sector to edit its map"
            onTileClick={(sector) => {
              if (sector !== null) {
                router.push(`/manual/world/sector-maps?sector=${sector}`);
              }
            }}
          />
        )}
      </div>
    </ContentBox>
  );
};
