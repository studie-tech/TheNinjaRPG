"use client";

import ContentBox from "@/layout/ContentBox";
import AvatarImage from "@/layout/Avatar";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Info } from "lucide-react";
import { api } from "@/app/_trpc/client";
import { cn } from "src/libs/shadui";

export default function Staff() {
  // Users Query
  const { data } = api.profile.getPublicUsers.useQuery(
    { orderBy: "Staff", isAi: false, limit: 50 },
    {},
  );
  const users = data?.data || [];

  // Render results
  return (
    <>
      <ContentBox title="TNR Staff" subtitle="Structure">
        <div className="flex flex-col gap-2">
          {/* Row 1: Coders */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-slate-300 p-1 rounded-lg font-bold relative">
              Code Admin & Owner
              <UserList
                users={users.filter((user) => user.role === "CODING-ADMIN")}
                expectedLength={1}
                columnCount={2}
              />
              <Information hoverEffect="hover:fill-slate-500">
                Main responsibility is to set the strategic direction and long-term
                goals, guiding all teams to ensure the game’s success and growth.
                Directly supervises and contributes to maintaining and developing the
                game’s core codebase.
              </Information>
            </div>
            <div className="bg-pink-300 p-1 rounded-lg font-bold col-span-2">
              Coders
              <UserList
                users={users.filter((user) => user.role === "CODER")}
                expectedLength={4}
                columnCount={4}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 text-center gap-2 text-black">
            {/* Column 1: Moderators */}
            <div className="flex flex-col gap-2">
              <div className="bg-red-500 p-1 rounded-lg font-bold relative">
                Moderator Admin
                <UserList
                  users={users.filter((user) => user.role === "MODERATOR-ADMIN")}
                  expectedLength={1}
                />
                <Information hoverEffect="hover:fill-red-800">
                  Main responsibility is to supervise and support our moderation team,
                  ensuring smooth operations and a welcoming environment for all
                  players. Works closely with the Head Moderator to oversee moderator
                  activities, review and address escalated issues, and make high-level
                  decisions on rule enforcement. Guides moderation team in handling
                  reports, applying game guidelines consistently, and fostering a
                  positive, safe community experience.
                </Information>
              </div>
              <div className="bg-emerald-500 p-1 rounded-lg font-bold">
                Head Moderator
                <UserList
                  users={users.filter((user) => user.role === "HEAD_MODERATOR")}
                  expectedLength={1}
                />
              </div>
              <div className="bg-green-800 p-1 rounded-lg font-bold text-white">
                Moderators
                <UserList
                  users={users.filter((user) => user.role === "MODERATOR")}
                  expectedLength={4}
                />
              </div>
            </div>

            {/* Column 2: Content */}
            <div className="flex flex-col gap-2">
              <div className="bg-purple-500 p-1 rounded-lg font-bold relative">
                Content Admin
                <UserList
                  users={users.filter((user) => user.role === "CONTENT-ADMIN")}
                  expectedLength={1}
                />
                <Information hoverEffect="hover:fill-purple-700">
                  Main responsibility is to oversee and manage all in-game content to
                  enhance player engagement and ensure a high-quality experience.
                  Working with content & event members, supervising the creation,
                  review, and implementation of new game elements such as quests, items,
                  jutsus, bloodlines, events etc.
                </Information>
              </div>
              <div className="bg-purple-400 p-1 rounded-lg font-bold">
                Content
                <UserList
                  users={users.filter((user) => user.role === "CONTENT")}
                  expectedLength={6}
                />
              </div>
            </div>

            {/* Column 3: Event */}
            <div className="flex flex-col gap-2">
              <div className="bg-rose-300 p-1 rounded-lg font-bold relative">
                Event Admin
                <UserList
                  users={users.filter((user) => user.role === "EVENT-ADMIN")}
                  expectedLength={1}
                />
                <Information hoverEffect="hover:fill-purple-700">
                  Main responsibility is to oversee and manage all in-game content to
                  enhance player engagement and ensure a high-quality experience.
                  Working with content & event members, supervising the creation,
                  review, and implementation of new game elements such as quests, items,
                  jutsus, bloodlines, events etc.
                </Information>
              </div>
              <div className="bg-orange-600 p-1 rounded-lg font-bold">
                Event
                <UserList
                  users={users.filter((user) => user.role === "EVENT")}
                  expectedLength={5}
                />
              </div>
            </div>
          </div>
        </div>
      </ContentBox>
      <ContentBox title="Staff Guidelines" subtitle="Overall Processes" initialBreak>
        <div className="flex flex-col gap-3">
          <p>
            <b>Hiring Process</b>
            <br />
            Users are strongly discouraged from pestering game staff about staff
            positions. Participate actively and positively in the community, both in
            tavern and on discord, and we will reach out.
          </p>
          <p>
            <b>Staff Conflicts</b>
            <br />
            Staff members may have disagreements, both within teams or across teams,
            e.g. a moderator disagreeing with a piece of content, or a content member
            disagreeing with a moderation decision. It is important to remember that all
            staff members are working towards the same goal: to make the game a better
            place for all players. All such disagreements are expected to be kept out of
            the public eye, both within TNR but also on all other channels, and instead
            be handled by raising the concern &quot;up the ladder&quot;, e.g. from
            moderator to moderator admin, who can then resolve the issue with e.g.
            content admin. If the issue cannot be resolved, it should be escalated to
            the owner, at which point a resolution will be found.
          </p>
        </div>
      </ContentBox>
    </>
  );
}

interface UserListProps {
  users: {
    userId: string;
    avatar: string | null;
    username: string;
    level: number;
    role: string;
  }[];
  expectedLength?: number;
  columnCount?: number;
}

const UserList: React.FC<UserListProps> = (props) => {
  // Destructure information
  const { users, expectedLength, columnCount = 2 } = props;
  // Show skeleton if expectedLength is set & there are no users
  if (expectedLength && users.length === 0) {
    return (
      <div
        className={cn(
          expectedLength > 1
            ? `grid grid-cols-1 sm:grid-cols-${columnCount}`
            : "flex flex-row justify-center",
        )}
      >
        {Array.from({ length: expectedLength }).map((_, i) => (
          <Skeleton key={i} className="m-2 aspect-square rounded-xl basis-1/2" />
        ))}
      </div>
    );
  }

  // Show users
  return (
    <div
      className={cn(
        users.length > 1
          ? `grid grid-cols-1 sm:grid-cols-${columnCount}`
          : "flex flex-row justify-center",
      )}
    >
      {users.map((user, i) => (
        <Link
          className="text-center relative basis-1/2"
          key={`${user.role}-${i}`}
          href={`/username/${user.username}`}
        >
          <AvatarImage
            href={user.avatar}
            alt={user.username}
            userId={user.userId}
            hover_effect={true}
            priority={true}
            size={100}
          />
          <div>
            <div className="font-bold text-xs">{user.username}</div>
          </div>
        </Link>
      ))}
    </div>
  );
};

interface InformationProps {
  children: React.ReactNode;
  hoverEffect: string;
}

const Information: React.FC<InformationProps> = (props) => {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Info
          className={cn(
            "w-6 h-6 absolute right-1 bottom-1 hover:cursor-pointer",
            props.hoverEffect,
          )}
        />
      </PopoverTrigger>
      <PopoverContent>
        <div className="max-w-[320px] min-w-[320px] relative">{props.children}</div>
      </PopoverContent>
    </Popover>
  );
};
