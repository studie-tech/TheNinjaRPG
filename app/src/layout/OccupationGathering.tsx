"use client";

import { Info, Star, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  GATHERING_ITEM_DROP_CHANCES,
  GATHERING_RANKS,
  GATHERING_REQUIRED_EXP,
} from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import QuestPicker from "@/layout/QuestPicker";
import {
  getGatheringRank,
  getGatheringRankProgress,
  getNextRankExperience,
} from "@/libs/gathering";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import { useRequiredUserData } from "@/utils/UserContext";

export default function OccupationGathering() {
  // State
  const { data: userData } = useRequiredUserData();

  // Guard
  if (userData?.occupation !== "GATHERING") return null;

  // Derived data
  const gatheringRank = getGatheringRank(userData.gatheringExperience);
  const rankProgress = getGatheringRankProgress(userData.gatheringExperience);
  const nextRankExp = getNextRankExperience(gatheringRank);

  return (
    <>
      <QuestPicker
        questType="gathering"
        title="Gathering Quests"
        subtitle="Gather resources"
        initialBreak={true}
      />
      <ContentBox title="Overview" subtitle="Your experience and rank" initialBreak>
        <div className="space-y-6">
          {/* Gathering Rank */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Star className="h-5 w-5" />
                Gathering Rank: {capitalizeFirstLetter(gatheringRank)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>
                    Experience: {userData.gatheringExperience.toLocaleString()}
                  </span>
                  {rankProgress.nextRank && nextRankExp && (
                    <span>Next: {nextRankExp.toLocaleString()}</span>
                  )}
                </div>
                <Progress value={rankProgress.progress} className="h-2" />
              </div>
            </CardContent>
          </Card>

          {/* Drop Chances */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Item Drop Chances
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="text-muted-foreground text-sm">
                  Your current drop chances for {gatheringRank}:
                </div>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  {Object.entries(GATHERING_ITEM_DROP_CHANCES[gatheringRank]).map(
                    ([rarity, chance], i) => (
                      <div key={`${rarity}-${i}`} className="text-center">
                        <Badge variant="outline" className="mb-2 capitalize">
                          {rarity.toLowerCase()}
                        </Badge>
                        <div className="font-bold text-lg">{chance}%</div>
                      </div>
                    ),
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Gathering Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="h-5 w-5" />
                Gathering Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <h4 className="mb-2 font-medium">Gathering Ranks & Requirements</h4>
                  <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                    {GATHERING_RANKS.map((rank, i) => (
                      <div key={`${rank}-${i}`}>
                        <Badge variant="outline" className="mb-2">
                          {rank} ({GATHERING_REQUIRED_EXP[rank].toLocaleString()}+ exp)
                        </Badge>
                        <div className="ml-2 space-y-1 text-muted-foreground">
                          <div>Drop Chances:</div>
                          <ul className="space-y-1">
                            {Object.entries(GATHERING_ITEM_DROP_CHANCES[rank]).map(
                              ([rarity, chance], i) => (
                                <li
                                  key={`${rarity}-${i}`}
                                  className="flex justify-between"
                                >
                                  <span>
                                    • {capitalizeFirstLetter(rarity.toLowerCase())}:
                                  </span>
                                  <span>{chance}%</span>
                                </li>
                              ),
                            )}
                          </ul>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="mb-2 font-medium">How Gathering Works</h4>
                  <ul className="space-y-1 text-muted-foreground text-sm">
                    <li>
                      • Complete gathering quests to gain experience and materials
                    </li>
                    <li>
                      • Higher gathering ranks increase drop chances for rare materials
                    </li>
                    <li>• Experience is gained from successful gathering activities</li>
                    <li>
                      • Your user rank affects how much gathering experience you gain
                    </li>
                    <li>
                      • Different material rarities have different drop rates per rank
                    </li>
                    <li>• Gathering materials can be used for crafting and trading</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </ContentBox>
    </>
  );
}
