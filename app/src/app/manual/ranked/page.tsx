"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ContentBox from "@/layout/ContentBox";
import { SeasonManager } from "./components/SeasonManager";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

export default function RankedManualPage() {
  const { data: userData } = useUserData();
  const canEditContent = canChangeContent(userData?.role ?? "USER");

  return (
    <ContentBox
      title="Ranked PvP System"
      subtitle="Competitive battles for League Points"
      back_href="/manual"
    >
      <Tabs defaultValue="overview" className="w-full">
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
                A competitive PvP system where players battle for League Points (LP) and climb the ranks
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="text-xl font-semibold mb-2">League Points (LP)</h3>
                <p className="text-muted-foreground">
                  League Points represent your skill rating in ranked PvP. You gain LP by winning matches and lose LP when defeated.
                  The amount of LP gained or lost depends on the difference in LP between you and your opponent.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">Ranked Stats</h3>
                <p className="text-muted-foreground">
                  In ranked battles, all players have standardized stats to ensure fair competition:
                </p>
                <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
                  <li>Level 100 with maximum experience</li>
                  <li>Equalized health, chakra, and stamina pools</li>
                  <li>Balanced combat stats for all players</li>
                  <li>No bloodlines</li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">Battle Format</h3>
                <p className="text-muted-foreground">
                  Ranked battles are 1v1 matches where players can use:
                </p>
                <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
                  <li>One weapon from their ranked loadout</li>
                  <li>Two types of consumables (6 charges each)</li>
                  <li>Any jutsus they have equipped in their ranked loadout</li>
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
                <h3 className="text-xl font-semibold mb-2">LP-Based Matchmaking</h3>
                <p className="text-muted-foreground">
                  Players are matched based on their League Points (LP) to ensure fair and competitive matches:
                </p>
                <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
                  <li>Matches are made within a reasonable LP range</li>
                  <li>Longer queue times may result in wider LP ranges</li>
                  <li>Players with similar LP are prioritized for matches</li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">Queue System</h3>
                <p className="text-muted-foreground">
                  How the ranked queue works:
                </p>
                <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
                  <li>Join the queue to be matched with other players</li>
                  <li>You can leave the queue at any time</li>
                  <li>Matches are made automatically when suitable opponents are found</li>
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
                <h3 className="text-xl font-semibold mb-2">Setting Up Your Loadout</h3>
                <p className="text-muted-foreground">
                  To set up your ranked loadout:
                </p>
                <ol className="list-decimal list-inside mt-2 space-y-1 text-muted-foreground">
                  <li>Visit the Ranked page</li>
                  <li>Select your preferred weapon</li>
                  <li>Choose two different consumables</li>
                  <li>Equip your desired jutsus in the ranked jutsu loadout</li>
                </ol>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">Loadout Restrictions</h3>
                <p className="text-muted-foreground">
                  Keep in mind:
                </p>
                <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
                  <li>Only items available in the shop can be used in ranked loadouts</li>
                  <li>You can change your loadout at any time</li>
                  <li>Loadout changes take effect immediately</li>
                  <li>You cannot use items from your inventory in ranked battles</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rewards">
          <Card>
            <CardHeader>
              <CardTitle>Ranked Rewards</CardTitle>
              <CardDescription>
                What you can earn from ranked battles
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="text-xl font-semibold mb-2">LP Gains and Losses</h3>
                <p className="text-muted-foreground">
                  The amount of LP you gain or lose depends on the LP difference between you and your opponent:
                </p>
                <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
                  <li>Beating a higher LP opponent: +20-30 LP</li>
                  <li>Beating a similar LP opponent: +15-20 LP</li>
                  <li>Beating a lower LP opponent: +10-15 LP</li>
                  <li>Losing to a higher LP opponent: -10-15 LP</li>
                  <li>Losing to a similar LP opponent: -15-20 LP</li>
                  <li>Losing to a lower LP opponent: -20-30 LP</li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">Seasonal Rewards</h3>
                <p className="text-muted-foreground">
                  At the end of each ranked season, players receive rewards based on their final LP:
                </p>
                <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
                  <li>Top 10: Special title and unique rewards</li>
                  <li>Top 100: Exclusive items and recognition</li>
                  <li>All participants: Season participation rewards</li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">Current Season</h3>
                <SeasonManager />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </ContentBox>
  );
} 