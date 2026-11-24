"use client";

import { use } from "react";
import { BloodlineStatisticsScreen } from "@/screens/manual/bloodline/statistics/BloodlineStatisticsScreen";

export default function BloodlineStatistics(props: {
  params: Promise<{ bloodlineid: string }>;
}) {
  return <BloodlineStatisticsScreen params={use(props.params)} />;
}
