"use client";
import { use } from "react";
import { ContentStatistics } from "@/layout/ContentStatistics";
import { jutsuText } from "@/layout/seoTexts";

export default function JutsuStatistics(props: {
  params: Promise<{ jutsuid: string }>;
}) {
  const { jutsuid } = use(props.params);
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
