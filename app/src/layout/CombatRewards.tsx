import type { ReactNode } from "react";
import type { CombatResult } from "@/libs/combat/types";
import { getHuntingRank } from "@/libs/hunting";
import { capitalizeFirstLetter, formatAmount } from "@/utils/string";
import type { HuntingReceipt } from "@/validators/hunting";

/** Present settled combat rewards without fetching or granting anything on render. */
export function CombatRewards({
  result,
  isOutlaw,
  showPvpEnergy,
  isQuest,
}: {
  result: CombatResult;
  isOutlaw: boolean;
  showPvpEnergy: boolean;
  isQuest: boolean;
}) {
  const gains: [string, number][] = [
    ["Experience Points", result.experience],
    ["Unassigned Experience", result.earnedExperience],
    ["Offence", result.offence],
    ["Defence", result.defence],
    ...Object.entries(result.masteryGains ?? {}).map(
      ([mastery, gain]): [string, number] => [
        `${capitalizeFirstLetter(mastery.replace("Mastery", ""))} Mastery`,
        gain,
      ],
    ),
    ["Intelligence", result.intelligence],
    ["Strength", result.strength],
    ["Willpower", result.willpower],
    ["Speed", result.speed],
  ];
  const changes: [string, number][] = [
    [isOutlaw ? "Notoriety" : "Village Prestige", result.villagePrestige],
    ["Village Tokens", result.villageTokens],
    ["Clan points", result.clanPoints],
    [result.money < 0 ? "Money lost" : "Money gained", result.money],
  ];
  const territoryChanges: [string, number][] = [
    ...Object.entries(result.warHealthInfo ?? {}).map(
      ([name, change]): [string, number] => [`${name} War HP`, change],
    ),
    ...Object.entries(result.shrineInfo ?? {}).map(
      ([sector, change]): [string, number] => [`Shrine HP in sector ${sector}`, change],
    ),
    ...Object.entries(result.villageWarShrineDisplay ?? {}).map(
      ([name, change]): [string, number] => [`War Shrine HP (${name})`, change],
    ),
  ].filter(([, change]) => change !== 0);
  const rewards = [
    ...gains.filter(([, value]) => value > 0),
    ...changes.filter(([, value]) => value !== 0),
  ];
  const droppedItems = result.droppedItems ?? [];
  const hasRewards = !!(
    rewards.length ||
    territoryChanges.length ||
    result.lpDiff ||
    (result.pvpExperience ?? 0) > 0 ||
    (result.weeklyPvpKills ?? 0) > 0 ||
    result.seichiSilver > 0 ||
    result.bountiesClaimed.length ||
    droppedItems.length ||
    showPvpEnergy ||
    isQuest
  );
  // Hunting already has its own receipt summary; retain any additional combat rewards.
  if (result.hunting && !hasRewards) return null;
  return (
    <RewardSummary title="Battle rewards" label="Combat rewards">
      {rewards.map(([label, value]) => (
        <p key={label}>
          {label}: <strong>{value.toFixed(2)}</strong>
        </p>
      ))}
      {result.lpDiff !== 0 && (
        <p>
          Ranked PvP LP:{" "}
          <strong>
            {result.lpDiff > 0 ? "+" : ""}
            {result.lpDiff.toFixed(2)}
          </strong>
        </p>
      )}
      {(result.pvpExperience ?? 0) > 0 && (
        <p>
          PvP Experience: <strong>+{result.pvpExperience?.toFixed(2)}</strong>
        </p>
      )}
      {(result.weeklyPvpKills ?? 0) > 0 && (
        <p>
          Weekly PvP kills: <strong>+{result.weeklyPvpKills}</strong>
        </p>
      )}
      {result.seichiSilver > 0 && (
        <p>
          Seichi Silver: <strong>{result.seichiSilver}</strong>
        </p>
      )}
      {territoryChanges.map(([label, change]) => (
        <p
          key={label}
          className={
            change > 0
              ? "text-green-700 dark:text-green-400"
              : "text-red-700 dark:text-red-400"
          }
        >
          {label}:{" "}
          <strong>
            {change > 0 ? "+" : ""}
            {change.toFixed(2)}
          </strong>
        </p>
      ))}
      {showPvpEnergy && (
        <p>
          PvP Energy reward: <strong>{result.energyReward ?? 0}</strong>
          {(result.energyReward ?? 0) > 0 && " (restored up to capacity)"}
        </p>
      )}
      {result.bountiesClaimed.map((bounty) => (
        <p key={bounty.bountyId}>
          Bounty claimed: <strong>{formatAmount(bounty.amountRyo)} Ryo</strong>
        </p>
      ))}
      {droppedItems.map((drop) => (
        <p key={drop.itemId}>
          Looted: <strong>{drop.name}</strong>
        </p>
      ))}
      {isQuest && (
        <p className="text-muted-foreground text-sm sm:col-span-2">
          Quest Energy is restored when you claim the completed quest's rewards.
        </p>
      )}
      {!hasRewards && <p>No battle rewards.</p>}
    </RewardSummary>
  );
}

/** Reuse the combat summary for persisted hunting receipts, including failed encounters. */
export function HuntingRewards({ receipt }: { receipt: HuntingReceipt }) {
  return (
    <RewardSummary
      title={`${receipt.outcome === "Won" ? "Victory Settled" : receipt.outcome} · ${receipt.contractName}`}
      label="Hunting result"
    >
      {receipt.outcome === "Won" ? (
        <>
          {receipt.materials.map((material, index) => (
            <p key={`${material.itemId}-${index}`}>
              {material.bonus ? "Bonus" : "Guaranteed"}:{" "}
              <strong>
                {material.quantity}× {material.name}
              </strong>
            </p>
          ))}
          <p>
            +{receipt.experience.toLocaleString()} hunting experience ·{" "}
            {getHuntingRank(receipt.totalExperience)}
          </p>
          <p>{receipt.remaining} successful hunts remaining</p>
          {receipt.cooldownUntil && (
            <p className="sm:col-span-2">
              Contract cooldown until {new Date(receipt.cooldownUntil).toLocaleString()}
            </p>
          )}
        </>
      ) : (
        <p className="sm:col-span-2">
          No completion rewards. Your hunt allowance and preparation are preserved;
          recover and retry.
        </p>
      )}
    </RewardSummary>
  );
}

/** Keep hunting and other combat summaries compact, readable and consistent with the game theme. */
function RewardSummary({
  title,
  label,
  children,
}: {
  title: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <section
      className="min-w-0 space-y-2 rounded border bg-muted/30 p-3 text-left"
      aria-label={label}
    >
      <h3 className="break-words font-semibold">{title}</h3>
      <div className="grid min-w-0 gap-x-4 gap-y-1 break-words sm:grid-cols-2">
        {children}
      </div>
    </section>
  );
}
