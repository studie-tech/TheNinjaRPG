import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCReact, getQueryKey } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import * as navigation from "next/navigation";
import type { AppRouter } from "@/api/root";
import * as client from "@/app/_trpc/client";
import type { RouterInputs, RouterOutputs } from "@/app/_trpc/client";
import HomePage from "@/app/[shell]/home/page";
import * as dialog from "@/components/ui/dialog";
import { type HomeType, HomeTypeDetails, IMG_HOME_KITCHEN, MAP_WAKE_ISLAND_SECTOR } from "@/drizzle/constants";
import * as sleep from "@/hooks/sleep";
import * as ContentBox from "@/layout/ContentBox";
import * as Image from "@/layout/Image";
import * as Link from "@/layout/Link";
import * as Modal from "@/layout/Modal";
import { getHomeFurnitureGeometry, type HomeFurniture, unprojectHomePlacement } from "@/libs/home";
import { getHomeRooms } from "@/libs/homeProperty";
import { HOME_FLOOR_PROJECTION } from "@/libs/homeRoomGeometry";
import * as Kitchen from "@/layout/Kitchen";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import { ensureDom } from "../../setup-dom.mjs";
import { actualDialog, actualModal } from "../../setup/preload";

const furniture: HomeFurniture[] = [
  { id: "owned-bed", itemId: "home-bed", name: "Bed", image: "/images/home/furniture/bed.webp", width: 34, groundAnchor: 91.1, action: "sleep", isFloor: false, quantity: 1, views: {} },
  { id: "owned-armory", itemId: "home-armory", name: "Armory", image: "/images/home/furniture/armory.webp", width: 24, groundAnchor: 95.8, action: "storage", isFloor: false, quantity: 1, views: {} },
  { id: "owned-kitchen", itemId: "home-kitchen", name: "Kitchen", image: "/images/home/furniture/kitchen.webp", width: 32, groundAnchor: 89.1, action: "kitchen", isFloor: false, quantity: 1, views: {} },
];
const layout = [
  { id: "owned-bed", x: 22, y: 15.15, rotation: 0 as const },
  { id: "owned-armory", x: 75, y: 15.15, rotation: 0 as const },
  { id: "owned-kitchen", x: 76, y: 57.58, rotation: 0 as const },
];
const rug: HomeFurniture = {
  id: "owned-rug", itemId: "custom-rug", name: "Woven Rug", image: "/custom-rug.webp", width: 25, groundAnchor: 88.5, action: null, isFloor: true, quantity: 1, views: {},
};

const basics = furniture.map((piece, index) => ({
  ...piece,
  itemId: ["home-sleeping-mat", "home-storage-box", "home-kitchen-utensils"][index]!,
  name: ["Sleeping Mat", "Storage Box", "Kitchen Utensils"][index]!,
}));
const ownedItems = basics.map((piece) => ({
  id: piece.id, itemId: piece.itemId, quantity: 1, level: 1, storedAtHome: true, equipped: "NONE",
  item: { id: piece.itemId, name: piece.name, image: piece.image, itemType: "FURNITURE", slot: "NONE", rarity: "COMMON", hidden: false },
})) as unknown as RouterOutputs["item"]["getUserItems"];
const essentialHome: NonNullable<RouterOutputs["home"]["getUserHome"]> = {
  homeType: "NONE", biome: "ground", regen: HomeTypeDetails.NONE.regen, storage: HomeTypeDetails.NONE.storage,
  furniture: basics, furnitureRevision: 3, styles: [], isPublic: false, layout: [...layout],
};

const testApi = createTRPCReact<AppRouter>();
const emptyPetCollection = { pets: [], activePetId: null };
let savedEvent: typeof Event;
let savedCustomEvent: typeof CustomEvent;
let savedAnimationFrame: PropertyDescriptor | undefined;
let savedCancelAnimationFrame: PropertyDescriptor | undefined;
let searchParams: URLSearchParams;
let replaceRoute: ReturnType<typeof vi.fn>;

beforeEach(() => {
  ensureDom();
  savedEvent = globalThis.Event;
  savedCustomEvent = globalThis.CustomEvent;
  globalThis.Event = window.Event;
  globalThis.CustomEvent = window.CustomEvent;
  savedAnimationFrame = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
  savedCancelAnimationFrame = Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame");
  Object.defineProperties(globalThis, {
    requestAnimationFrame: { configurable: true, value: (callback: FrameRequestCallback) => Number(setTimeout(() => callback(Date.now()), 0)) },
    cancelAnimationFrame: { configurable: true, value: (id: number) => clearTimeout(id) },
  });
  searchParams = new URLSearchParams();
  replaceRoute = vi.fn((href: string) => {
    searchParams = new URLSearchParams(href.split("?")[1]);
  });
  vi.spyOn(navigation, "useRouter").mockReturnValue({ replace: replaceRoute } as never);
  vi.spyOn(navigation, "useSearchParams").mockImplementation(() => searchParams as never);
  vi.spyOn(Modal, "default").mockImplementation(actualModal);
  vi.spyOn(dialog, "Dialog").mockImplementation(actualDialog.Dialog);
  vi.spyOn(dialog, "DialogContent").mockImplementation(actualDialog.DialogContent);
  vi.spyOn(dialog, "DialogFooter").mockImplementation(actualDialog.DialogFooter);
  vi.spyOn(dialog, "DialogHeader").mockImplementation(actualDialog.DialogHeader);
  vi.spyOn(dialog, "DialogTitle").mockImplementation(actualDialog.DialogTitle);
  // Fresh tRPC hooks preserve real mutation lifecycles despite other suites' shared API mocks.
  Object.assign(vi.spyOn(client, "api" as never), {
    home: testApi.home,
    item: testApi.item,
    pets: testApi.pets,
    useUtils: testApi.useUtils,
  });
  vi.spyOn(UserContext, "useRequireInVillage").mockReturnValue({
    userData: {
      userId: "home-test-user",
      homeType: "NONE",
      status: "AWAKE",
      money: 1000,
      sector: 1,
      village: { sector: 1 },
    },
    access: true,
    ownVillage: true,
  } as never);
  vi.spyOn(UserContext, "useUserData").mockReturnValue({ data: { role: "USER" } } as never);
  vi.spyOn(sleep, "useSleepToggle").mockReturnValue({
    toggleSleep: vi.fn(),
    isTogglingSleep: false,
  } as never);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children, topRightContent }) => (
    <div>{topRightContent && <div data-testid="home-header-controls">{topRightContent}</div>}{children}</div>
  ));
  vi.spyOn(Image, "default").mockImplementation(({ alt }) => <img alt={alt} />);
  vi.spyOn(Link, "default").mockImplementation(({ children, href }) => (
    <a href={String(href)}>{children}</a>
  ));
  vi.spyOn(Kitchen, "default").mockImplementation(() => <p>Kitchen recipes</p>);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
});
afterEach(async () => {
  cleanup();
  // Radix restores focus on a timer while unmounting its dialog.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  globalThis.Event = savedEvent;
  globalThis.CustomEvent = savedCustomEvent;
  for (const [key, descriptor] of [["requestAnimationFrame", savedAnimationFrame], ["cancelAnimationFrame", savedCancelAnimationFrame]] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  vi.restoreAllMocks();
});

for (const hasCachedInventory of [false, true]) {
  it(`refreshes home storage after ${hasCachedInventory ? "cached" : "initial"} parallel inventory reads miss newly granted furniture`, async () => {
    let finishHome = () => {};
    const homeReady = new Promise<void>((resolve) => { finishHome = resolve; });
    let finishInventory = () => {};
    const inventoryReady = new Promise<void>((resolve) => { finishInventory = resolve; });
    let homeQueries = 0;
    let itemQueries = 0;
    let finishPregrantRead = () => {};
    const pregrantRead = new Promise<void>((resolve) => { finishPregrantRead = resolve; });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const itemKey = getQueryKey(testApi.item.getUserItems, undefined, "query");
    if (hasCachedInventory) {
      queryClient.setQueryData(itemKey, []);
      await queryClient.invalidateQueries({ queryKey: itemKey });
    }
    const trpcClient = testApi.createClient({ links: [() => ({ op }) => observable((observer) => {
      if (op.path === "home.getHomeRequests") {
        observer.next({ result: { data: [] } });
        observer.complete();
        return;
      }
      const result = async () => {
        if (op.path === "home.getUserHome") {
          homeQueries++;
          await homeReady;
          return essentialHome;
        }
        if (op.path === "item.getUserItems") {
          if (++itemQueries === 1) {
            if (hasCachedInventory) await pregrantRead;
            return [];
          }
          await inventoryReady;
          return ownedItems;
        }
        if (op.path === "home.getAvailableUpgrades") return [];
        if (op.path === "pets.getCollection") return emptyPetCollection;
        throw new Error(`Unexpected procedure ${op.path}`);
      };
      void result().then((data) => { observer.next({ result: { data } }); observer.complete(); }, (error) => observer.error(error));
    })] });
    try {
      const view = render(
        <testApi.Provider client={trpcClient} queryClient={queryClient}>
          <QueryClientProvider client={queryClient}><HomePage /></QueryClientProvider>
        </testApi.Provider>,
      );
      await waitFor(() => expect(queryClient.getQueryData<RouterOutputs["item"]["getUserItems"]>(itemKey)).toEqual([]));
      expect(homeQueries).toBe(1);
      expect(itemQueries).toBe(1);
      await act(async () => { finishHome(); await homeReady; });
      const storage = await view.findByRole("button", { name: "Storage Box: Open home storage" });
      fireEvent.click(storage);
      await waitFor(() => expect(itemQueries).toBe(2));
      const dialog = within(view.getByRole("dialog"));
      expect(dialog.getByText("Loading item storage data")).toBeTruthy();
      expect(dialog.queryByText("You don't have any items stored in your home.")).toBeNull();
      expect(dialog.queryByRole("button", { name: "Merge all stacks" })).toBeNull();
      await act(async () => { finishInventory(); await inventoryReady; });
      expect(await dialog.findByRole("tab", { name: "Furniture (3)" })).toBeTruthy();
      await act(async () => { fireEvent.mouseDown(dialog.getByRole("tab", { name: "Furniture (3)" }), { button: 0 }); });
      for (const piece of basics) expect(dialog.getAllByAltText(piece.name).length).toBeGreaterThan(0);
      await act(async () => { finishPregrantRead(); await pregrantRead; });
      expect(queryClient.getQueryData<RouterOutputs["item"]["getUserItems"]>(itemKey)).toEqual(ownedItems);
      expect(itemQueries).toBe(2);
      expect(homeQueries).toBe(1);
    } finally {
      finishHome();
      finishInventory();
      finishPregrantRead();
      queryClient.clear();
    }
  }, 20_000);
}

for (const hasMissingInventory of [false, true]) {
  it(hasMissingInventory ? "stops refreshing unchanged missing furniture IDs and lets storage Retry recover" : "keeps complete home inventory at one parallel read", async () => {
    let itemQueries = 0;
    let homeQueries = 0;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const homeKey = getQueryKey(testApi.home.getUserHome, undefined, "query");
    const trpcClient = testApi.createClient({ links: [() => ({ op }) => observable((observer) => {
      if (op.path === "home.getHomeRequests") {
        observer.next({ result: { data: [] } });
        observer.complete();
        return;
      }
      if (op.path === "home.getUserHome") {
        homeQueries++;
        observer.next({ result: { data: essentialHome } });
      } else if (op.path === "item.getUserItems") {
        itemQueries++;
        observer.next({ result: { data: hasMissingInventory && itemQueries <= 2 ? [] : ownedItems } });
      } else if (op.path === "home.getAvailableUpgrades") {
        observer.next({ result: { data: [] } });
      } else if (op.path === "pets.getCollection") {
        observer.next({ result: { data: emptyPetCollection } });
      } else {
        throw new Error(`Unexpected procedure ${op.path}`);
      }
      observer.complete();
    })] });
    try {
      const view = render(
        <testApi.Provider client={trpcClient} queryClient={queryClient}>
          <QueryClientProvider client={queryClient}><HomePage /></QueryClientProvider>
        </testApi.Provider>,
      );
      fireEvent.click(await view.findByRole("button", { name: "Storage Box: Open home storage" }));
      const dialog = within(view.getByRole("dialog"));
      if (hasMissingInventory) {
        expect((await dialog.findByRole("alert")).textContent).toContain("Unable to load home storage.");
        expect(dialog.queryByRole("tab", { name: /Stored Items/ })).toBeNull();
      } else {
        expect(await dialog.findByRole("tab", { name: "Furniture (3)" })).toBeTruthy();
      }
      // New result objects and furniture ordering must not restart the same missing-ID refresh.
      await act(async () => {
        queryClient.setQueryData(homeKey, { ...essentialHome, furniture: [...basics].reverse() });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });
      expect(itemQueries).toBe(hasMissingInventory ? 2 : 1);
      expect(homeQueries).toBe(1);
      if (hasMissingInventory) {
        fireEvent.click(dialog.getByRole("button", { name: "Retry" }));
        expect(await dialog.findByRole("tab", { name: "Furniture (3)" })).toBeTruthy();
        expect(itemQueries).toBe(3);
        expect(homeQueries).toBe(2);
      }
    } finally {
      queryClient.clear();
    }
  }, 20_000);
}

it("links every owned companion image to its selected profile and identifies only the active pet", async () => {
  const collection = {
    pets: [
      { id: "active-pet", name: "Pippin", avatar: "/pippin.webp" },
      { id: "parked-pet", name: "Miso", avatar: "/miso.webp" },
    ],
    activePetId: "active-pet",
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = testApi.createClient({ links: [() => ({ op }) => observable((observer) => {
    let data: unknown;
    if (op.path === "pets.getCollection") data = collection;
    else if (op.path === "home.getUserHome") data = essentialHome;
    else if (op.path === "home.getAvailableUpgrades" || op.path === "item.getUserItems") data = [];
    else throw new Error(`Unexpected procedure ${op.path}`);
    observer.next({ result: { data } });
    observer.complete();
  })] });
  try {
    const view = render(
      <testApi.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}><HomePage /></QueryClientProvider>
      </testApi.Provider>,
    );
    for (const pet of collection.pets) {
      const image = await view.findByAltText(pet.name);
      expect(image.closest("a")?.getAttribute("href")).toBe(`/profile?tab=pet&petId=${pet.id}`);
    }
    expect(view.getAllByText("Active companion")).toHaveLength(1);
    expect(view.getByText("Active companion").closest("li")?.textContent).toContain("Pippin");
  } finally {
    queryClient.clear();
  }
});

it.each([
  { sector: 1, status: "AWAKE", battleId: null, href: `/travel?sector=${MAP_WAKE_ISLAND_SECTOR}`, label: "Travel to Wake Island" },
  { sector: MAP_WAKE_ISLAND_SECTOR, status: "AWAKE", battleId: null, href: "/pets", label: "Open sanctuary" },
  { sector: 1, status: "ASLEEP", battleId: null, href: null, label: "Travel to Wake Island" },
  { sector: 1, status: "AWAKE", battleId: "battle", href: null, label: "Travel to Wake Island" },
])("offers location-aware sanctuary navigation for $status in sector $sector with battle $battleId", async ({ sector, status, battleId, href, label }) => {
  vi.spyOn(UserContext, "useRequireInVillage").mockReturnValue({
    userData: { homeType: "NONE", status, battleId, money: 1000, sector, village: { sector } },
    access: true,
    ownVillage: true,
  } as never);
  const { view, queryClient } = mountHome();
  try {
    await view.findByText(/Meet your first companion at the Bondkeeper Sanctuary on Wake Island/);
    if (href) {
      expect(view.getByRole("link", { name: label }).getAttribute("href")).toBe(href);
    } else {
      expect(view.queryByRole("link", { name: label })).toBeNull();
      expect(view.getByRole("button", { name: label }).hasAttribute("disabled")).toBe(true);
      expect(view.getByText("You must be awake and out of battle to travel.")).toBeTruthy();
    }
  } finally {
    queryClient.clear();
  }
});

it("does not refresh disabled owner inventory or expose cached pets for a guest", async () => {
  vi.spyOn(UserContext, "useRequireInVillage").mockReturnValue({
    userData: { homeType: "NONE", status: "AWAKE", sector: 2, village: { sector: 1 } },
    access: true,
    ownVillage: false,
  } as never);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  queryClient.setQueryData(getQueryKey(testApi.home.getUserHome, undefined, "query"), essentialHome);
  queryClient.setQueryData(getQueryKey(testApi.item.getUserItems, undefined, "query"), []);
  queryClient.setQueryData(getQueryKey(testApi.pets.getCollection, undefined, "query"), { pets: [{ id: "owner-pet", name: "Owner companion", avatar: "/owner-pet.webp" }], activePetId: "owner-pet" });
  const requests = vi.fn();
  const trpcClient = testApi.createClient({ links: [() => ({ op }) => observable(() => {
    requests(op.path);
    throw new Error(`Unexpected guest procedure ${op.path}`);
  })] });
  try {
    const view = render(
      <testApi.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}><HomePage /></QueryClientProvider>
      </testApi.Provider>,
    );
    await view.findByRole("button", { name: "Go to sleep" });
    expect(requests).not.toHaveBeenCalled();
    expect(view.queryByRole("button", { name: "Manage home" })).toBeNull();
    expect(view.queryByAltText("Owner companion")).toBeNull();
  } finally {
    queryClient.clear();
  }
});

it("refreshes a selected furniture variant when returning from inventory", async () => {
  vi.spyOn(Image, "default").mockImplementation(({ alt, src }) => <img alt={alt} src={typeof src === "string" ? src : undefined} />);
  let homeQueries = 0;
  let selectedImage = "/base-chair.webp";
  const chair: HomeFurniture = {
    ...rug, id: "owned-chair", itemId: "chair", name: "Chair", isFloor: false,
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const trpcClient = testApi.createClient({ links: [() => ({ op }) => observable((observer) => {
    if (op.path === "home.getHomeRequests") {
      observer.next({ result: { data: [] } });
      observer.complete();
      return;
    }
    if (op.path === "home.getUserHome") {
      homeQueries++;
      const home: NonNullable<RouterOutputs["home"]["getUserHome"]> = {
        homeType: "NONE", biome: "ground", regen: HomeTypeDetails.NONE.regen, storage: HomeTypeDetails.NONE.storage,
        furniture: [{ ...chair, image: selectedImage }], furnitureRevision: 3, styles: [], isPublic: false,
        layout: [{ id: chair.id, x: 50, y: 50, rotation: 0 }],
      };
      observer.next({ result: { data: home } });
    } else if (op.path === "pets.getCollection") {
      observer.next({ result: { data: emptyPetCollection } });
    } else if (op.path === "home.getAvailableUpgrades" || op.path === "item.getUserItems") {
      observer.next({ result: { data: [] } });
    } else {
      throw new Error(`Unexpected procedure ${op.path}`);
    }
    observer.complete();
  })] });
  const mount = () => render(
    <testApi.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}><HomePage /></QueryClientProvider>
    </testApi.Provider>,
  );
  try {
    const firstVisit = mount();
    await firstVisit.findByRole("button", { name: "Decorate" });
    expect(firstVisit.container.querySelector('img[src="/base-chair.webp"]')).not.toBeNull();
    firstVisit.unmount();
    selectedImage = "/red-chair.webp";
    // Variant selection refreshes inventory; the next home visit must fetch its selected appearance.
    await queryClient.invalidateQueries({ queryKey: getQueryKey(testApi.item.getUserItemsWithVariants, undefined, "query") });
    const secondVisit = mount();
    await waitFor(() => expect(secondVisit.container.querySelector('img[src="/red-chair.webp"]')).not.toBeNull());
    expect(homeQueries).toBe(2);
    expect(secondVisit.container.querySelector('img[src="/base-chair.webp"]')).toBeNull();
  } finally {
    queryClient.clear();
  }
});

it("refreshes furniture storage after a downgrade stores a carried piece from a removed room", async () => {
  let home: typeof essentialHome = { ...essentialHome, homeType: "TOWN_HOUSE", furniture: [...basics, rug], layout: [...layout, { id: rug.id, x: 50, y: 50, rotation: 0, room: "room-1" }] };
  let items = [...ownedItems, { ...ownedItems[0]!, id: rug.id, itemId: rug.itemId, storedAtHome: false, item: { ...ownedItems[0]!.item, id: rug.itemId, name: rug.name, image: rug.image } }];
  let itemQueries = 0;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const itemKey = getQueryKey(testApi.item.getUserItems, undefined, "query");
  const trpcClient = testApi.createClient({ links: [() => ({ op }) => observable((observer) => {
    if (op.path === "home.getHomeRequests") {
      observer.next({ result: { data: [] } });
      observer.complete();
      return;
    }
    let data;
    if (op.path === "home.getUserHome") data = { ...home };
    else if (op.path === "item.getUserItems") {
      itemQueries++;
      data = items.map((row) => ({ ...row }));
    } else if (op.path === "home.getAvailableUpgrades") {
      data = [{ type: "TWO_BED_HOUSE", ...HomeTypeDetails.TWO_BED_HOUSE, isUpgrade: false, upgradeCost: 0, downgradeRefund: 100 }];
    } else if (op.path === "home.upgradeHome") {
      expect(op.input).toEqual({ homeType: "TWO_BED_HOUSE" });
      home = { ...home, homeType: "TWO_BED_HOUSE", layout: [...layout], furnitureRevision: home.furnitureRevision + 1 };
      items = items.map((row) => row.id === rug.id ? { ...row, storedAtHome: true } : row);
      data = { success: true, message: "Downgraded" };
    } else throw new Error(`Unexpected procedure ${op.path}`);
    observer.next({ result: { data } });
    observer.complete();
  })] });
  try {
    const view = render(
      <testApi.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}><HomePage /></QueryClientProvider>
      </testApi.Provider>,
    );
    fireEvent.click(await view.findByRole("button", { name: "Manage home" }));
    const management = within(view.getByRole("dialog"));
    await act(async () => { fireEvent.mouseDown(management.getByRole("tab", { name: "Downgrades" }), { button: 0 }); });
    fireEvent.click(management.getByRole("button", { name: "Downgrade" }));
    await waitFor(() => expect(queryClient.getQueryData<RouterOutputs["item"]["getUserItems"]>(itemKey)!.find(({ id }) => id === rug.id)!.storedAtHome).toBe(true));
    expect(itemQueries).toBe(2);
    fireEvent.click(management.getAllByRole("button", { name: "Close" })[0]!);
    fireEvent.click(view.getByRole("button", { name: "Home storage" }));
    const storage = within(view.getByRole("dialog"));
    expect(storage.getByRole("tab", { name: "Furniture (4)" })).toBeTruthy();
    await act(async () => { fireEvent.mouseDown(storage.getByRole("tab", { name: "Furniture (4)" }), { button: 0 }); });
    expect(storage.getAllByAltText(rug.name).length).toBeGreaterThan(0);
    await act(async () => { fireEvent.mouseDown(storage.getByRole("tab", { name: "Inventory" }), { button: 0 }); });
    expect(storage.queryByAltText(rug.name)).toBeNull();
  } finally {
    queryClient.clear();
  }
}, 20_000);

it("refreshes furniture storage after placing a carried piece and waits for its inventory", async () => {
  let home = { ...essentialHome, furniture: [...basics, rug] };
  let items = [...ownedItems, { ...ownedItems[0]!, id: rug.id, itemId: rug.itemId, storedAtHome: false, item: { ...ownedItems[0]!.item, id: rug.itemId, name: rug.name, image: rug.image } }];
  let finishInventory = () => {};
  const inventoryReady = new Promise<void>((resolve) => { finishInventory = resolve; });
  let itemQueries = 0;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const itemKey = getQueryKey(testApi.item.getUserItems, undefined, "query");
  const trpcClient = testApi.createClient({ links: [() => ({ op }) => observable((observer) => {
    if (op.path === "home.getHomeRequests") {
      observer.next({ result: { data: [] } });
      observer.complete();
      return;
    }
    const result = async () => {
      if (op.path === "home.getUserHome") return { ...home };
      if (op.path === "item.getUserItems") {
        if (++itemQueries > 1) await inventoryReady;
        return items.map((row) => ({ ...row }));
      }
      if (op.path === "home.getAvailableUpgrades") return [];
      if (op.path === "home.saveFurnitureLayout") {
        const draft = op.input as RouterInputs["home"]["saveFurnitureLayout"];
        home = { ...home, layout: draft.placements, furnitureRevision: home.furnitureRevision + 1 };
        items = items.map((row) => row.id === rug.id ? { ...row, storedAtHome: true } : row);
        return { success: true, message: "Saved" };
      }
      throw new Error(`Unexpected procedure ${op.path}`);
    };
    void result().then((data) => { observer.next({ result: { data } }); observer.complete(); }, (error) => observer.error(error));
  })] });
  try {
    const view = render(
      <testApi.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}><HomePage /></QueryClientProvider>
      </testApi.Provider>,
    );
    fireEvent.click(await view.findByRole("button", { name: "Decorate" }));
    fireEvent.click(view.getByRole("button", { name: /Woven Rug.*Place$/ }));
    fireEvent.click(view.getByRole("button", { name: "Save layout" }));
    await waitFor(() => expect(itemQueries).toBe(2));
    expect(queryClient.isMutating()).toBe(1);
    expect((view.getByRole("button", { name: "Saving…" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { finishInventory(); await inventoryReady; });
    await waitFor(() => expect(view.queryByRole("button", { name: "Save layout" })).toBeNull());
    expect(queryClient.getQueryData<RouterOutputs["item"]["getUserItems"]>(itemKey)!.find(({ id }) => id === rug.id)!.storedAtHome).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Home storage" }));
    expect(view.getByRole("tab", { name: "Furniture (4)" })).toBeDefined();
  } finally {
    finishInventory();
    queryClient.clear();
  }
});

for (const success of [true, false]) {
  it(`keeps the editor disabled through refreshing a ${success ? "successful" : "rejected"} save`, async () => {
    let finishRefresh = () => {};
    const refreshed = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    let homeQueries = 0;
    const home: NonNullable<RouterOutputs["home"]["getUserHome"]> = {
      homeType: "NONE",
      biome: "ground",
      regen: HomeTypeDetails.NONE.regen,
      storage: HomeTypeDetails.NONE.storage,
      furniture,
      furnitureRevision: 3, styles: [], isPublic: false,
      layout: [...layout],
    };
    const save = vi.fn((draft: RouterInputs["home"]["saveFurnitureLayout"]) => {
      if (success) {
        home.layout = draft.placements;
        home.furnitureRevision++;
      }
      return {
        success,
        message: success ? "Saved" : "Your home changed. Refresh and try again",
      };
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const trpcClient = testApi.createClient({
      links: [
        () =>
          ({ op }) =>
            observable((observer) => {
              if (op.path === "home.getHomeRequests") {
                observer.next({ result: { data: [] } });
                observer.complete();
                return;
              }
              const result = async () => {
                if (op.path === "home.getUserHome") {
                  if (++homeQueries > 1) await refreshed;
                  return { ...home };
                }
                if (op.path === "home.saveFurnitureLayout")
                  return save(op.input as RouterInputs["home"]["saveFurnitureLayout"]);
                if (
                  op.path === "home.getAvailableUpgrades" ||
                  op.path === "item.getUserItems"
                )
                  return [];
                if (op.path === "pets.getCollection") return emptyPetCollection;
                throw new Error(`Unexpected procedure ${op.path}`);
              };
              void result().then(
                (data) => {
                  observer.next({ result: { data } });
                  observer.complete();
                },
                (error) => observer.error(error),
              );
            }),
      ],
    });
    const view = render(
      <testApi.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <HomePage />
        </QueryClientProvider>
      </testApi.Provider>,
    );
    const decorate = await view.findByRole("button", { name: "Decorate" });
    fireEvent.click(decorate);
    const bed = view.getByRole("button", { name: "Move Bed" });
    fireEvent.keyDown(bed, { key: "ArrowRight" });
    const position = bed.style.left;
    fireEvent.click(view.getByRole("button", { name: "Save layout" }));
    await waitFor(() => expect(homeQueries).toBe(2));
    expect(queryClient.isMutating()).toBe(1);
    await waitFor(() =>
      expect(
        (view.getByRole("button", { name: "Saving…" }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
    for (const name of ["Cancel", "Undo changes"]) {
      expect((view.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(
        true,
      );
    }
    fireEvent.keyDown(bed, { key: "ArrowRight" });
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    expect(bed.style.left).toBe(position);
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => {
      finishRefresh();
      await refreshed;
    });
    if (success) {
      await waitFor(() =>
        expect(view.queryByRole("button", { name: "Move Bed" })).toBeNull(),
      );
      expect(view.getByRole("button", { name: "Bed: Go to sleep" }).style.left).toBe(
        position,
      );
    } else {
      await waitFor(() =>
        expect(
          (view.getByRole("button", { name: "Save layout" }) as HTMLButtonElement)
            .disabled,
        ).toBe(false),
      );
      expect(view.getByRole("alert").textContent).toContain("Your home changed");
      expect(bed.style.left).toBe(position);
      fireEvent.keyDown(bed, { key: "ArrowRight" });
      expect(bed.style.left).not.toBe(position);
    }
    queryClient.clear();
  });
}

// Real dialog focus and query refresh need an integration-test budget.
it("opens home management from the header and waits for refreshed inventory before decorating", async () => {
  let finishRefresh = () => {};
  const refreshed = new Promise<void>((resolve) => { finishRefresh = resolve; });
  let homeQueries = 0;
  const home: NonNullable<RouterOutputs["home"]["getUserHome"]> = {
    homeType: "NONE", biome: "ground", regen: HomeTypeDetails.NONE.regen, storage: HomeTypeDetails.NONE.storage,
    furniture: [...furniture], furnitureRevision: 3, styles: [], isPublic: false, layout: [...layout],
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const trpcClient = testApi.createClient({ links: [() => ({ op }) => observable((observer) => {
    if (op.path === "home.getHomeRequests") {
      observer.next({ result: { data: [] } });
      observer.complete();
      return;
    }
    const result = async () => {
      if (op.path === "home.getUserHome") {
        if (++homeQueries > 1) await refreshed;
        return { ...home };
      }
      if (op.path === "home.getAvailableUpgrades" || op.path === "item.getUserItems") return [];
      if (op.path === "pets.getCollection") return emptyPetCollection;
      throw new Error(`Unexpected procedure ${op.path}`);
    };
    void result().then((data) => { observer.next({ result: { data } }); observer.complete(); }, (error) => observer.error(error));
  })] });
  let invalidated: Promise<void> | undefined;
  try {
    const view = render(
      <testApi.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}><HomePage /></QueryClientProvider>
      </testApi.Provider>,
    );
    const trigger = await view.findByRole("button", { name: "Manage home" });
    await view.findByRole("button", { name: "Decorate" });
    const header = within(view.getByTestId("home-header-controls"));
    expect(header.getByRole("button", { name: "Manage home" })).toBe(trigger);
    expect(header.getByRole("button", { name: "Decorate" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "House shop" })).toBeNull();
    fireEvent.click(trigger);
    const management = within(view.getByRole("dialog"));
    expect(management.getByText("Home Management")).toBeTruthy();
    // Ordinary item purchases invalidate this query; a fresh draft must use the delivered rows and revision.
    home.furniture = [...furniture, rug];
    home.furnitureRevision++;
    act(() => {
      invalidated = queryClient.invalidateQueries({ queryKey: getQueryKey(testApi.home.getUserHome, undefined, "query") });
    });
    await waitFor(() => expect(homeQueries).toBe(2));
    fireEvent.click(management.getAllByRole("button", { name: "Close" })[0]!);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    const decorate = view.getByRole("button", { name: "Decorate" }) as HTMLButtonElement;
    expect(decorate.disabled).toBe(true);
    fireEvent.click(decorate);
    expect(view.queryByRole("button", { name: "Move Bed" })).toBeNull();
    await act(async () => { finishRefresh(); await Promise.all([refreshed, invalidated]); });
    await waitFor(() => expect(decorate.disabled).toBe(false));
    fireEvent.click(decorate);
    expect(view.getByRole("button", { name: /Woven Rug.*Place$/ })).toBeTruthy();
  } finally {
    finishRefresh();
    await invalidated;
    queryClient.clear();
  }
}, 20_000);

it("preserves a draft across a tier refresh and requires recovery before saving", async () => {
  const home = { ...essentialHome, furniture, homeType: "TOWN_HOUSE" as const, layout: [...layout] };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const homeKey = getQueryKey(testApi.home.getUserHome, undefined, "query");
  const save = vi.fn().mockReturnValue({ success: false, message: "Retained" });
  const trpcClient = testApi.createClient({ links: [() => ({ op }) => observable((observer) => {
    if (op.path === "home.getHomeRequests") {
      observer.next({ result: { data: [] } });
      observer.complete();
      return;
    }
    let data;
    if (op.path === "home.getUserHome") data = home;
    else if (op.path === "item.getUserItems") data = ownedItems;
    else if (op.path === "home.getAvailableUpgrades") data = [];
    else if (op.path === "pets.getCollection") data = emptyPetCollection;
    else if (op.path === "home.saveFurnitureLayout") data = save(op.input);
    else throw new Error(`Unexpected procedure ${op.path}`);
    observer.next({ result: { data } });
    observer.complete();
  })] });
  try {
    const view = render(
      <testApi.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}><HomePage /></QueryClientProvider>
      </testApi.Provider>,
    );
    fireEvent.click(await view.findByRole("button", { name: "Decorate" }));
    fireEvent.change(view.getByLabelText("Wall paint"), { target: { value: "sage" } });
    fireEvent.change(view.getByLabelText("Furniture room"), { target: { value: "room-1" } });
    fireEvent.change(view.getByLabelText("Wall paint"), { target: { value: "rose" } });
    const bed = view.getByRole("button", { name: "Move Bed" });
    /** A tier changes painted world bounds; the captured draft must retain its room-local anchors. */
    const normalizedPosition = (homeType: HomeType) => {
      const room = getHomeRooms(homeType).find(({ id }) => id === "room-1")!;
      const origin = getHomeFurnitureGeometry(furniture[0]!, { id: furniture[0]!.id, x: 0, y: 0, rotation: 0, room: room.id }, homeType).visibleBounds;
      return unprojectHomePlacement({
        x: (Number.parseFloat(bed.style.left) - room.x) * 100 / room.width - origin.x + HOME_FLOOR_PROJECTION.x,
        y: (Number.parseFloat(bed.style.top) - room.y) * 100 / room.height - origin.y + HOME_FLOOR_PROJECTION.y,
      });
    };
    const position = normalizedPosition("TOWN_HOUSE");
    await act(async () => {
      queryClient.setQueryData(homeKey, { ...home, homeType: "MANSION", furnitureRevision: 4 });
    });
    await view.findByRole("button", { name: "Decorate Room 6" });
    expect((view.getByLabelText("Furniture room") as HTMLSelectElement).value).toBe("room-1");
    expect(normalizedPosition("MANSION").x).toBeCloseTo(position.x, 8);
    expect(normalizedPosition("MANSION").y).toBeCloseTo(position.y, 8);
    fireEvent.keyDown(bed, { key: "ArrowRight" });
    expect(normalizedPosition("MANSION").x).toBeCloseTo(position.x, 8);
    expect(normalizedPosition("MANSION").y).toBeCloseTo(position.y, 8);
    expect(view.getByRole("alert").textContent).toContain("Your home tier changed. Cancel and reopen");
    expect((view.getByRole("button", { name: "Save layout" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Decorate Room 2" }));
    expect((view.getByLabelText("Wall paint") as HTMLSelectElement).value).toBe("rose");
    fireEvent.click(view.getByRole("button", { name: "Decorate Main room" }));
    expect((view.getByLabelText("Wall paint") as HTMLSelectElement).value).toBe("sage");
    fireEvent.click(view.getByRole("button", { name: "Save layout" }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    fireEvent.click(view.getByRole("button", { name: "Decorate" }));
    expect(view.queryByRole("alert")).toBeNull();
    expect((view.getByLabelText("Furniture room") as HTMLSelectElement).value).toBe("main");
    expect((view.getByLabelText("Wall paint") as HTMLSelectElement).value).toBe("ivory");
    fireEvent.click(view.getByRole("button", { name: "Save layout" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]![0]).toMatchObject({ homeType: "MANSION", revision: 4, styles: [] });
  } finally {
    queryClient.clear();
  }
});

it("opens the kitchen from an accessible owner deep link or scene action and preserves navigation and focus", async () => {
  searchParams = new URLSearchParams("panel=kitchen&from=companion");
  let access = false;
  let ownVillage = true;
  vi.spyOn(UserContext, "useRequireInVillage").mockImplementation(() => ({
    userData: { homeType: "NONE", status: "AWAKE", money: 1000, sector: 1, village: { sector: 1 } },
    access,
    ownVillage,
  }) as never);
  const { view, queryClient, rerender } = mountHome();
  try {
    expect(view.queryByRole("dialog")).toBeNull();
    expect(replaceRoute).not.toHaveBeenCalled();
    access = true;
    ownVillage = false;
    rerender();
    expect(view.queryByRole("dialog")).toBeNull();
    expect(replaceRoute).not.toHaveBeenCalled();
    ownVillage = true;
    rerender();
    const kitchen = within(await view.findByRole("dialog"));
    expect(await kitchen.findByText("Kitchen recipes")).toBeTruthy();
    expect(replaceRoute).toHaveBeenCalledTimes(1);
    expect(replaceRoute).toHaveBeenCalledWith("/home?from=companion", { scroll: false });
    fireEvent.click(kitchen.getAllByRole("button", { name: "Close" })[0]!);
    rerender();
    expect(view.queryByRole("dialog")).toBeNull();
    expect(replaceRoute).toHaveBeenCalledTimes(1);
  } finally {
    queryClient.clear();
  }
  cleanup();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  for (const hasKitchen of [true, false]) {
    const kitchen: HomeFurniture = {
      ...rug, id: "owned-kitchen", itemId: "home-kitchen", name: "Kitchen",
      image: "/kitchen.webp", isFloor: false, action: "kitchen",
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const trpcClient = testApi.createClient({ links: [() => ({ op }) => observable((observer) => {
      if (op.path === "home.getHomeRequests") {
        observer.next({ result: { data: [] } });
        observer.complete();
        return;
      }
      if (op.path === "home.getUserHome") {
        observer.next({ result: { data: {
          homeType: "NONE", biome: "ground", regen: HomeTypeDetails.NONE.regen, storage: HomeTypeDetails.NONE.storage,
          furniture: hasKitchen ? [kitchen] : [], furnitureRevision: 3, styles: [], isPublic: false, layout: hasKitchen ? [{ id: kitchen.id, x: 76, y: 57.58, rotation: 0 }] : [],
        } } });
      } else if (op.path === "pets.getCollection") {
        observer.next({ result: { data: emptyPetCollection } });
      } else if (op.path === "home.getAvailableUpgrades" || op.path === "item.getUserItems") {
        observer.next({ result: { data: [] } });
      } else {
        throw new Error(`Unexpected procedure ${op.path}`);
      }
      observer.complete();
    })] });
    try {
      const view = render(
        <testApi.Provider client={trpcClient} queryClient={queryClient}>
          <QueryClientProvider client={queryClient}><HomePage /></QueryClientProvider>
        </testApi.Provider>,
      );
      const trigger = await view.findByRole("button", { name: "Kitchen" });
      expect(view.queryByRole("link", { name: /ramen shop/i })).toBeNull();
      fireEvent.click(trigger);
      const kitchenDialog = within(view.getByRole("dialog"));
      expect(await kitchenDialog.findByText("Kitchen recipes")).toBeTruthy();
      expect(Kitchen.default).toHaveBeenLastCalledWith({
        image: hasKitchen ? "/kitchen.webp" : IMG_HOME_KITCHEN,
      }, undefined);
      fireEvent.click(kitchenDialog.getAllByRole("button", { name: "Close" })[0]!);
      await waitFor(() => expect(document.activeElement).toBe(trigger));
    } finally {
      queryClient.clear();
      cleanup();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
}, 20_000);

/** Render the residence with its ordinary owner data for navigation regressions. */
function mountHome() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpcClient = testApi.createClient({ links: [() => ({ op }) => observable((observer) => {
    let data: unknown;
    if (op.path === "pets.getCollection") data = emptyPetCollection;
    else if (op.path === "home.getUserHome") data = essentialHome;
    else if (op.path === "item.getUserItems") data = ownedItems;
    else if (op.path === "home.getAvailableUpgrades") data = [];
    else if (op.path === "home.getHomeRequests") data = [];
    else throw new Error(`Unexpected procedure ${op.path}`);
    observer.next({ result: { data } });
    observer.complete();
  })] });
  const page = () => (
    <testApi.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}><HomePage /></QueryClientProvider>
    </testApi.Provider>
  );
  const view = render(page());
  return { view, queryClient, rerender: () => view.rerender(page()) };
}
