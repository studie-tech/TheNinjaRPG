import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import { MAX_PVP_BRACKET } from "@/drizzle/constants";
import * as Avatar from "@/layout/Avatar";
import { TravelUserCard } from "@/layout/TravelUserCard";
import { calcLevelRequirements, getKnownExpBracket } from "@/libs/profile";
import type { SectorUser } from "@/libs/sector-map/world-types";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../setup/trpc";

let queryClient: QueryClient;
let requests: string[];

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  requests = [];
  Object.assign(vi.spyOn(client, "api" as never), { village: testApi.village });
  vi.spyOn(Avatar, "default").mockImplementation(({ href }) => (
    <span>avatar:{href}</span>
  ));
});

afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  restoreBrowserGlobals();
  queryClient.clear();
  vi.restoreAllMocks();
});

/** Cumulative experience the map's effective-level reading turns into level 45. */
const experience = calcLevelRequirements(45);
const user = (patch: Partial<SectorUser> = {}): SectorUser =>
  ({
    userId: "target",
    username: "Kakashi",
    status: "AWAKE",
    rank: "JONIN",
    isOutlaw: false,
    level: 45,
    experience,
    curHealth: 62,
    maxHealth: 100,
    villageId: "leaf",
    allianceStatus: "NEUTRAL",
    warRelationship: null,
    avatar: "full.webp",
    avatarLight: "light.webp",
    ...patch,
  }) as SectorUser;

const mount = (target: SectorUser, onClose = vi.fn()) => {
  const trpcClient = fakeTrpcClient(async (path) => {
    requests.push(path);
    return [{ id: "leaf", name: "Akikaze", hexColor: "#123456" }];
  });
  const view = render(
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      <TravelUserCard user={target} anchor={{ x: 200, y: 200 }} onClose={onClose} />
    </TrpcTestProviders>,
  );
  return { ...view, onClose };
};

it("summarizes the tapped player from the sector snapshot and links to their full profile", async () => {
  const view = mount(user());
  expect(view.getByText("Kakashi")).toBeTruthy();
  expect(view.getByText("Lvl. 45 Jonin")).toBeTruthy();
  expect(view.getByText("avatar:light.webp")).toBeTruthy();
  expect(view.getByText("Neutral")).toBeTruthy();
  expect(view.getByText("HP (62 / 100)")).toBeTruthy();
  expect(
    view.getByText(`${getKnownExpBracket(user())}/${MAX_PVP_BRACKET}`),
  ).toBeTruthy();
  expect(
    view.getByRole("link", { name: /View full profile/ }).getAttribute("href"),
  ).toBe("/userid/target");
  expect(await view.findByText("Akikaze")).toBeTruthy();
  // Villages are the only request; everything else comes from the map snapshot.
  expect(requests).toEqual(["village.getAll"]);
});

it.each([
  [{ warRelationship: "ENEMY" as const, allianceStatus: "ALLY" as const }, "At war"],
  [{ warRelationship: "ALLY" as const }, "War ally"],
  [{ allianceStatus: "ALLY" as const }, "Ally"],
  [{ allianceStatus: "ENEMY" as const }, "Enemy"],
])("labels standing %p as %s, with war sides first", (patch, label) => {
  expect(mount(user(patch)).getByText(label)).toBeTruthy();
});

it("shows unknown levels like the scouting list and flags players who are not awake", () => {
  const view = mount(user({ experience: undefined, status: "HOSPITALIZED" }));
  expect(view.getByText("Lvl. ? Jonin")).toBeTruthy();
  expect(view.getByText("?")).toBeTruthy();
  expect(view.getByText("hospitalized")).toBeTruthy();
});

it("leaves focus outside the card, so the HP tooltip trigger is not ringed, and closes on Escape", () => {
  const view = mount(user());
  expect(view.getByRole("dialog").contains(document.activeElement)).toBe(false);
  fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" });
  expect(view.onClose).toHaveBeenCalledTimes(1);
});
