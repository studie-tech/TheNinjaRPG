"use client";

import { ContentStatistics } from "@/layout/ContentStatistics";
import { itemText } from "@/layout/seoTexts";

/** Render the manual item statistics screen independently of its route adapter. */
export function ItemStatisticsScreen(props: { params: { itemid: string } }) {
  const { itemid } = props.params;
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
