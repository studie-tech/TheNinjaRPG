"use client";

import { use } from "react";
import { ItemStatisticsScreen } from "@/screens/manual/item/statistics/ItemStatisticsScreen";

export default function ItemStatistics(props: { params: Promise<{ itemid: string }> }) {
  return <ItemStatisticsScreen params={use(props.params)} />;
}
