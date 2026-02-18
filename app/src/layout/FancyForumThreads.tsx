"use client";

import { MessagesSquare, SquarePen } from "lucide-react";

// Number of forum threads to display per page in fancy forum component
const FANCY_FORUM_THREADS_PER_PAGE = 10;

import Link from "next/link";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import type { InfiniteThreads } from "@/libs/forum";
import { useInfinitePagination } from "@/libs/pagination";
import { parseHtml } from "@/utils/parse";

interface FancyForumThreadsProps {
  board_name: string;
  defaultBackHref?: string;
  initialData: Awaited<InfiniteThreads>;
  initialBreak?: boolean;
  image?: string;
  canPost?: boolean | null;
}

export const FancyForumThreads: React.FC<FancyForumThreadsProps> = (props) => {
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  const {
    data: threads,
    isPending,
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
  const allThreads = threads?.pages.flatMap((page) => page.threads);
  const board = threads?.pages[0]?.board;

  useInfinitePagination({
    fetchNextPage,
    hasNextPage,
    lastElement,
  });

  if (!board || isPending) return <Loader explanation="Loading data" />;

  return (
    <ContentBox
      title={board.name}
      subtitle={board.summary}
      defaultBackHref={props.defaultBackHref}
      initialBreak={props.initialBreak}
      padding={false}
      topRightContent={
        props.canPost &&
        board && (
          <Link href={`/forum/${board.id}`}>
            <Button id="conversation">
              <SquarePen className="mr-2 h-5 w-5" />
              New
            </Button>
          </Link>
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
        {allThreads && allThreads.length === 0 ? (
          <div className="m-2 p-6 text-center text-muted-foreground">
            <p>No threads yet. Be the first to start a conversation!</p>
          </div>
        ) : (
          allThreads?.map((thread, i) => {
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
                    By {thread.user.username} on {thread.createdAt.toLocaleDateString()}
                  </p>
                </div>
                {post && parseHtml(post.content)}
                {board && (
                  <p className="pt-3 hover:cursor-pointer hover:text-orange-500">
                    <Link
                      href={`/forum/${board.id}/${thread.id}`}
                      className="flex flex-row items-center justify-end"
                    >
                      <MessagesSquare className="mr-1 h-5 w-5" />
                      {thread.nPosts} Comments
                    </Link>
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>
    </ContentBox>
  );
};
