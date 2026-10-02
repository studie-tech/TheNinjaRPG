"use client";

import { Bot, User } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CONTENT_PROPOSAL_RETENTION_DAYS,
  CONTENT_REVIEW_BULK_LIMIT,
  ContentProposalCategories,
  type ContentProposalCategory,
  type ContentProposalSource,
  type ContentProposalStatus,
} from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import { CategoryBadge, ContentReviewDetail } from "@/layout/ContentReviewDetail";
import Loader from "@/layout/Loader";
import {
  CATEGORY_LABELS,
  reviewStatsSourceLabel,
  STATUS_LABELS,
} from "@/libs/contentReview/labels";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import { formatTimeAgo } from "@/utils/time";
import { useRequiredUserData } from "@/utils/UserContext";

/**
 * The content review desk: suggestions from the content audit and from staff, one at a time,
 * with keyboard shortcuts for fast review. Staff who cannot review see their own suggestions.
 */
export const ContentReviewDesk: React.FC = () => {
  const { data: userData } = useRequiredUserData();
  const [tab, setTab] = useState<Tab>("Pending");
  const [category, setCategory] = useState<ContentProposalCategory | null>(null);
  const [source, setSource] = useState<ContentProposalSource | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bulkIds, setBulkIds] = useState<Set<string>>(new Set());
  const status = TAB_STATUS[tab];
  const utils = api.useUtils();

  const { data: counts } = api.contentReview.getCounts.useQuery(undefined, {
    enabled: !!userData,
  });
  const queue = api.contentReview.getQueue.useInfiniteQuery(
    { status: status ?? "PENDING", category, source, limit: 25 },
    {
      enabled: !!userData && !!status,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    },
  );
  const bulkApprove = api.contentReview.bulkApprove.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      setBulkIds(new Set());
      await Promise.all([
        utils.contentReview.getQueue.invalidate(),
        utils.contentReview.getCounts.invalidate(),
        utils.profile.getUser.invalidate(),
      ]);
    },
  });

  const items = queue.data?.pages.flatMap((page) => page.items) ?? [];
  const canReview = counts?.canReview ?? false;
  const selectedIndex = items.findIndex((item) => item.id === selectedId);

  // Keep a selection while the list changes under it (after a decision, a filter or a tab).
  useEffect(() => {
    if (items.length === 0) {
      if (selectedId !== null) setSelectedId(null);
    } else if (!items.some((item) => item.id === selectedId)) {
      setSelectedId(items[0]?.id ?? null);
    }
  }, [items, selectedId]);

  if (!userData) return <Loader explanation="Loading" />;

  const move = (delta: number) => {
    const next = items[Math.min(items.length - 1, Math.max(0, selectedIndex + delta))];
    if (next) setSelectedId(next.id);
  };
  const statusCount = (value: ContentProposalStatus) => counts?.statuses[value] ?? 0;
  const pending = statusCount("PENDING");
  const canBulkApprove = status === "PENDING" && canReview;
  const isBulkFull = bulkIds.size >= CONTENT_REVIEW_BULK_LIMIT;

  return (
    <ContentBox
      title="Content Review"
      subtitle={
        canReview
          ? `${pending} waiting · ${statusCount("OUTDATED")} outdated`
          : "Your suggestions and their status"
      }
      defaultBackHref="/manual"
    >
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value as Tab);
          setSelectedId(null);
          setBulkIds(new Set());
        }}
        className="mb-3"
      >
        <TabsList>
          {TABS.map((entry) => {
            const count = TAB_STATUS[entry] ? statusCount(TAB_STATUS[entry]) : 0;
            return (
              <TabsTrigger key={entry} value={entry}>
                {entry}
                {count > 0 && (entry === "Pending" || entry === "Outdated")
                  ? ` ${count}`
                  : ""}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>
      {tab === "Stats" ? (
        <ReviewStats canView={canReview && canChangeContent(userData.role)} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <FilterChip
              isActive={category === null}
              label={`All ${status ? STATUS_LABELS[status].toLowerCase() : ""}`}
              onClick={() => {
                setCategory(null);
                setBulkIds(new Set());
              }}
            />
            {ContentProposalCategories.map((entry) => (
              <FilterChip
                key={entry}
                isActive={category === entry}
                label={`${CATEGORY_LABELS[entry]}${
                  status === "PENDING" && counts?.pendingByCategory[entry]
                    ? ` ${counts.pendingByCategory[entry]}`
                    : ""
                }`}
                onClick={() => {
                  setCategory(category === entry ? null : entry);
                  setBulkIds(new Set());
                }}
              />
            ))}
            <span className="grow" />
            {(["AGENT", "STAFF"] as const).map((entry) => (
              <FilterChip
                key={entry}
                isActive={source === entry}
                label={entry === "AGENT" ? "Content audit" : "Staff"}
                onClick={() => {
                  setSource(source === entry ? null : entry);
                  setBulkIds(new Set());
                }}
              />
            ))}
          </div>
          {canBulkApprove && bulkIds.size > 0 && (
            <div className="flex items-center justify-between gap-2 rounded-lg border bg-poppopover p-2 text-sm">
              <span>
                {bulkIds.size} selected for approval with their defaults.
                {isBulkFull && ` Up to ${CONTENT_REVIEW_BULK_LIMIT} at a time.`}
              </span>
              <Button
                size="sm"
                loading={bulkApprove.isPending}
                onClick={() =>
                  // Only what the reviewer can still see in the list.
                  bulkApprove.mutate({
                    ids: items
                      .filter((item) => bulkIds.has(item.id))
                      .map((item) => item.id),
                  })
                }
              >
                Approve selected
              </Button>
            </div>
          )}
          {queue.isPending ? (
            <Loader explanation="Loading suggestions" />
          ) : items.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center">
              {status === "PENDING"
                ? "The queue is clear. New suggestions from the content audit show up here."
                : "Nothing here."}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
              <ol className="hidden max-h-[75vh] flex-col gap-2 overflow-y-auto md:flex md:max-lg:max-h-none md:max-lg:flex-row md:max-lg:overflow-x-auto">
                {items.map((item) => (
                  <li key={item.id} className="md:max-lg:w-56 md:max-lg:shrink-0">
                    <QueueCard
                      item={item}
                      isSelected={item.id === selectedId}
                      canBulkApprove={canBulkApprove}
                      isBulkSelected={bulkIds.has(item.id)}
                      isBulkFull={isBulkFull}
                      onSelect={() => setSelectedId(item.id)}
                      onToggleBulk={() =>
                        setBulkIds((previous) => {
                          const next = new Set(previous);
                          if (next.has(item.id)) next.delete(item.id);
                          else next.add(item.id);
                          return next;
                        })
                      }
                    />
                  </li>
                ))}
                {queue.hasNextPage && (
                  <li>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      loading={queue.isFetchingNextPage}
                      onClick={() => void queue.fetchNextPage()}
                    >
                      Load more
                    </Button>
                  </li>
                )}
              </ol>
              {selectedId && (
                <ContentReviewDetail
                  key={selectedId}
                  id={selectedId}
                  position={{ index: selectedIndex, total: items.length }}
                  onMove={move}
                  onDecided={() => move(1)}
                />
              )}
            </div>
          )}
          <p className="text-xs opacity-70">
            Shortcuts: J and K move, A twice approves, R rejects, E edits text. Rejected
            and outdated suggestions are removed after {CONTENT_PROPOSAL_RETENTION_DAYS}{" "}
            days.
          </p>
        </div>
      )}
    </ContentBox>
  );
};

/** One suggestion in the queue list: category, age, target and source. */
const QueueCard: React.FC<{
  item: QueueItem;
  isSelected: boolean;
  canBulkApprove: boolean;
  isBulkSelected: boolean;
  /** Bulk approval holds its maximum, so only ticked cards can change. */
  isBulkFull: boolean;
  onSelect: () => void;
  onToggleBulk: () => void;
}> = (props) => {
  const { item, isSelected, canBulkApprove, isBulkSelected, isBulkFull } = props;
  const { onSelect, onToggleBulk } = props;
  const target = item.targets[0];
  return (
    <div
      className={`flex flex-col gap-1 rounded-lg border p-2 text-sm ${isSelected ? "border-primary bg-poppopover shadow-[inset_3px_0_0_var(--color-orange-500)]" : "bg-popover hover:border-primary"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <CategoryBadge category={item.category} />
        <span className="flex items-center gap-2 text-xs opacity-70">
          {formatTimeAgo(
            new Date(item.status === "PENDING" ? item.createdAt : item.statusChangedAt),
          )}
          {canBulkApprove && (
            <input
              type="checkbox"
              aria-label={`Select ${item.title} for bulk approval`}
              checked={isBulkSelected}
              disabled={isBulkFull && !isBulkSelected}
              onChange={onToggleBulk}
            />
          )}
        </span>
      </div>
      <button
        type="button"
        onClick={onSelect}
        className="flex flex-col gap-1 text-left"
      >
        <span className="truncate font-bold">
          {target ? `${target.label} · ${target.name}` : "New content"}
          {item.targets.length > 1 ? ` +${item.targets.length - 1}` : ""}
        </span>
        <span className="line-clamp-2 text-xs">{item.title}</span>
        <span className="flex items-center gap-1 text-xs opacity-70">
          {item.source === "AGENT" ? (
            <Bot className="h-3 w-3" />
          ) : (
            <User className="h-3 w-3" />
          )}
          {item.status === "OUTDATED" && item.outdatedReason
            ? item.outdatedReason
            : item.source === "AGENT"
              ? "Content audit"
              : (item.createdBy ?? "Staff")}
        </span>
      </button>
    </div>
  );
};

/** Pill that toggles one queue filter. */
const FilterChip: React.FC<{
  isActive: boolean;
  label: string;
  onClick: () => void;
}> = ({ isActive, label, onClick }) => (
  <button
    type="button"
    aria-pressed={isActive}
    onClick={onClick}
    className={`rounded-full border px-3 py-0.5 ${isActive ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary"}`}
  >
    {label}
  </button>
);

/** Acceptance per source and category over the retention window, to tune the audit. */
const ReviewStats: React.FC<{ canView: boolean }> = ({ canView }) => {
  const { data, isPending } = api.contentReview.getStats.useQuery(
    { days: CONTENT_PROPOSAL_RETENTION_DAYS },
    { enabled: canView },
  );
  if (!canView) return <p>Only content staff can see review statistics.</p>;
  if (isPending) return <Loader explanation="Loading statistics" />;
  const rows = new Map<
    string,
    { label: string; category: ContentProposalCategory; counts: Record<string, number> }
  >();
  for (const row of data ?? []) {
    const label = reviewStatsSourceLabel(row.source, row.agentName);
    const key = `${label}|${row.category}`;
    const entry = rows.get(key) ?? { label, category: row.category, counts: {} };
    entry.counts[row.status] = (entry.counts[row.status] ?? 0) + row.n;
    rows.set(key, entry);
  }
  if (rows.size === 0) {
    return <p>No suggestions in the last {CONTENT_PROPOSAL_RETENTION_DAYS} days.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-primary text-white text-xs uppercase">
          <tr>
            <th className="px-3 py-2">Source</th>
            <th className="px-3 py-2">Category</th>
            <th className="px-3 py-2 text-right">Applied</th>
            <th className="px-3 py-2 text-right">Rejected</th>
            <th className="px-3 py-2 text-right">Outdated</th>
            <th className="px-3 py-2 text-right">Waiting</th>
            <th className="px-3 py-2 text-right">Accepted</th>
          </tr>
        </thead>
        <tbody>
          {[...rows.values()].map((row, index) => {
            const applied = (row.counts.APPLIED ?? 0) + (row.counts.REVERTED ?? 0);
            const rejected = row.counts.REJECTED ?? 0;
            const decided = applied + rejected;
            return (
              <tr
                key={`${row.label}-${row.category}`}
                className={`border-gray-700 border-b ${index % 2 ? "bg-popover" : "bg-card"}`}
              >
                <td className="px-3 py-2">{row.label}</td>
                <td className="px-3 py-2">{CATEGORY_LABELS[row.category]}</td>
                <td className="px-3 py-2 text-right tabular-nums">{applied}</td>
                <td className="px-3 py-2 text-right tabular-nums">{rejected}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.counts.OUTDATED ?? 0}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.counts.PENDING ?? 0}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {decided ? `${Math.round((applied / decided) * 100)}%` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs opacity-70">
        Last {CONTENT_PROPOSAL_RETENTION_DAYS} days. Rejected and outdated suggestions
        are removed after that, so older numbers would undercount them.
      </p>
    </div>
  );
};

/** Desk tabs; every tab but Stats lists the suggestions in one status. */
const TABS = [
  "Pending",
  "Outdated",
  "Applied",
  "Rejected",
  "Reverted",
  "Stats",
] as const;
type Tab = (typeof TABS)[number];
const TAB_STATUS: Record<Tab, ContentProposalStatus | null> = {
  Pending: "PENDING",
  Outdated: "OUTDATED",
  Applied: "APPLIED",
  Rejected: "REJECTED",
  Reverted: "REVERTED",
  Stats: null,
};

/** A suggestion as the queue list shows it. */
type QueueItem = RouterOutputs["contentReview"]["getQueue"]["items"][number];
