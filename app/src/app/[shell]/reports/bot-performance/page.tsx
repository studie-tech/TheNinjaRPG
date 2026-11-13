"use client";

import { Download, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLazyChart } from "@/hooks/useLazyChart";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import Table from "@/layout/Table";
import { downloadCsv } from "@/utils/dom";
import { isStaffRole } from "@/utils/permissions";
import { formatPercent } from "@/utils/string";
import { useRequiredUserDataSelector } from "@/utils/UserContext";
import type { ModBotPerformanceInput } from "@/validators/reports";

export default function BotPerformance() {
  const { data: userData } = useRequiredUserDataSelector((profile) => ({
    role: profile.role,
  }));
  const [filters, setFilters] = useState<ModBotPerformanceInput>({
    days: 30,
    interval: "daily",
    surface: "all",
  });
  const canView = isStaffRole(userData?.role);
  const { data, isPending, isFetching, isError, refetch } =
    api.reports.getModBotPerformance.useQuery(filters, {
      enabled: canView,
      retry: false,
    });
  const update = (value: Partial<ModBotPerformanceInput>) =>
    setFilters((previous) => ({ ...previous, ...value }));
  const summary = data?.summary;

  return (
    <ContentBox
      title="Bot Performance"
      subtitle="Moderation outcomes & scan health"
      defaultBackHref="/reports"
      padding={false}
    >
      <div className="space-y-6 p-4 md:p-6" aria-busy={isFetching}>
        {!userData ? (
          <Loader explanation="Loading user data" />
        ) : !canView ? (
          <p>Only staff can view bot performance.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-xl">Are bot alerts helping staff?</h2>
                <p className="mt-1 max-w-2xl text-muted-foreground text-sm">
                  Track reviewed alerts, staff action and queue load by report
                  submission date. Staff outcomes update as cases are reviewed or
                  reopened.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isFetching}
                  onClick={() => void refetch()}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!data || isFetching || isError}
                  onClick={() => data && downloadStats(data)}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Export CSV
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-4 rounded-lg border bg-card p-4">
              <fieldset aria-label="Report submission window">
                <legend className="mb-2 font-medium text-xs">Submission window</legend>
                <div className="flex gap-1">
                  {([7, 30, 90] as const).map((days) => (
                    <Button
                      key={days}
                      size="sm"
                      variant={filters.days === days ? "default" : "outline"}
                      aria-pressed={filters.days === days}
                      onClick={() => update({ days })}
                    >
                      {days} days
                    </Button>
                  ))}
                </div>
              </fieldset>
              <FilterSelect
                label="Group by"
                value={filters.interval}
                options={[
                  ["daily", "Day"],
                  ["weekly", "Week"],
                ]}
                onChange={(interval) =>
                  update({ interval: interval as ModBotPerformanceInput["interval"] })
                }
              />
              <FilterSelect
                label="Surface"
                value={filters.surface}
                options={Object.entries(SURFACES)}
                onChange={(surface) =>
                  update({ surface: surface as ModBotPerformanceInput["surface"] })
                }
              />
            </div>
            {isError ? (
              <div role="alert" className="rounded-lg border border-destructive p-4">
                <p>Could not load bot performance. Refresh to retry.</p>
              </div>
            ) : isPending ? (
              <Loader explanation="Loading moderation outcomes" />
            ) : (
              data &&
              summary && (
                <>
                  <p className="text-muted-foreground text-xs">
                    {dateLabel(data.start)} – {dateLabel(data.end)} · UTC · Updated{" "}
                    {new Date(data.end).toLocaleTimeString()} · Boundary periods may be
                    partial
                  </p>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <Metric
                      label="Reviewed alert action yield"
                      value={formatPercent(summary.actionYield)}
                      detail={`${summary.botAction} with staff action / ${summary.botReviewed} reviewed`}
                    />
                    <Metric
                      label="Bot alerts"
                      value={summary.botTotal}
                      detail={`${summary.botReviewed} reviewed · ${formatPercent(summary.reviewCoverage)} review coverage`}
                    />
                    <Metric
                      label="Cleared bot alerts"
                      value={summary.botCleared}
                      detail="Reviewed without a current sanction"
                    />
                    <Metric
                      label="Awaiting staff review"
                      value={summary.botPending}
                      detail="Bot reports currently unviewed"
                    />
                  </div>
                  <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 text-sm">
                    <p className="font-semibold">Detection recall is not measured</p>
                    <p className="mt-1 text-muted-foreground">
                      Human reports are not automatically bot misses. Many cover account
                      abuse or content the bot never scans. Cleared alerts also are not
                      proof of a false positive: staff may handle a case elsewhere.
                      Measuring recall requires independent labels on a sample of
                      scanned content, including gate clears.
                    </p>
                  </div>
                  {summary.botTotal + summary.humanTotal === 0 && (
                    <p className="rounded-lg border border-dashed p-5 text-sm">
                      No reports were submitted for this surface in this window. Scan
                      activity, if recorded, is shown below.
                    </p>
                  )}
                  <section className="space-y-3 rounded-lg border bg-card p-4">
                    <h3 className="font-semibold">Bot alert outcomes over time</h3>
                    <p className="text-muted-foreground text-sm">
                      Bars show report counts. Action yield is staff action ÷ reviewed
                      alerts; gaps mean no reviewed alerts. Smaller samples can move
                      sharply.
                    </p>
                    <OutcomeChart trend={data.trend} />
                    <details>
                      <summary className="cursor-pointer text-sm">
                        View counts by{" "}
                        {filters.interval === "daily" ? "day" : "week starting Monday"}
                      </summary>
                      <div className="mt-3 whitespace-nowrap tabular-nums">
                        <Table
                          data={data.trend.map((row) => ({
                            ...row,
                            actionYield: `${formatPercent(row.actionYield)} (n=${row.botReviewed})`,
                          }))}
                          columns={[...TREND_COLUMNS]}
                        />
                      </div>
                    </details>
                  </section>
                  <section className="space-y-3 rounded-lg border bg-card p-4">
                    <h3 className="font-semibold">Where reports come from</h3>
                    <p className="text-muted-foreground text-sm">
                      Compare surfaces before interpreting bot usefulness. Human
                      reports: {summary.humanTotal} total · {summary.humanAction} with
                      staff action · {summary.humanCleared} cleared ·{" "}
                      {summary.humanPending} pending.
                    </p>
                    <div className="whitespace-nowrap tabular-nums">
                      <Table
                        data={data.surfaces.map((row) => ({
                          ...row,
                          surface: SURFACES[row.surface],
                          actionYield: `${formatPercent(row.actionYield)} (${row.botAction}/${row.botReviewed})`,
                        }))}
                        columns={[...SURFACE_COLUMNS]}
                      />
                    </div>
                  </section>
                  <section className="space-y-3 rounded-lg border bg-card p-4">
                    <h3 className="font-semibold">Scan health</h3>
                    <p className="text-muted-foreground text-sm">
                      {data.telemetryStart
                        ? `First recorded scan in this selection: ${dateLabel(data.telemetryStart)}. `
                        : "No complete scan telemetry recorded in this selection. "}
                      Telemetry starts with this instrumentation; older flag-only audit
                      logs cannot supply a scan denominator. Scan attempts are not
                      unique posts or a measure of all-site coverage. Metadata is
                      retained for 90 days.
                    </p>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                      <Metric
                        label="Recorded scan attempts"
                        value={summary.scans}
                        detail={`${summary.flagged} flagged by safety gate`}
                      />
                      <Metric
                        label="Gate cleared"
                        value={summary.GATE_CLEAR}
                        detail="Did not reach decision model"
                      />
                      <Metric
                        label="Decision model cleared"
                        value={summary.DECISION_CLEAR}
                        detail={`${summary.REPORTED} attempts produced a report`}
                      />
                      <Metric
                        label="Errors / incomplete"
                        value={`${summary.ERROR} / ${summary.CHECKING}`}
                        detail="Provider or report-write errors / unfinished attempts"
                      />
                    </div>
                  </section>
                  <section className="space-y-3 rounded-lg border bg-card p-4">
                    <h3 className="font-semibold">
                      Original predictions vs current staff outcomes
                    </h3>
                    <p className="text-muted-foreground text-sm">
                      {summary.evaluated} reviewed reports with a timestamped original
                      prediction · {summary.excludedPredictions} reviewed reports
                      excluded because prediction provenance is missing. This is
                      agreement on reported cases, not accuracy across game content.
                    </p>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                      <Metric
                        label="Agreement"
                        value={formatPercent(summary.agreement)}
                        detail={`Based on ${summary.evaluated} reviewed reports`}
                      />
                      <Metric
                        label="Recommended action; staff acted"
                        value={summary.supportedAction}
                        detail="Includes warnings and sanctions"
                      />
                      <Metric
                        label="Recommended action; staff cleared"
                        value={summary.unsupportedAction}
                        detail="Disagreement requiring case review"
                      />
                      <Metric
                        label="Recommended clear; staff acted"
                        value={summary.missedAction}
                        detail={`${summary.supportedClear} recommended clear and staff cleared`}
                      />
                    </div>
                    {data.versions.length > 0 && (
                      <div className="whitespace-nowrap tabular-nums">
                        <Table
                          data={data.versions.map((row) => ({
                            ...row,
                            agreement: formatPercent(row.agreement),
                          }))}
                          columns={[...VERSION_COLUMNS]}
                        />
                      </div>
                    )}
                  </section>
                </>
              )
            )}
          </>
        )}
      </div>
    </ContentBox>
  );
}

const OutcomeChart = ({ trend }: { trend: Stats["trend"] }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const failed = useLazyChart(
    ref,
    (ChartJS, canvas) =>
      new ChartJS(canvas, {
        type: "bar",
        data: {
          labels: trend.map((row) => row.date),
          datasets: [
            {
              label: "Staff action",
              data: trend.map((row) => row.botAction),
              backgroundColor: "#0d9488",
              stack: "reports",
            },
            {
              label: "Cleared",
              data: trend.map((row) => row.botCleared),
              backgroundColor: "#94a3b8",
              stack: "reports",
            },
            {
              label: "Pending",
              data: trend.map((row) => row.botPending),
              backgroundColor: "#f59e0b",
              stack: "reports",
            },
            {
              type: "line",
              label: "Action yield (%)",
              data: trend.map((row) => row.actionYield),
              borderColor: "#6366f1",
              backgroundColor: "#6366f1",
              yAxisID: "yield",
              spanGaps: false,
              pointRadius: 3,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { stacked: true, ticks: { maxTicksLimit: 8, maxRotation: 0 } },
            y: {
              stacked: true,
              beginAtZero: true,
              title: { display: true, text: "Bot reports" },
              ticks: { precision: 0 },
            },
            yield: {
              position: "right",
              min: 0,
              max: 100,
              grid: { drawOnChartArea: false },
              title: { display: true, text: "Action yield (%)" },
            },
          },
          plugins: {
            tooltip: {
              callbacks: {
                afterBody: (items) => {
                  const row = trend[items[0]?.dataIndex ?? -1];
                  return row ? `Reviewed sample: ${row.botReviewed}` : "";
                },
              },
            },
          },
        },
      }),
    [trend],
  );
  return failed ? (
    <p role="status" className="py-8 text-sm">
      The chart could not load. Use the period table below to investigate results.
    </p>
  ) : (
    <div className="relative h-72">
      <canvas
        ref={ref}
        role="img"
        aria-label="Bot report outcomes and reviewed alert action yield over time. Exact counts are available in the period table below."
      />
    </div>
  );
};
const Metric = ({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) => (
  <div className="rounded-lg border bg-card p-4">
    <p className="text-muted-foreground text-xs">{label}</p>
    <p className="mt-2 font-semibold text-2xl tabular-nums">{value}</p>
    <p className="mt-2 text-muted-foreground text-xs">{detail}</p>
  </div>
);
const FilterSelect = ({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) => (
  <div className="w-44">
    <p className="mb-2 font-medium text-xs">{label}</p>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([key, text]) => (
          <SelectItem key={key} value={key}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);
const dateLabel = (at: string) =>
  new Date(at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
const downloadStats = (data: Stats) => {
  const fields = [
    "date",
    "botTotal",
    "botAction",
    "botCleared",
    "botPending",
    "botReviewed",
    "actionYield",
    "humanTotal",
    "scans",
    "flagged",
    "GATE_CLEAR",
    "DECISION_CLEAR",
    "REPORTED",
    "ERROR",
    "CHECKING",
  ] as const;
  downloadCsv(
    [[...fields], ...data.trend.map((row) => fields.map((key) => row[key] ?? ""))],
    `mod-bot-${data.start.slice(0, 10)}.csv`,
  );
};
const SURFACES: Record<string, string> = {
  all: "All surfaces",
  conversation: "Conversations",
  forum: "Forum",
  profile: "Profile",
  other: "Other",
};
const TREND_COLUMNS = [
  { key: "date", header: "Period (UTC)", type: "string" },
  { key: "botTotal", header: "Bot alerts", type: "string" },
  { key: "botAction", header: "Staff action", type: "string" },
  { key: "botCleared", header: "Cleared", type: "string" },
  { key: "botPending", header: "Pending", type: "string" },
  { key: "actionYield", header: "Action yield", type: "string" },
  { key: "humanTotal", header: "Human reports", type: "string" },
] as const;
const SURFACE_COLUMNS = [
  { key: "surface", header: "Surface", type: "string" },
  { key: "botTotal", header: "Bot alerts", type: "string" },
  { key: "botReviewed", header: "Reviewed", type: "string" },
  { key: "actionYield", header: "Action yield", type: "string" },
  { key: "botPending", header: "Pending", type: "string" },
  { key: "humanTotal", header: "Human reports", type: "string" },
] as const;
const VERSION_COLUMNS = [
  { key: "version", header: "Prompt version", type: "string" },
  { key: "scans", header: "Scan attempts", type: "string" },
  { key: "evaluated", header: "Reviewed predictions", type: "string" },
  { key: "agreement", header: "Agreement", type: "string" },
] as const;
type Stats = RouterOutputs["reports"]["getModBotPerformance"];
