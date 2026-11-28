import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import * as tutorialHooks from "@/hooks/tutorial";
import * as questRewardCache from "@/hooks/useQuestRewardCacheUpdate";
import * as logbook from "@/layout/Logbook";
import * as rewardChoice from "@/layout/RewardChoice";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";

type OnSuccess = (
  data: Record<string, unknown>,
  variables: { questId: string; nextObjectiveId?: string },
  context: { userRevision: number; quests: unknown },
) => Promise<void>;

const completeTutorialAction = vi.fn(async () => undefined);
let onSuccess: OnSuccess | undefined;
const spies: { mockRestore: () => void }[] = [];

beforeEach(() => {
  completeTutorialAction.mockClear();
  onSuccess = undefined;
  spies.push(
    Object.assign(vi.spyOn(client, "api" as never), {
      quests: {
        checkRewards: {
          useMutation: (options: { onSuccess: OnSuccess }) => {
            onSuccess = options.onSuccess;
            return { mutate: vi.fn(), isPending: false };
          },
        },
      },
    }) as never,
    vi.spyOn(tutorialHooks, "useTutorialStep").mockReturnValue({
      currentStep: { id: "dialog", relatedValue: "trials", advanceOn: "questDialog" },
      completeTutorialAction,
    } as never),
    vi.spyOn(UserContext, "useUserInfo").mockReturnValue({
      prepareUserUpdate: () => 1,
      updateUser: vi.fn(async () => true),
    } as never),
    vi.spyOn(rewardChoice, "useOpenRewardChoice").mockReturnValue(vi.fn() as never),
    vi.spyOn(questRewardCache, "useQuestRewardCacheUpdate").mockReturnValue({
      prepareQuestRewardUpdate: () => ({}),
      updateQuestRewards: vi.fn(async () => undefined),
    } as never),
    vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined as never),
  );
});

afterEach(() => {
  cleanup();
  for (const spy of spies.splice(0)) spy.mockRestore();
});

const answer = { questId: "trials", nextObjectiveId: "next" };
const context = { userRevision: 1, quests: {} };

it("keeps a dialog lesson on its step when the server refuses the answer", async () => {
  renderHook(() => logbook.useCheckRewards());
  expect(onSuccess).toBeDefined();
  await onSuccess?.(
    { success: false, message: "Must be awake to finish quests" },
    answer,
    context,
  );
  expect(completeTutorialAction).not.toHaveBeenCalled();
});

it("moves a dialog lesson on once the server accepts the answer", async () => {
  renderHook(() => logbook.useCheckRewards());
  await onSuccess?.({ success: true, message: "Answered" }, answer, context);
  expect(completeTutorialAction).toHaveBeenCalledTimes(1);
  expect(completeTutorialAction).toHaveBeenCalledWith("questDialog");
});
