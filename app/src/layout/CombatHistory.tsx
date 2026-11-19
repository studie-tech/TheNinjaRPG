import { ChevronsDown } from "lucide-react";
import type React from "react";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { api } from "@/app/_trpc/client";
import { Switch } from "@/components/ui/switch";
import { BATTLE_LOG_DEFAULT_LIMIT, BATTLE_LOG_FULL_LIMIT } from "@/drizzle/constants";
import { useLocalStorage } from "@/hooks/localstorage";
import ElementImage from "@/layout/ElementImage";
import Loader from "@/layout/Loader";
import type { ActionEffect, CombatResult } from "@/libs/combat/types";
import { cn } from "@/libs/shadui";
import { groupBy } from "@/utils/grouping";
import { parseHtml } from "@/utils/parse";
import { getUserFederalStatus } from "@/utils/paypal";
import { canViewFullBattleLog } from "@/utils/permissions";
import { insertComponentsIntoText } from "@/utils/string";
import { useRequiredUserDataSelector } from "@/utils/UserContext";

interface CombatHistoryProps {
  battleId: string;
  battleVersion?: number;
  battleRound?: number;
  results?: CombatResult | null;
}

const CombatHistory: React.FC<CombatHistoryProps> = (props) => {
  // State
  const { battleId, battleVersion, battleRound, results } = props;
  const [prefersDarkLog, setIsDarkLog] = useLocalStorage("combatLogDarkMode", false);
  // Match the server surface during hydration, then apply the stored preference.
  const isHydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const isDarkLog = isHydrated && prefersDarkLog;
  const themeToggleId = useId();
  const { data: userData } = useRequiredUserDataSelector((u) => ({
    role: u.role,
    staffAccount: u.staffAccount,
    federalStatus: u.federalStatus,
    showBattleDescription: u.showBattleDescription,
  }));
  const [roundChoices, setRoundChoices] = useState<{
    battleId: string;
    rounds: Record<number, boolean>;
  }>({ battleId, rounds: {} });
  useEffect(() => {
    setRoundChoices((choices) =>
      choices.battleId === battleId ? choices : { battleId, rounds: {} },
    );
  }, [battleId]);

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

  sortedGroups?.forEach((entries, round) => {
    // Only explicit choices persist; the default follows the latest two rounds.
    const choice =
      roundChoices.battleId === battleId ? roundChoices.rounds[round] : undefined;
    const isOpen = choice ?? (round >= maxRound - 1 && round <= maxRound);
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
          "flex w-full cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-slate-100 group-data-[theme=dark]/combat-log:hover:bg-slate-800",
          isOpen && "bg-slate-100 group-data-[theme=dark]/combat-log:bg-slate-800",
        )}
        onClick={() => {
          setRoundChoices((prev) => ({
            battleId,
            rounds: {
              ...(prev.battleId === battleId ? prev.rounds : {}),
              [round]: !isOpen,
            },
          }));
        }}
      >
        <div className="h-2 w-2 rounded-full bg-slate-600 group-data-[theme=dark]/combat-log:bg-slate-400" />
        <ChevronsDown
          className={cn(
            "h-4 w-4 text-slate-600 transition-transform group-data-[theme=dark]/combat-log:text-slate-300",
            !isOpen && "-rotate-90",
          )}
        />
        <span className="text-sm font-semibold">Round {round}</span>
        {timeString && (
          <span className="ml-auto text-xs text-slate-600 group-data-[theme=dark]/combat-log:text-slate-300">
            {timeString}
          </span>
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
                  className="py-1 pl-4 text-sm font-normal"
                >
                  {isNewUser && !isLastEntry ? (
                    <hr className="mt-0 mb-3 group-data-[theme=dark]/combat-log:border-slate-700" />
                  ) : null}
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
                      LOG_EFFECT_TEXT_COLORS[effect.color] ??
                      "text-black group-data-[theme=dark]/combat-log:text-slate-100";
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
    <div
      data-theme={isDarkLog ? "dark" : "light"}
      className={cn(
        "group/combat-log relative flex flex-col overflow-auto rounded-lg border pt-2",
        isDarkLog
          ? "border-slate-700 bg-slate-950 text-slate-100"
          : "bg-white text-black",
      )}
    >
      <div className="flex min-h-12 items-center gap-2 px-3 pb-2">
        <label htmlFor={themeToggleId} className="cursor-pointer text-sm">
          Dark battle log
        </label>
        <Switch
          id={themeToggleId}
          checked={isDarkLog}
          onCheckedChange={setIsDarkLog}
          touchTarget
        />
      </div>
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

/** Hydration changes once; preference updates are supplied by useLocalStorage. */
const subscribeToHydration = () => () => {};

/** Effect colors stay readable on each independently selected log surface. */
const LOG_EFFECT_TEXT_COLORS: Record<ActionEffect["color"], string> = {
  red: "text-red-700 group-data-[theme=dark]/combat-log:text-red-400",
  green: "text-green-700 group-data-[theme=dark]/combat-log:text-green-400",
  blue: "text-blue-700 group-data-[theme=dark]/combat-log:text-blue-400",
  yellow: "text-yellow-800 group-data-[theme=dark]/combat-log:text-yellow-300",
  purple: "text-purple-700 group-data-[theme=dark]/combat-log:text-purple-400",
  orange: "text-orange-700 group-data-[theme=dark]/combat-log:text-orange-400",
  pink: "text-pink-700 group-data-[theme=dark]/combat-log:text-pink-400",
  gray: "text-gray-600 group-data-[theme=dark]/combat-log:text-gray-300",
};

/** Stat words a battle log effect highlights wherever they appear. */
const STAT_KEYWORD_HIGHLIGHTS: Record<string, React.ReactNode> = Object.fromEntries(
  Object.entries({
    Highest: "text-stone-500 group-data-[theme=dark]/combat-log:text-stone-400",
    Taijutsu: "text-green-700 group-data-[theme=dark]/combat-log:text-green-400",
    Bukijutsu: "text-red-600 group-data-[theme=dark]/combat-log:text-red-400",
    Ninjutsu: "text-blue-600 group-data-[theme=dark]/combat-log:text-blue-400",
    Genjutsu: "text-purple-600 group-data-[theme=dark]/combat-log:text-purple-400",
    Strength: "text-blue-800 group-data-[theme=dark]/combat-log:text-blue-300",
    Intelligence: "text-teal-700 group-data-[theme=dark]/combat-log:text-teal-300",
    Willpower: "text-orange-700 group-data-[theme=dark]/combat-log:text-orange-400",
    Speed: "text-cyan-700 group-data-[theme=dark]/combat-log:text-cyan-300",
  }).map(([word, className]) => [
    word,
    <span key={word} className={className}>
      {word}
    </span>,
  ]),
);
