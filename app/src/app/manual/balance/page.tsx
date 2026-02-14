"use client";

import { SquareArrowOutUpRight } from "lucide-react";
import Link from "next/link";
import ContentBox from "@/layout/ContentBox";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import type { ArrayElement } from "@/utils/typeutils";

export default function ManualCombat() {
  const data = [
    {
      content: "Bloodlines",
      usage: (
        <Link href="/manual/bloodline/balance#Usage">
          <SquareArrowOutUpRight className="h-4 w-4" />
        </Link>
      ),
      power: (
        <Link href="/manual/bloodline/balance#Power">
          <SquareArrowOutUpRight className="h-4 w-4" />
        </Link>
      ),
      completeness: (
        <Link href="/manual/bloodline/completeness#Incomplete">
          <SquareArrowOutUpRight className="h-4 w-4" />
        </Link>
      ),
      diversity: (
        <Link href="/manual/bloodline/completeness#Diversity">
          <SquareArrowOutUpRight className="h-4 w-4" />
        </Link>
      ),
    },
    {
      content: "Jutsus",
      usage: (
        <Link href="/manual/jutsu/balance#Usage">
          <SquareArrowOutUpRight className="h-4 w-4" />
        </Link>
      ),
      power: (
        <Link href="/manual/jutsu/balance#Power">
          <SquareArrowOutUpRight className="h-4 w-4" />
        </Link>
      ),
      completeness: (
        <Link href="/manual/jutsu/completeness#Incomplete">
          <SquareArrowOutUpRight className="h-4 w-4" />
        </Link>
      ),
      diversity: (
        <Link href="/manual/jutsu/completeness#Diversity">
          <SquareArrowOutUpRight className="h-4 w-4" />
        </Link>
      ),
    },
    {
      content: "Items",
      usage: (
        <Link href="/manual/item/balance#Usage">
          <SquareArrowOutUpRight className="h-4 w-4" />
        </Link>
      ),
      power: (
        <Link href="/manual/item/balance#Power">
          <SquareArrowOutUpRight className="h-4 w-4" />
        </Link>
      ),
      completeness: (
        <Link href="/manual/item/completeness#Incomplete">
          <SquareArrowOutUpRight className="h-4 w-4" />
        </Link>
      ),
      diversity: (
        <Link href="/manual/item/completeness#Diversity">
          <SquareArrowOutUpRight className="h-4 w-4" />
        </Link>
      ),
    },
    {
      content: "AI",
      usage: (
        <Link href="/manual/ai/balance#Usage">
          <SquareArrowOutUpRight className="h-4 w-4" />
        </Link>
      ),
      power: (
        <Link href="/manual/ai/balance#Power">
          <SquareArrowOutUpRight className="h-4 w-4" />
        </Link>
      ),
    },
    {
      content: "Skill Trees",
      usage: (
        <Link href="/manual/skillTree/balance#Usage">
          <SquareArrowOutUpRight className="h-4 w-4" />
        </Link>
      ),
      power: (
        <Link href="/manual/skillTree/balance#Power">
          <SquareArrowOutUpRight className="h-4 w-4" />
        </Link>
      ),
    },
    {
      content: "Ranked PvP",
      usage: (
        <Link href="/manual/pvp_rank#loadouts">
          <SquareArrowOutUpRight className="h-4 w-4" />
        </Link>
      ),
      diversity: (
        <Link href="/manual/pvp_rank#rewards">
          <SquareArrowOutUpRight className="h-4 w-4" />
        </Link>
      ),
      timing: (
        <Link href="/manual/pvp_rank#matchmaking">
          <SquareArrowOutUpRight className="h-4 w-4" />
        </Link>
      ),
    },
    {
      content: "Combat",
      timing: (
        <Link href="/manual/combat">
          <SquareArrowOutUpRight className="h-4 w-4" />
        </Link>
      ),
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
