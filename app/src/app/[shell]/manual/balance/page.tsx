"use client";

import { SquareArrowOutUpRight } from "lucide-react";
import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import type { ArrayElement } from "@/utils/typeutils";

/** Link staff to usage, power and completeness reports for each content type. */
export default function ManualBalance() {
  const data = [
    {
      content: "Bloodlines",
      usage: linkCell("/manual/bloodline/balance#Usage"),
      power: linkCell("/manual/bloodline/balance#Power"),
      completeness: linkCell("/manual/bloodline/completeness#Incomplete"),
      diversity: linkCell("/manual/bloodline/completeness#Diversity"),
    },
    {
      content: "Jutsus",
      usage: linkCell("/manual/jutsu/balance#Usage"),
      power: linkCell("/manual/jutsu/balance#Power"),
      completeness: linkCell("/manual/jutsu/completeness#Incomplete"),
      diversity: linkCell("/manual/jutsu/completeness#Diversity"),
    },
    {
      content: "Items",
      usage: linkCell("/manual/item/balance#Usage"),
      power: linkCell("/manual/item/balance#Power"),
      completeness: linkCell("/manual/item/completeness#Incomplete"),
      diversity: linkCell("/manual/item/completeness#Diversity"),
    },
    {
      content: "AI",
      usage: linkCell("/manual/ai/balance#Usage"),
      power: linkCell("/manual/ai/balance#Power"),
      completeness: linkCell("/manual/ai/completeness"),
    },
    {
      content: "Skill Trees",
      usage: linkCell("/manual/skillTree/balance#Usage"),
      power: linkCell("/manual/skillTree/balance#Power"),
    },
    {
      content: "Ranked PvP",
      usage: linkCell("/manual/pvp_rank#loadouts"),
      diversity: linkCell("/manual/pvp_rank#rewards"),
      timing: linkCell("/manual/pvp_rank#matchmaking"),
    },
    {
      content: "Combat",
      timing: linkCell("/manual/combat"),
    },
  ];

  // Setup table
  type BalanceRow = ArrayElement<typeof data>;
  const columns: ColumnDefinitionType<BalanceRow, keyof BalanceRow>[] = [
    { key: "content", header: "Content", type: "string" },
    { key: "usage", header: "Usage", type: "jsx" },
    { key: "power", header: "Power", type: "jsx" },
    { key: "completeness", header: "Completeness", type: "jsx" },
    { key: "diversity", header: "Diversity", type: "jsx" },
    { key: "timing", header: "Timing", type: "jsx" },
  ];

  return (
    <ContentBox
      title="Balance"
      subtitle="Links to Balance Data"
      defaultBackHref="/manual"
      padding={false}
    >
      <p className="p-3">
        We believe the bath to getting the best balanced game is to be as data driven as
        possible. This page is a collection of links to the various data sources that we
        use to balance the game. Feel free to browse the data and see if you can find
        any interesting patterns, which may help us improve the game. Also, if you
        believe certain data visualizations would help us further in balancing efforts,
        please write us a suggestion, e.g. in a ticket or on github.
      </p>
      <Table data={data} columns={columns} />
    </ContentBox>
  );
}

/** Render the shared report-link control used throughout the balance summary table. */
const linkCell = (href: string) => (
  <Link href={href}>
    <SquareArrowOutUpRight className="h-4 w-4" />
  </Link>
);
