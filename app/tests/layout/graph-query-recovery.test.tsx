import type { Mock } from "bun:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { cloneElement } from "react";
import * as client from "@/app/_trpc/client";
import GraphBankLedger from "@/layout/GraphBankLedger";
import GraphBlackmarketLedger from "@/layout/GraphBlackmarketLedger";
import GraphCombatLog from "@/layout/GraphCombatLog";
import * as graph from "@/layout/GraphUsersGeneric";

const refetch = vi.fn();
let graphMock: Mock<typeof graph.default>;
let query: {
  data: object[] | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: typeof refetch;
};

beforeEach(() => {
  vi.clearAllMocks();
  query = {
    data: undefined,
    isPending: true,
    isError: false,
    isFetching: true,
    refetch,
  };
  const getGraph = { useQuery: () => query };
  Object.assign(vi.spyOn(client, "api" as never), {
    bank: { getGraph },
    blackmarket: { getGraph },
    combat: { getGraph },
  });
  graphMock = vi
    .spyOn(graph, "default")
    .mockReturnValue(<div data-testid="graph">Graph</div>);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const transfer = {
  senderId: "sender",
  senderUsername: "Sender",
  senderAvatar: null,
  receiverId: "receiver",
  receiverUsername: "Receiver",
  receiverAvatar: null,
  total: 10,
  totalReps: 10,
  totalRyo: 100,
};
const battle = {
  attackerId: "attacker",
  attackerUsername: "Attacker",
  attackerAvatar: null,
  defenderId: "defender",
  defenderUsername: "Defender",
  defenderAvatar: null,
  total: 10,
};

for (const { name, component, loading, empty, rows, edges } of [
  {
    name: "bank",
    component: <GraphBankLedger />,
    loading: "Loading bank ledger graph",
    empty: "No bank transfers to display.",
    rows: [transfer],
    edges: 1,
  },
  {
    name: "black market",
    component: <GraphBlackmarketLedger />,
    loading: "Loading black market ledger",
    empty: "No black market trades to display.",
    rows: [transfer],
    edges: 2,
  },
  {
    name: "combat",
    component: <GraphCombatLog userId="attacker" />,
    loading: "Loading Battle Data",
    empty: "No battles to display.",
    rows: [battle],
    edges: 1,
  },
]) {
  describe(`${name} graph query`, () => {
    it("ends loading after failure and disables retry while refetching", () => {
      const view = render(component);
      expect(view.getByText(loading)).toBeDefined();
      query = { ...query, isPending: false, isError: true, isFetching: false };
      view.rerender(cloneElement(component));
      expect(view.queryByText(loading) === null).toBe(true);
      expect(view.getByRole("alert").textContent).toContain("Could not load");
      const retry = view.getByRole("button", { name: "Try again" });
      fireEvent.click(retry);
      expect(refetch).toHaveBeenCalledTimes(1);

      query = { ...query, isFetching: true };
      view.rerender(cloneElement(component));
      expect((retry as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(retry);
      expect(refetch).toHaveBeenCalledTimes(1);

      query = { ...query, data: [], isError: false, isFetching: false };
      view.rerender(cloneElement(component));
      expect(view.queryByRole("alert") === null).toBe(true);
      expect(view.getByRole("status").textContent).toBe(empty);
    });

    it("keeps cached graph data visible during refetches and refetch errors", async () => {
      query = { ...query, data: rows, isPending: false, isFetching: false };
      const view = render(component);
      const renderedGraph = await view.findByTestId("graph");
      const graphProps = graphMock.mock.calls.at(-1)?.[0];
      expect(graphProps?.nodes).toHaveLength(2);
      expect(graphProps?.edges).toHaveLength(edges);
      query = { ...query, isFetching: true };
      view.rerender(cloneElement(component));
      expect(view.getByTestId("graph") === renderedGraph).toBe(true);
      query = { ...query, isFetching: false, isError: true };
      view.rerender(cloneElement(component));
      expect(view.getByTestId("graph") === renderedGraph).toBe(true);
      expect(view.queryByRole("alert") === null).toBe(true);
      expect(view.queryByText(loading) === null).toBe(true);
    });
  });
}
