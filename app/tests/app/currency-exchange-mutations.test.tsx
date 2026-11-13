import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { ReactNode } from "react";
import * as client from "@/app/_trpc/client";
import Bank from "@/app/[shell]/bank/page";
import BlackMarket from "@/app/[shell]/blackmarket/page";
import * as bankInterest from "@/hooks/useBankInterest";
import * as ContentBox from "@/layout/ContentBox";
import * as GraphBankLedger from "@/layout/GraphBankLedger";
import * as UserSearchSelect from "@/layout/UserSearchSelect";
import * as pagination from "@/libs/pagination";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";
import { mockUserContextValue } from "../setup/userContext";

type Options = {
  onMutate: unknown;
  onSuccess: (data: unknown, variables: unknown, revision: number) => Promise<void>;
};
let captured: Record<string, Options>;
const prepareUserUpdate = vi.fn(() => 7);
const updateUser = vi.fn(async (..._args: unknown[]) => undefined);
const invalidate = vi.fn(async () => undefined);
const user = { userId: "viewer", money: 500, bank: 900, level: 50, isBanned: false };
const capture = (name: string) => ({
  useMutation: (options: Options) => {
    captured[name] = options;
    return { mutate: vi.fn(), isPending: false };
  },
});

const renderPage = (page: ReactNode) =>
  render(
    <AppRouterContext.Provider value={{} as never}>{page}</AppRouterContext.Provider>,
  );

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true });
  vi.clearAllMocks();
  captured = {};
  localStorage.clear();
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  vi.spyOn(UserSearchSelect, "default").mockImplementation(() => null);
  vi.spyOn(GraphBankLedger, "default").mockImplementation(() => null);
  vi.spyOn(pagination, "useInfinitePagination").mockImplementation(() => undefined);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  const userApi = {
    data: user,
    userData: user,
    access: true,
    timeDiff: 0,
    prepareUserUpdate,
    updateUser,
  };
  mockUserContextValue(userApi as never);
  vi.spyOn(UserContext, "useRequireInVillage").mockReturnValue(userApi as never);
  vi.spyOn(bankInterest, "usePendingBankInterest").mockReturnValue({
    data: undefined,
  } as never);
  vi.spyOn(bankInterest, "useClaimBankInterest").mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as never);
  const offers = {
    useInfiniteQuery: () => ({ data: { pages: [] }, hasNextPage: false }),
  };
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ blackmarket: { getRyoOffers: { invalidate } } }),
    bank: {
      toBank: capture("toBank"),
      toPocket: capture("toPocket"),
      transfer: capture("transfer"),
      getTransfers: offers,
    },
    blackmarket: {
      createOffer: capture("createOffer"),
      delistOffer: capture("delistOffer"),
      takeOffer: capture("takeOffer"),
      getRyoOffers: offers,
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

describe("bank transfers", () => {
  it("starts every amount empty so its placeholder shows", () => {
    renderPage(<Bank />);
    for (const placeholder of [
      "Transfer to bank",
      "Transfer to pocket",
      "Amount to transfer",
    ]) {
      expect((screen.getByPlaceholderText(placeholder) as HTMLInputElement).value).toBe(
        "",
      );
    }
  });

  it("applies the returned balances and clears only the form that moved money", async () => {
    renderPage(<Bank />);
    const toBank = screen.getByPlaceholderText("Transfer to bank") as HTMLInputElement;
    const toPocket = screen.getByPlaceholderText(
      "Transfer to pocket",
    ) as HTMLInputElement;
    const toUser = screen.getByPlaceholderText(
      "Amount to transfer",
    ) as HTMLInputElement;
    const typeAll = () => {
      for (const input of [toBank, toPocket, toUser])
        fireEvent.input(input, { target: { value: "25" } });
    };
    for (const name of ["toBank", "toPocket", "transfer"]) {
      expect(captured[name]?.onMutate).toBe(prepareUserUpdate);
    }

    typeAll();
    await act(() =>
      captured.toBank!.onSuccess(
        { success: true, message: "ok", data: { bank: 1, money: 2 } },
        {},
        3,
      ),
    );
    expect([toBank.value, toPocket.value, toUser.value]).toEqual(["", "25", "25"]);
    typeAll();
    await act(() =>
      captured.toPocket!.onSuccess(
        { success: true, message: "ok", data: { bank: 4, money: 5 } },
        {},
        6,
      ),
    );
    expect([toBank.value, toPocket.value, toUser.value]).toEqual(["25", "", "25"]);
    typeAll();
    await act(() =>
      captured.transfer!.onSuccess(
        { success: true, message: "ok", data: { bank: 8 } },
        {},
        9,
      ),
    );
    expect([toBank.value, toPocket.value, toUser.value]).toEqual(["25", "25", ""]);
    expect(updateUser.mock.calls).toEqual([
      [{ bank: 1, money: 2 }, { revision: 3 }],
      [{ bank: 4, money: 5 }, { revision: 6 }],
      [{ bank: 8 }, { revision: 9 }],
    ]);

    typeAll();
    for (const name of ["toBank", "toPocket", "transfer"]) {
      await act(() =>
        captured[name]!.onSuccess({ success: false, message: "no" }, {}, 1),
      );
    }
    expect(updateUser).toHaveBeenCalledTimes(3);
    expect([toBank.value, toPocket.value, toUser.value]).toEqual(["25", "25", "25"]);
    expect(toast.showMutationToast).toHaveBeenCalledTimes(6);
  });
});

describe("ryo shop offers", () => {
  it("applies the returned balance delta and refreshes the offers for every offer change", async () => {
    localStorage.setItem("blackmarketTab", JSON.stringify("Ryo"));
    renderPage(<BlackMarket />);
    const names = ["createOffer", "delistOffer", "takeOffer"];
    for (const [index, name] of names.entries()) {
      const options = captured[name]!;
      expect(options.onMutate).toBe(prepareUserUpdate);
      const delta = { money: index };
      await options.onSuccess(
        { success: true, message: "ok", userDelta: delta },
        {},
        index + 10,
      );
      await options.onSuccess(
        { success: false, message: "no", userDelta: delta },
        {},
        1,
      );
    }
    expect(updateUser.mock.calls).toEqual(
      names.map((_, index) => [
        undefined,
        { revision: index + 10, delta: { money: index } },
      ]),
    );
    expect(invalidate).toHaveBeenCalledTimes(3);
    expect(toast.showMutationToast).toHaveBeenCalledTimes(6);
  });
});
