import React, { useState, useEffect } from "react";
import Loader from "./Loader";
import ElementImage from "@/layout/ElementImage";
import { api } from "@/app/_trpc/client";
import { groupBy } from "@/utils/grouping";
import { insertComponentsIntoText } from "@/utils/string";
import { cn } from "src/libs/shadui";
import { parseHtml } from "@/utils/parse";
import { useRequiredUserData } from "@/utils/UserContext";
import { canViewFullBattleLog } from "@/utils/permissions";
import { getUserFederalStatus } from "@/utils/paypal";
import { BATTLE_LOG_FULL_LIMIT, BATTLE_LOG_DEFAULT_LIMIT } from "@/drizzle/constants";
import type { CombatResult } from "@/libs/combat/types";
import type { ActionEffect } from "@/libs/combat/types";
import { ChevronsDown } from "lucide-react";

interface CombatHistoryProps {
  battleId: string;
  asc?: boolean;
  battleVersion?: number;
  battleRound?: number;
  results?: CombatResult | null;
}

const CombatHistory: React.FC<CombatHistoryProps> = (props) => {
  // State
  const { battleId, battleVersion, battleRound, results, asc } = props;
  const { data: userData } = useRequiredUserData();
  const [openRounds, setOpenRounds] = useState<number[]>([]);

  // Check if user can view full battle log (staff role or gold federal status)
  const canViewFull = userData
    ? canViewFullBattleLog(userData.role) || getUserFederalStatus(userData) === "GOLD"
    : false;

  // From database
  const { data: allEntries, isFetching } = api.combat.getBattleEntries.useQuery(
    {
      battleId: battleId,
      refreshKey: battleVersion ?? 0,
      checkBattle: results ? true : false,
      limit: canViewFull ? BATTLE_LOG_FULL_LIMIT : BATTLE_LOG_DEFAULT_LIMIT,
    },
    {
      enabled: !!battleId && !!userData,
      placeholderData: (previousData) => previousData,
    },
  );
  const groups = allEntries && groupBy(allEntries, "battleRound");

  // Fill in missing entries
  let maxRound = 0;
  if (allEntries) maxRound = Math.max(...allEntries.map((e) => e.battleRound));
  if (battleRound) maxRound = battleRound;

  for (let i = 1; i < maxRound; i++) {
    if (!groups?.has(i)) {
      groups?.set(i, [
        {
          id: "0",
          userId: "unknown",
          actionId: "unknown",
          description: "No information on what happened during this round.",
          createdAt: new Date(),
          updatedAt: new Date(),
          battleId: battleId,
          battleVersion: 0,
          battleRound: i,
          appliedEffects: [],
        },
      ]);
    }
  }

  // Get keys of the groups map, and reverse sort them
  const sortedGroups =
    groups &&
    new Map([...groups.entries()].sort((a, b) => (asc ? a[0] - b[0] : b[0] - a[0])));

  // Create the history
  const history: React.ReactNode[] = [];

  // Ensure the latest round is opened by default or whenever a new round appears
  useEffect(() => {
    if (maxRound) {
      const latest = maxRound;
      const secondLatest = maxRound - 1;
      setOpenRounds([latest, secondLatest].filter((r) => r > 0));
    }
  }, [maxRound]);

  sortedGroups?.forEach((entries, round) => {
    const isOpen = openRounds.includes(round);
    const roundTime = entries[0]?.createdAt;
    const timeString = roundTime
      ? roundTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "";

    const roundHeader = (
      <div
        className={cn(
          "flex items-center gap-2 py-1 px-1 rounded-md hover:bg-slate-200 cursor-pointer",
          isOpen && "bg-slate-300",
        )}
        onClick={() => {
          setOpenRounds((prev) =>
            isOpen ? prev.filter((r) => r !== round) : [...prev, round],
          );
        }}
      >
        <div className="w-2 h-2 rounded-full bg-gray-700" />
        <ChevronsDown
          className={cn(
            "h-4 w-4 transition-transform text-gray-700",
            !isOpen && "-rotate-90",
          )}
        />
        <span className="text-sm font-semibold text-gray-800">Round {round}</span>
        {timeString && (
          <span className="text-xs text-gray-500 ml-auto">{timeString}</span>
        )}
      </div>
    );

    const latestRoundBattleVersion = entries?.sort(
      (a, b) => b.battleVersion - a.battleVersion,
    )?.[0]?.battleVersion;

    history.push(
      <li key={`r-${round}`} className="pl-2 relative">
        {roundHeader}
        <div className="flex flex-col gap-1">
          {isOpen &&
            entries
              .sort((a, b) => b.battleVersion - a.battleVersion)
              .map((entry) => {
                const effects = entry.appliedEffects as ActionEffect[];
                const isNewUser =
                  entry.description.includes(". It is now ") ||
                  entry.description.includes("End Turn: ");
                const isLastEntry = entry.battleVersion === latestRoundBattleVersion;
                return (
                  <div
                    key={`v-${entry.battleVersion}`}
                    className="text-sm font-normal text-gray-600 pl-4 py-1"
                  >
                    {isNewUser && !isLastEntry ? <hr className="mb-3 mt-0" /> : null}
                    {userData?.showBattleDescription ? (
                      <p>
                        #{entry.battleVersion}: {parseHtml(entry.description)}
                      </p>
                    ) : (
                      ""
                    )}
                    {effects?.map((effect, i) => {
                      const color =
                        effect.color === "red"
                          ? "text-red-500"
                          : effect.color === "blue"
                            ? "text-blue-500"
                            : effect.color === "green"
                              ? "text-green-500"
                              : effect.color === "yellow"
                                ? "text-yellow-500"
                                : effect.color === "purple"
                                  ? "text-purple-500"
                                  : effect.color === "orange"
                                    ? "text-orange-500"
                                    : effect.color === "pink"
                                      ? "text-pink-500"
                                      : effect.color === "gray"
                                        ? "text-gray-500"
                                        : "text-black";
                      const text = insertComponentsIntoText(effect.txt, {
                        Highest: (
                          <span key={`${round}-${i}-H`} className="text-stone-500">
                            Highest
                          </span>
                        ),
                        Taijutsu: (
                          <span key={`${round}-${i}-T`} className="text-green-600">
                            Taijutsu
                          </span>
                        ),
                        Bukijutsu: (
                          <span key={`${round}-${i}-B`} className="text-red-600">
                            Bukijutsu
                          </span>
                        ),
                        Ninjutsu: (
                          <span key={`${round}-${i}-N`} className="text-blue-600">
                            Ninjutsu
                          </span>
                        ),
                        Genjutsu: (
                          <span key={`${round}-${i}-G`} className="text-purple-600">
                            Genjutsu
                          </span>
                        ),
                        Strength: (
                          <span key={`${round}-${i}-Str`} className="text-blue-800">
                            Strength
                          </span>
                        ),
                        Intelligence: (
                          <span key={`${round}-${i}-I`} className="text-teal-600">
                            Intelligence
                          </span>
                        ),
                        Willpower: (
                          <span key={`${round}-${i}-W`} className="text-orange-600">
                            Willpower
                          </span>
                        ),
                        Speed: (
                          <span key={`${round}-${i}-Spd`} className="text-cyan-600">
                            Speed
                          </span>
                        ),
                      });
                      return (
                        <div key={`combathistory-${i}`} className={cn(color)}>
                          - {text}{" "}
                          <div className="pl-2 flex flex-row items-center gap-1">
                            {effect.types?.map((t, ti) => (
                              <ElementImage key={ti} element={t} className="w-5 h-5" />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
        </div>
      </li>,
    );
  });

  // Show component
  return (
    <div className="relative flex flex-col rounded-lg border bg-slate-100 pt-2 overflow-auto">
      {isFetching && (
        <div className="absolute right-2 top-2">
          <Loader />
        </div>
      )}
      <ol className="w-full">{history}</ol>
    </div>
  );
};

export default CombatHistory;
