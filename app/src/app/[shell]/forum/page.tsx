"use client";

import { Bell, ChevronRight, MessageSquare } from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  Suspense,
  startTransition,
  useCallback,
  useEffect,
  useId,
  useState,
} from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ContentBox from "@/layout/ContentBox";
import { defineFilteringSchema, useContentFiltering } from "@/layout/ContentFiltering";
import { ForumNavigation, ForumSearch, ForumTopicList } from "@/layout/Forum";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { useUserData } from "@/utils/UserContext";

/** Provide the Suspense boundary required by URL-backed forum filters. */
export default function Forum() {
  return (
    <Suspense fallback={<ForumSkeleton />}>
      <ForumHome />
    </Suspense>
  );
}

/** Keep the forum loading boundary consistent with the game layout. */
const ForumSkeleton = () => <Loader explanation="Loading forum…" />;

/** Preserve in-progress filtering during local URL updates and reset browse state on navigation. */
function ForumHome() {
  const params = useSearchParams();
  const search = params.toString();
  const [navigation, setNavigation] = useState({ search, key: 0 });
  // Navigation restores URL defaults; applying filters keeps pending typing and focus.
  if (navigation.search !== search) setNavigation({ search, key: navigation.key + 1 });
  const updateUrl = useCallback((url: URL, mode: "push" | "replace" = "replace") => {
    if (url.href === window.location.href) return;
    startTransition(() => {
      setNavigation((current) => ({ ...current, search: url.searchParams.toString() }));
      window.history[mode === "push" ? "pushState" : "replaceState"](null, "", url);
    });
  }, []);
  return <ForumBrowse key={navigation.key} updateUrl={updateUrl} />;
}

/** Browse authorized boards or filtered topics, restoring URL state on browser navigation. */
function ForumBrowse({
  updateUrl,
}: {
  updateUrl: (url: URL, mode?: "push" | "replace") => void;
}) {
  const fieldPrefix = useId();
  const { data: user } = useUserData();
  const params = useSearchParams();
  const rawView = params.get("view") ?? "boards";
  const view = ["latest", "unread", "watched", "mine", "unanswered", "alerts"].includes(
    rawView,
  )
    ? rawView
    : "boards";
  const query = params.get("q") ?? "";
  const [boardId, setBoardId] = useState(params.get("board") ?? "");
  const [filterSchema] = useState(() => ({
    ...forumTextFilters,
    fields: forumTextFilters.fields.map((field) => ({
      ...field,
      defaultValue: params.get(field.id) ?? "",
    })),
  }));
  const filters = useContentFiltering(filterSchema);
  const { author, since, until } = filters.values;
  const { author: setAuthor, since: setSince, until: setUntil } = filters.setters;
  const {
    author: appliedAuthor,
    since: appliedSince,
    until: appliedUntil,
  } = filters.debounced;
  // Persist applied filters without adding history entries or saving unfinished typing.
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const [key, value] of [
      ["board", boardId],
      ["author", appliedAuthor],
      ["since", appliedSince],
      ["until", appliedUntil],
    ] as const) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    if (url.href !== window.location.href) updateUrl(url);
  }, [boardId, appliedAuthor, appliedSince, appliedUntil, updateUrl]);
  const { data: boards, isPending, error, refetch } = api.forum.getAll.useQuery();
  const topics = api.forum.getThreads.useInfiniteQuery(
    {
      limit: 20,
      view:
        view === "boards" || view === "alerts"
          ? "latest"
          : (view as "latest" | "unread" | "watched" | "mine" | "unanswered"),
      query,
      author: filters.debounced.author,
      boardId: boardId || undefined,
      tag: params.get("tag") ?? undefined,
      since: filters.debounced.since
        ? new Date(`${filters.debounced.since}T00:00:00`)
        : undefined,
      until: filters.debounced.until
        ? new Date(`${filters.debounced.until}T23:59:59.999`)
        : undefined,
    },
    {
      enabled: view !== "boards" && view !== "alerts",
      getNextPageParam: (p) => p.nextCursor,
      staleTime: 15000,
    },
  );
  const alerts = api.forum.alerts.useQuery(undefined, {
    enabled: !!user,
    refetchInterval: 60000,
  });
  const utils = api.useUtils();
  const readAlerts = api.forum.readAlerts.useMutation({
    onSuccess: () => utils.forum.alerts.invalidate(),
  });
  const sectionIds = [...new Set(boards?.map((b) => b.sectionId) ?? [])];
  const hasAppliedFilters = Boolean(
    query ||
      boardId ||
      appliedAuthor ||
      appliedSince ||
      appliedUntil ||
      params.get("tag"),
  );
  return (
    <ContentBox
      title="Forum"
      subtitle="Ask, share and discuss."
      topRightContent={<ForumNavigation showBrowseLinks={hasAppliedFilters} />}
    >
      <div className="mb-4">
        <ForumSearch
          query={query}
          onSearch={(text) => {
            const url = new URL(window.location.href);
            if (text) url.searchParams.set("q", text);
            else url.searchParams.delete("q");
            if (view === "boards" || view === "alerts")
              url.searchParams.set("view", "latest");
            updateUrl(url);
          }}
        />
      </div>
      <nav
        aria-label="Discussion views"
        className="mb-4 flex flex-wrap gap-1 border-b pb-3"
      >
        {[
          ["boards", "Boards"],
          ["latest", "Latest"],
          ["unanswered", "Unanswered"],
          ...(user
            ? [
                ["unread", "Unread"],
                ["watched", "Watching"],
                ["mine", "My discussions"],
                [
                  "alerts",
                  `Alerts${alerts.data?.some((a) => !a.readAt) ? ` (${alerts.data.filter((a) => !a.readAt).length})` : ""}`,
                ],
              ]
            : []),
        ].map(([key, label]) => {
          const next = new URLSearchParams(params);
          if (key === "boards") next.delete("view");
          else if (key) next.set("view", key);
          const href = `/forum${next.size ? `?${next}` : ""}`;
          return (
            <Link
              key={key}
              href={href}
              prefetch={false}
              onNavigate={(event) => {
                // Views only change query state; preserve the shell, focus and scroll.
                event.preventDefault();
                updateUrl(new URL(href, window.location.href), "push");
              }}
              aria-current={view === key ? "page" : undefined}
              className={`rounded-md px-3 py-2 text-sm ${view === key ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            >
              {label}
            </Link>
          );
        })}
      </nav>
      {error && (
        <p role="alert">
          The forum could not load.{" "}
          <Button variant="outline" onClick={() => void refetch()}>
            Try again
          </Button>
        </p>
      )}
      {isPending && <ForumSkeleton />}
      {view === "boards" && boards && (
        <div className="space-y-6">
          {sectionIds.map((id) => {
            const group = boards.filter((b) => b.sectionId === id);
            const section = group[0]?.section;
            return (
              <section key={id}>
                <div className="mb-2">
                  <h2 className="text-lg font-semibold">
                    {section?.name ?? "Other boards"}
                    {section?.archived && " (archived)"}
                  </h2>
                  {section?.summary && (
                    <p className="text-muted-foreground text-sm">{section.summary}</p>
                  )}
                </div>
                <div className="bg-popover divide-y rounded-lg border">
                  {group.map((board) => (
                    // The whole row opens a readable board.
                    <div
                      key={board.id}
                      className={`relative flex min-w-0 items-center gap-3 p-4 ${board.permissions.read ? "hover:bg-muted/40" : ""}`}
                    >
                      <MessageSquare
                        aria-hidden
                        className="hidden h-6 w-6 shrink-0 text-orange-600 sm:block"
                      />
                      <div className={`min-w-0 flex-1 ${board.parentId ? "pl-4" : ""}`}>
                        {board.permissions.read ? (
                          <Link
                            href={`/forum/${board.id}`}
                            className="font-semibold after:absolute after:inset-0 hover:underline"
                          >
                            {board.name}
                          </Link>
                        ) : (
                          <span className="font-semibold">
                            {board.name} (restricted)
                          </span>
                        )}
                        {board.archived && (
                          <span className="text-muted-foreground ml-2 text-xs">
                            Archived
                          </span>
                        )}
                        <p className="text-muted-foreground mt-1 line-clamp-2 text-sm leading-relaxed">
                          {board.summary}
                        </p>
                      </div>
                      <div className="text-muted-foreground shrink-0 text-right text-xs">
                        <span className="text-foreground block font-semibold">
                          {board.nThreads} {board.nThreads === 1 ? "topic" : "topics"}
                        </span>
                        <span>
                          {board.nPosts} {board.nPosts === 1 ? "post" : "posts"}
                        </span>
                      </div>
                      {board.permissions.read && (
                        <Link
                          href={`/forum/${board.id}`}
                          aria-label={`Open ${board.name}`}
                          className="hover:bg-accent relative z-10 rounded-md p-2"
                        >
                          <ChevronRight className="h-5 w-5" />
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
          {boards.length === 0 && (
            <p className="text-muted-foreground p-8 text-center">
              No boards are available yet.
            </p>
          )}
        </div>
      )}
      {view !== "boards" && view !== "alerts" && (
        <>
          <details className="mb-4 rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Filter discussions
              {params.get("tag") ? ` tagged “${params.get("tag")}”` : ""}
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                Board
                <select
                  className="bg-background block h-10 w-full rounded-md border px-2"
                  value={boardId}
                  onChange={(e) => setBoardId(e.target.value)}
                >
                  <option value="">All readable boards</option>
                  {boards
                    ?.filter((b) => b.permissions.read)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-sm" htmlFor={`${fieldPrefix}-1`}>
                Post author
                <Input
                  id={`${fieldPrefix}-1`}
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  maxLength={100}
                />
              </label>
              <label className="text-sm" htmlFor={`${fieldPrefix}-2`}>
                Active since
                <Input
                  id={`${fieldPrefix}-2`}
                  type="date"
                  value={since}
                  onChange={(e) => setSince(e.target.value)}
                />
              </label>
              <label className="text-sm" htmlFor={`${fieldPrefix}-3`}>
                Active until
                <Input
                  id={`${fieldPrefix}-3`}
                  type="date"
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                />
              </label>
            </div>
          </details>
          {topics.isPending ? (
            <Loader explanation="Finding discussions…" />
          ) : topics.error ? (
            <p role="alert">
              Search could not load.{" "}
              <Button onClick={() => void topics.refetch()}>Try again</Button>
            </p>
          ) : (
            <ForumTopicList
              threads={topics.data?.pages.flatMap((p) => p.threads) ?? []}
            />
          )}
          {topics.hasNextPage && (
            <Button
              className="mt-4 w-full"
              variant="outline"
              disabled={topics.isFetchingNextPage}
              onClick={() => void topics.fetchNextPage()}
            >
              {topics.isFetchingNextPage ? "Loading…" : "Load more discussions"}
            </Button>
          )}
        </>
      )}
      {view === "alerts" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Watched activity</h2>
            <Button
              variant="outline"
              size="sm"
              disabled={readAlerts.isPending}
              onClick={() => readAlerts.mutate()}
            >
              Mark alerts as read
            </Button>
          </div>
          {alerts.isPending ? (
            <Loader explanation="Loading alerts…" />
          ) : !alerts.data?.length ? (
            <div className="rounded-lg border p-8 text-center">
              <Bell className="mx-auto mb-3 h-6 w-6" />
              <p>No alerts yet. Watch a board or topic to hear about new posts.</p>
            </div>
          ) : (
            alerts.data.map((a) => (
              <Link
                key={a.id}
                href={`/forum/${a.boardId}/${a.threadId}?post=${a.postId}`}
                className={`block rounded-md border p-4 ${!a.readAt ? "border-orange-400" : ""}`}
              >
                <span className="font-semibold">{a.title}</span>
                <p className="text-muted-foreground text-xs" suppressHydrationWarning>
                  {a.createdAt.toLocaleString()}
                </p>
              </Link>
            ))
          )}
        </div>
      )}
    </ContentBox>
  );
}

const forumTextFilters = defineFilteringSchema({
  fields: [
    { id: "author", label: "Post author", type: "text", defaultValue: "" },
    { id: "since", label: "Active since", type: "date", defaultValue: "" },
    { id: "until", label: "Active until", type: "date", defaultValue: "" },
  ] as const,
});
