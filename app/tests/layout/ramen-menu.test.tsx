import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { RouterInputs, RouterOutputs } from "@/app/_trpc/client";
import * as client from "@/app/_trpc/client";
import type { UserUpdate, UserUpdateOptions } from "@/deltas/profile";
import type { UserStatus } from "@/drizzle/constants";
import { IMG_RAMEN_WELCOME } from "@/drizzle/constants";
import * as navigation from "@/hooks/navigation";
import * as tutorial from "@/hooks/tutorial";
import * as ContentBox from "@/layout/ContentBox";
import * as Image from "@/layout/Image";
import * as RamenShop from "@/layout/RamenShop";
import * as toast from "@/libs/toast";
import type { UserWithRelations } from "@/server/api/routers/profile";
import * as routing from "@/utils/routing";
import * as UserContext from "@/utils/UserContext";
import {
  prepareUserUpdate as prepareCacheUpdate,
  updateUserCache,
} from "@/utils/userCache";

type FoodInput = RouterInputs["village"]["buyFood"];
type FoodResult = RouterOutputs["village"]["buyFood"];
type PurchaseOptions = {
  onMutate: () => number | undefined;
  onSuccess: (
    result: FoodResult,
    input: FoodInput,
    revision: number | undefined,
  ) => Promise<void>;
  onError: (error: Error) => void;
};

let purchaseOptions: PurchaseOptions;
let purchaseResult: FoodResult;
let isPending = false;
const push = vi.fn();
const prepareUserUpdate = vi.fn(() => 17);
const completeTutorialAction = vi.fn(async () => {});
const updateUser = vi.fn(async (_patch: unknown, _options: unknown) => undefined);
const user = {
  status: "AWAKE",
  autoWakeUp: true,
  money: 1_000,
  level: 10,
  sector: 1,
  isOutlaw: false,
  maxHealth: 100,
  curHealth: 100,
  maxStamina: 100,
  curStamina: 20,
  maxChakra: 100,
  curChakra: 20,
} as NonNullable<UserWithRelations>;
const purchase = vi.fn(async (input: FoodInput) => {
  const revision = purchaseOptions.onMutate();
  await purchaseOptions.onSuccess(purchaseResult, input, revision);
});

beforeEach(() => {
  vi.clearAllMocks();
  isPending = false;
  user.status = "AWAKE";
  user.autoWakeUp = true;
  purchaseResult = {
    success: true,
    message: "Food purchased",
    userPatch: { curStamina: 40, curChakra: 40, curHealth: 100 },
    userDelta: { money: -10 },
  };
  Object.assign(vi.spyOn(client, "api" as never), {
    village: {
      buyFood: {
        useMutation: (options: PurchaseOptions) => {
          purchaseOptions = options;
          return { mutate: purchase, isPending };
        },
      },
    },
    travel: { getVillageInSector: { useQuery: () => ({ data: { structures: [] } }) } },
  });
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({
    data: user,
    prepareUserUpdate,
    updateUser,
  } as never);
  vi.spyOn(navigation, "useNavigationRouter").mockReturnValue({ push } as never);
  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/ramenshop");
  vi.spyOn(tutorial, "useTutorialStep").mockReturnValue({
    completeTutorialAction,
  } as never);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  vi.spyOn(Image, "default").mockImplementation(({ alt, src }) => (
    <img alt={alt} src={typeof src === "string" ? src : undefined} />
  ));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ramen menu", () => {
  it.each([
    ["AWAKE", true, null],
    ["ASLEEP", true, null],
    ["HOSPITALIZED", false, null],
    ["ASLEEP", false, "/home"],
    ["BATTLE", true, "/combat"],
    ["TRAVEL", true, "/travel"],
    ["QUEUED", true, null],
  ] satisfies [UserStatus, boolean, string | null][])(
    "routes %s (auto-wake %s) before an explicit purchase",
    (status, autoWakeUp, destination) => {
      user.status = status;
      user.autoWakeUp = autoWakeUp;
      const view = render(<RamenShop.RamenMenu />);
      expect(push.mock.calls).toEqual(destination ? [[destination]] : []);
      expect(view.getByRole("button", { name: /Small Bowl/ })).toBeTruthy();
      expect(view.container.querySelector("#tutorial-ramen-menu")).toBeTruthy();
      expect(purchase).not.toHaveBeenCalled();
      expect(completeTutorialAction).not.toHaveBeenCalled();
    },
  );

  it("uses village.buyFood and the shared user revision update", async () => {
    const view = render(<RamenShop.RamenMenu />);
    await act(async () =>
      fireEvent.click(view.getByRole("button", { name: /Small Bowl/ })),
    );
    expect(purchase).toHaveBeenCalledWith({ ramen: "small" });
    expect(prepareUserUpdate).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledWith(purchaseResult, { revision: 17 });
    expect(completeTutorialAction).toHaveBeenCalledWith("buyRamen");
  });

  it("keeps rejected food purchases visible beside a recoverable menu", async () => {
    purchaseResult = { success: false, message: "You must be awake" };
    const view = render(<RamenShop.RamenMenu />);
    await act(async () =>
      fireEvent.click(view.getByRole("button", { name: /Medium Bowl/ })),
    );
    expect(view.getByRole("alert").textContent).toBe("You must be awake");
    expect(view.getByRole("button", { name: /Medium Bowl/ })).toBeTruthy();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("prevents a second food action while the purchase is pending", () => {
    isPending = true;
    const view = render(<RamenShop.RamenMenu />);
    const bowl = view.getByRole("button", { name: /Small Bowl/ }) as HTMLButtonElement;
    expect(bowl.disabled).toBe(true);
    fireEvent.click(bowl);
    expect(purchase).not.toHaveBeenCalled();
  });

  it("retains the public ramen shop's welcome image and shared menu", async () => {
    const view = render(<RamenShop.default showImage />);
    expect(view.getByAltText("Ramen shop").getAttribute("src")).toBe(IMG_RAMEN_WELCOME);
    await act(async () =>
      fireEvent.click(view.getByRole("button", { name: /Large Bowl/ })),
    );
    expect(purchase).toHaveBeenCalledWith({ ramen: "large" });
  });
});

it("applies a confirmed fractional-price debit without discarding the patch", async () => {
  purchaseResult = {
    success: true,
    message: "Food purchased",
    userDelta: { money: -12 },
    userPatch: { curStamina: 50, curChakra: 50, regenAt: new Date() },
  };
  const view = render(<RamenShop.RamenMenu />);
  await act(async () =>
    fireEvent.click(view.getByRole("button", { name: /Small Bowl/ })),
  );
  expect(updateUser).toHaveBeenCalledWith(purchaseResult, { revision: 17 });
});

it.each(["ASLEEP", "HOSPITALIZED"] as const)(
  "applies confirmed %s recovery before the food projection without a profile read",
  async (status) => {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = [["profile", "getUser"], { type: "query" }];
    const initial = {
      userData: { ...user, userId: "ramen-user", status, experience: 50 },
      notifications: [],
    };
    cache.setQueryData(key, initial);
    let reads = 0;
    const observer = new QueryObserver(cache, {
      queryKey: key,
      staleTime: Infinity,
      queryFn: async () => {
        reads++;
        return initial;
      },
    });
    const unsubscribe = observer.subscribe(() => {});
    purchaseResult = {
      success: true,
      message: "Food purchased",
      actionNotice: "Recovered",
      userRecovery: {
        userId: "ramen-user",
        userPatch: {
          status: "AWAKE",
          curHealth: 100,
          curChakra: 100,
          curStamina: 100,
          experience: 75,
        },
      },
      userPatch: { curHealth: 100, curChakra: 100, curStamina: 100 },
      userDelta: { money: -10 },
    };
    vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({
      data: initial.userData,
      prepareUserUpdate: () => prepareCacheUpdate(cache, key),
      updateUser: (patch: UserUpdate | undefined, options?: UserUpdateOptions) =>
        updateUserCache(cache, key, patch, options),
    } as never);
    try {
      const view = render(<RamenShop.RamenMenu />);
      await act(async () =>
        fireEvent.click(view.getByRole("button", { name: /Small Bowl/ })),
      );
      expect(reads).toBe(0);
      expect(cache.getQueryData(key)).toMatchObject({
        userData: {
          status: "AWAKE",
          money: 990,
          experience: 75,
          curHealth: 100,
          curChakra: 100,
          curStamina: 100,
        },
      });
      expect(completeTutorialAction).toHaveBeenCalledWith("buyRamen");
    } finally {
      unsubscribe();
      cache.clear();
    }
  },
);
