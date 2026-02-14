"use client";

import Link from "next/link";
import { api } from "@/app/_trpc/client";
import { Skeleton } from "@/components/ui/skeleton";
import { IMG_ICON_FORUM } from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import Post from "@/layout/Post";
import { groupBy } from "@/utils/grouping";
import { secondsPassed } from "@/utils/time";

export const ForumSkeleton = () => {
  return (
    <div>
      <ContentBox title="Main Broadcast" subtitle="General boards for TNR">
        <div className="flex flex-col gap-3">
          <Skeleton className="flex h-[100px] w-full items-center justify-center bg-popover">
            <Loader explanation="Loading..."></Loader>
          </Skeleton>
          <Skeleton className="h-[100px] w-full bg-popover"></Skeleton>
        </div>
      </ContentBox>
      <ContentBox title="Text-Based RPG" subtitle="Village Boards" initialBreak>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[150px] w-full bg-popover"></Skeleton>
          <Skeleton className="h-[150px] w-full bg-popover"></Skeleton>
          <Skeleton className="h-[150px] w-full bg-popover"></Skeleton>
          <Skeleton className="h-[150px] w-full bg-popover"></Skeleton>
          <Skeleton className="h-[150px] w-full bg-popover"></Skeleton>
          <Skeleton className="h-[150px] w-full bg-popover"></Skeleton>
        </div>
      </ContentBox>
      <ContentBox title="The Chat Lounge" subtitle="Fun boards for TNR">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[130px] w-full bg-popover"></Skeleton>
        </div>
      </ContentBox>
    </div>
  );
};

export default function Forum() {
  const { data: boards } = api.forum.getAll.useQuery();
  if (!boards) return <ForumSkeleton />;

  const groups = groupBy(boards, "group");
  const groupEntries = [...groups.entries()];

  return (
    <div>
      {groupEntries.map(([groupKey, groupBoards], groupIndex) => {
        const splits = groupKey.split(":");
        return (
          <div key={`forum-group-${groupKey}`}>
            <ContentBox
              title={splits?.[0] ? splits?.[0] : "Unknown"}
              subtitle={splits?.[1]}
              initialBreak={groupIndex !== 0}
            >
              {groupBoards.map((board) => {
                return (
                  <Link key={board.id} href={`/forum/${board.id}`}>
                    <Post
                      title={board.name}
                      hover_effect={true}
                      align_middle={true}
                      image={
                        <div className="mr-3 basis-1/12">
                          <Image
                            src={IMG_ICON_FORUM}
                            width={100}
                            height={100}
                            alt="Forum Icon"
                            className={
                              secondsPassed(board.updatedAt) > 3600 * 24
                                ? "opacity-50"
                                : ""
                            }
                          ></Image>
                        </div>
                      }
                      options={
                        <div className="ml-3">
                          <span className="font-bold">{board.nThreads} </span> topics
                          <br />
                          <span className="font-bold">{board.nPosts} </span> replies
                        </div>
                      }
                    >
                      {board.summary}
                    </Post>
                  </Link>
                );
              })}
            </ContentBox>
          </div>
        );
      })}
    </div>
  );
}
