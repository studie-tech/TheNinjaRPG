import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { TRPCClientError } from "@trpc/client";
import { createTRPCReact, getQueryKey } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import type { AppRouter } from "@/api/root";
import * as appClient from "@/app/_trpc/client";
import type { Jutsu } from "@/drizzle/schema";
import * as CombatActions from "@/layout/CombatActions";
import * as ContentBox from "@/layout/ContentBox";
import * as ItemWithEffects from "@/layout/ItemWithEffects";
import * as JutsuFiltering from "@/layout/JutsuFiltering";
import { RankedLoadoutSelector } from "@/layout/PvpRank";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import type { JutsuEquipLimit } from "@/validators/jutsuEquipLimit";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";

const api = createTRPCReact<AppRouter>();
const clients: QueryClient[] = [];
const cap: JutsuEquipLimit[] = [
  { category: "parry", unrankedMaxEquipped: 1, rankedMaxEquipped: 1 },
];
const jutsus = ["First parry", "Second parry"].map(
  (name) =>
    ({
      id: name,
      name,
      jutsuType: "NORMAL",
      effects: [{ type: "parry" }],
    }) as Jutsu,
);

beforeEach(() => {
  installBrowserGlobals();
  Object.assign(vi.spyOn(appClient, "api" as never), {
    misc: api.misc,
    item: api.item,
    jutsu: api.jutsu,
    pvpRank: api.pvpRank,
    useUtils: api.useUtils,
  });
  vi.spyOn(UserContext, "useRequireInVillage").mockReturnValue({
    userData: { userId: "player" },
    access: true,
  } as never);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  vi.spyOn(ItemWithEffects, "default").mockImplementation(() => null);
  vi.spyOn(JutsuFiltering, "default").mockImplementation(() => null);
  vi.spyOn(CombatActions, "ActionSelector").mockImplementation(({ items, onClick }) => (
    <>
      {items?.map((item) => (
        <button key={item.id} type="button" onClick={() => onClick?.(item.id)}>
          {item.name}
        </button>
      ))}
    </>
  ));
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
});

afterEach(async () => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  await flushRadixFocus();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

/** Keep the real query observer and dialog; control only API responses and artwork. */
const setup = async (cached?: JutsuEquipLimit[]) => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  clients.push(client);
  const limitsKey = getQueryKey(api.misc.getJutsuEquipLimits, undefined, "query");
  if (cached !== undefined) client.setQueryData(limitsKey, cached);
  const mutations = vi.fn();
  const limitsReads: {
    resolve: (data: JutsuEquipLimit[]) => void;
    reject: () => void;
  }[] = [];
  const trpc = api.createClient({
    links: [
      () =>
        ({ op }) =>
          observable((observer) => {
            const resolve = (data: unknown) => {
              observer.next({ result: { data } });
              observer.complete();
            };
            switch (op.path) {
              case "misc.getJutsuEquipLimits":
                limitsReads.push({
                  resolve,
                  reject: () =>
                    observer.error(TRPCClientError.from(new Error("Offline"))),
                });
                break;
              case "pvpRank.getRankedLoadout":
                resolve({
                  id: "loadout",
                  loadout: {
                    jutsuIds: ["First parry"],
                    weaponIds: [],
                    consumableIds: [],
                    favoriteJutsuIds: [],
                    favoriteWeaponIds: [],
                    favoriteConsumableIds: [],
                  },
                });
                break;
              case "item.getAll":
                resolve({ data: [] });
                break;
              case "jutsu.getAll":
                resolve({ data: jutsus, nextCursor: undefined });
                break;
              case "pvpRank.updateRankedLoadout":
                mutations(op.input);
                resolve({ success: false, message: "Keep modal open" });
                break;
              default:
                throw new Error(`Unexpected procedure ${op.path}`);
            }
          }),
    ],
  });
  const view = render(
    <api.Provider client={trpc} queryClient={client}>
      <QueryClientProvider client={client}>
        <RankedLoadoutSelector />
      </QueryClientProvider>
    </api.Provider>,
  );
  fireEvent.mouseDown(view.getByRole("tab", { name: "Jutsu" }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(await view.findByRole("button", { name: "Second parry" }));
  return { view, client, limitsKey, limitsReads, mutations };
};

it("blocks click and Enter until uncached limits recover, while keeping Close and favorites available", async () => {
  const t = await setup();
  expect(t.view.getByRole("status").textContent).toBe("Loading jutsu limits");
  const equip = t.view.getByRole("button", { name: "Equip" }) as HTMLButtonElement;
  expect(equip.disabled).toBe(true);
  fireEvent.click(equip);
  t.view.getByRole("dialog").focus();
  fireEvent.keyDown(document, { key: "Enter" });
  expect(t.mutations).not.toHaveBeenCalled();
  expect(
    (t.view.getAllByRole("button", { name: "Close" })[0]! as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  expect(
    (t.view.getByRole("button", { name: "Favorite" }) as HTMLButtonElement).disabled,
  ).toBe(false);

  await act(() => t.limitsReads[0]!.reject());
  expect((await t.view.findByRole("alert")).textContent).toContain(
    "Could not load jutsu limits",
  );
  expect(equip.disabled).toBe(true);
  fireEvent.click(t.view.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(t.limitsReads).toHaveLength(2));
  expect(t.view.getByRole("status").textContent).toBe("Loading jutsu limits");
  expect(equip.disabled).toBe(true);
  await act(() => t.limitsReads[1]!.resolve(cap));
  await waitFor(() => expect(equip.disabled).toBe(false));
  fireEvent.click(equip);
  expect(toast.showMutationToast).toHaveBeenCalledWith({
    success: false,
    message: "You can only equip up to 1 parry jutsu in ranked PvP",
  });
  expect(t.mutations).not.toHaveBeenCalled();
});

it("accepts an explicitly empty rules list as unlimited", async () => {
  const t = await setup();
  await act(() => t.limitsReads[0]!.resolve([]));
  const equip = t.view.getByRole("button", { name: "Equip" }) as HTMLButtonElement;
  await waitFor(() => expect(equip.disabled).toBe(false));
  fireEvent.click(equip);
  await waitFor(() =>
    expect(t.mutations).toHaveBeenCalledWith(
      expect.objectContaining({ jutsuIds: ["First parry", "Second parry"] }),
    ),
  );
});

it("keeps cached rules active through a background request and its failure", async () => {
  const t = await setup(cap);
  let refetch: Promise<void> | undefined;
  await act(async () => {
    refetch = t.client.invalidateQueries({ queryKey: t.limitsKey });
  });
  await waitFor(() => expect(t.limitsReads).toHaveLength(1));
  const equip = t.view.getByRole("button", { name: "Equip" }) as HTMLButtonElement;
  expect(equip.disabled).toBe(false);
  fireEvent.click(equip);
  expect(t.mutations).not.toHaveBeenCalled();
  await act(async () => {
    t.limitsReads[0]!.reject();
    await refetch;
  });
  expect(t.view.queryByRole("alert")).toBeNull();
  expect(equip.disabled).toBe(false);
  fireEvent.click(equip);
  expect(toast.showMutationToast).toHaveBeenCalledWith({
    success: false,
    message: "You can only equip up to 1 parry jutsu in ranked PvP",
  });
  expect(t.mutations).not.toHaveBeenCalled();
});

it.each(["pending", "failed"])(
  "allows unequipping when limits are %s",
  async (state) => {
    const t = await setup();
    if (state === "failed") await act(() => t.limitsReads[0]!.reject());
    fireEvent.click(t.view.getAllByRole("button", { name: "Close" })[0]!);
    fireEvent.click(t.view.getByRole("button", { name: "First parry" }));
    const unequip = t.view.getByRole("button", {
      name: "Unequip",
    }) as HTMLButtonElement;
    expect(unequip.disabled).toBe(false);
    fireEvent.click(unequip);
    await waitFor(() =>
      expect(t.mutations).toHaveBeenCalledWith(
        expect.objectContaining({ jutsuIds: [] }),
      ),
    );
  },
);
