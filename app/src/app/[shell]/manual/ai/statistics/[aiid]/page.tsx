"use client";

import { use } from "react";
import { ManualAIsStatisticsScreen } from "@/screens/manual/ai/statistics/ManualAIsStatisticsScreen";

export default function ManualAIsStatistics(props: {
  params: Promise<{ aiid: string }>;
}) {
  return <ManualAIsStatisticsScreen params={use(props.params)} />;
}
