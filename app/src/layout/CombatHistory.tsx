import { ChevronsDown } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { BATTLE_LOG_DEFAULT_LIMIT, BATTLE_LOG_FULL_LIMIT } from "@/drizzle/constants";
import ElementImage from "@/layout/ElementImage";
import type { ActionEffect, CombatResult } from "@/libs/combat/types";
import { cn } from "@/libs/shadui";
import { groupBy } from "@/utils/grouping";
import { parseHtml } from "@/utils/parse";
import { getUserFederalStatus } from "@/utils/paypal";
import { canViewFullBattleLog } from "@/utils/permissions";
import { insertComponentsIntoText } from "@/utils/string";
import { useRequiredUserData } from "@/utils/UserContext";
import Loader from "./Loader";

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
      checkBattle: !!results,
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

  sortedGroups?.forEach((entries, roundKey) => {
    const round = roundKey; // round is a meaningful identifier (round number), not just an index
    const isOpen = openRounds.includes(round);
    const roundTime = entries[0]?.createdAt;
    const timeString = roundTime
      ? roundTime.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      : "";

    const roundHeader = (
      <button
        type="button"
        key={`header-${round}`}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-slate-200",
          isOpen && "bg-slate-300",
        )}
        onClick={() => {
          setOpenRounds((prev) =>
            isOpen ? prev.filter((r) => r !== round) : [...prev, round],
          );
        }}
      >
        <div className="h-2 w-2 rounded-full bg-gray-700" />
        <ChevronsDown
          className={cn(
            "h-4 w-4 text-gray-700 transition-transform",
            !isOpen && "-rotate-90",
          )}
        />
        <span className="font-semibold text-gray-800 text-sm">Round {round}</span>
        {timeString && (
          <span className="ml-auto text-gray-500 text-xs">{timeString}</span>
        )}
      </button>
    );

    const latestRoundBattleVersion = entries?.sort(
      (a, b) => b.battleVersion - a.battleVersion,
    )?.[0]?.battleVersion;

    history.push(
      <li key={`r-${round}`} className="relative pl-2">
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
                    className="py-1 pl-4 font-normal text-gray-600 text-sm"
                  >
                    {isNewUser && !isLastEntry ? <hr className="mt-0 mb-3" /> : null}
                    {userData?.showBattleDescription ? (
                      <p>
                        #{entry.battleVersion}: {parseHtml(entry.description)}
                      </p>
                    ) : (
                      ""
                    )}
                    {effects?.map((effect, effectIdx) => {
                      const effectKey = `${entry.battleVersion}-${effectIdx}`;
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
                          <span key={`${effectKey}-H`} className="text-stone-500">
                            Highest
                          </span>
                        ),
                        Taijutsu: (
                          <span key={`${effectKey}-T`} className="text-green-600">
                            Taijutsu
                          </span>
                        ),
                        Bukijutsu: (
                          <span key={`${effectKey}-B`} className="text-red-600">
                            Bukijutsu
                          </span>
                        ),
                        Ninjutsu: (
                          <span key={`${effectKey}-N`} className="text-blue-600">
                            Ninjutsu
                          </span>
                        ),
                        Genjutsu: (
                          <span key={`${effectKey}-G`} className="text-purple-600">
                            Genjutsu
                          </span>
                        ),
                        Strength: (
                          <span key={`${effectKey}-Str`} className="text-blue-800">
                            Strength
                          </span>
                        ),
                        Intelligence: (
                          <span key={`${effectKey}-I`} className="text-teal-600">
                            Intelligence
                          </span>
                        ),
                        Willpower: (
                          <span key={`${effectKey}-W`} className="text-orange-600">
                            Willpower
                          </span>
                        ),
                        Speed: (
                          <span key={`${effectKey}-Spd`} className="text-cyan-600">
                            Speed
                          </span>
                        ),
                      });
                      return (
                        <div key={effectKey} className={cn(color)}>
                          - {text}{" "}
                          <div className="flex flex-row items-center gap-1 pl-2">
                            {effect.types?.map((t, i) => (
                              <ElementImage
                                key={`${t}-${i}`}
                                element={t}
                                className="h-5 w-5"
                              />
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
    <div className="relative flex flex-col overflow-auto rounded-lg border bg-slate-100 pt-2">
      {isFetching && (
        <div className="absolute top-2 right-2">
          <Loader />
        </div>
      )}
      <ol className="w-full">{history}</ol>
    </div>
  );
};

export default CombatHistory;
