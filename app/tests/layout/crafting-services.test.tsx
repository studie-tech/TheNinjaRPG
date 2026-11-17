import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import * as client from "@/app/_trpc/client";
import * as serviceCache from "@/hooks/useCraftingServices";
import * as contentBox from "@/layout/ContentBox";
import { CraftingServices } from "@/layout/CraftingServices";
import * as selectors from "@/layout/SearchSelect";
import * as userContext from "@/utils/UserContext";

const save = vi.fn();
const retry = vi.fn();
let query: {
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  data?: {
    prices: { service: string; rarity: string; fee: number; enabled: boolean }[];
  };
  refetch: typeof retry;
};
beforeEach(() => {
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
    },
  });
  vi.spyOn(contentBox, "default").mockImplementation(
    ({ children }: ComponentProps<typeof contentBox.default>) => (
      <section>{children}</section>
    ),
  );
  vi.spyOn(selectors, "SearchSelect").mockImplementation(
    ({
      label,
      value,
      options,
      disabled,
      onChange,
    }: ComponentProps<typeof selectors.SearchSelect>) => (
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ),
  );
});
afterEach(() => {
  cleanup();
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
  fireEvent.change(screen.getByRole("combobox", { name: "Rarity" }), {
    target: { value: "RARE" },
  });
  expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("0");
  fireEvent.input(screen.getByRole("spinbutton"), { target: { value: "250" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Service" }), {
    target: { value: "REPAIR" },
  });
  expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("0");
  fireEvent.click(screen.getByRole("button", { name: "Save price" }));
  expect(save).toHaveBeenCalledWith({
    service: "REPAIR",
    rarity: "RARE",
    fee: 0,
    enabled: true,
  });
});
