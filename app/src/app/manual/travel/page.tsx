"use client";

import dynamic from "next/dynamic";
import { api } from "@/app/_trpc/client";
import { SECTOR_HEIGHT, SECTOR_WIDTH } from "@/drizzle/constants";
import { useMap } from "@/hooks/map";
import ContentBox from "@/layout/ContentBox";
import MapError from "@/layout/MapError";

const GlobalMap = dynamic(() => import("@/layout/Map"), {
  ssr: false,
});

export default function ManualTravel() {
  const { globe, mapError } = useMap();
  const { data: villages } = api.village.getAll.useQuery(undefined);

  return (
    <ContentBox
      title="Travel"
      subtitle="Navigating the world"
      defaultBackHref="/manual"
    >
      The world of Seichi is a vast and dangerous place. To navigate it, there are two
      levels of travel in this game; global travel and sector travel. Global travel
      shows you the entire planet segregated into so-called &quot;sectors&quot;. When
      viewing one of these sectors, you will see a {SECTOR_HEIGHT} times {SECTOR_WIDTH}{" "}
      hexagonal grid. You should think of this grid as a small section of that sector,
      in which your character can move, explore and interact with other players.
      {villages && globe && (
        <GlobalMap intersection={false} highlights={villages} hexasphere={globe} />
      )}
      {mapError && <MapError />}
    </ContentBox>
  );
}
