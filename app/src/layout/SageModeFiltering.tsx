"use client";

import type { LetterRank } from "@/drizzle/constants";
import { LetterRanks, SAGE_MODE_MAX_LEVEL } from "@/drizzle/constants";
import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  useContentFiltering,
} from "@/layout/ContentFiltering";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

const makeSageModeFilteringSchema = (
  limitRanks: LetterRank[],
  defaultRank: LetterRank | "None" = "None",
) =>
  defineFilteringSchema({
    fields: [
      { id: "name", label: "Name", type: "text", defaultValue: "" },
      {
        id: "rank",
        label: "Required Rank",
        type: "single-select",
        defaultValue: defaultRank,
        options: limitRanks.map((r) => ({ value: r, label: r })),
        emptyValues: ["None"],
        includeNone: true,
      },
      {
        id: "level",
        label: "Level",
        type: "single-select",
        defaultValue: "None",
        options: Array.from({ length: SAGE_MODE_MAX_LEVEL }, (_, i) => ({
          value: String(i + 1),
          label: `Level ${i + 1}`,
        })),
        emptyValues: ["None"],
        includeNone: true,
      },
      {
        id: "village",
        label: "Village",
        type: "single-select",
        defaultValue: "None",
        emptyValues: ["None"],
        includeNone: true,
        dataSource: "villages",
        filterOptions: (opts) => [
          { value: "None", label: "None" },
          ...opts.sort((a, b) => a.label.localeCompare(b.label)),
        ],
      },
      {
        id: "hidden",
        label: "Visibility",
        type: "tri-state",
        defaultValue: undefined,
        visibleIf: (ctx) =>
          Boolean((ctx as { canEdit?: boolean } | undefined)?.canEdit),
        triStateLabels: {
          labelActive: "Hidden",
          labelInactive: "Visible",
          labelAll: "All Visibility",
        },
      },
    ] as const,
  });

interface SageModeFilteringProps {
  state: SageModeFilteringState;
  limitRanks?: LetterRank[];
}

const SageModeFiltering: React.FC<SageModeFilteringProps> = (props) => {
  const { data: userData } = useUserData();
  const limitRanks = props.limitRanks ? props.limitRanks : [...LetterRanks];
  const schema = makeSageModeFilteringSchema([...limitRanks]);
  const context = { canEdit: Boolean(userData && canChangeContent(userData.role)) };

  return (
    <ContentFiltering
      schema={schema}
      state={props.state.cf}
      context={context}
      triggerButtonId="filter-sagemode"
    />
  );
};

export default SageModeFiltering;

export const getFilter = (
  state: SageModeFilteringState,
  limitRanks: LetterRank[] = [...LetterRanks],
) => {
  const filter = buildFilter(state.cf, makeSageModeFilteringSchema([...limitRanks]));
  // Convert level from string to number if present
  if (filter.level && typeof filter.level === "string") {
    filter.level = parseInt(filter.level, 10);
  }
  return filter;
};

export const useFiltering = (defaultRank: LetterRank | "None" = "None") => {
  const schema = makeSageModeFilteringSchema([...LetterRanks], defaultRank);
  const cf = useContentFiltering(schema);
  return {
    ...cf.values,
    cf,
    setName: cf.setters.name,
    setRank: cf.setters.rank,
    setLevel: cf.setters.level,
    setVillage: cf.setters.village,
    setHidden: cf.setters.hidden,
  };
};

export type SageModeFilteringState = ReturnType<typeof useFiltering>;
