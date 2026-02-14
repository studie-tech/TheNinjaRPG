"use client";

import { api } from "@/app/_trpc/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  RANKED_LOADOUT_MAX_CONSUMABLES,
  RANKED_LOADOUT_MAX_INCREASECOST_ITEMS,
  RANKED_LOADOUT_MAX_INCREASECOST_JUTSUS,
  RANKED_LOADOUT_MAX_JUTSUS,
  RANKED_LOADOUT_MAX_POISON_ITEMS,
  RANKED_LOADOUT_MAX_POISON_JUTSUS,
  RANKED_LOADOUT_MAX_RESIDUAL_JUTSUS,
  RANKED_LOADOUT_MAX_WEAPONS,
} from "@/drizzle/constants";
import { useLocalStorage } from "@/hooks/localstorage";
import ContentBox from "@/layout/ContentBox";
import { QueueLengthHistogram } from "@/layout/QueueLengthHistogram";
import RankedLoadoutFiltering, {
  getFilter,
  useFiltering,
} from "@/layout/RankedLoadoutFiltering";
import { RankedRankDistributionHistogram } from "@/layout/RankedRankDistributionHistogram";
import { SeasonManager } from "@/layout/SeasonManager";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import { UnclaimedSeasonRewards } from "@/layout/UnclaimedSeasonRewards";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import type { ArrayElement } from "@/utils/typeutils";

export default function RankedManualPage() {
  type Tab = "overview" | "matchmaking" | "loadouts" | "rewards";
  const [activeTab, setActiveTab] = useLocalStorage<Tab>("manRankTa", "overview", true);

  return (
    <>
      <ContentBox
        title="Ranked PvP (Preview Feature)"
        subtitle="Competitive battles for League Points"
        defaultBackHref="/manual"
      >
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as Tab)}
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="matchmaking">Matchmaking</TabsTrigger>
            <TabsTrigger value="loadouts">Loadouts</TabsTrigger>
            <TabsTrigger value="rewards">Rewards</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <Card>
              <CardHeader>
                <CardTitle>Ranked PvP Overview</CardTitle>
                <CardDescription>
                  A competitive PvP system where players battle for League Points (LP)
                  and climb the ranks
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h3 className="mb-2 font-semibold">League Points (LP)</h3>
                  <p className="text-muted-foreground text-sm">
                    League Points represent your skill rating in ranked PvP. You gain LP
                    by winning matches and lose LP when defeated. The amount of LP
                    gained or lost depends on the difference in LP between you and your
                    opponent.
                  </p>
                </div>

                <div>
                  <h3 className="mb-2 font-semibold">Ranked Stats</h3>
                  <p className="text-muted-foreground text-sm">
                    In ranked battles, all players have standardized stats to ensure
                    fair competition:
                  </p>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground text-sm">
                    <li>Level 100 with maximum experience</li>
                    <li>Equalized health, chakra, and stamina pools</li>
                    <li>Balanced combat stats for all players</li>
                    <li>No bloodlines</li>
                  </ul>
                </div>

                <div>
                  <h3 className="mb-2 font-semibold">Battle Format</h3>
                  <p className="text-muted-foreground text-sm">
                    Ranked battles are 1v1 matches where players can use:
                  </p>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground text-sm">
                    <li>
                      {RANKED_LOADOUT_MAX_WEAPONS} weapons from their ranked loadout
                    </li>
                    <li>{RANKED_LOADOUT_MAX_CONSUMABLES} types of consumables</li>
                    <li>
                      {RANKED_LOADOUT_MAX_JUTSUS} jutsus from their ranked loadout
                    </li>
                    <li>Maximum {RANKED_LOADOUT_MAX_RESIDUAL_JUTSUS} residual jutsu</li>
                    <li>Maximum {RANKED_LOADOUT_MAX_POISON_JUTSUS} poison jutsu</li>
                    <li>Maximum {RANKED_LOADOUT_MAX_POISON_ITEMS} poison item</li>
                    <li>
                      Maximum {RANKED_LOADOUT_MAX_INCREASECOST_JUTSUS} increasecost
                      jutsu
                    </li>
                    <li>
                      Maximum {RANKED_LOADOUT_MAX_INCREASECOST_ITEMS} increasecost item
                    </li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="matchmaking">
            <Card>
              <CardHeader>
                <CardTitle>Matchmaking System</CardTitle>
                <CardDescription>
                  How players are matched in ranked battles
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h3 className="mb-2 font-semibold">LP-Based Matchmaking</h3>
                  <p className="text-muted-foreground text-sm">
                    Players are matched based on their League Points (LP) to ensure fair
                    and competitive matches:
                  </p>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground text-sm">
                    <li>Matches are made within a reasonable LP range</li>
                    <li>Longer queue times may result in wider LP ranges</li>
                    <li>Players with similar LP are prioritized for matches</li>
                  </ul>
                </div>

                <div>
                  <h3 className="mb-2 font-semibold">Queue System</h3>
                  <p className="text-muted-foreground text-sm">
                    How the ranked queue works:
                  </p>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground text-sm">
                    <li>Join the queue to be matched with other players</li>
                    <li>You can leave the queue at any time</li>
                    <li>
                      Matches are made automatically when suitable opponents are found
                    </li>
                    <li>Queue times vary based on player activity and LP range</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="loadouts">
            <Card>
              <CardHeader>
                <CardTitle>Ranked Loadouts</CardTitle>
                <CardDescription>
                  How to set up your ranked battle equipment
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h3 className="mb-2 font-semibold">Setting Up Your Loadout</h3>
                  <p className="text-muted-foreground text-sm">
                    To set up your ranked loadout:
                  </p>
                  <ol className="mt-2 list-inside list-decimal space-y-1 text-muted-foreground text-sm">
                    <li>Visit the battle arena page and click the PVP Rank tab</li>
                    <li>Select your preferred weapons</li>
                    <li>Choose two different consumables</li>
                    <li>Equip your desired jutsus in the ranked jutsu loadout</li>
                  </ol>
                </div>

                <div>
                  <h3 className="mb-2 font-semibold">Loadout Restrictions</h3>
                  <p className="text-muted-foreground text-sm">Keep in mind:</p>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground text-sm">
                    <li>
                      Only items available in the shop can be used in ranked loadouts
                    </li>
                    <li>You can change your loadout at any time</li>
                    <li>Loadout changes take effect immediately</li>
                    <li>You cannot use items from your inventory in ranked battles</li>
                    <li>
                      Residual jutsu are limited to {RANKED_LOADOUT_MAX_RESIDUAL_JUTSUS}{" "}
                      in ranked battles
                    </li>
                    <li>
                      Poison jutsu are limited to {RANKED_LOADOUT_MAX_POISON_JUTSUS} in
                      ranked battles
                    </li>
                    <li>
                      Poison items are limited to {RANKED_LOADOUT_MAX_POISON_ITEMS} in
                      ranked battles
                    </li>
                    <li>
                      Increasecost jutsu are limited to{" "}
                      {RANKED_LOADOUT_MAX_INCREASECOST_JUTSUS} in ranked battles
                    </li>
                    <li>
                      Increasecost items are limited to{" "}
                      {RANKED_LOADOUT_MAX_INCREASECOST_ITEMS} in ranked battles
                    </li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rewards">
            <Card>
              <CardHeader>
                <CardTitle>Ranked Rewards</CardTitle>
                <CardDescription>What you can earn from ranked battles</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h3 className="mb-2 font-semibold">LP Gains and Losses</h3>
                  <p className="text-muted-foreground text-sm">
                    The amount of LP you gain or lose depends on the LP difference
                    between you and your opponent:
                  </p>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground text-sm">
                    <li>Beating a higher LP opponent: +20-30 LP</li>
                    <li>Beating a similar LP opponent: +15-20 LP</li>
                    <li>Beating a lower LP opponent: +10-15 LP</li>
                    <li>Losing to a higher LP opponent: -10-15 LP</li>
                    <li>Losing to a similar LP opponent: -15-20 LP</li>
                    <li>Losing to a lower LP opponent: -20-30 LP</li>
                  </ul>
                </div>

                <div>
                  <h3 className="mb-2 font-semibold">Seasonal Rewards</h3>
                  <p className="text-muted-foreground text-sm">
                    At the end of each ranked season, players receive rewards based on
                    their final LP. See the season for details on rewards for each
                    division.
                  </p>
                  <UnclaimedSeasonRewards />
                </div>

                <div className="w-full">
                  <h3 className="mb-2 font-semibold">Season Overview</h3>

                  <SeasonManager />
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </ContentBox>

      {activeTab === "matchmaking" && <QueueLengthHistogram />}
      {activeTab === "loadouts" && <RankedLoadoutStatistics />}
      {activeTab === "rewards" && <RankedRankDistributionHistogram />}
    </>
  );
}

/**
 * Ranked Loadout Statistics Component
 */
const RankedLoadoutStatistics = () => {
  const state = useFiltering();
  const { data, isPending } = api.data.getRankedLoadoutStatistics.useQuery(
    getFilter(state),
  );

  const tableData = data?.map((pick) => ({
    name: pick.name,
    type: capitalizeFirstLetter(pick.type),
    battleType: pick.battleType,
    count: pick.count,
  }));

  const columns: ColumnDefinitionType<
    ArrayElement<typeof tableData>,
    keyof ArrayElement<typeof tableData>
  >[] = [
    { key: "name", header: "Name", type: "string" },
    { key: "type", header: "Type", type: "capitalized" },
    { key: "battleType", header: "Battle Type", type: "capitalized" },
    { key: "count", header: "Usage Count", type: "number" },
  ];

  return (
    <ContentBox
      title="Most Used Loadouts"
      subtitle="Statistics from ranked battles"
      padding={false}
      initialBreak={true}
      topRightContent={<RankedLoadoutFiltering state={state} />}
    >
      {isPending ? (
        <div className="flex items-center justify-center p-8">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      ) : (
        <Table data={tableData} columns={columns} />
      )}
    </ContentBox>
  );
};
