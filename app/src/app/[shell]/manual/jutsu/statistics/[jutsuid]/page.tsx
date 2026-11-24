"use client";

import { use } from "react";
import { JutsuStatisticsScreen } from "@/screens/manual/jutsu/statistics/JutsuStatisticsScreen";

export default function JutsuStatistics(props: {
  params: Promise<{ jutsuid: string }>;
}) {
  return <JutsuStatisticsScreen params={use(props.params)} />;
}
