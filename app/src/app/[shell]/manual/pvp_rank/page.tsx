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
  MAX_PLAYER_LEVEL,
  RANKED_BLOODLINE_EFFECT_MULT,
  RANKED_DIVISIONS,
  RANKED_DRAW_LP,
  RANKED_LOADOUT_MAX_CONSUMABLES,
  RANKED_LOADOUT_MAX_INCREASECOST_ITEMS,
  RANKED_LOADOUT_MAX_JUTSUS,
  RANKED_LOADOUT_MAX_POISON_ITEMS,
  RANKED_LOADOUT_MAX_WEAPONS,
  RANKED_LOSS_PROTECTION_FACTOR,
  RANKED_LOSS_PROTECTION_RANK_GAP,
  RANKED_MIN_LP_GAIN,
  RANKED_STREAK_BONUS,
  RANKED_UPSET_BONUS_PER_RANK,
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
import { getJutsuCategoryDef } from "@/libs/jutsu";
import { capitalizeFirstLetter } from "@/utils/string";
import type { ArrayElement } from "@/utils/typeutils";

/** Explain ranked PvP rules, loadout limits, matchmaking, and season rewards. */
export default function RankedManualPage() {
  const {
    data: equipLimits,
    isError,
    refetch,
  } = api.misc.getJutsuEquipLimits.useQuery();
  const rankedLimits = equipLimits?.filter((rule) => rule.rankedMaxEquipped !== null);
  const jutsuLimitEntries = isError ? (
    <li role="alert">
      Could not load jutsu limits.{" "}
      <button type="button" className="underline" onClick={() => void refetch()}>
        Try again
      </button>
    </li>
  ) : rankedLimits === undefined ? (
    <li role="status">Loading jutsu limits…</li>
  ) : rankedLimits.length === 0 ? (
    <li>No category limits apply to ranked jutsu.</li>
  ) : (
    rankedLimits.map((rule) => {
      const label = capitalizeFirstLetter(getJutsuCategoryDef(rule.category).label);
      return (
        <li key={rule.category}>
          {rule.rankedMaxEquipped === 0
            ? `${label} jutsu cannot be equipped in ranked battles.`
            : `${label} jutsu are limited to ${rule.rankedMaxEquipped} in ranked battles.`}
        </li>
      );
    })
  );

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
                    <li>Level {MAX_PLAYER_LEVEL} with maximum stats</li>
                    <li>Equalized health, chakra, and stamina pools</li>
                    <li>Balanced combat stats for all players</li>
                    <li>
                      Bloodline holders get a simulated {RANKED_BLOODLINE_EFFECT_MULT}x
                      damage boost (no unique bloodline effects; still sealable)
                    </li>
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
                  </ul>
                  <p className="mt-2 text-muted-foreground text-sm">
                    See the Loadouts tab for the item and jutsu restrictions.
                  </p>
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
                    <li>Choose up to {RANKED_LOADOUT_MAX_CONSUMABLES} consumables</li>
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
                      Poison items are limited to {RANKED_LOADOUT_MAX_POISON_ITEMS} in
                      ranked battles
                    </li>
                    <li>
                      Increasecost items are limited to{" "}
                      {RANKED_LOADOUT_MAX_INCREASECOST_ITEMS} in ranked battles
                    </li>
                    {jutsuLimitEntries}
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
                    A win or loss moves your LP by an Elo calculation: the higher your
                    opponent's LP compared to yours, the more a win gains and the less a
                    loss costs. The largest possible Elo change (K-factor) depends on
                    your division:
                  </p>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground text-sm">
                    {RANKED_DIVISIONS.filter((division) =>
                      Number.isFinite(division.rankedLp),
                    ).map((division) => (
                      <li key={division.key}>
                        {division.name} ({division.rankedLp}+ LP): {division.kFactor} LP
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-muted-foreground text-sm">On top of that:</p>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground text-sm">
                    <li>
                      Beating a higher-ranked opponent adds{" "}
                      {RANKED_UPSET_BONUS_PER_RANK} LP per rank the opponent is above
                      you
                    </li>
                    <li>
                      Each win adds {RANKED_STREAK_BONUS} LP for every win already in
                      your current streak
                    </li>
                    <li>Every win gains at least {RANKED_MIN_LP_GAIN} LP</li>
                    <li>A draw gives both players {RANKED_DRAW_LP} LP</li>
                    <li>
                      Losing to an opponent at least {RANKED_LOSS_PROTECTION_RANK_GAP}{" "}
                      ranks above you costs{" "}
                      {Math.round(RANKED_LOSS_PROTECTION_FACTOR * 100)}% of the usual LP
                    </li>
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
