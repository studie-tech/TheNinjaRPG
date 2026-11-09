import { describe, expect, it } from "bun:test";
import { shareUserCache, withoutUserPosition } from "@/utils/userCacheSharing";

describe("profile cache structural sharing", () => {
  it("shares equal nested Dates and arrays while replacing a changed sibling without mutating snapshots", () => {
    const previous = Object.freeze({
      position: 1,
      data: Object.freeze([{ at: new Date(1000) }]),
    });
    const next = Object.freeze({
      position: 2,
      data: Object.freeze([{ at: new Date(1000) }]),
    });
    const shared = shareUserCache(previous, next) as typeof next;
    expect(shared).not.toBe(previous);
    expect(shared.position).toBe(2);
    expect(shared.data).toBe(previous.data);
    expect(next.data).not.toBe(previous.data);
    expect(previous.position).toBe(1);
  });
  it("reuses equal Dates throughout arrays and records without mutating either snapshot", () => {
    const previous = Object.freeze({
      users: Object.freeze([Object.freeze({ at: new Date(1000), value: 1 })]),
    });
    const next = Object.freeze({
      users: Object.freeze([Object.freeze({ at: new Date(1000), value: 1 })]),
    });
    expect(shareUserCache(previous, next)).toBe(previous);
    expect(previous.users[0]!.at.getTime()).toBe(1000);
    expect(next.users[0]!.at).not.toBe(previous.users[0]!.at);
  });

  it.each([
    [{ removed: undefined }, { added: undefined }],
    [{ removed: undefined }, {}],
    [{}, { added: undefined }],
    [
      [1, 2],
      [2, 1],
    ],
    [[1, 2], [1]],
    [[1], [1, undefined]],
    [null, { at: new Date(1000) }],
    [new Date(1000), 1000],
    [1000, new Date(1000)],
    [new Date(1000), new Date(1001)],
  ])("retains changed values and key presence: %j -> %j", (previous, next) => {
    expect(shareUserCache(previous, next)).toEqual(next);
    expect(shareUserCache(previous, next)).not.toBe(previous);
  });

  it("does not treat other SuperJSON object types as empty equal records", () => {
    const next = new Map([["a", 2]]);
    expect(shareUserCache(new Map([["a", 1]]), next)).toBe(next);
    const sparse = new Array(2);
    expect(shareUserCache([undefined, undefined], sparse)).toBe(sparse);
  });

  it("preserves own __proto__ fields without changing the resulting prototype", () => {
    const previous = JSON.parse('{"__proto__":{"at":1},"value":1}');
    const next = JSON.parse('{"__proto__":{"at":2},"value":1}');
    const shared = shareUserCache(previous, next) as object;
    expect(shared).toEqual(next);
    expect(Object.getPrototypeOf(shared)).toBe(Object.prototype);
    expect(Object.hasOwn(shared, "__proto__")).toBe(true);
  });
});

describe("position-independent profile views", () => {
  const profile = () => ({
    userId: "viewer",
    username: "Ninja",
    sector: 724,
    longitude: 10,
    latitude: 7,
    location: "Village",
    updatedAt: new Date(1000),
    training: { startedAt: new Date(500), queue: ["Wind"] },
  });

  it("carries one immutable view through successive movement snapshots and equal decoded Dates", () => {
    const initial = profile();
    const selected = withoutUserPosition(initial);
    expect(withoutUserPosition(initial)).toBe(selected);
    let current = initial;
    for (const longitude of [11, 12, 13]) {
      const next = {
        ...profile(),
        longitude,
        latitude: 8,
        location: "Forest",
        updatedAt: new Date(2000 + longitude),
      };
      current = shareUserCache(current, next) as typeof current;
      expect(current.longitude).toBe(longitude);
      expect(current.training).toBe(initial.training);
      expect(withoutUserPosition(current)).toBe(selected);
      expect(next.training).not.toBe(initial.training);
    }
    expect(selected).toEqual({
      userId: "viewer",
      username: "Ninja",
      sector: 724,
      training: initial.training,
    });
    expect(initial.longitude).toBe(10);
    expect(initial.updatedAt.getTime()).toBe(1000);
    expect(
      Object.keys(selected).some((key) =>
        ["longitude", "latitude", "location", "updatedAt"].includes(key),
      ),
    ).toBe(false);
  });

  it.each([
    { username: "Renamed" },
    { sector: 725 },
    { training: { startedAt: new Date(501), queue: ["Wind"] } },
    { training: { startedAt: new Date(500), queue: ["Fire"] } },
    { userId: "another-account" },
    { extra: undefined },
  ])("publishes changed non-position fields: %j", (patch) => {
    const previous = profile();
    const selected = withoutUserPosition(previous);
    const next = { ...profile(), ...patch, longitude: 11 };
    const shared = shareUserCache(previous, next) as typeof next;
    const result = withoutUserPosition(shared);
    expect(result).not.toBe(selected);
    const { longitude, latitude, location, updatedAt, ...expected } = next;
    expect(result).toEqual(expected);
    expect(withoutUserPosition(shared)).toBe(result);
  });

  it("does not carry a removed or renamed own property into a new view", () => {
    const previous = { ...profile(), removed: undefined };
    const selected = withoutUserPosition(previous);
    for (const next of [profile(), { ...profile(), added: undefined }]) {
      const shared = shareUserCache(previous, next) as typeof next;
      const result = withoutUserPosition(shared);
      expect(result).not.toBe(selected);
      expect(Object.hasOwn(result, "removed")).toBe(false);
      expect(Object.hasOwn(result, "added")).toBe(Object.hasOwn(next, "added"));
    }
  });

  it("retains the view through an enclosing cache snapshot and replaces it after profile removal", () => {
    const previous = { userData: profile() };
    const selected = withoutUserPosition(previous.userData);
    const moved = shareUserCache(previous, {
      userData: { ...profile(), longitude: 11 },
    }) as typeof previous;
    expect(withoutUserPosition(moved.userData)).toBe(selected);
    const removed = shareUserCache(moved, { userData: undefined }) as {
      userData: undefined;
    };
    expect(removed.userData).toBeUndefined();
    const replaced = shareUserCache(removed, {
      userData: { ...profile(), userId: "new-account" },
    }) as typeof previous;
    expect(withoutUserPosition(replaced.userData)).not.toBe(selected);
    expect(withoutUserPosition(replaced.userData).userId).toBe("new-account");
  });
});
