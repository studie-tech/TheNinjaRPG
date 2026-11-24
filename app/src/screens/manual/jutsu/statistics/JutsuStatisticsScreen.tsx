"use client";

import { ContentStatistics } from "@/layout/ContentStatistics";
import { jutsuText } from "@/layout/seoTexts";

/** Render the manual jutsu statistics screen independently of its route adapter. */
export function JutsuStatisticsScreen(props: { params: { jutsuid: string } }) {
  const { jutsuid } = props.params;
  return (
    <ContentStatistics
      type="jutsu"
      id={jutsuid}
      label="Jutsu"
      seoTitle="Jutsu Statistics"
      seoText={jutsuText}
      subtitle={({ totalUsers }) => `Total users: ${totalUsers}`}
      levelStats={{ title: "#Users vs. Jutsu Level", xaxis: "Jutsu Level" }}
      allowClearData
    />
  );
}
