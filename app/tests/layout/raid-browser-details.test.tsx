import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import * as ActiveTimedBuffs from "@/layout/ActiveTimedBuffs";
import * as Avatar from "@/layout/Avatar";
import * as ContentBox from "@/layout/ContentBox";
import RaidBrowser from "@/layout/RaidBrowser";
import * as TeamChatPanel from "@/layout/TeamChatPanel";
import { mockUserContextValue } from "../setup/userContext";

const settled = async (): Promise<void> => undefined;
const claim = vi.fn();
let claimPending = false;
let participation:
  | { damageDealt: number; battleCount: number; rewardsClaimed: string[] }
  | undefined;

const thresholds = [
  { id: "t1", damageRequired: 100, rewards: { reward_money: 50 } },
  { id: "t2", damageRequired: 500, rewards: { reward_money: 100 } },
  { id: "t3", damageRequired: 2000, rewards: {} },
];
const participations = [
  {
    id: "p1",
    rank: 1,
    damageDealt: 12345,
    user: { username: "Top", avatar: "https://example.com/top.png" },
  },
  { id: "p2", rank: 2, damageDealt: 678, user: null },
];

beforeEach(() => {
  claim.mockClear();
  claimPending = false;
  participation = { damageDealt: 600, battleCount: 3, rewardsClaimed: ["t1"] };
  vi.spyOn(ContentBox, "default").mockImplementation(({ title, children }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ));
  vi.spyOn(ActiveTimedBuffs, "ActiveTimedBuffs").mockImplementation(() => null);
  vi.spyOn(TeamChatPanel, "TeamChatPanel").mockImplementation(() => null);
  vi.spyOn(Avatar, "default").mockImplementation(({ alt }) => <img alt={alt} />);
  mockUserContextValue({
    data: { userId: "actor", sector: 5, isBanned: false },
    pusher: undefined,
    prepareUserUpdate: () => undefined,
    updateUser: settled,
  } as never);
  const query = (data: unknown) => ({ useQuery: () => ({ data, isFetching: false }) });
  const mutation = () => ({
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  });
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ raids: {}, profile: {} }),
    raids: {
      getAvailableRaids: query({ raids: [{ id: "raid-1", name: "Boss Raid" }] }),
      getCompletedRaids: query({ raids: [] }),
      getUserRaidQueue: query({ inQueue: false }),
      getRaidDetails: {
        useQuery: () => ({
          data: {
            raid: {
              name: "Boss Raid",
              raidType: "open",
              raidBossCurrentHealth: 900,
              raidBossMaxHealth: 1000,
              raidEndsAt: null,
              raidSector: 5,
              raidChatConversationId: null,
            },
            participation,
            thresholds,
          },
        }),
      },
      getRaidLeaderboard: query({ participations }),
      getActiveRaidTeams: query({ teams: [], maxTeams: 3 }),
      joinRaidQueue: mutation(),
      leaveRaidQueue: mutation(),
      startRaidBattle: mutation(),
      readyToQueue: mutation(),
      claimDamageReward: {
        useMutation: () => ({ mutate: claim, isPending: claimPending }),
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const section = (view: ReturnType<typeof render>, heading: string) =>
  view.getByText(heading).closest("div.rounded-lg") as HTMLElement;

describe("raid details", () => {
  it("lists damage thresholds by claim state and claims a met tier", () => {
    const view = render(<RaidBrowser sectorFilter={5} />);
    const tiers = [
      ...section(view, "Damage Thresholds").querySelectorAll(".space-y-2 > div"),
    ];
    expect(tiers.map((tier) => tier.className)).toEqual([
      "rounded border p-3 text-sm border-transparent",
      "rounded border p-3 text-sm border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20",
      "rounded border p-3 text-sm border-transparent",
    ]);
    expect(tiers.map((tier) => tier.textContent)).toEqual([
      "Tier 1: 100 damage50 ryoClaimed",
      "Tier 2: 500 damage100 ryoClaim",
      "Tier 3: 2,000 damage1,400 more",
    ]);
    expect(
      tiers.map((tier) => tier.querySelector("span.font-medium")?.className),
    ).toEqual([
      "font-medium text-green-600 dark:text-green-400",
      "font-medium text-green-600 dark:text-green-400",
      "font-medium ",
    ]);
    fireEvent.click(view.getByRole("button", { name: "Claim" }));
    expect(claim).toHaveBeenCalledWith({ questId: "raid-1", thresholdId: "t2" });
  });

  it("disables claiming while a claim is pending and counts everything as remaining without participation", () => {
    claimPending = true;
    const view = render(<RaidBrowser sectorFilter={5} />);
    const pending = view.getByRole("button", {
      name: "Claiming...",
    }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    cleanup();
    participation = undefined;
    const fresh = render(<RaidBrowser sectorFilter={5} />);
    expect(
      [...section(fresh, "Damage Thresholds").querySelectorAll(".space-y-2 > div")].map(
        (tier) => tier.textContent,
      ),
    ).toEqual([
      "Tier 1: 100 damage50 ryo100 more",
      "Tier 2: 500 damage100 ryo500 more",
      "Tier 3: 2,000 damage2,000 more",
    ]);
  });

  it("ranks the damage leaderboard and names deleted users", () => {
    const view = render(<RaidBrowser sectorFilter={5} />);
    const rows = [
      ...section(view, "Damage Leaderboard").querySelectorAll(".space-y-2 > div"),
    ];
    expect(rows.map((row) => row.textContent)).toEqual([
      "1Top12,345",
      "2Deleted User678",
    ]);
    expect(rows.map((row) => row.querySelector("img")?.getAttribute("alt"))).toEqual([
      "Top",
      "Deleted User",
    ]);
  });
});
