import { afterEach, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { CombatRewards, HuntingRewards } from "@/layout/CombatRewards";
import type { CombatResult } from "@/libs/combat/types";
import type { HuntingReceipt } from "@/validators/hunting";

afterEach(cleanup);

it("preserves ordinary rewards, mastery names, signed territory changes, bounties and loot", () => {
  const result = combatResult({
    experience: 10.125,
    earnedExperience: 20,
    offence: 1,
    defence: 2,
    strength: 3,
    intelligence: 4,
    willpower: 5,
    speed: 6,
    masteryGains: { ninjutsuMastery: 7, taijutsuMastery: 0 },
    villagePrestige: 8,
    villageTokens: -9,
    clanPoints: 10,
    money: 11,
    seichiSilver: 12,
    lpDiff: 13,
    pvpExperience: 14,
    weeklyPvpKills: 2,
    warHealthInfo: { Akikaze: 15, Hyorin: -16, Unchanged: 0 },
    shrineInfo: { 724: -17, 723: 0 },
    villageWarShrineDisplay: { Siege: 18 },
    bountiesClaimed: [{ bountyId: "bounty", hunterId: "hero", amountRyo: 19 }],
    droppedItems: [
      {
        itemId: "loot",
        name: "Boar hide",
        userItemId: "looted-row",
        fromUserId: "foe",
      },
    ],
  });
  const view = render(
    <CombatRewards
      result={result}
      isOutlaw={false}
      showPvpEnergy={true}
      isQuest={false}
    />,
  );
  const summary = view.getByRole("region", { name: "Combat rewards" });
  for (const reward of [
    "Experience Points: 10.13",
    "Unassigned Experience: 20.00",
    "Offence: 1.00",
    "Defence: 2.00",
    "Strength: 3.00",
    "Intelligence: 4.00",
    "Willpower: 5.00",
    "Speed: 6.00",
    "Ninjutsu Mastery: 7.00",
    "Village Prestige: 8.00",
    "Village Tokens: -9.00",
    "Clan points: 10.00",
    "Money gained: 11.00",
    "Seichi Silver: 12",
    "Ranked PvP LP: +13.00",
    "PvP Experience: +14.00",
    "Weekly PvP kills: +2",
    "Akikaze War HP: +15.00",
    "Hyorin War HP: -16.00",
    "Shrine HP in sector 724: -17.00",
    "War Shrine HP (Siege): +18.00",
    "Bounty claimed: 19 Ryo",
    "Looted: Boar hide",
    "PvP Energy reward: 0",
  ])
    expect(summary.textContent).toContain(reward);
  for (const hidden of [
    "Taijutsu Mastery",
    "Unchanged",
    "sector 723",
    "Quest Energy",
    "No battle rewards",
  ])
    expect(summary.textContent).not.toContain(hidden);
});

it("preserves losses and outlaw notoriety while hiding nonpositive stat gains", () => {
  const view = render(
    <CombatRewards
      result={combatResult({
        outcome: "Lost",
        money: -25,
        villagePrestige: -2,
        lpDiff: -3,
        experience: -4,
        masteryGains: { ninjutsuMastery: -5 },
      })}
      isOutlaw={true}
      showPvpEnergy={false}
      isQuest={false}
    />,
  );
  const text = view.getByRole("region", { name: "Combat rewards" }).textContent;
  for (const reward of [
    "Money lost: -25.00",
    "Notoriety: -2.00",
    "Ranked PvP LP: -3.00",
  ])
    expect(text).toContain(reward);
  for (const hidden of [
    "Experience Points",
    "Ninjutsu Mastery",
    "Village Prestige",
    "PvP Energy",
  ])
    expect(text).not.toContain(hidden);
});

it("keeps quest and eligible PvP Energy explanations tied to their battle context", () => {
  const result = combatResult({ energyReward: 8 });
  const view = render(
    <CombatRewards
      result={result}
      isOutlaw={false}
      showPvpEnergy={true}
      isQuest={false}
    />,
  );
  expect(view.container.textContent).toContain(
    "PvP Energy reward: 8 (restored up to capacity)",
  );
  view.rerender(
    <CombatRewards
      result={result}
      isOutlaw={false}
      showPvpEnergy={false}
      isQuest={true}
    />,
  );
  expect(view.container.textContent).not.toContain("PvP Energy reward");
  expect(view.container.textContent).toContain(
    "Quest Energy is restored when you claim the completed quest's rewards.",
  );
  view.rerender(
    <CombatRewards
      result={result}
      isOutlaw={false}
      showPvpEnergy={false}
      isQuest={false}
    />,
  );
  expect(view.container.textContent).toContain("No battle rewards.");
  expect(view.container.textContent).not.toContain("Quest Energy");
});

it("renders a persisted hunting receipt once and retains additional combat rewards", () => {
  const receipt = huntingReceipt();
  const result = combatResult({ hunting: receipt });
  const view = render(
    <>
      <HuntingRewards receipt={receipt} />
      <CombatRewards
        result={result}
        isOutlaw={false}
        showPvpEnergy={false}
        isQuest={false}
      />
    </>,
  );
  const summary = view.getByRole("region", { name: "Hunting result" });
  expect(summary.textContent).toContain("Victory Settled · Forest Boar Hunt");
  expect(summary.textContent).toContain("Guaranteed: 2× Boar hide");
  expect(summary.textContent).toContain("Bonus: 1× Boar tusk");
  expect(summary.textContent).toContain("+250 hunting experience");
  expect(summary.textContent).toContain("1 successful hunts remaining");
  expect(view.queryByRole("region", { name: "Combat rewards" })).toBeNull();
  view.rerender(
    <>
      <HuntingRewards receipt={receipt} />
      <CombatRewards
        result={{ ...result, money: 5 }}
        isOutlaw={false}
        showPvpEnergy={false}
        isQuest={false}
      />
    </>,
  );
  expect(view.getByRole("region", { name: "Combat rewards" }).textContent).toContain(
    "Money gained: 5.00",
  );
});

it.each(["Lost", "Fled", "Draw"] as const)(
  "retains hunting recovery guidance for %s",
  (outcome) => {
    const view = render(<HuntingRewards receipt={{ ...huntingReceipt(), outcome }} />);
    expect(view.container.textContent).toContain(`${outcome} · Forest Boar Hunt`);
    expect(view.container.textContent).toContain(
      "No completion rewards. Your hunt allowance and preparation are preserved;",
    );
    expect(view.container.textContent).not.toContain("Guaranteed");
  },
);

it("shows the final-hunt cooldown and handles a receipt without material drops", () => {
  const view = render(
    <HuntingRewards
      receipt={{
        ...huntingReceipt(),
        materials: [],
        remaining: 0,
        cooldownUntil: "2026-10-18T10:30:00.000Z",
      }}
    />,
  );
  expect(view.container.textContent).toContain("0 successful hunts remaining");
  expect(view.container.textContent).toContain("Contract cooldown until");
  expect(view.container.textContent).toContain("+250 hunting experience");
});

/** Explicit settled-result fixture keeps display coverage independent of combat calculations. */
function combatResult(overrides: Partial<CombatResult> = {}): CombatResult {
  return {
    outcome: "Won",
    didWin: 1,
    eloDiff: 0,
    lpDiff: 0,
    experience: 0,
    earnedExperience: 0,
    pvpStreak: 0,
    curHealth: 100,
    curStamina: 100,
    curChakra: 100,
    strength: 0,
    intelligence: 0,
    willpower: 0,
    speed: 0,
    money: 0,
    seichiSilver: 0,
    offence: 0,
    defence: 0,
    villagePrestige: 0,
    friendsLeft: 0,
    targetsLeft: 0,
    villageTokens: 0,
    anbuPoints: 0,
    warHealthChange: 0,
    shrineChangeHp: 0,
    warHealthInfo: {},
    shrineInfo: {},
    villageWarShrineInfo: {},
    villageWarShrineDisplay: {},
    clanPoints: 0,
    notifications: [],
    bountiesClaimed: [],
    droppedItems: [],
    ...overrides,
  };
}

/** A committed receipt can be rendered after battle or after refreshing the occupation board. */
function huntingReceipt(): HuntingReceipt {
  return {
    battleId: "hunt",
    outcome: "Won",
    contractName: "Forest Boar Hunt",
    experience: 250,
    totalExperience: 5000,
    remaining: 1,
    cooldownUntil: null,
    materials: [
      { itemId: "hide", name: "Boar hide", quantity: 2, bonus: false },
      { itemId: "tusk", name: "Boar tusk", quantity: 1, bonus: true },
    ],
  };
}
