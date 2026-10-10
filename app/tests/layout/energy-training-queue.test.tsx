import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUserCaps } from "@/drizzle/constants";
import { EnergyTrainingQueue, useEnergyTrainingQueue } from "@/layout/EnergyTrainingQueue";
import type { UserWithRelations } from "@/routers/profile";
import type { UserDeltaResponse } from "@/validators/userCache";
import { ensureDom } from "../setup-dom.mjs";

type Result = UserDeltaResponse;
type QueueCallbacks = {
  onMutate: () => { revision: number | undefined };
  onSuccess: (result: Result) => void;
  onError: (error: Error) => void;
  onSettled: (
    result: Result | undefined,
    error: Error | null,
    variables: { entries: unknown[]; guess?: string },
    context?: { revision: number | undefined },
  ) => Promise<void>;
};
type QueueMocks = {
  invalidate: Mock<() => Promise<void>>;
  mutate: ReturnType<typeof vi.fn>;
  updateUser: Mock<(patch: unknown, options?: unknown) => Promise<void>>;
  callbacks: QueueCallbacks | null;
};
function testMocks(): QueueMocks {
  const globals = globalThis as typeof globalThis & { __energyQueueMocks?: QueueMocks };
  globals.__energyQueueMocks ??= {
    invalidate: vi.fn(async () => undefined),
    mutate: vi.fn(),
    updateUser: vi.fn(async (patch: unknown) => {
      if (!patch) await testMocks().invalidate();
    }),
    callbacks: null,
  };
  return globals.__energyQueueMocks;
}
const mocks = testMocks();
vi.mock("@/app/_trpc/client", () => ({
  api: {
    useUtils: () => ({ profile: { getUser: { invalidate: testMocks().invalidate } } }),
    train: {
      updateEnergyTrainingQueue: {
        useMutation: (callbacks: QueueCallbacks) => {
          testMocks().callbacks = callbacks;
          return { mutate: testMocks().mutate, isPending: false };
        },
      },
    },
  },
}));
vi.mock("@/utils/UserContext", () => ({
  useRequiredUserData: () => ({
    prepareUserUpdate: () => 7,
    updateUser: testMocks().updateUser,
  }),
}));
vi.mock("@/layout/ContentBox", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/libs/toast", () => ({ showMutationToast: vi.fn() }));

beforeEach(() => {
  ensureDom();
  vi.clearAllMocks();
});
afterEach(cleanup);

const user = {
  rank: "GENIN",
  offence: 10,
  defence: 10,
  strength: 10,
  intelligence: 10,
  speed: 10,
  willpower: 10,
  maxEnergy: 100,
  status: "AWAKE",
  isOutlaw: true,
  federalStatus: "GOLD",
  staffAccount: false,
  energyQueueHead: 0,
  masteryQueueHead: 0,
  queue: [],
} as unknown as NonNullable<UserWithRelations>;

/** One queued offence entry, stored as a row the way the account refresh returns it. */
const queuedOffence = [
  { kind: "ENERGY", position: 1, stat: "offence", energy: 100 },
] as unknown as NonNullable<UserWithRelations>["queue"];

const QueueImageAction = ({
  user,
  getGuess,
  refreshCaptcha,
}: {
  user: NonNullable<UserWithRelations>;
  getGuess: () => string;
  refreshCaptcha: () => Promise<void>;
}) => {
  const { saveQueue, error } = useEnergyTrainingQueue(refreshCaptcha);
  return (
    <>
      <button type="button" onClick={() => saveQueue({ expectedEntries: [], entries: [{ stat: "offence", energy: user.maxEnergy }], guess: getGuess() })}>
        Add to queue
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
};

describe("Energy queue captcha recovery", () => {
  it.each([
    { success: true, message: "Training queue saved", userPatch: { energyQueueTail: 1, queue: queuedOffence, curEnergy: 50 } },
    { success: false, message: "Invalid captcha" },
  ])(
    "refreshes a consumed captcha after $message so another edit can proceed",
    async (result) => {
      let guess = "first challenge";
      const refreshCaptcha = vi.fn(async () => {
        guess = "next challenge";
      });
      const view = render(
        <QueueImageAction
          user={user}
          getGuess={() => guess}
          refreshCaptcha={refreshCaptcha}
        />,
      );
      fireEvent.click(view.getByRole("button", { name: "Add to queue" }));
      expect(mocks.mutate).toHaveBeenLastCalledWith(
        expect.objectContaining({ guess: "first challenge" }),
      );
      await act(async () => {
        mocks.callbacks?.onSuccess(result);
        await mocks.callbacks?.onSettled(result, null, mocks.mutate.mock.lastCall?.[0], mocks.callbacks?.onMutate());
      });
      expect(refreshCaptcha).toHaveBeenCalledTimes(1);
      expect(mocks.updateUser).toHaveBeenCalledWith(result.success ? result.userPatch : undefined, expect.objectContaining({ revision: 7 }));
      expect(mocks.invalidate).toHaveBeenCalledTimes(result.success ? 0 : 1);
      fireEvent.click(view.getByRole("button", { name: "Add to queue" }));
      expect(mocks.mutate).toHaveBeenLastCalledWith(
        expect.objectContaining({ guess: "next challenge" }),
      );
      if (!result.success)
        expect(view.getByRole("alert").textContent).toBe("Invalid captcha");
    },
  );

  it("recovers when the write throws after consuming the captcha", async () => {
    const refreshCaptcha = vi.fn(async () => undefined);
    const view = render(
      <QueueImageAction
        user={user}
        getGuess={() => "answer"}
        refreshCaptcha={refreshCaptcha}
      />,
    );
    await act(async () => {
      mocks.callbacks?.onError(new Error("Write failed"));
      await mocks.callbacks?.onSettled(undefined, new Error("Write failed"), {
        entries: [{ stat: "offence", energy: 100 }],
        guess: "answer",
      });
    });
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toBe("Write failed"),
    );
    expect(refreshCaptcha).toHaveBeenCalledTimes(1);
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
  });

  it("preserves the captcha answer when clearing the queue without validation", async () => {
    const refreshCaptcha = vi.fn(async () => undefined);
    const view = render(
      <EnergyTrainingQueue
        user={{ ...user, queue: queuedOffence }}
        availableEnergy={0}
        getGuess={() => "answer"}
        refreshCaptcha={refreshCaptcha}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Clear queue" }));
    await act(async () => {
      await mocks.callbacks?.onSettled(
        { success: true, message: "Training queue cleared", userPatch: { energyQueueHead: 1, energyQueueTail: 1, queue: [] } },
        null,
        mocks.mutate.mock.lastCall?.[0],
        mocks.callbacks?.onMutate(),
      );
    });
    expect(refreshCaptcha).not.toHaveBeenCalled();
    expect(mocks.updateUser).toHaveBeenCalledWith({ energyQueueHead: 1, energyQueueTail: 1, queue: [] }, expect.objectContaining({ revision: 7 }));
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
  it("refreshes when a successful save requires broader automatic reconciliation", async () => {
    render(<EnergyTrainingQueue user={user} availableEnergy={100} getGuess={() => ""} refreshCaptcha={async () => {}} />);
    await act(async () => {
      await mocks.callbacks?.onSettled({ success: true, message: "Training queue saved" }, null, { entries: [] }, mocks.callbacks?.onMutate());
    });
    expect(mocks.updateUser).toHaveBeenCalledWith(undefined, expect.objectContaining({ revision: 7 }));
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
  });

});


describe("Energy queue capped stats", () => {
  it("keeps queue removal available when all stats cap", () => {
    const { stats_cap, gens_cap } = getUserCaps(user.rank);
    const view = render(<EnergyTrainingQueue user={{ ...user, offence: stats_cap, defence: stats_cap, strength: gens_cap, intelligence: gens_cap, speed: gens_cap, willpower: gens_cap, queue: queuedOffence }} availableEnergy={0} getGuess={() => "answer"} refreshCaptcha={async () => {}} />);
    fireEvent.click(view.getByRole("button", { name: "Clear queue" }));
    expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ entries: [] }));
  });
});
