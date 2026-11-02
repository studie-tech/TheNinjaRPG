import { describe, expect, it } from "bun:test";
import { shareUserCache } from "@/utils/userCacheSharing";

describe("profile cache structural sharing", () => {
  it("shares equal nested Dates and arrays while replacing a changed sibling without mutating snapshots", () => {
    const previous = Object.freeze({ position: 1, data: Object.freeze([{ at: new Date(1000) }]) });
    const next = Object.freeze({ position: 2, data: Object.freeze([{ at: new Date(1000) }]) });
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
    [[1, 2], [2, 1]],
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
