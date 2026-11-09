import { describe, expect, it } from "bun:test";
import type { GameRenderer } from "@/libs/rendering/runtime";
import { createRenderScope } from "@/libs/rendering/scope";

const parentOf = () => {
  const owned = new Set<() => void>();
  const parent = {
    own: (cleanup: () => void) => {
      owned.add(cleanup);
    },
    disown: (cleanup: () => void) => {
      owned.delete(cleanup);
    },
    isDisposed: () => false,
  } as GameRenderer;
  return {
    parent,
    owned,
    dispose: () => {
      for (const cleanup of owned) cleanup();
    },
  };
};

describe("travel scene ownership", () => {
  it("releases removed sectors immediately and keeps retained sectors alive", () => {
    const { parent, owned, dispose } = parentOf();
    const retained = createRenderScope(parent),
      departed = createRenderScope(parent);
    const released: string[] = [];
    retained.own(() => released.push("retained"));
    departed.own(() => released.push("departed"));
    departed.dispose();
    departed.dispose();
    expect(released).toEqual(["departed"]);
    expect(departed.signal.aborted).toBe(true);
    expect(retained.signal.aborted).toBe(false);
    expect(owned.size).toBe(1);
    dispose();
    expect(released).toEqual(["departed", "retained"]);
    expect(owned.size).toBe(0);
  });
  it("disposes late resources and bounds parent cleanup registrations across crossings", () => {
    const { parent, owned } = parentOf();
    for (let crossing = 0; crossing < 100; crossing++) {
      const scope = createRenderScope(parent);
      scope.dispose();
      let released = 0;
      scope.own(() => released++);
      expect(released).toBe(1);
      expect(owned.size).toBe(0);
    }
  });
});
