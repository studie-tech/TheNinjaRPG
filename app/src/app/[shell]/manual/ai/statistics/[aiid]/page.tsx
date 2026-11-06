"use client";
import { use } from "react";
import { ContentStatistics } from "@/layout/ContentStatistics";
import { aiText } from "@/layout/seoTexts";

/** Show battle usage statistics for the AI selected by the route. */
export default function ManualAIsStatistics(props: {
  params: Promise<{ aiid: string }>;
}) {
  const { aiid } = use(props.params);
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
