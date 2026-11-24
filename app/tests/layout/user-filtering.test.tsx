import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  within,
} from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import { OCCUPATIONS } from "@/drizzle/constants";
import UserFiltering, { getFilter, useFiltering } from "@/layout/UserFiltering";
import { getPublicUsersSchema } from "@/validators/user";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";
import { mockUserContextValue } from "../setup/userContext";

const noNames = { useQuery: () => ({ data: [] }) };

const UserFilter = ({ aiToggles }: { aiToggles?: boolean }) => {
  const state = useFiltering();
  return (
    <>
      <UserFiltering state={state} aiToggles={aiToggles} />
      <output data-testid="filter">{JSON.stringify(getFilter(state))}</output>
    </>
  );
};

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true, scrollIntoView: true });
  Object.assign(vi.spyOn(client, "api" as never), {
    bloodline: { getAllNames: noNames },
    village: { getAllNames: noNames },
    misc: { getAllGameAssetNames: noNames },
    data: { getReferralSources: noNames, getVisitorUtmSources: noNames },
  });
  mockUserContextValue({ data: { role: "USER" } });
});

afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  restoreBrowserGlobals();
  vi.restoreAllMocks();
});

describe("occupation filter", () => {
  it.each([...OCCUPATIONS])("sends the chosen %s occupation", (occupation) => {
    const { result } = renderHook(() => useFiltering());
    act(() => result.current.cf.setters.occupation(occupation));

    const filter = getFilter(result.current);
    expect(filter).toEqual({ occupation });
    expect(
      getPublicUsersSchema.parse({ ...filter, limit: 30, orderBy: "Online" })
        .occupation,
    ).toBe(occupation);
  });

  it("sends nothing for None, whether untouched or chosen again", () => {
    const { result } = renderHook(() => useFiltering());
    expect(getFilter(result.current)).toEqual({});

    act(() => result.current.cf.setters.occupation("HUNTER"));
    act(() => result.current.cf.setters.occupation("None"));
    expect("occupation" in getFilter(result.current)).toBe(false);
  });

  it("offers players every occupation and applies the one they pick", () => {
    const view = render(<UserFilter />);
    fireEvent.click(view.getByRole("button", { name: "Filter" }));
    const field = view.getByText("Occupation").parentElement!;
    fireEvent.keyDown(within(field).getByRole("combobox"), { key: "ArrowDown" });

    expect(view.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "None",
      "Gathering",
      "Hunter",
      "Crafting",
    ]);
    const crafting = view.getByRole("option", { name: "Crafting" });
    act(() => crafting.focus());
    fireEvent.keyDown(crafting, { key: "Enter" });
    expect(view.getByTestId("filter").textContent).toBe('{"occupation":"CRAFTING"}');
  });

  it("is not offered for AIs", () => {
    const view = render(<UserFilter aiToggles />);
    fireEvent.click(view.getByRole("button", { name: "Filter" }));
    expect(view.getByText("Village")).toBeTruthy();
    expect(view.queryByText("Occupation")).toBeNull();
  });
});
