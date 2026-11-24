"use client";

import { use } from "react";
import { AssetEditScreen } from "@/screens/manual/asset/edit/AssetEditScreen";

export default function AssetEdit(props: { params: Promise<{ assetid: string }> }) {
  return <AssetEditScreen params={use(props.params)} />;
}
