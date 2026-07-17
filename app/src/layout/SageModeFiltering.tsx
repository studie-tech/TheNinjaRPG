"use client";

import { SAGE_MODE_MAX_LEVEL } from "@/drizzle/constants";
import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  useContentFiltering,
} from "@/layout/ContentFiltering";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

const makeSageModeFilteringSchema = () =>
  defineFilteringSchema({
    fields: [
      { id: "name", label: "Name", type: "text", defaultValue: "" },
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
}

const SageModeFiltering: React.FC<SageModeFilteringProps> = (props) => {
  const { data: userData } = useUserData();
  const schema = makeSageModeFilteringSchema();
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

export const getFilter = (state: SageModeFilteringState) => {
  const filter = buildFilter(state.cf, makeSageModeFilteringSchema());
  // Convert level from string to number if present
  if (filter.level && typeof filter.level === "string") {
    filter.level = parseInt(filter.level, 10);
  }
  return filter;
};

export const useFiltering = () => {
  const schema = makeSageModeFilteringSchema();
  const cf = useContentFiltering(schema);
  return {
    ...cf.values,
    cf,
    setName: cf.setters.name,
    setLevel: cf.setters.level,
    setVillage: cf.setters.village,
    setHidden: cf.setters.hidden,
  };
};

export type SageModeFilteringState = ReturnType<typeof useFiltering>;
