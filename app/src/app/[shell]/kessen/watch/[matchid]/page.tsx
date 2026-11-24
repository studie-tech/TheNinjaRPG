"use client";

import { use } from "react";
import { KessenWatchScreen } from "@/screens/kessen/watch/KessenWatchScreen";

export default function KessenWatchPage(props: {
  params: Promise<{ matchid: string }>;
}) {
  return <KessenWatchScreen params={use(props.params)} />;
}
