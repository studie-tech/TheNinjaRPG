import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  useContentFiltering,
} from "@/layout/ContentFiltering";

// Helper: get date string (YYYY-MM-DD) for N months ago
const dateStringMonthsAgo = (months: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() - months);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// Inline schema for recruitment filters (single source of truth)
const recruitmentFilteringSchema = defineFilteringSchema({
  fields: [
    {
      id: "sources",
      label: "Sources",
      type: "multi-select",
      defaultValue: [],
      dataSource: "referralSources",
    },
    {
      id: "startDate",
      label: "User Created (From)",
      type: "date",
      // Default to 3 months back
      defaultValue: dateStringMonthsAgo(3),
    },
    {
      id: "endDate",
      label: "User Created (To)",
      type: "date",
      defaultValue: "",
    },
  ] as const,
});

interface RecruitmentFilteringProps {
  state: RecruitmentFilteringState;
}

const RecruitmentFiltering: React.FC<RecruitmentFilteringProps> = (props) => {
  return (
    <ContentFiltering
      schema={recruitmentFilteringSchema}
      state={props.state.cf}
      triggerButtonId="filter-recruitment"
    />
  );
};

export default RecruitmentFiltering;

export const getFilter = (state: RecruitmentFilteringState) =>
  buildFilter(state.cf, recruitmentFilteringSchema);

export const useFiltering = () => {
  const cf = useContentFiltering(recruitmentFilteringSchema);
  return {
    ...cf.values,
    cf,
    setSources: cf.setters.sources,
    setStartDate: cf.setters.startDate,
    setEndDate: cf.setters.endDate,
  };
};

export type RecruitmentFilteringState = ReturnType<typeof useFiltering>;
