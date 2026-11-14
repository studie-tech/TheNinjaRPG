import { expect, it } from "bun:test";
import type { RouterOutputs } from "@/app/_trpc/client";
import { addSectorArrivals } from "@/deltas/travel";

type SectorData = RouterOutputs["travel"]["getSectorData"];
type SectorUsers = RouterOutputs["travel"]["getSectorUsers"];

const row = (userId: string, longitude: number, latitude: number) =>
  ({ userId, username: userId, longitude, latitude, sector: 7 }) as SectorUsers[number];
const snapshot = (users: SectorUsers) =>
  ({ users, warData: [], sectorData: { sector: 7 }, overworldAis: [] }) as SectorData;

it("adds arrivals once and carries the live positions of players already shown", () => {
  const walker = row("walker", 1, 1);
  const idle = row("idle", 4, 4);
  const current = snapshot([walker, idle]);
  const positions = new Map([
    ["walker", { longitude: 3, latitude: 2 }],
    ["idle", { longitude: 4, latitude: 4 }],
  ]);
  const newcomer = row("newcomer", 9, 9);
  const next = addSectorArrivals(current, [newcomer, row("walker", 0, 0)], positions);
  expect(next.users.map((user) => user.userId)).toEqual(["walker", "idle", "newcomer"]);
  expect(next.users[0]).toMatchObject({ longitude: 3, latitude: 2 });
  expect(next.users[1]).toBe(idle);
  expect(next.users[2]).toBe(newcomer);
  expect(next.overworldAis).toBe(current.overworldAis);
});

it("leaves the snapshot untouched when every arrival is already shown or it is empty", () => {
  const current = snapshot([row("shown", 1, 1)]);
  expect(addSectorArrivals(current, [row("shown", 2, 2)], new Map())).toBe(current);
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
