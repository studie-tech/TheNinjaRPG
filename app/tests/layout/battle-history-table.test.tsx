import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import type { RouterInputs, RouterOutputs } from "@/app/_trpc/client";
import * as Avatar from "@/layout/Avatar";
import { BattleHistoryTable } from "@/layout/BattleHistoryTable";
import { fakeTrpcClient, testApi, TrpcTestProviders } from "../setup/trpc";

type Input = RouterInputs["combat"]["getBattleHistory"];
type Row = RouterOutputs["combat"]["getBattleHistory"]["data"][number];
let queryClient: QueryClient;
let requests: Input[];
let push: ReturnType<typeof vi.fn>;
let fail: boolean;
let delay: (() => void) | undefined;

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  requests = [];
  push = vi.fn();
  fail = false;
  delay = undefined;
  Object.assign(vi.spyOn(client, "api" as never), { combat: testApi.combat });
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push } as never);
  vi.spyOn(Avatar, "default").mockImplementation(() => <span>Avatar</span>);
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
});

const row = (id: number): Row => ({
  id,
  createdAt: new Date("2026-01-01T12:00:00.123Z"),
  battleId: `battle-${id}`,
  attackedId: "deleted",
  defenderId: "actor",
  battleType: "COMBAT",
  // A deleted relation is null at runtime despite Drizzle inferring a required attacker.
  attacker: null as unknown as Row["attacker"],
  defender: { userId: "actor", username: "Actor", avatar: null },
});

const mount = (props: Parameters<typeof BattleHistoryTable>[0] = {}) => {
  const trpcClient = fakeTrpcClient(async (_path, request) => {
    const input = request as Input;
    requests.push(input);
    if (fail) throw new Error("Connection failed");
    if (input.cursor)
      await new Promise<void>((resolve) => {
        delay = resolve;
      });
    const data = input.cursor ? [row(1)] : [row(3), row(2)];
    return {
      data,
      nextCursor: input.cursor ? undefined : { createdAt: data[1]!.createdAt, id: 2 },
    };
  });
  const screen = (current: typeof props) => (
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      <BattleHistoryTable {...current} />
    </TrpcTestProviders>
  );
  const view = render(screen(props));
  return { ...view, change: (current: typeof props) => view.rerender(screen(current)) };
};

it("fetches older rows only on demand, keeps links, and disables repeated requests while loading", async () => {
  const view = mount({ userId: "profile", combatTypes: ["RANKED_PVP"] });
  fireEvent.click(await view.findByText("battle-3"));
  expect(push).toHaveBeenCalledWith("/battlelog/battle-3");
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    userId: "profile",
    combatTypes: ["RANKED_PVP"],
    limit: 20,
  });
  fireEvent.click(view.getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(
    view.getByRole("button", { name: "Loading battles..." }).hasAttribute("disabled"),
  ).toBe(true);
  expect(requests[1]?.cursor).toEqual({ createdAt: row(2).createdAt, id: 2 });
  delay!();
  await view.findByText("battle-1");
  expect(view.getAllByRole("row")).toHaveLength(4);
  expect(view.queryByRole("button", { name: "Load more" })).toBeNull();
});

it("retains loaded rows on a failed next page and recovers through retry", async () => {
  const view = mount({ secondsBack: 10800 });
  await view.findByText("battle-3");
  fail = true;
  fireEvent.click(view.getByRole("button", { name: "Load more" }));
  expect((await view.findByRole("alert")).textContent).toContain("Connection failed");
  expect(view.getByText("battle-3")).toBeTruthy();
  fail = false;
  fireEvent.click(view.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(delay).toBeDefined());
  delay!();
  await view.findByText("battle-1");
  expect(view.queryByRole("alert")).toBeNull();
  expect(requests.every((input) => input.secondsBack === 10800)).toBe(true);
});

it("recovers from an initial error without showing an empty-history success state", async () => {
  fail = true;
  const view = mount();
  await view.findByRole("alert");
  expect(view.queryByText("No combat history found")).toBeNull();
  fail = false;
  fireEvent.click(view.getByRole("button", { name: "Try again" }));
  await view.findByText("battle-3");
  expect(view.queryByRole("alert")).toBeNull();
});

it("does not fetch inactive tabs and resets the cursor when the user or type changes", async () => {
  const view = mount({ userId: "one", enabled: false });
  expect(requests).toHaveLength(0);
  view.change({ userId: "one", enabled: true });
  await view.findByText("battle-3");
  fireEvent.click(view.getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(delay).toBeDefined());
  delay!();
  await view.findByText("battle-1");
  view.change({ userId: "one", combatTypes: ["ARENA"], showBattleType: true });
  await waitFor(() => expect(requests).toHaveLength(3));
  expect(requests[2]?.cursor).toBeUndefined();
  expect(requests[2]?.combatTypes).toEqual(["ARENA"]);
  await waitFor(() => expect(view.getAllByText("Combat")).toHaveLength(2));
  view.change({ userId: "two" });
  await view.findByText("battle-3");
  expect(requests.at(-1)?.userId).toBe("two");
  expect(requests.at(-1)?.cursor).toBeUndefined();
  expect(view.queryByText("battle-1")).toBeNull();
});
