"use client";

import { Plus, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { RouterOutputs } from "@/app/_trpc/client";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  FORUM_BOARD_THREADS_PER_PAGE,
  FORUM_MIN_LEVEL,
  forumLevelMessage,
} from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import {
  ForumComposer,
  ForumEmptyState,
  ForumNavigation,
  ForumSearch,
  ForumTopicList,
  ForumWatchButton,
} from "@/layout/Forum";
import { ForumTopicTools } from "@/layout/ForumModeration";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
import { useUserData } from "@/utils/UserContext";

/** Combine board policy, URL-backed topic discovery, watches and permitted creation/moderation tools. */
export default function Board({
  boardId,
  initialThreads,
}: {
  boardId: string;
  initialThreads: RouterOutputs["forum"]["getThreads"];
}) {
  const { data: user } = useUserData();
  const router = useRouter();
  const utils = api.useUtils();
  const params = useSearchParams();
  const query = params.get("q") ?? "";
  const [compose, setCompose] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const threads = api.forum.getThreads.useInfiniteQuery(
    { boardId, limit: FORUM_BOARD_THREADS_PER_PAGE, query: query || undefined },
    {
      initialData: !query ? { pages: [initialThreads], pageParams: [0] } : undefined,
      placeholderData: (previous) => previous,
      getNextPageParam: (p) => p.nextCursor,
      staleTime: 15000,
      refetchOnMount: "always",
    },
  );
  const board = threads.data?.pages[0]?.board;
  const create = api.forum.createThread.useMutation();
  const canCreate =
    !!board?.permissions.create && !!user && user.level >= FORUM_MIN_LEVEL;
  return (
    <ContentBox
      title={board?.name ?? "Forum board"}
      subtitle={board?.summary}
      defaultBackHref="/forum"
      topRightContent={<ForumNavigation />}
    >
      {threads.error && (
        <p role="alert">
          This board could not load.{" "}
          <Button onClick={() => void threads.refetch()}>Try again</Button>
        </p>
      )}
      {threads.isPending && <Loader explanation="Loading discussions…" />}
      {!threads.isPending && !board && (
        <p>This board is unavailable or you do not have permission to read it.</p>
      )}
      {board && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ForumWatchButton scope="BOARD" scopeId={board.id} />
            {canCreate && (
              <Button onClick={() => setCompose((v) => !v)}>
                {compose ? (
                  <X className="mr-2 h-4 w-4" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                {compose ? "Close composer" : "New topic"}
              </Button>
            )}
          </div>
          {board.rules && (
            <details className="bg-muted/30 rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Board rules
              </summary>
              <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap">
                {board.rules}
              </p>
            </details>
          )}
          {board.permissions.archived && (
            <p role="status" className="rounded-md border p-3 text-sm">
              This board is archived. Existing discussions remain available to read.
            </p>
          )}
          {board.restriction && (
            <p role="status" className="rounded-md border p-3 text-sm">
              Posting restricted: {board.restriction.reason}
            </p>
          )}
          {user && user.level < FORUM_MIN_LEVEL && (
            <p className="text-muted-foreground text-sm">{forumLevelMessage}</p>
          )}
          {compose && board.permissions.create && user && (
            <ForumComposer
              key={`${user.userId}:${board.id}`}
              draftKey={`board:${board.id}`}
              title
              coverImage={board.name === "News"}
              defaultKind={
                board.name === "Questions & Answers" ? "QUESTION" : "DISCUSSION"
              }
              pending={create.isPending}
              uploads={board.permissions.upload}
              onSubmit={async (value) => {
                const result = await create.mutateAsync({
                  board_id: board.id,
                  ...value,
                });
                showMutationToast(result);
                if (!result.success) return false;
                await Promise.all([
                  utils.forum.getAll.invalidate(),
                  utils.forum.getThreads.invalidate(),
                ]);
                setCompose(false);
                if (result.threadId)
                  router.push(`/forum/${board.id}/${result.threadId}`);
                return true;
              }}
            />
          )}
          <ForumSearch
            query={query}
            onSearch={(text) => {
              const url = new URL(window.location.href);
              if (text) url.searchParams.set("q", text);
              else url.searchParams.delete("q");
              window.history.replaceState(null, "", url);
            }}
          />
          {board.permissions.moderate && selected.length > 0 && (
            <ForumTopicTools
              ids={selected}
              onDone={() => {
                setSelected([]);
              }}
            />
          )}
          <ForumTopicList
            threads={threads.data?.pages.flatMap((p) => p.threads) ?? []}
            selectable={board.permissions.moderate}
            empty={
              query ? (
                <ForumEmptyState
                  title="No topics match your search"
                  detail="Try other words, or clear the search to see every topic."
                />
              ) : (
                <ForumEmptyState
                  title="No topics yet"
                  detail={
                    canCreate
                      ? "Start the first discussion on this board."
                      : "Nobody has started a discussion on this board yet."
                  }
                  action={
                    canCreate && !compose ? (
                      <Button onClick={() => setCompose(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Start the first topic
                      </Button>
                    ) : undefined
                  }
                />
              )
            }
            selected={selected}
            onSelect={(id) =>
              setSelected((s) =>
                s.includes(id) ? s.filter((v) => v !== id) : [...s, id],
              )
            }
          />
          {threads.hasNextPage && (
            <Button
              className="w-full"
              variant="outline"
              disabled={threads.isFetchingNextPage}
              onClick={() => void threads.fetchNextPage()}
            >
              {threads.isFetchingNextPage ? "Loading…" : "Load more topics"}
            </Button>
          )}
        </div>
      )}
    </ContentBox>
  );
}
