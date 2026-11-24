"use client";

import { ContentStatistics } from "@/layout/ContentStatistics";
import { aiText } from "@/layout/seoTexts";

/** Show battle usage statistics for the AI selected by the route. */
export function ManualAIsStatisticsScreen(props: { params: { aiid: string } }) {
  const { aiid } = props.params;
  return (
    <ContentStatistics
      type="ai"
      id={aiid}
      label="AI"
      seoTitle="AI Profile"
      seoText={aiText}
      subtitle={({ total }) => `Total battles: ${total}`}
    />
  );
}
