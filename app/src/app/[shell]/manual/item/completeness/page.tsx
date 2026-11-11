"use client";

import { api } from "@/app/_trpc/client";
import { DEFAULT_ITEM_DESCRIPTION } from "@/drizzle/constants";
import { useContentDetails } from "@/hooks/useContentDetails";
import {
  CompletenessMark,
  ContentCompletenessPanel,
  CountsChart,
  StackedCountsChart,
} from "@/layout/ContentCompletenessCharts";
import { ContentLinksCell } from "@/layout/ContentLinksCell";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import WordCloud from "@/layout/Wordcloud";
import {
  countBy,
  countEffectCalculations,
  hasEffectGraphics,
  hasEffectSfx,
  hasInvalidEffectAssets,
  isNonBattleItem,
} from "@/libs/contentCompleteness";
import { canChangeContent } from "@/utils/permissions";
import type { ArrayElement } from "@/utils/typeutils";
import { useUserData } from "@/utils/UserContext";

/** Inspect item completeness and diversity with selectable content details. */
export default function ManualItemCompleteness() {
  const details = useContentDetails();

  // User data for permissions
  const { data: userData } = useUserData();

  // Queries
  const { data, isPending } = api.item.getAll.useQuery({ limit: 500 }, {});
  const allItems = data?.data;
  const { data: gameAssets } = api.misc.getAllGameAssetNames.useQuery(undefined);

  // Check if user can edit items
  const canEdit = canChangeContent(userData?.role ?? "USER");

  // Table processing
  const assetIdSet = new Set((gameAssets ?? []).map((a) => a.id));
  const processed = allItems
    ?.map((item) => {
      // Checks
      const noBattleUsage = isNonBattleItem(item);
      const effects = item.effects.length === 0 && !noBattleUsage;
      const description = item.description === DEFAULT_ITEM_DESCRIPTION;
      const missingGraphic = !hasEffectGraphics(item.effects) && !noBattleUsage;
      const missingSfx = !hasEffectSfx(item.effects) && !noBattleUsage;
      // Check: referenced asset IDs exist in gameAsset table
      const invalidAssets =
        !!gameAssets &&
        hasInvalidEffectAssets(item.effects, assetIdSet) &&
        !noBattleUsage;
      const total = [
        effects,
        description,
        missingGraphic,
        missingSfx,
        invalidAssets,
      ].filter(Boolean).length;
      // Return summary
      return {
        name: item.name,
        links: (
          <ContentLinksCell
            type="item"
            id={item.id}
            canEdit={canEdit}
            onInfo={() => details.open(item.id)}
          />
        ),
        effects: <CompletenessMark missing={effects} />,
        description: <CompletenessMark missing={description} />,
        missingGraphic: <CompletenessMark missing={missingGraphic} />,
        missingSfx: <CompletenessMark missing={missingSfx} />,
        assetsExist: <CompletenessMark missing={invalidAssets} />,
        total: total,
      };
    })
    .filter((b) => b.total > 0)
    .sort((a, b) => b.total - a.total);

  // Table
  type Row = ArrayElement<typeof processed>;
  const columns: ColumnDefinitionType<Row, keyof Row>[] = [
    { key: "name", header: "Item", type: "string" },
    { key: "links", header: "Links", type: "jsx" },
    { key: "effects", header: "Effects", type: "jsx" },
    { key: "missingGraphic", header: "Graphics", type: "jsx" },
    { key: "missingSfx", header: "SFX", type: "jsx" },
    { key: "assetsExist", header: "Assets Exist", type: "jsx" },
    { key: "description", header: "Description", type: "jsx" },
    { key: "total", header: "Total", type: "jsx" },
  ];

  return (
    <ContentCompletenessPanel
      type="item"
      storageKey="itemComplete"
      isPending={isPending}
      details={details}
      incomplete={<Table data={processed} columns={columns} />}
      diversity={
        <>
          <p className="bold text-xl">Description Wordcloud</p>
          <WordCloud text={allItems?.map((b) => b.description).join(" ")} />
          <p className="bold text-xl">Title Wordcloud</p>
          <WordCloud text={allItems?.map((b) => b.name).join(" ")} />
          <p className="bold text-xl">Rarity</p>
          <CountsChart data={countBy(allItems, (item) => item.rarity)} />
          <p className="bold text-xl">Effect Types</p>
          <StackedCountsChart data={countEffectCalculations(allItems)} />
        </>
      }
    />
  );
}
