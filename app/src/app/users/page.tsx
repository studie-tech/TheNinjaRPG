"use client";

import { useState } from "react";
import ContentBox from "@/layout/ContentBox";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BriefcaseBusiness } from "lucide-react";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import Loader from "@/layout/Loader";
import { canSeeIps } from "@/utils/permissions";
import { ExternalLink } from "lucide-react";
import { api } from "@/app/_trpc/client";
import { useInfinitePagination } from "@/libs/pagination";
import { showUserRank } from "@/libs/profile";
import { useRequiredUserData } from "@/utils/UserContext";
import UserFiltering, { useFiltering, getFilter } from "@/layout/UserFiltering";
import type { ArrayElement } from "@/utils/typeutils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function Users() {
  const { data: userData, isClerkLoaded } = useRequiredUserData();
  const tabNames = [
    "Online",
    "Strongest",
    "PvP",
    "Outlaws",
    "Community",
    "Staff",
    "Ranked",
  ] as const;
  type TabName = (typeof tabNames)[number];
  const [activeTab, setActiveTab] = useState<TabName>("Online");
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);

  // Two-level filtering
  const state = useFiltering();

  const {
    data: users,
    fetchNextPage,
    hasNextPage,
  } = api.profile.getPublicUsers.useInfiniteQuery(
    { ...getFilter(state), limit: 30, orderBy: activeTab, isAi: false },
    {
      enabled: isClerkLoaded,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
      staleTime: 1000 * 60 * 5,
    },
  );
  const { data: onlineStats } = api.profile.countOnlineUsers.useQuery(undefined, {
    enabled: isClerkLoaded,
  });
  const userCountNow = onlineStats?.onlineNow || 0;
  const userCountDay = onlineStats?.onlineDay || 0;
  const maxOnline = onlineStats?.maxOnline || 0;

  // Get PvP ranks for all users if we're in the Ranked tab
  const allUserIds = users?.pages.flatMap(page => page.data.map(user => user.userId)) ?? [];
  const { data: pvpRanks } = api.rankedpvp.getPvpRanks.useQuery(
    { userIds: allUserIds },
    { enabled: activeTab === "Ranked" && allUserIds.length > 0 }
  );

  const allUsers = users?.pages
    .map((page) => page.data)
    .flat()
    .map((user) => ({
      ...user,
      info: (
        <div>
          <p className="font-bold">{user.username}</p>
          <p>
            Lvl. {user.level} {activeTab === "Ranked" ? (
              pvpRanks?.[user.userId] || "Loading..."
            ) : showUserRank(user)}
          </p>
          <p>{user.village?.name || "Syndicate"}</p>
        </div>
      ),
    }));
  type User = ArrayElement<typeof allUsers>;

  useInfinitePagination({
    fetchNextPage,
    hasNextPage,
    lastElement,
  });

  const columns: ColumnDefinitionType<User, keyof User>[] = [
    { key: "avatar", header: "", type: "avatar" },
    { key: "info", header: "Info", type: "jsx" },
  ];
  if (activeTab === "Strongest") {
    columns.push({ key: "experience", header: "Experience", type: "string" });
  } else if (activeTab === "Online") {
    columns.push({ key: "updatedAt", header: "Last Active", type: "time_passed" });
  } else if (activeTab === "PvP") {
    columns.push({ key: "pvpStreak", header: "PvP Streak", type: "string" });
  } else if (activeTab === "Outlaws") {
    columns.push({ key: "villagePrestige", header: "Notoriety", type: "string" });
  } else if (activeTab === "Community") {
    columns.push({ key: "tavernMessages", header: "Yapper Rank", type: "string" });
  } else if (activeTab === "Staff") {
    columns.push({ key: "tavernMessages", header: "Yapper Rank", type: "string" });
    columns.push({ key: "role", header: "Role", type: "capitalized" });
  } else if (activeTab === "Ranked") {
    columns.push({ key: "rankedLp", header: "Ranked LP", type: "string" });
  }
  if (userData && canSeeIps(userData.role)) {
    columns.push({ key: "lastIp", header: "LastIP", type: "string" });
  }

  if (!userData) return <Loader explanation="Loading userdata" />;

  return (
    <ContentBox
      title={`Users`}
      subtitle={`Top ${activeTab}`}
      padding={false}
      topRightContent={
        <div className="flex flex-row items-center gap-1">
          <Select onValueChange={(value) => setActiveTab(value as TabName)}>
            <SelectTrigger>
              <SelectValue placeholder={activeTab} />
            </SelectTrigger>
            <SelectContent>
              {tabNames.map((tab) => (
                <SelectItem key={tab} value={tab}>
                  {tab}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Link href="/staff">
            <Button>
              <BriefcaseBusiness className="h-6 w-6" />
            </Button>
          </Link>
          <UserFiltering state={state} />
        </div>
      }
    >
      <div className="p-2 grid grid-cols-3 text-center">
        <p>
          <b>Online last 5min</b>
          <br /> {userCountNow} users
        </p>
        <p>
          <b>Max Online Ever</b>
          <br />
          {maxOnline} users
        </p>
        <p>
          <b>Online today</b>
          <br /> {userCountDay} users
        </p>
      </div>
      <Table
        data={allUsers}
        columns={columns}
        linkPrefix="/username/"
        linkColumn={"username"}
        setLastElement={setLastElement}
        buttons={[
          {
            label: <ExternalLink className="h-5 w-5" />,
            onClick: (user: User) => {
              window.open(`/userid/${user.userId}`, "_blank");
            },
          },
        ]}
      />
    </ContentBox>
  );
}
