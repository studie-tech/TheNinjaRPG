import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { RouterInputs, RouterOutputs } from "@/app/_trpc/client";
import type { UserWithRelations } from "@/server/api/routers/profile";
import * as client from "@/app/_trpc/client";
import * as tutorial from "@/hooks/tutorial";
import * as ContentBox from "@/layout/ContentBox";
import * as Image from "@/layout/Image";
import * as RamenShop from "@/layout/RamenShop";
import * as toast from "@/libs/toast";
import * as routing from "@/utils/routing";
import * as UserContext from "@/utils/UserContext";
import { IMG_RAMEN_WELCOME } from "@/drizzle/constants";

type FoodInput = RouterInputs["village"]["buyFood"];
type FoodResult = RouterOutputs["village"]["buyFood"];
type PurchaseOptions = {
  onMutate: () => number | undefined;
  onSuccess: (result: FoodResult, input: FoodInput, revision: number | undefined) => Promise<void>;
  onError: (error: Error) => void;
};

let purchaseOptions: PurchaseOptions;
let purchaseResult: FoodResult;
let isPending = false;
const prepareUserUpdate = vi.fn(() => 17);
const completeTutorialAction = vi.fn(async () => {});
const updateUser = vi.fn(async (_patch: unknown, _options: unknown) => undefined);
const user = {
  status: "AWAKE", money: 1_000, level: 10, sector: 1, isOutlaw: false,
  maxHealth: 100, curHealth: 100, maxStamina: 100, curStamina: 20,
  maxChakra: 100, curChakra: 20,
} as NonNullable<UserWithRelations>;
const purchase = vi.fn(async (input: FoodInput) => {
  const revision = purchaseOptions.onMutate();
  await purchaseOptions.onSuccess(purchaseResult, input, revision);
});

beforeEach(() => {
  vi.clearAllMocks();
  isPending = false;
  purchaseResult = { success: true, message: "Food purchased", userPatch: { curStamina: 40, curChakra: 40, curHealth: 100 }, userDelta: { money: -10 } };
  Object.assign(vi.spyOn(client, "api" as never), {
    village: { buyFood: { useMutation: (options: PurchaseOptions) => {
      purchaseOptions = options;
      return { mutate: purchase, isPending };
    } } },
    travel: { getVillageInSector: { useQuery: () => ({ data: { structures: [] } }) } },
  });
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({
    data: user, prepareUserUpdate, updateUser,
  } as never);
  vi.spyOn(routing, "useAwake").mockReturnValue(true);
  vi.spyOn(tutorial, "useTutorialStep").mockReturnValue({ completeTutorialAction } as never);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => <div>{children}</div>);
  vi.spyOn(Image, "default").mockImplementation(({ alt, src }) => <img alt={alt} src={typeof src === "string" ? src : undefined} />);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ramen menu", () => {
  it("uses village.buyFood and the shared user revision update", async () => {
    const view = render(<RamenShop.RamenMenu />);
    await act(async () => fireEvent.click(view.getByRole("button", { name: /Small Bowl/ })));
    expect(purchase).toHaveBeenCalledWith({ ramen: "small" });
    expect(prepareUserUpdate).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledWith(purchaseResult.userPatch, { revision: 17, delta: { money: -10 }, achievementProgress: undefined });
    expect(completeTutorialAction).toHaveBeenCalledWith("buyRamen");
  });

  it("keeps rejected food purchases visible beside a recoverable menu", async () => {
    purchaseResult = { success: false, message: "You must be awake" };
    const view = render(<RamenShop.RamenMenu />);
    await act(async () => fireEvent.click(view.getByRole("button", { name: /Medium Bowl/ })));
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
    await act(async () => fireEvent.click(view.getByRole("button", { name: /Large Bowl/ })));
    expect(purchase).toHaveBeenCalledWith({ ramen: "large" });
  });
});


it("applies a confirmed fractional-price debit without discarding the patch", async () => {
  purchaseResult = { success: true, message: "Food purchased", userDelta: { money: -12 }, userPatch: { curStamina: 50, curChakra: 50, regenAt: new Date() } };
  const view = render(<RamenShop.RamenMenu />);
  await act(async () => fireEvent.click(view.getByRole("button", { name: /Small Bowl/ })));
  expect(updateUser).toHaveBeenCalledWith(purchaseResult.userPatch, { revision: 17, delta: { money: -12 }, achievementProgress: undefined });
});
