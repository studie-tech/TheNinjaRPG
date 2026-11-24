"use client";

import { use } from "react";
import { MapTerrainEditScreen } from "@/screens/manual/world/tilesets/terrain/edit/MapTerrainEditScreen";

export default function MapTerrainEdit(props: {
  params: Promise<{ terrainid: string }>;
}) {
  return <MapTerrainEditScreen params={use(props.params)} />;
}
