"use client";

import { SAGE_MODE_MAX_LEVEL } from "@/drizzle/constants";
import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  hiddenVisibilityField,
  useContentEditContext,
  useContentFiltering,
} from "@/layout/ContentFiltering";

/** Manual-list filter schema: name, roll-pool level, village, and staff visibility. */
const SAGE_MODE_FILTERING_SCHEMA = defineFilteringSchema({
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
      filterOptions: (opts) => opts.sort((a, b) => a.label.localeCompare(b.label)),
    },
    hiddenVisibilityField(),
  ] as const,
});

interface SageModeFilteringProps {
  state: SageModeFilteringState;
}

/** Filter popover for the sage mode manual list. Visibility is staff-only. */
const SageModeFiltering: React.FC<SageModeFilteringProps> = (props) => {
  const context = useContentEditContext();

  return (
    <ContentFiltering
      schema={SAGE_MODE_FILTERING_SCHEMA}
      state={props.state.cf}
      context={context}
      triggerButtonId="filter-sagemode"
    />
  );
};

export default SageModeFiltering;

/** tRPC filter for `api.sageMode.getAll` (coerces level from the select string). */
export const getFilter = (state: SageModeFilteringState) => {
  const filter = buildFilter(state.cf, SAGE_MODE_FILTERING_SCHEMA);
  // Convert level from string to number if present
  if (filter.level && typeof filter.level === "string") {
    filter.level = parseInt(filter.level, 10);
  }
  return filter;
};

/** State for the Sage Mode Filtering component. */
export const useFiltering = () => {
  const cf = useContentFiltering(SAGE_MODE_FILTERING_SCHEMA);
  return {
    ...cf.values,
    cf,
  };
};

/** State type returned by `useFiltering`. */
export type SageModeFilteringState = ReturnType<typeof useFiltering>;
