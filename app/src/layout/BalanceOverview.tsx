"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  BalanceFiltering,
  getBalanceFilter,
  useBalanceFiltering,
} from "@/layout/BalanceFiltering";
import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import Table from "@/layout/Table";
import { summarizeBattleOutcomes } from "@/libs/statistics";
import { downloadBlob } from "@/utils/dom";
import { groupBy } from "@/utils/grouping";
import { getBalancePeriodEnd } from "@/utils/time";

/** Present comparable content and player-outcome samples for the active reporting period. */
export const BalanceOverview = () => {
  const state = useBalanceFiltering();
  const filter = getBalanceFilter(state);
  const invalidRange =
    typeof filter.minLevel === "number" &&
    typeof filter.maxLevel === "number" &&
    filter.minLevel > filter.maxLevel;
  const overview = api.data.getBalanceOverview.useQuery(filter, {
    enabled: state.isReady && !invalidRange,
  });
  const archives = api.data.getBalanceArchives.useQuery();
  const utils = api.useUtils();
  const [selectedArchive, setSelectedArchive] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const data = overview.data;
  const contentGroups = groupBy(data?.content ?? [], "type");
  const participants = data?.participants ?? [];
  const turnRows = Array.from(
    groupBy(
      participants
        .filter((r) => r.turnOrder > 0)
        .map((r) => ({ ...r, cohort: `${r.userRank}:${r.userLevel}:${r.turnOrder}` })),
      "cohort",
    ).values(),
  )
    .map((rows) => ({
      rank: rows[0]?.userRank ?? "NONE",
      level: rows[0]?.userLevel ?? 0,
      order: rows[0]?.turnOrder === 1 ? "First" : "Second",
      ...summarizeBattleOutcomes(rows),
    }))
    .sort(
      (a, b) =>
        a.level - b.level ||
        a.rank.localeCompare(b.rank) ||
        a.order.localeCompare(b.order),
    );
  const archiveId = selectedArchive || String(archives.data?.[0]?.periodStart ?? "");

  const download = async () => {
    setIsDownloading(true);
    setDownloadError("");
    try {
      await downloadArchive(Number(archiveId), (input) =>
        utils.data.getBalanceArchivePage.fetch(input),
      );
    } catch {
      setDownloadError("The archive could not be downloaded. Please try again.");
    }
    setIsDownloading(false);
  };

  return (
    <>
      <ContentBox
        title="Balance overview"
        subtitle="Current two-week reporting period"
        defaultBackHref="/manual"
        topRightContent={<BalanceFiltering state={state} />}
      >
        {invalidRange && (
          <p role="alert">
            Minimum player level must not exceed maximum player level. Adjust the
            filters to continue.
          </p>
        )}
        {!invalidRange && (!state.isReady || overview.isPending) && (
          <Loader explanation="Loading balance statistics" />
        )}
        {!invalidRange && overview.isError && (
          <p role="alert">
            Balance statistics could not be loaded.{" "}
            <Button variant="outline" onClick={() => void overview.refetch()}>
              Try again
            </Button>
          </p>
        )}
        {!invalidRange && data && (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              {dateLabel(data.periodStart)} –{" "}
              {dateLabel(getBalancePeriodEnd(data.periodStart))} (UTC, end exclusive).
              Live counters restart every 14 days; completed periods stay available
              below. Player level and rank are captured before combat scaling.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {(["jutsu", "bloodline", "item"] as const).map((type) => {
                const rows = contentGroups.get(type) ?? [];
                const stats = summarizeBattleOutcomes(rows);
                return (
                  <Link
                    key={type}
                    href={`/manual/${type}/balance#Usage`}
                    className="rounded-lg border p-4 hover:bg-accent"
                  >
                    <h3 className="font-semibold capitalize">
                      {type === "jutsu" ? "Jutsu" : `${type}s`}
                    </h3>
                    <p className="text-2xl font-bold">
                      {stats.totalUsage.toLocaleString()}{" "}
                      <span className="text-sm font-normal">battle uses</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {new Set(rows.map((r) => r.contentId)).size} used ·{" "}
                      {stats.winRate} win rate
                    </p>
                  </Link>
                );
              })}
            </div>
            <p className="my-3 text-sm text-muted-foreground">
              A use is one player using that content in a battle, regardless of action
              count. Win rates include losses and flees in the denominator.
              Equipped/owned counts on detailed reports describe current accounts and
              are not archived.
            </p>
            <h3 className="mb-2 font-semibold">Most-used content</h3>
            <Table
              data={Array.from(
                groupBy(
                  data.content.map((r) => ({ ...r, key: `${r.type}:${r.contentId}` })),
                  "key",
                ).values(),
              )
                .map((rows) => ({
                  name: (
                    <Link
                      href={`/manual/${rows[0]?.type}/statistics/${rows[0]?.contentId}`}
                    >
                      {rows[0]?.name}
                    </Link>
                  ),
                  type: rows[0]?.type ?? "jutsu",
                  ...summarizeBattleOutcomes(rows),
                }))
                .sort((a, b) => b.totalUsage - a.totalUsage)
                .slice(0, 20)}
              columns={[
                { key: "name", header: "Content", type: "jsx" },
                { key: "type", header: "Type", type: "capitalized" },
                { key: "totalUsage", header: "Battle uses", type: "number" },
                { key: "wins", header: "Wins", type: "number" },
                { key: "flees", header: "Flees", type: "number" },
                { key: "winRate", header: "Win rate", type: "string" },
              ]}
            />
            {data.content.length === 0 && (
              <p className="py-3 text-sm">
                No content usage matches this period and these filters.
              </p>
            )}
          </>
        )}
      </ContentBox>
      <ContentBox
        title="Starting-turn win rates"
        subtitle="One outcome sample per player in head-to-head PvP"
      >
        <p className="mb-3 text-sm text-muted-foreground">
          First and second refer to the starting turn order. Only battles with exactly
          two human participants are compared; AI, team battles, summons and unknown
          starting orders are excluded. Dungeon runs and tournament exhibitions do not
          record balance usage. Small samples may be misleading.
        </p>
        {data && !invalidRange && !overview.isError && (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3">
              {[1, 2].map((order) => {
                const stats = summarizeBattleOutcomes(
                  participants.filter((r) => r.turnOrder === order),
                );
                return (
                  <div key={order} className="rounded-lg border p-4">
                    <h3 className="font-semibold">
                      {order === 1 ? "First" : "Second"} to act
                    </h3>
                    <p className="text-2xl font-bold">{stats.winRate}</p>
                    <p className="text-sm text-muted-foreground">
                      {stats.wins} wins / {stats.totalUsage} player outcomes
                    </p>
                  </div>
                );
              })}
            </div>
            <Table
              data={turnRows}
              columns={[
                { key: "rank", header: "Player rank", type: "capitalized" },
                { key: "level", header: "Player level", type: "number" },
                { key: "order", header: "Starting order", type: "string" },
                { key: "totalUsage", header: "Samples", type: "number" },
                { key: "wins", header: "Wins", type: "number" },
                { key: "losses", header: "Losses", type: "number" },
                { key: "flees", header: "Flees", type: "number" },
                { key: "winRate", header: "Win rate", type: "string" },
              ]}
            />
            {turnRows.length === 0 && (
              <p className="py-3 text-sm">
                No head-to-head PvP outcomes match this period and these filters.
              </p>
            )}
          </>
        )}
      </ContentBox>
      <ContentBox
        title="Balance archives"
        subtitle="Download completed reporting periods"
      >
        <p className="mb-3 text-sm text-muted-foreground">
          Downloads contain all recorded battle types, content identifiers, counts,
          player levels, ranks and starting order for the selected period, independently
          of the filters above. Legacy data has no known reporting window or player
          demographics.
        </p>
        {archives.isPending && <Loader explanation="Loading archives" />}
        {archives.isError && (
          <p role="alert">
            Archives could not be loaded.{" "}
            <Button variant="outline" onClick={() => void archives.refetch()}>
              Try again
            </Button>
          </p>
        )}
        {archives.data?.length === 0 && (
          <p>
            No completed periods yet. The first archive will appear when the current
            period ends.
          </p>
        )}
        {!!archives.data?.length && (
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="balance-archive" className="text-sm font-medium">
              Reporting period
            </label>
            <select
              id="balance-archive"
              value={archiveId}
              onChange={(e) => setSelectedArchive(e.target.value)}
              className="max-w-full rounded-md border bg-background p-2"
              disabled={isDownloading}
            >
              {archives.data.map((archive) => (
                <option key={archive.periodStart} value={archive.periodStart}>
                  {archive.periodStart === 0
                    ? "Legacy data (undated)"
                    : `${dateLabel(archive.periodStart)} – ${dateLabel(getBalancePeriodEnd(archive.periodStart))}`}{" "}
                  · {archive.rows} rows
                </option>
              ))}
            </select>
            <Button onClick={() => void download()} disabled={isDownloading}>
              <Download className="mr-2 h-4 w-4" />
              {isDownloading ? "Downloading…" : "Download JSON"}
            </Button>
          </div>
        )}
        {downloadError && (
          <p role="alert" className="mt-3 text-destructive">
            {downloadError}
          </p>
        )}
      </ContentBox>
    </>
  );
};

/** Format period boundaries in UTC, matching the game's reporting clock. */
const dateLabel = (seconds: number) =>
  new Date(seconds * 1000).toISOString().slice(0, 10);

/** Download bounded archive pages as a single versioned JSON file. */
const downloadArchive = async (
  periodStart: number,
  fetchPage: (input: {
    periodStart: number;
    cursor: number;
  }) => Promise<RouterOutputs["data"]["getBalanceArchivePage"]>,
) => {
  const rows = [];
  let cursor: number | undefined = 0;
  while (cursor !== undefined) {
    const page = await fetchPage({
      periodStart,
      cursor,
    });
    rows.push(...page.rows);
    cursor = page.nextCursor;
  }
  downloadBlob(
    new Blob(
      [
        JSON.stringify(
          {
            version: 1,
            periodStart,
            periodEnd: periodStart ? getBalancePeriodEnd(periodStart) : null,
            description:
              "Aggregated balance counters. battleWon: 0 loss, 1 win, 2 flee. turnOrder: 0 unknown or outside head-to-head PvP, 1 first, 2 second. Level 0/rank NONE indicate unavailable demographics. Counts are player-content battle samples; participant rows count player outcomes.",
            rows,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
    `balance-${periodStart ? dateLabel(periodStart) : "legacy"}.json`,
  );
};
