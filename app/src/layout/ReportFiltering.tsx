import { api } from "@/app/_trpc/client";
import { BanStates } from "@/drizzle/constants";
import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  toOptions,
  useContentFiltering,
} from "@/layout/ContentFiltering";

interface ReportFilteringProps {
  state: ReportFilteringState;
}

const makeReportSchema = (systems: string[]) =>
  defineFilteringSchema({
    fields: [
      {
        id: "reportedUser",
        label: "Reported User",
        type: "text",
        defaultValue: "",
      },
      {
        id: "reporterUser",
        label: "Reporter User",
        type: "text",
        defaultValue: "",
      },
      {
        id: "status",
        label: "Status",
        type: "single-select",
        defaultValue: "UNVIEWED",
        includeNone: false,
        emptyValues: [],
        options: toOptions(BanStates),
      },
      {
        id: "system",
        label: "System",
        type: "single-select",
        defaultValue: "None",
        includeNone: true,
        emptyValues: ["None"],
        options: systems.map((s) => ({ value: s, label: s })),
      },
      {
        id: "startDate",
        label: "Start Date",
        type: "date",
        defaultValue: "",
        normalizeForFilter: (v: string) => (v === "" ? null : new Date(v)),
      },
      {
        id: "endDate",
        label: "End Date",
        type: "date",
        defaultValue: "",
        normalizeForFilter: (v: string) => (v === "" ? null : new Date(v)),
      },
    ] as const,
  });

const ReportFiltering: React.FC<ReportFilteringProps> = (props) => {
  const { data } = api.reports.getReportSystemNames.useQuery(undefined);
  const systems = (data ?? []).map((row: { system: string }) => row.system);
  const schema = makeReportSchema(systems);
  return (
    <ContentFiltering
      schema={schema}
      state={props.state.cf}
      triggerButtonId="filter-reports"
    />
  );
};

export default ReportFiltering;

export const getFilter = (state: ReportFilteringState) =>
  buildFilter(state.cf, makeReportSchema([]));

export const useFiltering = () => {
  const { data } = api.reports.getReportSystemNames.useQuery(undefined);
  const systems = (data ?? []).map((row: { system: string }) => row.system);
  const cf = useContentFiltering(makeReportSchema(systems));
  return {
    ...cf.values,
    cf,
    setStartDate: cf.setters.startDate, // keep date as string (yyyy-mm-dd)
    setEndDate: cf.setters.endDate, // keep date as string (yyyy-mm-dd)
    setSystem: cf.setters.system,
    setStatus: cf.setters.status,
    setReportedUser: cf.setters.reportedUser,
    setReporterUser: cf.setters.reporterUser,
  };
};

export type ReportFilteringState = ReturnType<typeof useFiltering>;
