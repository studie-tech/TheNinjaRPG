import { afterEach, beforeEach, expect, it, setSystemTime, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import * as client from "@/app/_trpc/client";
import * as Image from "@/layout/Image";
import * as modal from "@/layout/Modal";
import { SurroundingUsers } from "@/layout/SurroundingUsers";
import { calcLevelRequirements } from "@/libs/profile";
import type { SectorUser } from "@/libs/sector-map/world-types";
import * as toast from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../setup/trpc";
import { mockUserContextValue } from "../setup/userContext";

const viewer = {
  userId: "viewer",
  villageId: "home",
  status: "AWAKE",
  rank: "JONIN",
  isOutlaw: true,
  village: {
    id: "home",
    relationshipA: [{ villageIdA: "home", villageIdB: "friend", status: "ALLY" }],
    relationshipB: [],
  },
} as unknown as NonNullable<UserWithRelations>;
const player = (username: string, patch: Partial<SectorUser> = {}) =>
  ({
    userId: username,
    username,
    villageId: "foe",
    rank: "JONIN",
    experience: calcLevelRequirements(50),
    level: 50,
    latitude: 1,
    longitude: 1,
    status: "AWAKE",
    curHealth: 50,
    maxHealth: 100,
    avatar: null,
    ...patch,
  }) as SectorUser;
const attack = vi.fn();
const rob = vi.fn();
const move = vi.fn();
let queryClient: QueryClient;
beforeEach(() => {
  vi.spyOn(modal, "default").mockImplementation(({ children }) => <>{children}</>);
  vi.spyOn(Image, "default").mockImplementation(({ alt, src, ...props }) => (
    // biome-ignore lint/performance/noImgElement: isolated scouting image fixture
    <img {...props} alt={alt} src={typeof src === "string" ? src : undefined} />
  ));
  Object.assign(vi.spyOn(client, "api" as never), {
    village: testApi.village,
    hospital: testApi.hospital,
    useUtils: testApi.useUtils,
  });
  mockUserContextValue({
    data: viewer,
    timeDiff: 0,
    prepareUserUpdate: vi.fn(),
    updateUser: vi.fn(),
  });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  setSystemTime();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
const setup = (users: SectorUser[]) => {
  const Harness = ({ roster }: { roster: SectorUser[] }) => {
    const [brackets, setBrackets] = useState<number[] | null>(null);
    const [excludeAllies, setExcludeAllies] = useState(true);
    const [allyAttack, setAllyAttack] = useState(false);
    return (
      <SurroundingUsers
        userData={viewer}
        hex={{ col: 1, row: 1 } as never}
        users={roster}
        setIsOpen={vi.fn()}
        storedBrackets={brackets}
        setStoredBrackets={setBrackets}
        excludeAllies={excludeAllies}
        setExcludeAllies={setExcludeAllies}
        allyAttack={allyAttack}
        setAllyAttack={setAllyAttack}
        wars={[]}
        attackUser={attack}
        robUser={rob}
        move={move}
      />
    );
  };
  const trpcClient = fakeTrpcClient(() => []);
  const content = (roster: SectorUser[]) => (
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      <Harness roster={roster} />
    </TrpcTestProviders>
  );
  const view = render(content(users));
  return {
    ...view,
    updateRoster: (roster: SectorUser[]) => view.rerender(content(roster)),
  };
};

it("combines multiple brackets, supports an empty selection and All, and keeps unknown XP out of focused results", () => {
  setup([
    player("Low", { experience: 0 }),
    player("Elite", { rank: "ELITE JONIN" }),
    player("Unknown", { experience: undefined }),
  ]);
  expect(
    screen
      .getAllByRole("button", { pressed: true })
      .map((button) => button.textContent),
  ).toEqual(["All"]);
  fireEvent.click(screen.getByRole("button", { name: "Bracket 1" }));
  expect(
    screen
      .getAllByRole("button", { pressed: true })
      .map((button) => button.textContent),
  ).toEqual(["1"]);
  expect(screen.getByRole("list").textContent).toContain("Low");
  expect(screen.getByRole("list").textContent).not.toContain("Elite");
  fireEvent.click(screen.getByRole("button", { name: "Bracket 8" }));
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Bracket 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Bracket 8" }));
  expect(screen.getByText(/No awake users match/)).toBeTruthy();
  expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "All" }));
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
  expect(
    screen
      .getAllByRole("button", { pressed: true })
      .map((button) => button.textContent),
  ).toEqual(["All"]);
});

it("excludes village, diplomatic and war allies while war enemies remain visible, independently of friendly attacks", () => {
  setup([
    player("Home", { villageId: "home" }),
    player("Diplomat", { villageId: "friend" }),
    player("WarAlly", { warRelationship: "ALLY" }),
    player("WarEnemy", { villageId: "home", warRelationship: "ENEMY" }),
  ]);
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  expect(screen.getByRole("list").textContent).toContain("WarEnemy");
  fireEvent.click(screen.getByRole("checkbox", { name: "Attack button on allies" }));
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  fireEvent.click(screen.getByRole("checkbox", { name: "Exclude allies" }));
  expect(screen.getAllByRole("listitem")).toHaveLength(4);
  expect(screen.getByRole("button", { name: "Attack Home" })).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: "Attack button on allies" }));
  expect(screen.queryByRole("button", { name: "Attack Home" })).toBeNull();
});

it("keeps eligible actions and callback targets, guards immune robbery, and masks profile access", () => {
  setup([
    player("Target"),
    player("Distant", { longitude: 2 }),
    player("Masked", { isMasked: true }),
    player("Immune", { robImmunityUntil: new Date(Date.now() + 60_000) }),
    player("Student", { rank: "STUDENT" }),
    player("Banned", { isBanned: true }),
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Attack Target" }));
  expect(attack).toHaveBeenCalledWith("Target");
  fireEvent.click(screen.getByRole("button", { name: "Rob Target" }));
  expect(rob).toHaveBeenCalledWith("Target");
  fireEvent.click(screen.getByRole("button", { name: "Move Distant" }));
  expect(move).toHaveBeenCalledWith(2, 1);
  expect(screen.queryByRole("button", { name: "Attack Distant" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Rob Distant" })).toBeNull();
  expect(
    screen.getByRole("link", { name: "Profile of Target" }).getAttribute("href"),
  ).toBe("/userid/Target");
  expect(screen.queryByRole("link", { name: "Profile of Masked" })).toBeNull();
  expect(
    screen.getByRole("button", { name: "Rob Immune" }).getAttribute("aria-disabled"),
  ).toBe("true");
  expect(screen.queryByRole("button", { name: "Attack Student" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Rob Student" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Attack Banned" })).toBeNull();
  expect(screen.getByRole("button", { name: "Heal Target" })).toBeTruthy();
});

it("updates the visible roster when a player moves or leaves and separates an empty sector from filtered results", () => {
  const view = setup([player("Target")]);
  expect(
    within(screen.getByRole("list")).getByRole("button", { name: "Attack Target" }),
  ).toBeTruthy();
  view.updateRoster([player("Target", { longitude: 2 })]);
  expect(screen.queryByRole("button", { name: "Attack Target" })).toBeNull();
  expect(screen.getByRole("button", { name: "Move Target" })).toBeTruthy();
  view.updateRoster([]);
  expect(screen.getByText("No awake users in this sector")).toBeTruthy();
});

it("checks robbery immunity at click time so an expired deadline never blocks the action", () => {
  const feedback = vi
    .spyOn(toast, "showMutationToast")
    .mockImplementation(() => undefined);
  const expiry = Date.now() + 10_000;
  setup([player("Immune", { robImmunityUntil: new Date(expiry) })]);
  fireEvent.click(screen.getByRole("button", { name: "Rob Immune" }));
  expect(rob).not.toHaveBeenCalled();
  expect(feedback).toHaveBeenCalledWith({
    success: false,
    message: "Target is immune from being robbed",
  });
  vi.useFakeTimers();
  setSystemTime(expiry + 1);
  fireEvent.click(screen.getByRole("button", { name: "Rob Immune" }));
  expect(rob).toHaveBeenCalledWith("Immune");
});
