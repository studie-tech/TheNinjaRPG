import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import * as cacheUpdate from "@/hooks/useQueryCacheUpdate";
import JutsuLoadoutSelector from "@/layout/JutsuLoadoutSelector";
import * as LoadoutSelector from "@/layout/LoadoutSelector";
import * as toast from "@/libs/toast";
import * as userContext from "@/utils/UserContext";

/** The options the selector gives its select mutation. */
let select: {
  onSuccess: (data: unknown, input: unknown, revision: unknown) => Promise<unknown>;
};

beforeEach(() => {
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      jutsu: { getUserJutsus: { invalidate: async () => undefined } },
    }),
    jutsu: {
      getLoadouts: {
        useQuery: () => ({ data: [] }),
        _def: () => ({ path: ["jutsu", "getLoadouts"] }),
      },
      selectJutsuLoadout: {
        useMutation: (options: typeof select) => {
          select = options;
          return {};
        },
      },
      renameLoadout: { useMutation: () => ({}) },
    },
  });
  vi.spyOn(userContext, "useUserDataSelector").mockReturnValue({
    data: 3,
    prepareUserUpdate: () => 1,
    updateUser: async () => undefined,
  } as never);
  vi.spyOn(cacheUpdate, "useQueryCacheUpdate").mockReturnValue({
    prepareUpdate: vi.fn(),
    updateCache: vi.fn(),
  } as never);
  vi.spyOn(LoadoutSelector, "default").mockImplementation((() => null) as never);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("finishes a selection only once the view has reloaded what the loadout equips", async () => {
  let reloaded: () => void = () => undefined;
  const onSelected = vi.fn(() => new Promise<void>((done) => (reloaded = done)));
  render(<JutsuLoadoutSelector onSelected={onSelected} />);
  let isFinished = false;
  const selected = select
    .onSuccess({ success: true, message: "Loadout selected" }, { id: "b" }, 1)
    .then(() => {
      isFinished = true;
    });
  await new Promise((done) => setTimeout(done, 0));
  expect(onSelected).toHaveBeenCalledTimes(1);
  expect(isFinished).toBe(false);
  reloaded();
  await selected;
  expect(isFinished).toBe(true);
});
