"use client";

import { use } from "react";
import { ManualAiPlacementsScreen } from "@/screens/manual/ai/placements/ManualAiPlacementsScreen";

export default function ManualAiPlacements(props: {
  params: Promise<{ aiid: string }>;
}) {
  return <ManualAiPlacementsScreen params={use(props.params)} />;
}
