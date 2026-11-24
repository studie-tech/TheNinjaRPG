"use client";

import { ContentStatistics } from "@/layout/ContentStatistics";
import { bloodlineText } from "@/layout/seoTexts";

/** Render the manual bloodline statistics screen independently of its route adapter. */
export function BloodlineStatisticsScreen(props: { params: { bloodlineid: string } }) {
  const { bloodlineid } = props.params;
  return (
    <ContentStatistics
      type="bloodline"
      id={bloodlineid}
      label="Bloodline"
      seoTitle="Bloodline Statistics"
      seoText={bloodlineText}
      subtitle={({ totalUsers }) => `Total users: ${totalUsers}`}
      levelStats={{ title: "#Users vs. User Level", xaxis: "User Level" }}
    />
  );
}
