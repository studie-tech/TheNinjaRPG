import { afterEach, describe, expect, it } from "bun:test";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { getFilter, useFiltering } from "@/layout/JutsuFiltering";
import { availableRanks } from "@/libs/train";

afterEach(cleanup);

describe("jutsu filter defaults", () => {
  it("requests the rank-filtered list once on a cold mount", async () => {
    const ranks = availableRanks("GENIN");
    const requests: Record<string, unknown>[] = [];
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const view = renderHook(
      () => {
        const state = useFiltering(ranks);
        const filter = getFilter(state);
        const query = useQuery({
          queryKey: ["jutsus", filter],
          queryFn: async () => {
            requests.push(filter);
            return [];
          },
        });
        return { state, query };
      },
      { wrapper },
    );

    expect(view.result.current.state.rank).toEqual(ranks);
    expect(getFilter(view.result.current.state)).toEqual({ rank: ranks });
    await waitFor(() => expect(view.result.current.query.isSuccess).toBe(true));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    expect(requests).toEqual([{ rank: ranks }]);
    view.unmount();
    client.clear();
  });

  it("keeps the jutsu inventory unranked when no default is supplied", () => {
    const view = renderHook(() => useFiltering());
    expect(view.result.current.rank).toEqual([]);
    expect(getFilter(view.result.current)).toEqual({});
  });

  it("retains edited filters across rerenders and allows clearing or overriding ranks", async () => {
    const ranks = availableRanks("GENIN");
    const view = renderHook(() => useFiltering(ranks));

    act(() => {
      view.result.current.setRank([]);
      view.result.current.cf.setters.name("Clone");
    });
    view.rerender();
    await waitFor(
      () => expect(getFilter(view.result.current)).toEqual({ name: "Clone" }),
      { timeout: 2_000 },
    );
    expect(view.result.current.rank).toEqual([]);
    expect(view.result.current.name).toBe("Clone");

    act(() => view.result.current.setRank(["JONIN"]));
    view.rerender();
    await waitFor(
      () =>
        expect(getFilter(view.result.current)).toEqual({
          name: "Clone",
          rank: ["JONIN"],
        }),
      { timeout: 2_000 },
    );
  });
});
