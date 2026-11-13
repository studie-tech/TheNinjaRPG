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
import { countBy, countEffectCalculations } from "@/libs/contentCompleteness";
import { canChangeContent } from "@/utils/permissions";
import type { ArrayElement } from "@/utils/typeutils";
import { useUserDataSelector } from "@/utils/UserContext";

/** Inspect bloodline completeness and diversity with selectable content details. */
export default function ManualBloodlineCompleteness() {
  const details = useContentDetails();

  // User data for permissions
  const { data: userData } = useUserDataSelector((u) => ({ role: u.role }));

  // Queries
  const { data, isPending } = api.bloodline.getAll.useQuery({ limit: 500 }, {});
  const allBloodlines = data?.data;

  // Check if user can edit bloodlines
  const canEdit = canChangeContent(userData?.role ?? "USER");

  // Table processing
  const processed = allBloodlines
    ?.map((bloodline) => {
      // Checks
      const classification = !bloodline.statClassification;
      const effects = bloodline.effects.length === 0;
      const description = bloodline.description.length < MIN_CONTENT_DESCRIPTION_LENGTH;
      const total = [classification, effects, description].filter(Boolean).length;
      // Return summary

      return {
        name: bloodline.name,
        links: (
          <ContentLinksCell
            type="bloodline"
            id={bloodline.id}
            canEdit={canEdit}
            onInfo={() => details.open(bloodline.id)}
          />
        ),
        classification: <CompletenessMark missing={classification} />,
        effects: <CompletenessMark missing={effects} />,
        description: <CompletenessMark missing={description} />,
        total: total,
      };
    })
    .filter((b) => b.total > 0)
    .sort((a, b) => b.total - a.total);

  // Table
  type Row = ArrayElement<typeof processed>;
  const columns: ColumnDefinitionType<Row, keyof Row>[] = [
    { key: "name", header: "Bloodline", type: "string" },
    { key: "links", header: "Links", type: "jsx" },
    { key: "classification", header: "Classification", type: "jsx" },
    { key: "effects", header: "Effects", type: "jsx" },
    { key: "description", header: "Description", type: "jsx" },
    { key: "total", header: "Total", type: "jsx" },
  ];

  return (
    <ContentCompletenessPanel
      type="bloodline"
      storageKey="bloodComplete"
      isPending={isPending}
      details={details}
      incomplete={<Table data={processed} columns={columns} />}
      diversity={
        <>
          <p className="bold text-xl">Description Wordcloud</p>
          <WordCloud text={allBloodlines?.map((b) => b.description).join(" ")} />
          <p className="bold text-xl">Classifications</p>
          <CountsChart data={countBy(allBloodlines, (b) => b.statClassification)} />
          <p className="bold text-xl">Ranking</p>
          <CountsChart data={countBy(allBloodlines, (b) => b.rank)} />
          <p className="bold text-xl">Effect Types</p>
          <StackedCountsChart data={countEffectCalculations(allBloodlines)} />
        </>
      }
    />
  );
}
