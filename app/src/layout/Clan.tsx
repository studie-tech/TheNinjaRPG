import type React from "react";
import { api } from "@/app/_trpc/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocalStorage } from "@/hooks/localstorage";
import ActionLogs from "@/layout/ActionLog";
import { getFilter, useFiltering } from "@/layout/ActionLogFiltering";
import ContentBox from "@/layout/ContentBox";
import { ClanBattles } from "@/layout/clan/ClanBattles";
import { ClanInfo } from "@/layout/clan/ClanInfo";
import { ClanMembers } from "@/layout/clan/ClanMembers";
import { ClanOrders } from "@/layout/clan/ClanOrders";
import { ClanRequests } from "@/layout/clan/ClanRequests";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { QueryError } from "@/layout/QueryError";
import Tournament from "@/layout/Tournament";
import { WarRoom } from "@/layout/WarSystem";
import { useRequiredUserData } from "@/utils/UserContext";
import { checkClanLeadership } from "@/validators/clan";
import { ObjectiveReward } from "@/validators/rewards";

interface ClanProfileProps {
  clanId: string;
  defaultBackHref?: string;
}

/** Clan page with the overview card and its tabs. */
export const ClanProfile: React.FC<ClanProfileProps> = (props) => {
  // Destructure & state
  const [showActive, setShowActive] = useLocalStorage<string>("clanPageTab", "orders");
  const { data: userData } = useRequiredUserData();
  const { clanId, defaultBackHref } = props;

  // Queries
  const {
    data: clanData,
    error: clanError,
    isFetching: isFetchingClan,
    refetch: refetchClan,
  } = api.clan.get.useQuery({ clanId: clanId }, { enabled: !!userData });

  // Two-level filtering
  const state = useFiltering("clan");

  // Loaders
  if (!clanId) return <Loader explanation="Which clan?" />;
  if (clanData === null)
    return (
      <ContentBox
        title="Clan"
        subtitle="Clan not found"
        defaultBackHref={defaultBackHref ?? "/clanhall"}
      >
        <p className="mb-3">This clan has been disbanded or could not be found.</p>
        <Link href="/clanhall" className="link-inline">
          Back to the clan hall
        </Link>
      </ContentBox>
    );
  if (!clanData && clanError)
    return (
      <ContentBox title="Clan" defaultBackHref={defaultBackHref ?? "/clanhall"}>
        <QueryError
          layout="stacked"
          message="Could not load this clan."
          messageClassName="mb-3"
          onRetry={() => void refetchClan()}
          isRetrying={isFetchingClan}
        />
      </ContentBox>
    );
  if (!clanData) return <Loader explanation="Loading clan data" />;
  if (!userData) return <Loader explanation="Loading user data" />;

  // Derived
  const leaderLike = checkClanLeadership(userData.userId, clanData);

  // Render
  return (
    <>
      {/** OVERVIEW */}
      <ClanInfo defaultBackHref={defaultBackHref} clanData={clanData} />
      <div className="w-full pt-2">
        <Tabs
          defaultValue={showActive}
          className="flex flex-col items-center justify-center"
          onValueChange={(value) => setShowActive(value)}
        >
          <TabsList className="text-center">
            <TabsTrigger value="orders">Orders</TabsTrigger>
            <TabsTrigger value="battles">Battles</TabsTrigger>
            <TabsTrigger value="requests">Requests</TabsTrigger>
            <TabsTrigger value="tournaments">Tournaments</TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="war">War</TabsTrigger>
            {userData.isOutlaw && <TabsTrigger value="logs">Logs</TabsTrigger>}
          </TabsList>
          <TabsContent value="orders">
            <ClanOrders
              clanId={clanData.id}
              order={clanData.leaderOrder}
              canPost={leaderLike}
            />
          </TabsContent>
          <TabsContent value="battles">
            <ClanBattles clanId={clanData.id} canCreate={leaderLike} />
          </TabsContent>
          <TabsContent value="requests">
            <ClanRequests
              clanId={clanData.id}
              clanLeaderId={clanData.leaderId}
              isLeaderOrColeader={leaderLike}
            />
          </TabsContent>
          <TabsContent value="tournaments">
            <Tournament
              userData={userData}
              tournamentId={clanData.id}
              rewards={ObjectiveReward.parse({ reward_money: clanData.bank })}
              title={`Tournaments`}
              subtitle="Initiated by leader"
              type="CLAN"
              canCreate={leaderLike && clanData.bank > 0}
              canJoin={userData.clanId === clanData.id}
            />
          </TabsContent>
          <TabsContent value="members">
            <ClanMembers userId={userData.userId} clanId={clanData.id} />
          </TabsContent>
          <TabsContent value="war">
            <WarRoom user={userData} initialBreak={true} />
          </TabsContent>
          {userData.isOutlaw && (
            <TabsContent value="logs">
              <ActionLogs
                state={getFilter(state)}
                relatedId={clanData.id}
                initialBreak={true}
              />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </>
  );
};
