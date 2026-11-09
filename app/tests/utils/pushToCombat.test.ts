import { describe, expect, it } from "bun:test";
import { pushToCombat } from "@/utils/routing";

/**
 * A battle start reaches the client twice — the mutation that started it, and the server's
 * websocket announcement — so `pushToCombat` navigates once per battle. The cases that matter are
 * the ones where it must NOT stay silent: a player who is pulled into someone else's battle has
 * never navigated for that id, and every later battle has an id of its own.
 */
const fakeRouter = () => {
  const pushed: string[] = [];
  return {
    router: { push: (url: string) => pushed.push(url) } as unknown as Parameters<
      typeof pushToCombat
    >[0],
    pushed,
  };
};

describe("pushToCombat", () => {
  it("navigates once per battle id, ignoring a repeated announcement", () => {
    const { router, pushed } = fakeRouter();
    pushToCombat(router, "battle-1");
    pushToCombat(router, "battle-1");
    pushToCombat(router, "battle-2");
    pushToCombat(router, "battle-3");
    expect(pushed).toEqual(["/combat", "/combat", "/combat"]);
  });

  it("navigates unconditionally when the caller has no battle id to key on", () => {
    const { router, pushed } = fakeRouter();
    pushToCombat(router, undefined);
    pushToCombat(router, null);
    expect(pushed).toEqual(["/combat", "/combat"]);
  });
});
