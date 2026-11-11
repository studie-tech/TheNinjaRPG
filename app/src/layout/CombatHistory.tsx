import { ChevronsDown } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { BATTLE_LOG_DEFAULT_LIMIT, BATTLE_LOG_FULL_LIMIT } from "@/drizzle/constants";
import ElementImage from "@/layout/ElementImage";
import Loader from "@/layout/Loader";
import { EFFECT_TEXT_COLORS } from "@/libs/combat/constants";
import type { ActionEffect, CombatResult } from "@/libs/combat/types";
import { cn } from "@/libs/shadui";
import { groupBy } from "@/utils/grouping";
import { parseHtml } from "@/utils/parse";
import { getUserFederalStatus } from "@/utils/paypal";
import { canViewFullBattleLog } from "@/utils/permissions";
import { insertComponentsIntoText } from "@/utils/string";
import { useRequiredUserData } from "@/utils/UserContext";

interface CombatHistoryProps {
  battleId: string;
  battleVersion?: number;
  battleRound?: number;
  results?: CombatResult | null;
}

const CombatHistory: React.FC<CombatHistoryProps> = (props) => {
  // State
  const { battleId, battleVersion, battleRound, results } = props;
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
      // Unversioned saved logs may predate the final insert. Live keys are seeded
      // from committed deltas and must keep their cache across layout/tab remounts.
      // Abort abandoned reads so reopening cannot reuse their incomplete response.
      refetchOnMount: battleVersion === undefined ? "always" : true,
      trpc: { abortOnUnmount: true },
    },
  );
  const groups = allEntries && groupBy(allEntries, "battleRound");

  // Fill in missing entries
  let maxRound = 0;
  if (allEntries) maxRound = Math.max(...allEntries.map((e) => e.battleRound));
  if (battleRound) maxRound = battleRound;

  const placeholderRounds = new Set<number>();
  for (let i = 1; i < maxRound; i++) {
    if (!groups?.has(i)) {
      placeholderRounds.add(i);
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
    groups && new Map([...groups.entries()].sort((a, b) => b[0] - a[0]));

  // Create the history
  const history: React.ReactNode[] = [];

  // Open the latest rounds by default and whenever a new round appears, keeping any
  // earlier round the player opened
  useEffect(() => {
    if (maxRound) {
      const latest = [maxRound, maxRound - 1].filter((r) => r > 0);
      setOpenRounds((rounds) => [...new Set([...rounds, ...latest])]);
    }
  }, [maxRound]);

  sortedGroups?.forEach((entries, round) => {
    const isOpen = openRounds.includes(round);
    const roundTime = placeholderRounds.has(round) ? undefined : entries[0]?.createdAt;
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
          "flex w-full cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-accent",
          isOpen && "bg-accent",
        )}
        onClick={() => {
          setOpenRounds((prev) =>
            isOpen ? prev.filter((r) => r !== round) : [...prev, round],
          );
        }}
      >
        <div className="h-2 w-2 rounded-full bg-muted-foreground" />
        <ChevronsDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            !isOpen && "-rotate-90",
          )}
        />
        <span className="font-semibold text-foreground text-sm">Round {round}</span>
        {timeString && (
          <span className="ml-auto text-muted-foreground text-xs">{timeString}</span>
        )}
      </button>
    );

    entries.sort((a, b) => b.battleVersion - a.battleVersion);
    const latestRoundBattleVersion = entries[0]?.battleVersion;

    history.push(
      <li key={`r-${round}`} className="relative pl-2">
        {roundHeader}
        <div className="flex flex-col gap-1">
          {isOpen &&
            entries.map((entry) => {
              const effects = entry.appliedEffects as ActionEffect[];
              const isNewUser =
                entry.description.includes(". It is now ") ||
                entry.description.includes("End Turn: ");
              const isLastEntry = entry.battleVersion === latestRoundBattleVersion;
              return (
                <div
                  key={`v-${entry.battleVersion}`}
                  className="py-1 pl-4 font-normal text-muted-foreground text-sm"
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
                    const color = EFFECT_TEXT_COLORS[effect.color] ?? "text-foreground";
                    const text = insertComponentsIntoText(
                      effect.txt,
                      STAT_KEYWORD_HIGHLIGHTS,
                    );
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
    <div className="relative flex flex-col overflow-auto rounded-lg border bg-card text-card-foreground pt-2">
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

/** Stat words a battle log effect highlights wherever they appear. */
const STAT_KEYWORD_HIGHLIGHTS: Record<string, React.ReactNode> = Object.fromEntries(
  Object.entries({
    Highest: "text-stone-500",
    Taijutsu: "text-green-600",
    Bukijutsu: "text-red-600",
    Ninjutsu: "text-blue-600",
    Genjutsu: "text-purple-600",
    Strength: "text-blue-800",
    Intelligence: "text-teal-600",
    Willpower: "text-orange-600",
    Speed: "text-cyan-600",
  }).map(([word, className]) => [
    word,
    <span key={word} className={className}>
      {word}
    </span>,
  ]),
);
