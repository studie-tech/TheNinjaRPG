"use client";

import { Download, RefreshCw, RotateCcw } from "lucide-react";
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
import {
  CONTENT_PROPOSAL_RETENTION_DAYS,
  ContentProposalCategories,
  ContentProposalEntityTypes,
  ContentProposalSources,
} from "@/drizzle/constants";
import { useLazyChart } from "@/hooks/useLazyChart";
import Loader from "@/layout/Loader";
import {
  CATEGORY_LABELS,
  ENTITY_LABELS,
  SOURCE_LABELS,
} from "@/libs/contentReview/labels";
import { downloadCsv } from "@/utils/dom";
import { formatPercent } from "@/utils/string";
import type { ReviewStatsInput } from "@/validators/contentReview";

export const ContentReviewStats: React.FC<{ canView: boolean }> = ({ canView }) => {
  const [filters, setFilters] = useState<ReviewStatsInput>(DEFAULT_FILTERS);
  const { data, isPending, isFetching, isError, refetch } =
    api.contentReview.getStats.useQuery(filters, {
      enabled: canView,
      placeholderData: (previous) => previous,
    });
  const update = (value: Partial<ReviewStatsInput>) =>
    setFilters((previous) => ({ ...previous, ...value }));
  // Keep an active agent filter visible even when the new window has no submissions.
  const agents = [
    ...new Set([
      ...(data?.agents ?? []),
      ...(filters.agentName == null ? [] : [filters.agentName]),
    ]),
  ].sort();
  if (!canView) return <p>Only content staff can see review statistics.</p>;
  const summary = data?.summary;
  return (
    <div className="space-y-5" aria-busy={isFetching}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-xl">Suggestion performance</h2>
          <p className="mt-1 text-muted-foreground text-sm">
            Explore which suggestions lead to useful content changes.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={isFetching}
            onClick={() => void refetch()}
            title="Reload the latest suggestion outcomes"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!data || !summary?.total || isFetching || isError}
            onClick={() => data && downloadStats(data)}
          >
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>
      <div className="space-y-4 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="mb-2 font-medium text-xs">Submission window</p>
            <fieldset className="flex gap-1" aria-label="Submission window">
              {[7, 30, CONTENT_PROPOSAL_RETENTION_DAYS].map((days) => (
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
            </fieldset>
          </div>
          <div className="w-40">
            <StatsSelect
              label="Group by"
              value={filters.interval}
              onChange={(interval) =>
                update({ interval: interval as ReviewStatsInput["interval"] })
              }
              options={[
                ["daily", "Day"],
                ["weekly", "Week"],
                ["monthly", "Month"],
              ]}
            />
          </div>
          <Button size="sm" variant="ghost" onClick={() => setFilters(DEFAULT_FILTERS)}>
            <RotateCcw className="mr-2 h-3.5 w-3.5" />
            Reset filters
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatsSelect
            label="Content type"
            value={filters.entityType ?? "ALL"}
            onChange={(value) =>
              update({
                entityType:
                  value === "ALL" ? null : (value as ReviewStatsInput["entityType"]),
              })
            }
            options={[
              ["ALL", "All content types"],
              ...ContentProposalEntityTypes.map((type): [string, string] => [
                type,
                ENTITY_LABELS[type],
              ]),
            ]}
          />
          <StatsSelect
            label="Category"
            value={filters.category ?? "ALL"}
            onChange={(value) =>
              update({
                category:
                  value === "ALL" ? null : (value as ReviewStatsInput["category"]),
              })
            }
            options={[
              ["ALL", "All categories"],
              ...ContentProposalCategories.map((category): [string, string] => [
                category,
                CATEGORY_LABELS[category],
              ]),
            ]}
          />
          <StatsSelect
            label="Source"
            value={filters.source ?? "ALL"}
            onChange={(value) =>
              update({
                source: value === "ALL" ? null : (value as ReviewStatsInput["source"]),
                agentName: null,
              })
            }
            options={[
              ["ALL", "All sources"],
              ...ContentProposalSources.map(
                (entry) => [entry, SOURCE_LABELS[entry]] as [string, string],
              ),
            ]}
          />
          <StatsSelect
            label="Agent"
            disabled={filters.source === "STAFF"}
            value={
              filters.agentName == null
                ? "ALL"
                : `${AGENT_OPTION_PREFIX}${filters.agentName}`
            }
            onChange={(value) =>
              update({
                agentName:
                  value === "ALL" ? null : value.slice(AGENT_OPTION_PREFIX.length),
                ...(value !== "ALL" ? { source: "AGENT" as const } : {}),
              })
            }
            options={[
              ["ALL", "All agents"],
              ...agents.map((agent): [string, string] => [
                `${AGENT_OPTION_PREFIX}${agent}`,
                agent || "Unnamed agent",
              ]),
            ]}
          />
        </div>
      </div>
      {isError ? (
        <div role="alert" className="rounded-lg border p-4">
          <p>Could not load review statistics.</p>
          <Button className="mt-2" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : isPending ? (
        <Loader explanation="Loading statistics" />
      ) : (
        data &&
        summary && (
          <>
            <p className="text-muted-foreground text-xs">
              {formatDate(data.start)} – {formatDate(data.end)} · Submitted dates in UTC
              · Weeks start Monday
              <span className="ml-2" role="status">
                {isFetching ? "Updating results…" : ""}
              </span>
            </p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Metric
                label="Suggestions"
                value={summary.total.toLocaleString()}
                detail={`${summary.PENDING} pending · ${summary.OUTDATED} outdated`}
              />
              <Metric
                label="Reviewed"
                value={summary.reviewed.toLocaleString()}
                detail={`${formatPercent(summary.reviewCoverage)} of submissions`}
              />
              <Metric
                label="Acceptance rate"
                value={formatPercent(summary.acceptanceRate)}
                detail={`${summary.accepted} accepted / ${summary.reviewed} reviewed`}
              />
              <Metric
                label="Applied suggestions"
                value={summary.APPLIED.toLocaleString()}
                detail={`${summary.REVERTED} approvals later reverted`}
              />
            </div>
            {summary.total ? (
              <div className="rounded-lg border bg-card p-4">
                <h3 className="font-semibold">Acceptance over time</h3>
                <p className="mt-1 text-muted-foreground text-xs">
                  Hover or tap a period to compare its rate and review volume. Edge
                  periods may be partial.
                </p>
                <AcceptanceChart trend={data.trend} />
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer font-medium">
                    View period data
                  </summary>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-right text-xs">
                      <thead>
                        <tr>
                          <th className="p-2 text-left">Period starts (UTC)</th>
                          <th className="p-2">Submitted</th>
                          <th className="p-2">Accepted</th>
                          <th className="p-2">Rejected</th>
                          <th className="p-2">Acceptance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.trend.map((row) => (
                          <tr key={row.date} className="border-t tabular-nums">
                            <td className="p-2 text-left">{formatDate(row.date)}</td>
                            <td className="p-2">{row.total}</td>
                            <td className="p-2">{row.accepted}</td>
                            <td className="p-2">{row.REJECTED}</td>
                            <td className="p-2">{formatPercent(row.acceptanceRate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <p className="font-semibold">No matching suggestions</p>
                <p className="mt-1 text-muted-foreground text-sm">
                  Try a wider window or clear a filter to explore more data.
                </p>
              </div>
            )}
            {data.breakdown.length > 0 && (
              <div>
                <h3 className="mb-3 font-semibold">Source & category breakdown</h3>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full whitespace-nowrap text-right text-sm">
                    <thead className="bg-popover text-xs">
                      <tr>
                        <th className="p-3 text-left">Source / agent</th>
                        <th className="p-3 text-left">Category</th>
                        <th className="p-3">Submitted</th>
                        <th className="p-3">Accepted</th>
                        <th className="p-3">Rejected</th>
                        <th className="p-3">Pending</th>
                        <th className="p-3">Outdated</th>
                        <th className="p-3">Reverted</th>
                        <th className="p-3">Acceptance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.breakdown.map((row) => (
                        <tr
                          key={JSON.stringify([
                            row.source,
                            row.agentName,
                            row.category,
                          ])}
                          className="border-t tabular-nums"
                        >
                          <td className="p-3 text-left font-medium">
                            {row.source === "STAFF"
                              ? SOURCE_LABELS.STAFF
                              : row.agentName || SOURCE_LABELS.AGENT}
                          </td>
                          <td className="p-3 text-left">
                            {CATEGORY_LABELS[row.category]}
                          </td>
                          <td className="p-3">{row.total}</td>
                          <td className="p-3">{row.accepted}</td>
                          <td className="p-3">{row.REJECTED}</td>
                          <td className="p-3">{row.PENDING}</td>
                          <td className="p-3">{row.OUTDATED}</td>
                          <td className="p-3">{row.REVERTED}</td>
                          <td className="p-3 font-semibold">
                            {formatPercent(row.acceptanceRate)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <p className="text-muted-foreground text-xs leading-relaxed">
              Acceptance = accepted ÷ (accepted + rejected). Accepted includes approvals
              later reverted; pending and outdated suggestions are excluded. Each
              suggestion counts once, even when it changes multiple entities. Outcomes
              reflect the current status of suggestions submitted in this window.
              Rejected and outdated suggestions are retained for{" "}
              {CONTENT_PROPOSAL_RETENTION_DAYS} days; previously deleted records are
              unavailable.
            </p>
          </>
        )
      )}
    </div>
  );
};

const AcceptanceChart = ({ trend }: { trend: Stats["trend"] }) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const failed = useLazyChart(
    canvas,
    (ChartJS, element) => {
      const color = getComputedStyle(element).color;
      return new ChartJS<"bar" | "line">(element, {
        type: "bar",
        data: {
          labels: trend.map((row) => formatDate(row.date)),
          datasets: [
            {
              type: "line",
              label: "Acceptance %",
              data: trend.map((row) => row.acceptanceRate),
              yAxisID: "rate",
              borderColor: "#2563eb",
              backgroundColor: "#2563eb",
              borderWidth: 2.5,
              pointRadius: trend.length > 35 ? 1 : 3,
              pointHoverRadius: 5,
              spanGaps: false,
              order: 0,
            },
            {
              type: "bar",
              label: "Accepted",
              data: trend.map((row) => row.accepted),
              yAxisID: "volume",
              backgroundColor: "rgba(13, 148, 136, 0.5)",
              stack: "reviews",
              order: 1,
            },
            {
              type: "bar",
              label: "Rejected",
              data: trend.map((row) => row.REJECTED),
              yAxisID: "volume",
              backgroundColor: "rgba(217, 119, 6, 0.45)",
              stack: "reviews",
              order: 1,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          color,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: {
              position: "bottom",
              labels: { color, usePointStyle: true, padding: 18 },
            },
            tooltip: {
              callbacks: {
                afterTitle: (items) =>
                  `${trend[items[0]?.dataIndex ?? 0]?.total ?? 0} suggestions submitted`,
                label: (item) =>
                  `${item.dataset.label}: ${item.dataset.yAxisID === "rate" ? formatPercent(item.parsed.y) : item.parsed.y}`,
              },
            },
          },
          scales: {
            x: {
              stacked: true,
              ticks: { color, maxTicksLimit: 8, maxRotation: 0 },
              grid: { display: false },
            },
            rate: {
              position: "left",
              min: 0,
              max: 100,
              title: { display: true, text: "Acceptance (%)", color },
              ticks: { color, stepSize: 25, callback: (value) => `${value}%` },
              grid: { color: "rgba(128,128,128,0.12)" },
            },
            volume: {
              position: "right",
              stacked: true,
              min: 0,
              title: { display: true, text: "Reviewed suggestions", color },
              ticks: { color, precision: 0 },
              grid: { drawOnChartArea: false },
            },
          },
        },
      });
    },
    [trend],
  );
  return failed ? (
    <p role="status" className="py-8 text-sm">
      The chart could not load. Use the period data below to investigate results.
    </p>
  ) : (
    <div className="relative mt-4 h-72 sm:h-80">
      <canvas
        ref={canvas}
        role="img"
        aria-label="Acceptance percentage and accepted and rejected counts by submission period. Exact values are available in View period data."
      />
    </div>
  );
};

const StatsSelect = ({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
  disabled?: boolean;
}) => (
  <div>
    <p className="mb-1.5 font-medium text-xs">{label}</p>
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([key, name]) => (
          <SelectItem key={key} value={key}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);
const Metric = ({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) => (
  <div className="rounded-lg border bg-card p-4">
    <p className="text-muted-foreground text-xs">{label}</p>
    <p className="my-1 font-bold text-2xl tabular-nums sm:text-3xl">{value}</p>
    <p className="text-muted-foreground text-xs">{detail}</p>
  </div>
);
const formatDate = (date: string) =>
  new Date(date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
const downloadStats = (data: Stats) => {
  downloadCsv(
    [
      [
        "Period starts (UTC)",
        "Submitted",
        "Accepted",
        "Rejected",
        "Pending",
        "Outdated",
        "Reverted",
        "Acceptance %",
      ],
      ...data.trend.map((row) => [
        row.date,
        row.total,
        row.accepted,
        row.REJECTED,
        row.PENDING,
        row.OUTDATED,
        row.REVERTED,
        row.acceptanceRate?.toFixed(2) ?? "",
      ]),
    ],
    `content-review-${data.start.slice(0, 10)}-${data.end.slice(0, 10)}.csv`,
  );
};
/**
 * Prefix for agent option values: Radix Select rejects an empty value, and an agent
 * may be unnamed or named "ALL", so a bare name could collide with the "ALL" option.
 */
const AGENT_OPTION_PREFIX = "agent:";

const DEFAULT_FILTERS: ReviewStatsInput = {
  days: CONTENT_PROPOSAL_RETENTION_DAYS,
  interval: "weekly",
};
type Stats = RouterOutputs["contentReview"]["getStats"];
