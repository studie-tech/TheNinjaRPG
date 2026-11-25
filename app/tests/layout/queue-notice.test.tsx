import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { RouterOutputs } from "@/app/_trpc/client";
import * as client from "@/app/_trpc/client";
import * as queueCount from "@/hooks/useRankedQueueCount";
import * as Link from "@/layout/Link";
import { QueueNotice } from "@/layout/QueueNotice";
import type { QueuedActivity } from "@/libs/queuedActivity";
import * as toast from "@/libs/toast";
import { mockUserContextValue } from "../setup/userContext";

const leave = {
  raid: vi.fn(),
  shrine: vi.fn(),
  clan: vi.fn(),
  territory: vi.fn(),
  ranked: vi.fn(),
};
let activity: QueuedActivity;
let status: string;
let rankedOptions: {
  onSuccess: (
    data: RouterOutputs["pvpRank"]["leaveRankedPvpQueue"],
    input: undefined,
    revision: number,
  ) => Promise<void>;
  onError: (error: unknown, input: undefined, revision: number) => void;
  onSettled: (data: { success: boolean } | undefined) => void;
};
const updateUser = vi.fn(async () => true);
const refreshRankedQueueCount = vi.fn(async () => true);
const refreshRankedQueue = vi.fn();
const refreshActivity = vi.fn();
type ReadOptions = {
  refetchInterval: (query: { state: { data: QueuedActivity } }) => number | false;
};
const read = vi.fn((_input: undefined, _options: ReadOptions) => ({ data: activity }));

beforeEach(() => {
  status = "QUEUED";
  for (const mock of [
    ...Object.values(leave),
    read,
    updateUser,
    refreshRankedQueueCount,
    refreshRankedQueue,
    refreshActivity,
  ])
    mock.mockClear();
  vi.spyOn(queueCount, "useRankedQueueCountCache").mockReturnValue({
    refreshRankedQueueCount,
  });
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined as never);
  vi.spyOn(Link, "default").mockImplementation((({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>) as never);
  mockUserContextValue(
    () =>
      ({
        data: { userId: "player", status },
        prepareUserUpdate: () => 7,
        updateUser,
      }) as never,
  );
  const mutation = (mutate: () => void) => ({
    useMutation: () => ({ mutate, isPending: false }),
  });
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      pvpRank: { getRankedPvpQueue: { invalidate: refreshRankedQueue } },
      raids: { getQueuedActivity: { invalidate: refreshActivity } },
    }),
    raids: {
      getQueuedActivity: { useQuery: read },
      leaveRaidQueue: mutation(leave.raid),
    },
    shrine: { leaveShrineBattle: mutation(leave.shrine) },
    clan: { leaveClanBattle: mutation(leave.clan) },
    territoryWar: { leaveTeam: mutation(leave.territory) },
    pvpRank: {
      leaveRankedPvpQueue: {
        useMutation: (options: typeof rankedOptions) => {
          rankedOptions = options;
          return { mutate: leave.ranked, isPending: false };
        },
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("queue notice", () => {
  it("stays out of the page, without a read, unless the player is queued", () => {
    status = "AWAKE";
    const view = render(<QueueNotice />);
    expect(view.container.textContent).toBe("");
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "RAID", sector: 7 }, "raid", "/travel", []],
    [
      { kind: "SHRINE", lobbyId: "l", sector: 7 },
      "shrine",
      "/shrine",
      [{ shrineBattleId: "l" }],
    ],
    [{ kind: "CLAN", lobbyId: "l" }, "clan", "/clanhall", [{ clanBattleId: "l" }]],
    [
      { kind: "TERRITORY", lobbyId: "l" },
      "territory",
      "/territory-war",
      [{ teamId: "l" }],
    ],
    [{ kind: "RANKED" }, "ranked", "/battlearena#PVP%20Rank", []],
  ] as const)("links %j and leaves it", (queued, exit, href, input) => {
    activity = queued;
    const view = render(<QueueNotice />);
    expect(view.getByRole("link").getAttribute("href")).toBe(href);
    fireEvent.click(view.getByRole("button", { name: "Leave queue" }));
    for (const [kind, mock] of Object.entries(leave))
      expect(mock).toHaveBeenCalledTimes(kind === exit ? 1 : 0);
    expect(leave[exit].mock.calls[0]).toEqual([...input]);
  });

  it.each([
    ["DUNGEON", "/dungeon"],
    ["CARAVAN", "/warehouse"],
  ] as const)("only links a %s, which has its own rules for leaving", (kind, href) => {
    activity = { kind };
    const view = render(<QueueNotice />);
    expect(view.getByRole("link").getAttribute("href")).toBe(href);
    expect(view.queryByRole("button")).toBeNull();
  });

  it("uses the confirmed ranked exit patch and shared count reconciliation", async () => {
    activity = { kind: "RANKED" };
    render(<QueueNotice />);
    const result = {
      success: true,
      message: "Left ranked PvP queue",
      userPatch: { status: "AWAKE" as const },
    };
    await rankedOptions.onSuccess(result, undefined, 7);
    expect(updateUser).toHaveBeenCalledWith(result, { revision: 7 });
    expect(refreshRankedQueue).toHaveBeenCalledTimes(1);
    expect(refreshRankedQueueCount).toHaveBeenCalledTimes(1);
  });

  it("reconciles an unconfirmed ranked exit against the captured profile", () => {
    activity = { kind: "RANKED" };
    render(<QueueNotice />);
    rankedOptions.onError(new Error("Connection lost"), undefined, 7);
    rankedOptions.onSettled(undefined);
    expect(updateUser).toHaveBeenCalledWith(undefined, { revision: 7 });
    expect(refreshActivity).toHaveBeenCalledTimes(1);
  });

  it("waits for details while the queued activity is unknown", () => {
    activity = { kind: "UNKNOWN" };
    const view = render(<QueueNotice />);
    expect(view.getByText("Waiting for queue details...")).toBeTruthy();
    expect(view.queryByRole("button")).toBeNull();
    // A seat stored just after the status claim must replace this text with its exit.
    const interval = read.mock.calls[0]![1].refetchInterval;
    expect(interval({ state: { data: { kind: "UNKNOWN" } } })).toBeGreaterThan(0);
    expect(interval({ state: { data: { kind: "RANKED" } } })).toBe(false);
  });
});
