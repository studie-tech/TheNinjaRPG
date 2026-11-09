"use client";

import type React from "react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type BattleType, BattleTypes } from "@/drizzle/constants";
import type { UserRank } from "@/drizzle/schema";
import { BattleHistoryTable } from "@/layout/BattleHistoryTable";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import Post from "@/layout/Post";
import Table from "@/layout/Table";
import { UserAvatarTile } from "@/layout/UserAvatarTile";
import { parseHtml } from "@/utils/parse";

// ---------------- TAB COMPONENTS: Lazy-loaded queries ----------------

interface TabComponentProps {
  userId: string;
  isActive: boolean;
}

/** Fetch and display reports against the player only while the tab is active. */
export const ReportsTab: React.FC<TabComponentProps> = ({ userId, isActive }) => {
  const { data: reports, isPending } = api.reports.getUserReports.useQuery(
    { userId },
    { enabled: isActive },
  );

  return (
    <ContentBox
      title="Reports"
      subtitle="Reports against this user"
      initialBreak={true}
    >
      {isPending && <Loader explanation="Fetching User Reports" />}
      {reports?.length === 0 && <p>No reports found</p>}
      {reports?.map((report) => (
        <Link key={`report-${report.id}`} href={`/reports/${report.id}`}>
          <Post
            title={`${report.reporterUser?.username} on ${report.system}`}
            hover_effect={true}
            align_middle={true}
            image={
              <div className="m-3 w-16">
                {report.reporterUser?.avatar && (
                  <Image
                    src={report.reporterUser.avatar}
                    width={100}
                    height={100}
                    alt="Reporter Avatar"
                  />
                )}
              </div>
            }
          >
            {parseHtml(report.reason)}
            <b>Status:</b> {report.status.toLowerCase()}
          </Post>
        </Link>
      ))}
    </ContentBox>
  );
};

/** Load the staff-visible connection history when its profile tab is active. */
export const HistoricalIpsTab: React.FC<TabComponentProps> = ({ userId, isActive }) => {
  const { data: historicalIps, isPending } = api.staff.getUserHistoricalIps.useQuery(
    { userId },
    { enabled: isActive },
  );

  return (
    <ContentBox
      title="Historical IPs"
      subtitle="IP addresses used the last 90 days"
      initialBreak={true}
    >
      {isPending && <Loader explanation="Fetching Historical IPs" />}
      {historicalIps?.length === 0 && <p>No historical IP records found</p>}
      {historicalIps && historicalIps.length > 0 && (
        <div className="space-y-2">
          {historicalIps.map((ip) => (
            <div
              key={ip.ip}
              className="flex items-center justify-between rounded-lg border-2 border-border bg-card p-3"
            >
              <div>
                <h4 className="font-semibold text-foreground">
                  <Link
                    href={`/users/ipsearch/${ip.ip}`}
                    className="hover:cursor-pointer hover:text-orange-500"
                  >
                    {ip.ip}
                  </Link>
                </h4>
                <p className="text-muted-foreground text-sm">
                  Last used: {ip.usedAt.toLocaleString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </ContentBox>
  );
};

/** Load claimed activity-event history only for the active staff profile tab. */
export const ActivityEventsTab: React.FC<TabComponentProps> = ({
  userId,
  isActive,
}) => {
  const { data: activityEvents, isPending } = api.staff.getUserActivityEvents.useQuery(
    { userId },
    { enabled: isActive },
  );

  return (
    <ContentBox
      title="Activity Events"
      subtitle="Latest claimed activity events"
      initialBreak={true}
    >
      {isPending && <Loader explanation="Fetching Activity Events" />}
      {activityEvents?.length === 0 && <p>No activity events found</p>}
      {activityEvents && activityEvents.length > 0 && (
        <div className="space-y-2">
          {activityEvents.map((event) => (
            <div
              key={event.id}
              className="rounded-lg border-2 border-border bg-card p-3"
            >
              <h4 className="font-semibold text-foreground">
                Activity Event #{event.id}
              </h4>
              <p className="text-muted-foreground text-sm">Streak: {event.streak}</p>
              <p className="text-muted-foreground text-sm">
                Created: {event.createdAt.toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </ContentBox>
  );
};

/** Load logged bloodline changes only while their profile tab is active. */
export const BloodlineHistoryTab: React.FC<TabComponentProps> = ({
  userId,
  isActive,
}) => {
  const { data: bloodlineHistory, isPending } = api.logs.getBloodlineHistory.useQuery(
    { userId },
    { enabled: isActive },
  );

  return (
    <ContentBox
      title="Bloodline History"
      subtitle="All bloodlines this user has had"
      initialBreak={true}
      padding={false}
    >
      {isPending && <Loader explanation="Fetching Bloodline History" />}
      {bloodlineHistory?.length === 0 && (
        <p className="p-3">No bloodline history found</p>
      )}
      {bloodlineHistory && bloodlineHistory.length > 0 && (
        <Table
          data={bloodlineHistory}
          columns={[
            { key: "image", header: "Image", type: "avatar" },
            { key: "name", header: "Name", type: "string" },
            { key: "rank", header: "Rank", type: "capitalized" },
            { key: "type", header: "Roll Type", type: "capitalized" },
            { key: "createdAt", header: "Date", type: "date" },
          ]}
        />
      )}
    </ContentBox>
  );
};

// ---------------- Additional Tab Components ----------------

interface StudentsTabProps {
  students: Array<{
    userId: string;
    username: string;
    rank: UserRank;
    level: number;
    avatar: string | null;
    isOutlaw: boolean;
  }>;
}

/** Display the already-loaded student roster without another profile query. */
export const StudentsTab: React.FC<StudentsTabProps> = ({ students }) => {
  return (
    <ContentBox title="Students" subtitle="Past and present" initialBreak={true}>
      {(!students || students.length === 0) && <p>No students found</p>}
      {students && students.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5">
          {students.map((user) => (
            <UserAvatarTile key={user.userId} user={user} className="text-center" />
          ))}
        </div>
      )}
    </ContentBox>
  );
};

interface MarriagesTabProps extends TabComponentProps {
  username: string;
}

/** Load marriage relationships only while the player's marriage tab is active. */
export const MarriagesTab: React.FC<MarriagesTabProps> = ({
  userId,
  username,
  isActive,
}) => {
  const { data: marriages, isPending } = api.marriage.getMarriedUsers.useQuery(
    { id: userId },
    { staleTime: 300000, enabled: isActive },
  );

  if (isPending) return <Loader explanation="Fetching Married Users" />;

  return (
    <ContentBox
      title="Married Users"
      subtitle={`${username} is married to these users`}
      initialBreak={true}
    >
      {(!marriages || marriages.length === 0) && <p>No married users found</p>}
      {marriages && marriages.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5">
          {marriages.map((user) => (
            <UserAvatarTile
              key={user.userId}
              user={user}
              hideLevel
              className="text-center"
            />
          ))}
        </div>
      )}
    </ContentBox>
  );
};

// ---------------- Ranked Matches Tab ----------------

/** Load ranked battle history only while its public-profile tab is active. */
export const RankedMatchesTab: React.FC<TabComponentProps> = ({ userId, isActive }) => {
  return (
    <ContentBox
      title="Ranked Match History"
      subtitle="All ranked PvP matches for this user"
      initialBreak={true}
      padding={false}
    >
      <BattleHistoryTable
        userId={userId}
        combatTypes={["RANKED_PVP"]}
        enabled={isActive}
        emptyMessage="No ranked matches found"
      />
    </ContentBox>
  );
};

// ---------------- Combat History Tab ----------------

/** Browse battle-type-filtered history without fetching for an inactive profile tab. */
export const CombatHistoryTab: React.FC<TabComponentProps> = ({ userId, isActive }) => {
  const [selectedType, setSelectedType] = useState<string>("all");

  return (
    <ContentBox
      title="Combat History"
      subtitle="All combat encounters for this user"
      initialBreak={true}
      padding={false}
      topRightContent={
        <Select value={selectedType} onValueChange={setSelectedType}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {BattleTypes.map((type, i) => (
              <SelectItem key={`${type}-${i}`} value={type}>
                {type.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      <BattleHistoryTable
        userId={userId}
        combatTypes={selectedType === "all" ? undefined : [selectedType as BattleType]}
        enabled={isActive}
        showBattleType
      />
    </ContentBox>
  );
};
