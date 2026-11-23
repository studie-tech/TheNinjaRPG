import { afterEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChakraStormLobby } from "@/layout/ChakraStormLobby";
import { MiniGameDailyDuty } from "@/layout/MiniGameDailyDuty";
import { TowerDefenseLanding } from "@/layout/TowerDefenseLanding";
import { TowerDefenseLobby } from "@/layout/TowerDefenseLobby";
import { CS_EMPTY_PROGRESS } from "@/libs/chakraStorm/progress";

afterEach(cleanup);

const reward = { ryo: 2750, prestige: 150, villageTokens: 200 };

it("puts the defense account benefit directly after the guest hero, before the features", () => {
  const onPlay = vi.fn();
  render(<TowerDefenseLanding isStarting={false} disabled={false} onPlay={onPlay} />);
  const hero = screen.getByRole("region", { name: "Shuriken Siege: play for free" });
  expect(hero.nextElementSibling).toBe(
    screen.getByRole("region", { name: "Daily Guard Hall duty" }),
  );
  expect(hero.parentElement?.nextElementSibling).toBe(
    screen.getByRole("region", { name: "Why players keep coming back" }),
  );
  expect(
    screen.getByRole("link", { name: "Create free account" }).getAttribute("href"),
  ).toBe("/signup");
  expect(screen.getByRole("link", { name: "Join to earn" }).getAttribute("href")).toBe(
    "/signup",
  );
  fireEvent.click(screen.getByRole("button", { name: "Play now, free" }));
  expect(onPlay).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  "keeps the scout guest benefit below the shared hero and guards starting while loading: %s",
  (isLoading) => {
    const onStart = vi.fn();
    render(
      <ChakraStormLobby
        progress={CS_EMPTY_PROGRESS}
        stage="horizon"
        isGuest
        isLoading={isLoading}
        daily={null}
        onStage={() => {}}
        onStart={onStart}
        onTrain={() => {}}
      />,
    );
    const hero = screen.getByRole("region", { name: "Chakra Storm: play for free" });
    expect(hero.nextElementSibling).toBe(
      screen.getByRole("region", { name: "Daily scouting report" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Play now, free" }));
    expect(onStart).toHaveBeenCalledTimes(isLoading ? 0 : 1);
  },
);

it("places a signed-in scout's duty before the scouting action", () => {
  render(
    <ChakraStormLobby
      progress={CS_EMPTY_PROGRESS}
      stage="horizon"
      isGuest={false}
      daily={{ reward, done: false, hasVillage: true }}
      onStage={() => {}}
      onStart={() => {}}
      onTrain={() => {}}
    />,
  );
  const duty = screen.getByRole("region", { name: "Daily scouting report" });
  expect(duty.nextElementSibling).toBe(
    screen.getByRole("region", { name: "Start scouting" }),
  );
  expect(screen.getByText("200 village tokens")).toBeTruthy();
});

it("keeps the defense duty before the start action and uses the shared rewards", () => {
  render(
    <TowerDefenseLobby
      isGuest={false}
      level={11}
      villageName="Tsukimori"
      dailyDutyDone={false}
      progress={{ points: 0, bestWave: 0, dojo: {} }}
      saved={null}
      isStarting={false}
      isResuming={false}
      isPurchasing={false}
      onStart={() => {}}
      onResume={() => {}}
      onDiscard={() => {}}
      onBuy={() => {}}
    />,
  );
  const duty = screen.getByRole("region", { name: "Daily Guard Hall duty" });
  expect(
    duty.nextElementSibling?.contains(screen.getByText("Defend the Village")),
  ).toBe(true);
  expect(screen.getByText("2,750 ryo")).toBeTruthy();
  expect(screen.getByText("150 prestige")).toBeTruthy();
  expect(screen.getByText("200 village tokens")).toBeTruthy();
});

it("omits village tokens when the player has no village", () => {
  render(
    <MiniGameDailyDuty
      id="daily"
      title="Daily duty"
      description="Complete a run today."
      done={false}
      reward={reward}
      hasVillage={false}
    />,
  );
  expect(screen.getByText("2,750 ryo")).toBeTruthy();
  expect(screen.queryByText(/village tokens/)).toBeNull();
});

it("shows completion feedback without presenting the reward as still available", () => {
  render(
    <MiniGameDailyDuty
      id="daily"
      title="Daily duty done"
      description="Your next duty arrives tomorrow."
      done
      reward={reward}
      hasVillage
    />,
  );
  expect(screen.getByText("Your next duty arrives tomorrow.")).toBeTruthy();
  expect(screen.queryByText(/ryo|prestige|village tokens/)).toBeNull();
});
