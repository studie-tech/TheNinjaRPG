import { expect, it } from "bun:test";
import type { RouterOutputs } from "@/app/_trpc/client";
import { addSectorArrivals, getSectorPresenceUpdate } from "@/deltas/travel";
import type { SectorUser } from "@/libs/sector-map/world-types";

type SectorData = RouterOutputs["travel"]["getSectorData"];
type SectorUsers = RouterOutputs["travel"]["getSectorUsers"];

const row = (userId: string, longitude: number, latitude: number) =>
  ({ userId, username: userId, longitude, latitude, sector: 7 }) as SectorUsers[number];
const snapshot = (users: SectorUsers) =>
  ({
    users,
    warData: [],
    sectorData: { sector: 7 },
    overworldAis: [],
  }) as unknown as SectorData;

it("adds arrivals, replaces returning players' stale rows and keeps others' live positions", () => {
  const walker = row("walker", 1, 1);
  const idle = row("idle", 4, 4);
  const returning = row("returning", 2, 2);
  const current = snapshot([walker, idle, returning, row("departed", 3, 3)]);
  const positions = new Map([
    [
      "walker",
      { ...walker, longitude: 3, latitude: 2, allianceStatus: "NEUTRAL" as const },
    ],
    ["idle", { ...idle, allianceStatus: "NEUTRAL" as const }],
  ]);
  const newcomer = row("newcomer", 9, 9);
  const back = row("returning", 6, 5);
  const next = addSectorArrivals(current, [newcomer, back], positions);
  expect(next.users.map((user) => user.userId)).toEqual([
    "walker",
    "idle",
    "returning",
    "newcomer",
  ]);
  expect(next.users[0]).toMatchObject({ longitude: 3, latitude: 2 });
  expect(next.users[1]).toEqual(idle);
  expect(next.users[2]).toBe(back);
  expect(next.users[3]).toBe(newcomer);
  expect(next.overworldAis).toBe(current.overworldAis);
});

it.each([
  { status: "BATTLE" as const, battleId: "live-battle" },
  { status: "AWAKE" as const, battleId: null },
])("keeps other players' live presence when a newcomer arrives ($status)", (combat) => {
  const current = snapshot([
    {
      ...row("shown", 1, 1),
      status: combat.status === "BATTLE" ? "AWAKE" : "BATTLE",
      battleId: "stale-battle",
      curHealth: 20,
      maxHealth: 100,
      username: "ANBU",
      avatar: "mask.webp",
      isMasked: true,
      warRelationship: "ENEMY",
    },
  ]);
  const live = {
    ...current.users[0],
    ...combat,
    longitude: 3,
    latitude: 2,
    location: "Village",
    villageId: "village",
    curHealth: 100,
    maxHealth: 120,
    level: 51,
    experience: 200,
    rank: "JONIN",
    username: "Unmasked name",
    avatar: "unmasked.webp",
    isMasked: false,
    warRelationship: "ALLY",
  } as SectorUser;
  const next = addSectorArrivals(
    current,
    [row("newcomer", 9, 9)],
    new Map([["shown", live]]),
  );
  expect(next.users[0]).toMatchObject({
    ...combat,
    longitude: 3,
    latitude: 2,
    location: "Village",
    villageId: "village",
    curHealth: 100,
    maxHealth: 120,
    level: 51,
    experience: 200,
    rank: "JONIN",
    username: "ANBU",
    avatar: "mask.webp",
    isMasked: true,
    warRelationship: "ENEMY",
  });
  expect(current.users[0]?.curHealth).toBe(20);
});

it("projects defined presence fields, retaining explicit null and zero without identity changes", () => {
  expect(
    getSectorPresenceUpdate({
      ...row("shown", 0, 0),
      curHealth: 0,
      maxHealth: undefined,
      battleId: null,
      location: null,
      experience: undefined,
      username: "Unmasked name",
      avatar: "unmasked.webp",
      warRelationship: "ALLY",
    }),
  ).toEqual({
    longitude: 0,
    latitude: 0,
    sector: 7,
    curHealth: 0,
    battleId: null,
    location: null,
  });
});

it("leaves the snapshot untouched without arrivals or when the viewer cannot scout", () => {
  const current = snapshot([row("shown", 1, 1)]);
  expect(addSectorArrivals(current, [], new Map())).toBe(current);
  const guarded = {
    users: [],
    village: null,
    sectorData: null,
    warData: null,
    overworldAis: [],
    questPlacements: [],
  } as SectorData;
  expect(addSectorArrivals(guarded, [row("newcomer", 1, 1)], new Map())).toBe(guarded);
});
