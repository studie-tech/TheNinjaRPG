"use client";

import { use } from "react";
import { MapAssetEditScreen } from "@/screens/manual/world/tilesets/edit/MapAssetEditScreen";

export default function MapAssetEdit(props: { params: Promise<{ assetid: string }> }) {
  return <MapAssetEditScreen params={use(props.params)} />;
}
