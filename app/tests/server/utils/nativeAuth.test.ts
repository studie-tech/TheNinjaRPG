import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Redis } from "@upstash/redis";
import { createNativeAuthStore, nativeAuthChallenge } from "@/server/utils/nativeAuth";
import {
  nativeAuthExchangeSchema,
  nativeAuthStartSchema,
} from "@/validators/nativeAuth";
import { hasLocalRedis, startLocalRedis } from "../../setup/localRedis";

const integration = hasLocalRedis ? describe : describe.skip;

integration("native auth one-use PKCE store (real Redis)", () => {
  let redis: Redis;
  let close: () => void;
  let store: ReturnType<typeof createNativeAuthStore>;

  beforeAll(async () => {
    ({ redis, close } = await startLocalRedis("native-auth"));
    store = createNativeAuthStore(redis);
  });
  afterAll(() => close?.());

  it("binds a flow to its proof, keeps the identity private, and preserves its expiry", async () => {
    const verifier = "v".repeat(43);
    const flow = await store.start("google", nativeAuthChallenge(verifier));
    expect(await store.describe(flow)).toEqual({ provider: "google" });
    expect(await store.redeem(flow, verifier, "z".repeat(43))).toBeNull();
    const code = await store.approve(flow, "user-one");
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await store.approve(flow, "user-one")).toBe(code);
    expect(await store.approve(flow, "user-two")).toBeNull();
    // Knowing the initiating flow and proof is insufficient: approval issues a new code.
    expect(await store.redeem(flow, verifier, "z".repeat(43))).toBeNull();
    const ttl = await redis.ttl(`native-auth:${flow}`);
    expect(ttl).toBeGreaterThan(590);
    expect(ttl).toBeLessThanOrEqual(600);
    expect(await store.redeem(flow, "x".repeat(43), code!)).toBeNull();
    expect(await store.redeem(flow, verifier, code!)).toBe("user-one");
    expect(await store.describe(flow)).toBeNull();
    expect(await store.redeem(flow, verifier, code!)).toBeNull();
  });

  it("allows exactly one of two concurrent redemptions", async () => {
    const verifier = "s".repeat(43);
    const flow = await store.start("discord", nativeAuthChallenge(verifier));
    const code = await store.approve(flow, "user-race");
    const results = await Promise.all([
      store.redeem(flow, verifier, code!),
      store.redeem(flow, verifier, code!),
    ]);
    expect(results.filter(Boolean)).toEqual(["user-race"]);
    expect(results.filter((value) => value === null)).toHaveLength(1);
  });

  it("does not revive an expired flow through approval or exchange", async () => {
    const verifier = "e".repeat(43);
    const flow = await store.start("facebook", nativeAuthChallenge(verifier));
    const code = await store.approve(flow, "user-expired");
    await redis.del(`native-auth:${flow}`);
    expect(await store.approve(flow, "user-expired")).toBeNull();
    expect(await store.redeem(flow, verifier, code!)).toBeNull();
  });
});

it("rejects unsupported providers, malformed proofs and extra credential fields", () => {
  expect(
    nativeAuthStartSchema.safeParse({ provider: "google", challenge: "a".repeat(43) })
      .success,
  ).toBe(true);
  expect(
    nativeAuthStartSchema.safeParse({ provider: "unknown", challenge: "a".repeat(43) })
      .success,
  ).toBe(false);
  expect(
    nativeAuthExchangeSchema.safeParse({ flowId: "a".repeat(43), verifier: "bad" })
      .success,
  ).toBe(false);
  expect(
    nativeAuthExchangeSchema.safeParse({
      flowId: "a".repeat(43),
      verifier: "v".repeat(43),
      userId: "attacker",
    }).success,
  ).toBe(false);
});
