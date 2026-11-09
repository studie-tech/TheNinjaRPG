import { afterEach, beforeEach, expect, it, setSystemTime, vi } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import * as client from "@/app/_trpc/client";
import * as SelectModule from "@/components/ui/select";
import * as navigation from "@/hooks/navigation";
import * as AvatarImage from "@/layout/Avatar";
import * as ContentBox from "@/layout/ContentBox";
import { ClanInfo } from "@/layout/clan/ClanInfo";
import * as UserContext from "@/utils/UserContext";

type ClanData = ComponentProps<typeof ClanInfo>["clanData"];

const nominateElder = vi.fn();
const member = (
  userId: string,
  username: string,
  rank: string,
  anbuId: string | null = null,
) => ({
  userId,
  username,
  rank,
  level: 40,
  avatar: null,
  anbuId,
  isOutlaw: false,
});
const clan = (overrides: Partial<Record<string, unknown>> = {}) =>
  ({
    id: "clan",
    name: "Leaf Clan",
    image: "/clan.webp",
    leaderId: "leader",
    coLeader1: null,
    coLeader2: null,
    coLeader3: null,
    points: 10,
    bank: 0,
    repTreasury: 0,
    pvpActivity: 0,
    elderCutoffMonth: 11,
    elderCutoffYear: 2026,
    elderCutoffRank: 2,
    elderNominee: null,
    founder: null,
    leader: null,
    village: {
      id: "v",
      name: "Konoha",
      type: "VILLAGE",
      sector: 1,
      wasDowngraded: false,
      belowMemberMinimumSince: null,
    },
    members: [
      member("leader", "Leader", "JONIN"),
      member("jonin", "Jonin", "JONIN"),
      member("anbu", "Anbu", "JONIN", "squad"),
      member("genin", "Genin", "GENIN"),
    ],
    ...overrides,
  }) as unknown as ClanData;

beforeEach(() => {
  vi.spyOn(ContentBox, "default").mockImplementation(
    ({ children, topRightContent }) => (
      <div>
        {topRightContent}
        {children}
      </div>
    ),
  );
  nominateElder.mockClear();
  const mutation = (mutate = vi.fn()) => ({
    useMutation: () => ({ mutate, mutateAsync: vi.fn(), isPending: false }),
  });
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    clan: new Proxy(
      { nominateElder: mutation(nominateElder) } as Record<string, unknown>,
      {
        get: (target, key: string) => target[key] ?? mutation(),
      },
    ),
  });
  vi.spyOn(navigation, "useNavigationRouter").mockImplementation(
    () => ({ push: vi.fn() }) as never,
  );
  vi.spyOn(AvatarImage, "default").mockImplementation((() => null) as never);
  vi.spyOn(SelectModule, "Select").mockImplementation((({
    value,
    onValueChange,
    disabled,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <input
      aria-label="Nominee"
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    />
  )) as never);
  vi.spyOn(UserContext, "useRequiredUserData").mockImplementation(
    () =>
      ({
        data: {
          userId: "leader",
          clanId: "clan",
          role: "USER",
          isOutlaw: false,
          money: 0,
          reputationPoints: 0,
          village: null,
        },
        updateUser: vi.fn(),
        prepareUserUpdate: vi.fn(),
      }) as never,
  );
});

afterEach(() => {
  cleanup();
  setSystemTime();
  vi.restoreAllMocks();
});

const section = (view: ReturnType<typeof render>) =>
  view.getByText("Village Elder Nomination").closest("div.rounded-lg") as HTMLElement;

it("lets an eligible leader nominate inside the window", () => {
  setSystemTime(new Date("2026-11-26T12:00:00Z"));
  const view = render(
    <ClanInfo
      clanData={clan({ elderNominee: { userId: "jonin", username: "Jonin" } })}
    />,
  );
  const box = within(section(view));
  expect(box.getByText(/ranked #2 in activity points/)).toBeTruthy();
  expect(box.queryByText(/Nomination window is closed/)).toBeNull();
  expect(box.getByText("Jonin").tagName).toBe("SPAN");
  const select = box.getByRole("textbox", { name: "Nominee" }) as HTMLInputElement;
  expect(select.value).toBe("jonin");
  expect(select.disabled).toBe(false);
  fireEvent.change(select, { target: { value: "leader" } });
  fireEvent.click(box.getByRole("button", { name: "Nominate" }));
  expect(nominateElder).toHaveBeenCalledWith({ clanId: "clan", nomineeId: "leader" });
});

it("explains a closed window and an ineligible clan", () => {
  setSystemTime(new Date("2026-11-10T12:00:00Z"));
  const closed = render(<ClanInfo clanData={clan()} />);
  expect(within(section(closed)).getByText(/Nomination window is closed/)).toBeTruthy();
  expect(
    (
      within(section(closed)).getByRole("textbox", {
        name: "Nominee",
      }) as HTMLInputElement
    ).disabled,
  ).toBe(true);
  expect(
    (
      within(section(closed)).getByRole("button", {
        name: "Nominate",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  cleanup();
  setSystemTime(new Date("2026-11-26T12:00:00Z"));
  const ineligible = render(<ClanInfo clanData={clan({ elderCutoffMonth: 10 })} />);
  expect(
    within(section(ineligible)).getByText(
      /not eligible for elder nomination this month/,
    ),
  ).toBeTruthy();
});

it("hides the nomination from outlaw factions", () => {
  setSystemTime(new Date("2026-11-26T12:00:00Z"));
  vi.spyOn(UserContext, "useRequiredUserData").mockImplementation(
    () =>
      ({
        data: {
          userId: "leader",
          clanId: "clan",
          role: "USER",
          isOutlaw: true,
          money: 0,
          reputationPoints: 0,
          village: null,
        },
        updateUser: vi.fn(),
        prepareUserUpdate: vi.fn(),
      }) as never,
  );
  const view = render(<ClanInfo clanData={clan()} />);
  expect(view.queryByText("Village Elder Nomination")).toBeNull();
});
