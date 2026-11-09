import type React from "react";
import { api } from "@/app/_trpc/client";
import AvatarImage from "@/layout/Avatar";
import Loader from "@/layout/Loader";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import type { ArrayElement } from "@/utils/typeutils";
import { useRequiredUserData } from "@/utils/UserContext";

/** List the viewer's village clans or syndicate factions with leaders and member counts. */
export const ClansOverview: React.FC = () => {
  const { data: userData } = useRequiredUserData();
  const locationLabel = userData?.isOutlaw ? "syndicate" : "village";
  const groupLabel = userData?.isOutlaw ? "Faction" : "Clan";
  const groupLabelPlural = userData?.isOutlaw ? "Factions" : "Clans";

  // Queries
  const { data } = api.clan.getAll.useQuery(
    { villageId: userData?.villageId ?? "", isOutlaw: userData?.isOutlaw ?? false },
    { enabled: !!userData?.villageId },
  );
  const allClans = data?.map((clan) => ({
    ...clan,
    memberCount: clan.members.length,
    clanInfo: (
      <div className="w-20 text-center">
        <AvatarImage href={clan.image} alt={clan.name} size={100} hover_effect={true} />
        {clan.name}
      </div>
    ),
    leaderInfo: (
      <div className="w-20 text-center">
        {clan.leader && (
          <div>
            <AvatarImage
              href={clan.leader.avatar}
              alt={clan.name}
              size={100}
              hover_effect={true}
            />
            {clan.leader.username}
          </div>
        )}
      </div>
    ),
    villageType: clan.village?.type || "unknown",
  }));

  // Table
  type Clan = ArrayElement<typeof allClans>;
  const columns: ColumnDefinitionType<Clan, keyof Clan>[] = [
    { key: "clanInfo", header: groupLabel, type: "jsx" },
    { key: "leaderInfo", header: "Leader", type: "jsx" },
    { key: "memberCount", header: "# Members", type: "string" },
    { key: "pvpActivity", header: "PVP Activity", type: "string" },
  ];

  // If we're outlaw, then show village information
  if (userData?.isOutlaw) {
    columns.push({ key: "villageType", header: "FactionStage", type: "capitalized" });
  }

  // Loaders
  if (!userData) return <Loader explanation="Loading user data" />;

  // Render
  return (
    <>
      {allClans && allClans.length > 0 && (
        <Table
          data={allClans}
          columns={columns}
          linkPrefix="/clanhall/"
          linkColumn={"id"}
        />
      )}
      {allClans?.length === 0 && (
        <p className="p-3">
          No current {groupLabelPlural.toLowerCase()} in this {locationLabel}
        </p>
      )}
    </>
  );
};
