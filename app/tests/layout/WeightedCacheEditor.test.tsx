import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { WeightedCacheEditor } from "@/layout/WeightedCacheEditor";
import { CACHE_RESTRICTED_REWARD_MESSAGE } from "@/libs/weightedCache";
import type { WeightedCache } from "@/validators/weightedCache";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

const scroll = vi.fn();

beforeEach(() => {
  scroll.mockClear();
  installBrowserGlobals({ events: ["CustomEvent"], scrollIntoView: scroll });
});
afterEach(() => {
  cleanup();
  restoreBrowserGlobals();
});

/** Keep the controlled editor's draft in parent state, as the item form does. */
const CacheForm = ({ restricted = false }: { restricted?: boolean }) => {
  const [cache, setCache] = useState<WeightedCache>({
    version: 1,
    displayName: "Supply Cache",
    rolls: [{ count: 1, probability: 10_000 }],
    tiers: [
      {
        name: "Common",
        probability: 10_000,
        entries: Array.from({ length: 3 }, () => ({
          items: [{ itemId: "pill", quantity: 2 }],
        })),
      },
    ],
  });
  return (
    <WeightedCacheEditor
      cache={cache}
      onChange={setCache}
      items={[
        { id: "pill", name: "Chakra Pill", isRestrictedCacheReward: restricted },
        { id: "bloodline", name: "Bloodline Scroll", isRestrictedCacheReward: true },
      ]}
      isLoading={false}
      isError={false}
      onRetry={() => {}}
    />
  );
};

describe("weighted cache editor sections", () => {
  it("exposes existing restricted rewards for repair and excludes new restricted choices", async () => {
    const view = render(<CacheForm restricted />);
    expect(view.getAllByRole("alert")[0]?.textContent).toContain(
      CACHE_RESTRICTED_REWARD_MESSAGE,
    );
    fireEvent.click(view.getByRole("button", { name: "Review first issue" }));
    const entry = view.getAllByRole("alert")[0]!.closest("details")!;
    fireEvent.click(within(entry).getByRole("combobox"));
    await waitFor(() =>
      expect(view.getByRole("option", { name: "Chakra Pill" })).toBeDefined(),
    );
    expect(view.queryByRole("option", { name: "Bloodline Scroll" })).toBeNull();
  });
  it("collapses saved tiers and entries while keeping invalid numeric drafts available", async () => {
    const view = render(<CacheForm />);
    const tier = view.getByText("Common · 100% · 3 entries").closest("details")!;
    const entry = within(tier)
      .getByText("Entry 1 · 33.33% within tier · 1 item")
      .closest("details")!;
    expect(tier.open).toBe(false);
    expect(entry.open).toBe(false);
    fireEvent.click(tier.querySelector("summary")!);
    fireEvent.click(entry.querySelector("summary")!);
    await waitFor(() => expect(entry.open).toBe(true));
    const quantity = within(entry).getByRole("spinbutton", {
      name: /quantity/,
    }) as HTMLInputElement;
    fireEvent.input(quantity, { target: { value: "" } });
    fireEvent.click(tier.querySelector("summary")!);
    await waitFor(() => expect(tier.open).toBe(false));
    fireEvent.click(view.getByRole("button", { name: "Review first issue" }));
    const error = view.getByRole("alert");
    expect(error.textContent).toContain("Common · Entry 1 · Item 1:");
    expect(tier.open).toBe(true);
    expect(entry.open).toBe(true);
    expect(document.activeElement).toBe(error);
    expect(scroll).toHaveBeenCalled();
    expect(quantity.value).toBe("");
    fireEvent.input(quantity, { target: { value: "3" } });
    await waitFor(() => expect(view.queryByRole("alert")).toBeNull());
    expect(quantity.value).toBe("3");
  });

  it("opens added entries and names their errors without schema paths", async () => {
    const view = render(<CacheForm />);
    const tier = view.getByText("Common · 100% · 3 entries").closest("details")!;
    fireEvent.click(tier.querySelector("summary")!);
    fireEvent.click(within(tier).getByRole("button", { name: "Add reward entry" }));
    const error = view.getByRole("alert");
    expect(error.textContent).toBe(
      "Common · Entry 4: Reward entries need at least one item",
    );
    expect(error.closest("details")?.open).toBe(true);
    fireEvent.click(
      within(error.closest("details")!).getByRole("button", { name: "Remove entry" }),
    );
    await waitFor(() => expect(view.queryByRole("alert")).toBeNull());
  });

  it("opens a newly added zero-probability draft without rejecting its empty entries", () => {
    const view = render(<CacheForm />);
    fireEvent.click(view.getByRole("button", { name: "Add tier" }));
    const tier = view.getByText("New tier · 0% · 0 entries").closest("details")!;
    expect(tier.open).toBe(true);
    expect(view.queryByRole("alert")).toBeNull();
    fireEvent.click(within(tier).getByRole("button", { name: "Add reward entry" }));
    expect(
      within(tier)
        .getByText("Entry 1 · 100.00% within tier · 0 items")
        .closest("details")?.open,
    ).toBe(true);
    expect(view.queryByRole("alert")).toBeNull();
  });
});
