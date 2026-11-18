import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import * as client from "@/app/_trpc/client";
import * as serviceCache from "@/hooks/useCraftingServices";
import * as contentBox from "@/layout/ContentBox";
import { CraftForMe, CraftingServices } from "@/layout/CraftingServices";
import * as userContext from "@/utils/UserContext";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

const save = vi.fn();
const retry = vi.fn();
let query: {
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  data?: {
    prices: { service: string; rarity: string; fee: number; enabled: boolean }[];
    crafter?: { rank: string; occupation: string; username: string };
  };
  refetch: typeof retry;
};
beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true, scrollIntoView: true });
  save.mockClear();
  retry.mockClear();
  query = {
    isPending: false,
    isError: false,
    isFetching: false,
    data: { prices: [] },
    refetch: retry,
  };
  vi.spyOn(userContext, "useRequiredUserData").mockReturnValue({
    data: { userId: "crafter", occupation: "CRAFTING" },
  } as never);
  vi.spyOn(serviceCache, "useServiceRequests").mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
  } as never);
  vi.spyOn(serviceCache, "useCraftingServiceCache").mockReturnValue({
    prepareServiceUpdate: vi.fn(),
    updateService: vi.fn(async () => {}),
  } as never);
  vi.spyOn(serviceCache, "useCraftingServicePriceCache").mockReturnValue({
    prepareUpdate: vi.fn(),
    updateCache: vi.fn(async () => {}),
  } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    occupation: {
      respondToServiceRequest: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      getServicePrices: { useQuery: () => query },
      setServicePrice: { useMutation: () => ({ mutate: save, isPending: false }) },
      getCraftableItems: { useQuery: () => ({ data: [] }) },
      submitServiceRequest: { useMutation: () => ({ mutate: save, isPending: false }) },
    },
    item: {
      getUserItems: {
        useQuery: () => ({
          data: [
            {
              id: "sword",
              quantity: 1,
              equipped: "NONE",
              isInAuction: false,
              storedAtHome: false,
              durability: 50,
              item: {
                name: "Service Sword",
                rarity: "COMMON",
                maxDurability: 100,
                canBeImbued: true,
              },
              imbuements: [
                {
                  id: "imb",
                  craftingFinishedAt: new Date(0),
                  item: { name: "Bound Crystal", rarity: "COMMON" },
                },
              ],
            },
            {
              id: "gem",
              quantity: 1,
              item: { name: "Service Crystal", rarity: "COMMON", itemType: "CRYSTAL" },
            },
          ],
        }),
      },
    },
  });
  vi.spyOn(contentBox, "default").mockImplementation(
    ({ children }: ComponentProps<typeof contentBox.default>) => (
      <section>{children}</section>
    ),
  );
});
afterEach(() => {
  cleanup();
  restoreBrowserGlobals();
  vi.restoreAllMocks();
});
const renderPrices = () => {
  const view = render(<CraftingServices />);
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Service Prices" }), {
    button: 0,
    ctrlKey: false,
  });
  return view;
};
it("shows loading and retry feedback before any saved price can be edited", () => {
  query = { ...query, isPending: true, data: undefined, isFetching: true };
  const view = renderPrices();
  expect(screen.getByText("Loading service prices")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Save price" })).toBeNull();
  query = { ...query, isPending: false, isError: true, isFetching: false };
  view.rerender(<CraftingServices />);
  expect(screen.getByRole("alert").textContent).toContain(
    "Could not load service prices",
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry prices" }));
  expect(retry).toHaveBeenCalledTimes(1);
  query = {
    ...query,
    isError: false,
    data: { prices: [{ service: "CRAFT", rarity: "COMMON", fee: 300, enabled: true }] },
  };
  view.rerender(<CraftingServices />);
  expect(
    (screen.getByRole("spinbutton", { name: "Fee in ryo" }) as HTMLInputElement).value,
  ).toBe("300");
});
it("resets drafts between unset price pairs while preserving edits to the selected pair", () => {
  const view = renderPrices();
  fireEvent.input(screen.getByRole("spinbutton", { name: "Fee in ryo" }), {
    target: { value: "125" },
  });
  query = { ...query, data: { prices: [] } };
  view.rerender(<CraftingServices />);
  expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("125");
  fireEvent.click(screen.getByRole("combobox", { name: "Rarity" }));
  fireEvent.click(screen.getByRole("option", { name: /^RARE$/ }));
  expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("0");
  fireEvent.input(screen.getByRole("spinbutton"), { target: { value: "250" } });
  fireEvent.click(screen.getByRole("combobox", { name: "Service" }));
  fireEvent.click(screen.getByRole("option", { name: "Repair my Items" }));
  expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("0");
  fireEvent.click(screen.getByRole("button", { name: "Save price" }));
  expect(save).toHaveBeenCalledWith({
    service: "REPAIR",
    rarity: "RARE",
    fee: 0,
    enabled: true,
  });
});

it.each([undefined, 80])(
  "preserves the fee and availability draft when reselecting the current pair with saved fee %s",
  (savedFee) => {
    if (savedFee !== undefined)
      query.data = {
        prices: [{ service: "CRAFT", rarity: "COMMON", fee: savedFee, enabled: true }],
      };
    renderPrices();
    fireEvent.input(screen.getByRole("spinbutton", { name: "Fee in ryo" }), {
      target: { value: "125" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Offer this service" }));
    for (const [label, option] of [
      ["Service", "Craft an Item"],
      ["Rarity", "COMMON"],
    ]) {
      fireEvent.click(screen.getByRole("combobox", { name: label }));
      fireEvent.click(screen.getByRole("option", { name: option }));
      expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("125");
      expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    }
    fireEvent.click(screen.getByRole("button", { name: "Save price" }));
    expect(save).toHaveBeenCalledWith({
      service: "CRAFT",
      rarity: "COMMON",
      fee: 125,
      enabled: false,
    });
  },
);

it.each(["IMBUE", "DISIMBUE"] as const)(
  "waits for the %s crystal selection before reporting price availability",
  (service) => {
    query.data = {
      prices: [],
      crafter: { rank: "MASTER", occupation: "CRAFTING", username: "Crafter" },
    };
    const view = render(<CraftForMe crafterId="crafter" />);
    fireEvent.click(screen.getByRole("button", { name: "Craft for Me" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: service === "IMBUE" ? "Imbue" : "Disimbue",
      }),
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Your item" }));
    fireEvent.click(screen.getByRole("option", { name: /Service Sword/ }));
    expect(screen.queryByText(/has not enabled a price/)).toBeNull();
    const label = service === "IMBUE" ? "Crystal" : "Imbuement";
    expect(screen.getByRole("combobox", { name: label }).textContent).toContain(
      service === "IMBUE" ? "Select your crystal" : "Select the crystal to return",
    );
    fireEvent.click(screen.getByRole("combobox", { name: label }));
    fireEvent.click(
      screen.getByRole("option", {
        name: service === "IMBUE" ? /Service Crystal/ : "Bound Crystal",
      }),
    );
    expect(screen.getByText(/has not enabled a price/)).toBeTruthy();
    query.data = {
      ...query.data,
      prices: [{ service, rarity: "COMMON", fee: 50, enabled: true }],
    };
    view.rerender(<CraftForMe crafterId="crafter" />);
    expect(screen.getByText("Service fee: 50 ryo")).toBeTruthy();
    expect(screen.queryByText(/has not enabled a price/)).toBeNull();
  },
);

it("opens saved price pairs for editing and keeps a draft when selecting the same row", () => {
  query.data = {
    prices: [{ service: "REPAIR", rarity: "RARE", fee: 175, enabled: false }],
  };
  renderPrices();
  const edit = screen.getByRole("button", { name: "Edit Repair my Items RARE price" });
  fireEvent.click(edit);
  expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("175");
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  fireEvent.input(screen.getByRole("spinbutton"), { target: { value: "200" } });
  fireEvent.click(edit);
  expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("200");
  fireEvent.click(screen.getByRole("button", { name: "Save price" }));
  expect(save).toHaveBeenCalledWith({
    service: "REPAIR",
    rarity: "RARE",
    fee: 200,
    enabled: false,
  });
});

it("keeps pending actions visible and terminal receipts in expandable history", () => {
  vi.spyOn(serviceCache, "useServiceRequests").mockReturnValue({
    data: ["PENDING", "COMPLETED"].map((status) => ({
      id: status,
      status,
      service: "CRAFT",
      itemName: `${status} Sword`,
      fee: 80,
      crafterId: "crafter",
      requesterId: "requester",
      requester: { username: "Requester" },
      materials: [],
    })),
    isLoading: false,
    isError: false,
  } as never);
  render(<CraftingServices />);
  const pending = screen.getByRole("button", { name: "Accept" });
  expect(pending.closest("details")?.open).toBe(true);
  const history = screen.getByText("COMPLETED Sword").closest("details");
  expect(history?.open).toBe(false);
  fireEvent.click(screen.getByText("Request history (1)"));
  expect(history?.open).toBe(true);
});

it("shows one explanatory empty state when there are no service requests", () => {
  render(<CraftingServices />);
  expect(screen.getByText("No incoming service requests")).toBeTruthy();
  expect(screen.queryByText("No open incoming requests.")).toBeNull();
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Outgoing" }), {
    button: 0,
    ctrlKey: false,
  });
  expect(screen.getByText("No outgoing service requests")).toBeTruthy();
  expect(screen.queryByText("No open outgoing requests.")).toBeNull();
});

it("shows the no-open message only for the direction with historical receipts", () => {
  vi.spyOn(serviceCache, "useServiceRequests").mockReturnValue({
    data: [
      {
        id: "completed",
        status: "COMPLETED",
        service: "CRAFT",
        itemName: "Sword",
        fee: 80,
        crafterId: "crafter",
        requesterId: "requester",
        materials: [],
      },
    ],
    isLoading: false,
    isError: false,
  } as never);
  render(<CraftingServices />);
  expect(screen.getByText("No open incoming requests.")).toBeTruthy();
  expect(screen.queryByText("No incoming service requests")).toBeNull();
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Outgoing" }), {
    button: 0,
    ctrlKey: false,
  });
  expect(screen.getByText("No outgoing service requests")).toBeTruthy();
  expect(screen.queryByText("No open outgoing requests.")).toBeNull();
});
