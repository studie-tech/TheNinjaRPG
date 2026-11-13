"use client";

import { api } from "@/app/_trpc/client";
import { MIN_CONTENT_DESCRIPTION_LENGTH } from "@/drizzle/constants";
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
} from "@/libs/contentCompleteness";
import { canChangeContent } from "@/utils/permissions";
import type { ArrayElement } from "@/utils/typeutils";
import { useUserDataSelector } from "@/utils/UserContext";

/** Inspect jutsu completeness and diversity with selectable content details. */
export default function ManualJutsuCompleteness() {
  const details = useContentDetails();

  // User data for permissions
  const { data: userData } = useUserDataSelector((u) => ({ role: u.role }));

  // Queries
  const { data, isPending } = api.jutsu.getAll.useQuery({ limit: 500 }, {});
  const allJutsus = data?.data;
  const { data: gameAssets } = api.misc.getAllGameAssetNames.useQuery(undefined);

  // Check if user can edit jutsu
  const canEdit = canChangeContent(userData?.role ?? "USER");

  // Table processing
  const assetIdSet = new Set((gameAssets ?? []).map((a) => a.id));
  const processed = allJutsus
    ?.map((jutsu) => {
      // Checks
      const effects = jutsu.effects.length === 0;
      const description = jutsu.description.length < MIN_CONTENT_DESCRIPTION_LENGTH;
      const battleDescription =
        jutsu.battleDescription.length < MIN_CONTENT_DESCRIPTION_LENGTH;
      const missingGraphic = !hasEffectGraphics(jutsu.effects);
      const missingSfx = !hasEffectSfx(jutsu.effects);
      // Check: referenced asset IDs exist in gameAsset table
      const invalidAssets =
        !!gameAssets && hasInvalidEffectAssets(jutsu.effects, assetIdSet);

      const total = [
        effects,
        description,
        battleDescription,
        missingGraphic,
        missingSfx,
        invalidAssets,
      ].filter(Boolean).length;
      // Return summary
      return {
        name: jutsu.name,
        links: (
          <ContentLinksCell
            type="jutsu"
            id={jutsu.id}
            canEdit={canEdit}
            onInfo={() => details.open(jutsu.id)}
          />
        ),
        effects: <CompletenessMark missing={effects} />,
        description: <CompletenessMark missing={description} />,
        battleDescription: <CompletenessMark missing={battleDescription} />,
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
    { key: "name", header: "Jutsu", type: "string" },
    { key: "links", header: "Links", type: "jsx" },
    { key: "effects", header: "Effects", type: "jsx" },
    { key: "missingGraphic", header: "Graphics", type: "jsx" },
    { key: "missingSfx", header: "SFX", type: "jsx" },
    { key: "assetsExist", header: "Assets Exist", type: "jsx" },
    { key: "description", header: "Description", type: "jsx" },
    { key: "battleDescription", header: "Battle Desc", type: "jsx" },
    { key: "total", header: "Total", type: "jsx" },
  ];

  return (
    <ContentCompletenessPanel
      type="jutsu"
      storageKey="jutsuComplete"
      isPending={isPending}
      details={details}
      incomplete={<Table data={processed} columns={columns} />}
      diversity={
        <>
          <p className="bold text-xl">Description Wordcloud</p>
          <WordCloud text={allJutsus?.map((b) => b.description).join(" ")} />
          <p className="bold text-xl">Title Wordcloud</p>
          <WordCloud text={allJutsus?.map((b) => b.name).join(" ")} />
          <p className="bold text-xl">Classifications</p>
          <CountsChart data={countBy(allJutsus, (j) => j.statClassification)} />
          <p className="bold text-xl">Ranking</p>
          <CountsChart data={countBy(allJutsus, (j) => j.jutsuRank)} />
          <p className="bold text-xl">Effect Types</p>
          <StackedCountsChart data={countEffectCalculations(allJutsus)} />
        </>
      }
    />
  );
}
