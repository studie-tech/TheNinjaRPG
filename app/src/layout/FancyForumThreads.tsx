"use client";

import { MessagesSquare, SquarePen } from "lucide-react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import NotFoundPage from "@/components/layout/NotFoundPage";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FANCY_FORUM_THREADS_PER_PAGE } from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import { EmptyState } from "@/layout/EmptyState";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import type { InfiniteThreads } from "@/libs/forum";
import { useInfinitePagination } from "@/libs/pagination";
import { parseHtml } from "@/utils/parse";

interface FancyForumThreadsProps {
  board_name: string;
  defaultBackHref?: string;
  initialData: Awaited<InfiniteThreads>;
  image?: string;
  canPost?: boolean | null;
}

export const FancyForumThreads: React.FC<FancyForumThreadsProps> = (props) => {
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  const {
    data: threads,
    fetchNextPage,
    hasNextPage,
  } = api.forum.getThreads.useInfiniteQuery(
    { limit: FANCY_FORUM_THREADS_PER_PAGE, boardName: props.board_name },
    {
      initialData: () => ({ pages: [props.initialData], pageParams: [null] }),
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
      refetchOnMount: false,
      refetchOnReconnect: false,
    },
  );
  const allThreads = threads.pages.flatMap((page) => page.threads);
  const board = threads.pages[0]?.board;

  useInfinitePagination({
    fetchNextPage,
    hasNextPage,
    lastElement,
  });

  if (!board)
    return (
      <NotFoundPage
        message="This forum board does not exist. It may have been removed."
        defaultBackHref="/forum"
        links={[
          { href: "/forum", label: "Back to the forum" },
          { href: "/", label: "Return to the front page" },
        ]}
      />
    );

  // Empty summaries still reserve the loading shell's subtitle row.
  return (
    <ContentBox
      title={board.name}
      subtitle={board.summary || "\u00a0"}
      defaultBackHref={props.defaultBackHref}
      padding={false}
      topRightContent={
        props.canPost && (
          <Button asChild id="conversation">
            <Link href={`/forum/${board.id}`}>
              <SquarePen className="mr-2 h-5 w-5" />
              New
            </Link>
          </Button>
        )
      }
    >
      {props.image && (
        <Image
          alt="threads-image"
          src={props.image}
          width={512}
          height={195}
          className="w-full"
          priority={true}
        />
      )}
      <div className="grid grid-cols-1">
        {allThreads.length === 0 ? (
          <EmptyState
            className="m-2"
            title="No threads yet"
            description={
              props.canPost
                ? "Be the first to start a conversation!"
                : "New posts from staff will appear here."
            }
          />
        ) : (
          allThreads.map((thread, i) => {
            const post = thread.posts[0];
            return (
              <div
                key={thread.id}
                ref={i === allThreads.length - 1 ? setLastElement : null}
                className={`m-2 rounded-md border-2 bg-popover p-3`}
              >
                <div>
                  <h2 className="font-bold">{thread.title}</h2>
                  <p className="pb-1 font-bold italic" suppressHydrationWarning>
                    By {thread.user?.username ?? "Unknown"} on{" "}
                    {thread.createdAt.toLocaleDateString()}
                  </p>
                </div>
                {post && parseHtml(post.content)}
                <p className="pt-3 hover:cursor-pointer hover:text-orange-500">
                  <Link
                    href={`/forum/${board.id}/${thread.id}`}
                    className="flex flex-row items-center justify-end"
                  >
                    <MessagesSquare className="mr-1 h-5 w-5" />
                    {thread.nPosts} Comments
                  </Link>
                </p>
              </div>
            );
          })
        )}
      </div>
    </ContentBox>
  );
};

/**
 * Keep the known board title, back link and banner visible while thread-shaped
 * placeholders reserve space for the fetched content.
 */
export const FancyForumThreadsSkeleton: React.FC<
  Pick<FancyForumThreadsProps, "board_name" | "defaultBackHref" | "image">
> = (props) => (
  <ContentBox
    title={props.board_name}
    subtitle={<Skeleton className="w-64 max-w-full">&nbsp;</Skeleton>}
    defaultBackHref={props.defaultBackHref}
    padding={false}
  >
    {props.image && (
      <Image
        alt="threads-image"
        src={props.image}
        width={512}
        height={195}
        className="w-full"
        priority={true}
      />
    )}
    <div className="grid grid-cols-1" role="status" aria-label="Loading threads">
      {THREAD_SKELETONS.map((key) => (
        <div
          key={key}
          className="m-2 rounded-md border-2 bg-popover p-3"
          aria-hidden="true"
        >
          <Skeleton className="mb-2 h-5 w-1/2" />
          <Skeleton className="mb-3 h-4 w-1/3" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
          <Skeleton className="mt-3 ml-auto h-5 w-28" />
        </div>
      ))}
    </div>
  </ContentBox>
);

const THREAD_SKELETONS = Array.from({ length: 3 }, (_, i) => `thread-skeleton-${i}`);
