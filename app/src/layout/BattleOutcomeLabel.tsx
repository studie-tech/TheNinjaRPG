import type { BattleOutcome } from "@/drizzle/constants";
import { cn } from "@/libs/shadui";

/** A battle result, coloured by outcome; battles from before results were recorded show a dash. */
export const BattleOutcomeLabel = ({ outcome }: { outcome: BattleOutcome | null }) =>
  outcome ? (
    <span
      className={cn(
        "font-semibold",
        outcome === "Won" && "text-green-600 dark:text-green-400",
        outcome === "Lost" && "text-red-600 dark:text-red-400",
        (outcome === "Draw" || outcome === "Fled") && "text-muted-foreground",
      )}
    >
      {outcome}
    </span>
  ) : (
    <span className="text-muted-foreground" title="Result not recorded">
      <span aria-hidden>—</span>
      <span className="sr-only">Not recorded</span>
    </span>
  );

/** Keep recorded fighter results in the header, with long names yielding to their outcomes. */
export const BattleResultSummary = ({
  entry,
}: {
  entry: {
    attacker?: { username: string } | null;
    defender?: { username: string } | null;
    attackerOutcome: BattleOutcome | null;
    defenderOutcome: BattleOutcome | null;
  };
}) => {
  const sides = [
    { name: entry.attacker?.username ?? "Attacker", outcome: entry.attackerOutcome },
    { name: entry.defender?.username ?? "Defender", outcome: entry.defenderOutcome },
  ].filter((side) => side.outcome !== null);
  if (sides.length === 0) return null;
  return (
    <p className="flex flex-col items-end text-sm leading-tight">
      <span className="sr-only">Result:</span>
      {sides.map((side, index) => (
        <span
          key={index === 0 ? "attacker" : "defender"}
          className="flex max-w-36 items-baseline gap-1 sm:max-w-64"
        >
          <span className="truncate" title={side.name}>
            {side.name}:
          </span>{" "}
          <BattleOutcomeLabel outcome={side.outcome} />
        </span>
      ))}
    </p>
  );
};
