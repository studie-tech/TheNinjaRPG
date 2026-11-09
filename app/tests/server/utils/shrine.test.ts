import { describe, expect, it, setSystemTime } from "bun:test";
import {
  SHRINE_BATTLE_LOBBY_SECONDS,
  SHRINE_BATTLE_STALE_LOBBY_SECONDS,
} from "@/drizzle/constants";
import { shrineLobbyFreshAfter } from "@/server/utils/shrine";

describe("shrineLobbyFreshAfter", () => {
  const windowMs =
    (SHRINE_BATTLE_LOBBY_SECONDS + SHRINE_BATTLE_STALE_LOBBY_SECONDS) * 1000;

  it("reaches back one lobby window plus its grace period", () => {
    const now = new Date("2026-03-01T12:00:00.500Z");
    expect(windowMs).toBe(360_000);
    expect(shrineLobbyFreshAfter(now)).toEqual(new Date(now.getTime() - windowMs));
  });

  it("defaults to the current time", () => {
    const now = new Date("2026-03-01T12:00:00.000Z");
    setSystemTime(now);
    expect(shrineLobbyFreshAfter()).toEqual(new Date(now.getTime() - windowMs));
    setSystemTime();
  });
});
