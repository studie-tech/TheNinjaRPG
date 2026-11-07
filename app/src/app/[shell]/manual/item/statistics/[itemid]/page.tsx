"use client";
import { use } from "react";
import { ContentStatistics } from "@/layout/ContentStatistics";
import { itemText } from "@/layout/seoTexts";

export default function ItemStatistics(props: { params: Promise<{ itemid: string }> }) {
  const { itemid } = use(props.params);
  return (
    <ContentStatistics
      type="item"
      id={itemid}
      label="Item"
      seoTitle="Item Statistics"
      seoText={itemText}
      subtitle={({ total, totalUsers }) => `#battles: ${total}. #users: ${totalUsers}`}
    />
  );
}
