import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  useContentFiltering,
} from "@/layout/ContentFiltering";
import { getLocalDateStringMonthsAgo } from "@/utils/time";

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
      defaultValue: getLocalDateStringMonthsAgo(3),
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
  };
};

export type RecruitmentFilteringState = ReturnType<typeof useFiltering>;
