import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import * as questHooks from "@/hooks/quest";
import { useQuestFight } from "@/hooks/useQuestFight";
import * as Logbook from "@/layout/Logbook";
import * as UserContext from "@/utils/UserContext";

const info = { questId: "trials", dialogId: "stand", battleId: "double" };
const checkRewards = vi.fn();
const retryBattle = vi.fn();
let isPending = false;

const show = (
  goals: { id: string; done: boolean; recentlyDied?: boolean }[],
  status = "AWAKE",
) => {
  vi.spyOn(UserContext, "useUserDataSelector").mockReturnValue({
    data: { status, questData: [{ id: info.questId, goals }] },
  } as never);
  vi.spyOn(Logbook, "useCheckRewards").mockReturnValue({
    checkRewards,
    isCheckingRewards: isPending,
  } as never);
  vi.spyOn(questHooks, "useRetryQuestBattle").mockReturnValue({
    retryBattle,
    isRetrying: false,
  } as never);
  return renderHook(() => useQuestFight(info)).result.current;
};

beforeEach(() => {
  isPending = false;
  checkRewards.mockClear();
  retryBattle.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("gives the dialog answer that leads into the fight", () => {
  show([
    { id: "stand", done: false },
    { id: "double", done: false },
  ])?.start();
  expect(checkRewards).toHaveBeenCalledWith({
    questId: "trials",
    nextObjectiveId: "double",
  });
  expect(retryBattle).not.toHaveBeenCalled();
});

it("fights a lost battle again", () => {
  show([
    { id: "stand", done: true },
    { id: "double", done: false, recentlyDied: true },
  ])?.start();
  expect(retryBattle).toHaveBeenCalledWith({ questId: "trials" });
  expect(checkRewards).not.toHaveBeenCalled();
});

it("has nothing to start during a battle or once it is won", () => {
  expect(show([{ id: "stand", done: false }], "BATTLE")).toBeUndefined();
  expect(
    show([
      { id: "stand", done: true },
      { id: "double", done: true },
    ]),
  ).toBeUndefined();
});

it("starts once while the answer is on its way", () => {
  isPending = true;
  show([{ id: "stand", done: false }])?.start();
  expect(checkRewards).not.toHaveBeenCalled();
});
