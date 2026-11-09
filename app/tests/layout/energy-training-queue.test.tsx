import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import * as client from "@/app/_trpc/client";
import { getUserCaps } from "@/drizzle/constants";
import * as ContentBox from "@/layout/ContentBox";
import {
  EnergyTrainingQueue,
  useEnergyTrainingQueue,
} from "@/layout/EnergyTrainingQueue";
import type { UserWithRelations } from "@/routers/profile";
import * as userContext from "@/utils/UserContext";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import type { UserDeltaResponse } from "@/validators/userCache";
import { spyOnToasts } from "../setup/toastMock";

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
  invalidate: Mock<
    (
      input?: undefined,
      filters?: undefined,
      options?: { cancelRefetch?: boolean },
    ) => Promise<void>
  >;
  mutate: ReturnType<typeof vi.fn>;
  updateUser: Mock<(patch: unknown, options?: unknown) => Promise<void>>;
  callbacks: QueueCallbacks | null;
  client?: QueryClient;
  timeDiff?: number;
};
const mocks: QueueMocks = {
  invalidate: vi.fn(async () => undefined),
  mutate: vi.fn(),
  updateUser: vi.fn(async (patch: unknown) => {
    if (
      !patch ||
      (typeof patch === "object" && "success" in patch && !("userPatch" in patch))
    )
      await mocks.invalidate();
  }),
  callbacks: null,
};
const profileKey = [["profile", "getUser"], { type: "query" }];
const utils = {
  profile: {
    getUser: {
      invalidate: (...args: Parameters<QueueMocks["invalidate"]>) =>
        mocks.invalidate(...args),
      getData: () => mocks.client?.getQueryData<{ serverTime: number }>(profileKey),
    },
  },
};
const api = {
  useUtils: () => utils,
  train: {
    updateEnergyTrainingQueue: {
      useMutation: (callbacks: QueueCallbacks) => {
        mocks.callbacks = callbacks;
        return { mutate: mocks.mutate, isPending: false };
      },
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invalidate.mockImplementation(async () => undefined);
  mocks.client = undefined;
  mocks.timeDiff = 0;
  Object.assign(vi.spyOn(client, "api" as never), api);
  vi.spyOn(ContentBox, "default").mockImplementation((({
    children,
  }: {
    children: ReactNode;
  }) => <div>{children}</div>) as never);
  spyOnToasts();
  vi.spyOn(userContext, "useRequiredUserData").mockImplementation(
    () =>
      ({
        prepareUserUpdate: () => 7,
        updateUser: mocks.updateUser,
      }) as never,
  );
  vi.spyOn(userContext, "useUserInfo").mockImplementation(
    () => ({ timeDiff: mocks.timeDiff ?? 0 }) as never,
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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
      <button
        type="button"
        onClick={() =>
          saveQueue({
            expectedEntries: [],
            entries: [{ stat: "offence", energy: user.maxEnergy }],
            guess: getGuess(),
          })
        }
      >
        Add to queue
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
};

describe("Energy queue captcha recovery", () => {
  it.each([
    {
      success: true,
      message: "Training queue saved",
      userPatch: { energyQueueTail: 1, queue: queuedOffence, curEnergy: 50 },
    },
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
        await mocks.callbacks?.onSettled(
          result,
          null,
          mocks.mutate.mock.lastCall?.[0],
          mocks.callbacks?.onMutate(),
        );
      });
      expect(refreshCaptcha).toHaveBeenCalledTimes(1);
      expect(mocks.updateUser).toHaveBeenCalledWith(
        result,
        expect.objectContaining({ revision: 7 }),
      );
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
        refreshCaptcha={refreshCaptcha}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Clear queue" }));
    await act(async () => {
      await mocks.callbacks?.onSettled(
        {
          success: true,
          message: "Training queue cleared",
          userPatch: { energyQueueHead: 1, energyQueueTail: 1, queue: [] },
        },
        null,
        mocks.mutate.mock.lastCall?.[0],
        mocks.callbacks?.onMutate(),
      );
    });
    expect(refreshCaptcha).not.toHaveBeenCalled();
    expect(mocks.updateUser).toHaveBeenCalledWith(
      {
        success: true,
        message: "Training queue cleared",
        userPatch: { energyQueueHead: 1, energyQueueTail: 1, queue: [] },
      },
      expect.objectContaining({ revision: 7 }),
    );
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
  it("refreshes when a successful save requires broader automatic reconciliation", async () => {
    render(
      <EnergyTrainingQueue
        user={user}
        availableEnergy={100}
        refreshCaptcha={async () => {}}
      />,
    );
    await act(async () => {
      await mocks.callbacks?.onSettled(
        { success: true, message: "Training queue saved" },
        null,
        { entries: [] },
        mocks.callbacks?.onMutate(),
      );
    });
    expect(mocks.updateUser).toHaveBeenCalledWith(
      { success: true, message: "Training queue saved" },
      expect.objectContaining({ revision: 7 }),
    );
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
  });
});

describe("Energy queue capped stats", () => {
  it("keeps queue removal available when all stats cap", () => {
    const { stats_cap, gens_cap } = getUserCaps(user.rank);
    const view = render(
      <EnergyTrainingQueue
        user={{
          ...user,
          offence: stats_cap,
          defence: stats_cap,
          strength: gens_cap,
          intelligence: gens_cap,
          speed: gens_cap,
          willpower: gens_cap,
          queue: queuedOffence,
        }}
        availableEnergy={0}
        refreshCaptcha={async () => {}}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Clear queue" }));
    expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ entries: [] }));
  });
});

describe("Energy queue profile recovery", () => {
  const base = Date.UTC(2026, 10, 2, 12);
  let now = base;
  const subscriptions: (() => void)[] = [];

  beforeEach(() => {
    now = base;
    vi.useFakeTimers();
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => {
    for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
    mocks.client?.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const advance = async (milliseconds: number) => {
    await act(async () => {
      now += milliseconds;
      vi.advanceTimersByTime(milliseconds);
    });
  };
  const mount = (timeDiff = 0) => {
    mocks.timeDiff = timeDiff;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mocks.client = client;
    const snapshot = () => ({
      serverTime: now - timeDiff,
      userData: { ...user, queue: queuedOffence },
    });
    const read = vi.fn(async () => snapshot());
    client.setQueryData(profileKey, snapshot());
    const observer = new QueryObserver(client, {
      queryKey: profileKey,
      queryFn: read,
      staleTime: Infinity,
    });
    subscriptions.push(observer.subscribe(() => {}));
    mocks.invalidate.mockImplementation((_input, _filters, options) =>
      client.invalidateQueries({ queryKey: profileKey }, options),
    );
    const props = {
      user: snapshot().userData,
      availableEnergy: 0,
      refreshCaptcha: async () => {},
    };
    const view = render(<EnergyTrainingQueue {...props} />);
    return { client, read, snapshot, props, view };
  };

  it.each([0, 5_000, -5_000])(
    "waits one minute after a completed canonical read with %i ms clock offset",
    async (timeDiff) => {
      const test = mount(timeDiff);
      await advance(50_000);
      await act(async () => {
        await test.client.refetchQueries({ queryKey: profileKey });
      });
      await advance(10_000);
      expect(test.read).toHaveBeenCalledTimes(1);
      await advance(49_999);
      expect(test.read).toHaveBeenCalledTimes(1);
      await advance(1);
      expect(test.read).toHaveBeenCalledTimes(2);
    },
  );

  it("performs only the canonical reads when other recovery paths settle every 50 seconds", async () => {
    const test = mount();
    for (let count = 1; count <= 3; count++) {
      await advance(count === 1 ? 50_000 : 40_000);
      await act(async () => {
        await test.client.refetchQueries({ queryKey: profileKey });
      });
      await advance(10_000);
      expect(test.read).toHaveBeenCalledTimes(count);
    }
    await advance(20_000);
    // Three completed reads replace three canonical reads plus three minute polls.
    expect(test.read).toHaveBeenCalledTimes(3);
  });

  it("joins a pending profile read without canceling it and keeps the next recovery scheduled", async () => {
    const test = mount();
    let complete!: (result: ReturnType<typeof test.snapshot>) => void;
    test.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await advance(59_000);
    const pending = test.client.refetchQueries({ queryKey: profileKey });
    await advance(1_000);
    expect(test.read).toHaveBeenCalledTimes(1);
    expect(mocks.invalidate).toHaveBeenLastCalledWith(undefined, undefined, {
      cancelRefetch: false,
    });
    // A slow request does not stop attempts while it remains pending.
    await advance(60_000);
    expect(mocks.invalidate).toHaveBeenCalledTimes(2);
    expect(test.read).toHaveBeenCalledTimes(1);
    await act(async () => {
      complete(test.snapshot());
      await pending;
    });
    await advance(60_000);
    expect(test.read).toHaveBeenCalledTimes(2);
  });

  it("does not treat a confirmed local patch as canonical settlement", async () => {
    const test = mount();
    await advance(50_000);
    const revision = prepareUserUpdate(test.client, profileKey);
    await act(async () => {
      expect(
        await updateUserCache(
          test.client,
          profileKey,
          { curEnergy: 25, updatedAt: new Date(now) },
          { revision },
        ),
      ).toBe(true);
    });
    await advance(10_000);
    expect(test.read).toHaveBeenCalledTimes(1);
  });

  it("keeps the canonical recovery required by a stale mutation revision", async () => {
    const test = mount();
    const revision = prepareUserUpdate(test.client, profileKey);
    await act(async () => {
      await updateUserCache(test.client, profileKey, { curEnergy: 25 });
    });
    await advance(50_000);
    await act(async () => {
      expect(
        await updateUserCache(test.client, profileKey, { curEnergy: 10 }, { revision }),
      ).toBe(false);
    });
    expect(test.read).toHaveBeenCalledTimes(1);
    await advance(10_000);
    expect(test.read).toHaveBeenCalledTimes(1);
    await advance(50_000);
    expect(test.read).toHaveBeenCalledTimes(2);
  });

  it("retains minute recovery when cached data has no canonical timestamp", async () => {
    const test = mount();
    test.client.setQueryData(profileKey, { userData: test.props.user });
    await advance(60_000);
    expect(test.read).toHaveBeenCalledTimes(1);
    await advance(60_000);
    expect(test.read).toHaveBeenCalledTimes(2);
  });

  it("retries failed reads once per minute without looping on a stale server timestamp", async () => {
    const test = mount();
    test.read.mockRejectedValueOnce(new Error("Profile unavailable"));
    await advance(60_000);
    expect(test.client.getQueryState(profileKey)?.status).toBe("error");
    expect(test.read).toHaveBeenCalledTimes(1);
    await advance(59_999);
    expect(test.read).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(test.read).toHaveBeenCalledTimes(2);
    expect(test.client.getQueryState(profileKey)?.status).toBe("success");
  });

  it.each(["remove", "unmount"])(
    "stops polling when the queue is removed or the account surface unmounts: %s",
    async (action) => {
      const test = mount();
      if (action === "remove")
        test.view.rerender(
          <EnergyTrainingQueue {...test.props} user={{ ...user, queue: [] }} />,
        );
      else test.view.unmount();
      await advance(180_000);
      expect(test.read).not.toHaveBeenCalled();
    },
  );
});
