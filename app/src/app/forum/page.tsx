"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";

import ContentBox from "@/layout/ContentBox";
import Post from "@/layout/Post";
import Loader from "@/layout/Loader";
import { Skeleton } from "@/components/ui/skeleton";

import { api } from "@/app/_trpc/client";
import { secondsPassed } from "@/utils/time";
import { groupBy } from "@/utils/grouping";
import { IMG_ICON_FORUM, IMG_COLLAB_NSRP } from "@/drizzle/constants";

export const NSRPBoard = () => (
  <ContentBox title="Text-Based RPG" subtitle="Naruto Saigen RP" initialBreak>
    <div className="flex flex-col gap-3">
      <Link href="https://www.narutosaigen.com/">
        <Image
          src={IMG_COLLAB_NSRP}
          alt="NSRP"
          width={100}
          height={100}
          className="w-full"
        />
      </Link>
      <p>
        If you&apos;re looking for a great Naruto RP complete with a welcoming and
        long-running community, helpful staff and an abundance of exciting in-character
        possibilities, then look no further: Naruto Saigen RP is the place for you
      </p>
      <p>
        Jump straight into the action as your very own custom-made shinobi and
        experience firsthand what it means to be a part of something great. Naruto
        Saigen introduces an alternate universe setting inspired by the Naruto and
        Boruto canon, providing near infinite possibilities and allowing you to write
        the stories you&apos;ve always wanted to tell. Begin as a ninja from one of the
        five great shinobi villages, as a minor country mercenary, or even as a rogue
        ninja, and enjoy the flexibility to create your own jutsu, weapons, summons,
        clans, bloodlines, villages, organisations, means to be a part of something
        great. Naruto Saigen introduces an alternate universe setting inspired by the
        Naruto and Boruto canon, providing near infinite possibilities and allowing you
        to write the stories you&apos;ve always wanted to tell. Begin as a ninja from
        one of the five great shinobi villages, as a minor country mercenary, or even as
        a rogue ninja, and enjoy the flexibility to create your own jutsu, weapons,
        summons, clans, bloodlines, villages, organisations, and more as your story
        unfolds. NSRP strives to offer everything you expect from a Naruto RP, and has
        continually grown and evolved throughout its 10+ year history.{" "}
      </p>
      <p>
        Our members have already invaded Konohagakure no Sato, embroiled Kumogakure no
        Sato and Lightning Country in a bloody civil war, discovered ancient caverns
        filled with monsters and spirits in the Catacombs under Iwagakure no Sato, and
        seen the breach of an old spirit prison within Wind Country, requiring the
        members of Sunagakure no Sato to round up the escaped spirits! Our member-driven
        environment means that you can develop the plots you want, when and how you want
        them.
      </p>
      <p>
        The forums are enjoying a lively surge of activity and embrace new members with
        open arms. Don&apos;t wait any longer before joining—become a part of one of the
        leading Naruto and Boruto roleplaying forums in existence. Our forums have been
        going strong since 2008 and remain highly active; we&apos;re clearly doing
        something right!
      </p>
    </div>
  </ContentBox>
);

export const ForumSkeleton = () => {
  return (
    <div>
      <ContentBox title="Main Broadcast" subtitle="General boards for TNR">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[100px] w-full bg-popover flex items-center justify-center">
            <Loader explanation="Loading..."></Loader>
          </Skeleton>
          <Skeleton className="h-[100px] w-full bg-popover"></Skeleton>
        </div>
      </ContentBox>
    </div>
  );
};

export default function Forum() {
  const { data: boards } = api.forum.getAll.useQuery();
  if (!boards)
    return (
      <div>
        <ForumSkeleton />
        <NSRPBoard />
      </div>
    );

  const forum: React.ReactNode[] = [];
  const groups = groupBy(boards, "group");
  let i = 0;
  groups.forEach((boards, group) => {
    const splits = group.split(":");
    forum.push(
      <div key={group}>
        <ContentBox
          title={splits?.[0] ? splits?.[0] : "Unknown"}
          subtitle={splits?.[1]}
          initialBreak={i !== 0}
        >
          {boards.map((board) => {
            return (
              <Link key={board.id} href={"/forum/" + board.id}>
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
                          secondsPassed(board.updatedAt) > 3600 * 24 ? "opacity-50" : ""
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
      </div>,
    );
    i++;
  });
  return (
    <div>
      {forum}
      <NSRPBoard />
    </div>
  );
}
