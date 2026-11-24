"use client";

import { use } from "react";
import { HomeVisitScreen } from "@/screens/home/visit/HomeVisitScreen";

export default function Page({ params }: { params: Promise<{ userId: string }> }) {
  return <HomeVisitScreen params={use(params)} />;
}
