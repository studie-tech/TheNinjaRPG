"use client";
import { use } from "react";
import { ContentStatistics } from "@/layout/ContentStatistics";
import { bloodlineText } from "@/layout/seoTexts";

export default function BloodlineStatistics(props: {
  params: Promise<{ bloodlineid: string }>;
}) {
  const { bloodlineid } = use(props.params);
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
