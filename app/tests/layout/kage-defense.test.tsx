import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import { KageDefense } from "@/layout/KageDefense";
import { pushToCombat } from "@/utils/routing";
import * as UserContext from "@/utils/UserContext";

type Options = {
  onSuccess: (result: object, input?: undefined, revision?: number) => Promise<void>;
};

const updateUser = vi.fn(async () => undefined);
const push = vi.fn();
let options: Options;

beforeEach(() => {
  updateUser.mockClear();
  push.mockClear();
  const mutation = {
    useMutation: (mutationOptions: Options) => {
      options = mutationOptions;
      return {};
    },
  };
  const invalidate = async () => undefined;
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      kage: { getDefenses: { invalidate } },
      village: { get: { invalidate } },
    }),
    kage: new Proxy(
      { getDefenses: { useQuery: () => ({ isPending: true }) } },
      { get: (target, key) => (key in target ? target[key as never] : mutation) },
    ),
  });
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push } as never);
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({
    updateUser,
    timeDiff: 0,
  } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const battleStart = { success: true, message: "Started", battleId: "kage-battle" };

it("applies the battle response and navigates through the shared battle entry", async () => {
  render(<KageDefense user={{ userId: "kage", villageId: "village" } as never} />);
  await options.onSuccess(battleStart, undefined, 7);
  expect(updateUser).toHaveBeenCalledWith(battleStart, { revision: 7, refetch: false });
  expect(push).toHaveBeenCalledTimes(1);
});

it("does not navigate twice when the battle event arrived first", async () => {
  render(<KageDefense user={{ userId: "kage", villageId: "village" } as never} />);
  pushToCombat(navigation.useRouter(), "kage-battle-2");
  await options.onSuccess({ ...battleStart, battleId: "kage-battle-2" });
  expect(push).toHaveBeenCalledTimes(1);
});
