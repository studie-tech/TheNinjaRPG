import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useGuestKessenMatch } from "@/hooks/kessen/useGuestKessenMatch";
import { academyAdvice } from "@/libs/kessen/academy";
import type { KessenAction } from "@/libs/kessen/types";
import type { KessenCatalogEntry } from "@/validators/kessen";
import { KESSEN_SEED_CATALOG } from "../libs/kessen/fixtures/catalog";

const CARDS: KessenCatalogEntry[] = KESSEN_SEED_CATALOG.map((card) => ({
  ...card,
  image: "",
  artUrl: "",
  focalX: 50,
  focalY: 30,
  flavor: "",
  abilityName: null,
  number: null,
}));

const realFetch = globalThis.fetch;
let fetchCalls = 0;

beforeEach(() => {
  fetchCalls = 0;
  globalThis.fetch = (() => {
    fetchCalls++;
    throw new Error("A guest table must not call the network");
  }) as unknown as typeof fetch;
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  localStorage.clear();
});

describe("useGuestKessenMatch", () => {
  it("plays a lesson in the browser and remembers the win on this device only", async () => {
    const { result } = renderHook(() => useGuestKessenMatch(CARDS));
    act(() => {
      result.current.startLesson("first-blood");
    });
    expect(result.current.payload?.lesson).toBe("first-blood");
    for (let n = 0; n < 50 && result.current.payload?.status === "ACTIVE"; n++) {
      const view = result.current.payload.view;
      const advice = academyAdvice("first-blood", view);
      const action: KessenAction =
        view.phase === "mulligan"
          ? { t: "mull", cards: [] }
          : advice?.kind === "move"
            ? advice.action
            : { t: "pass" };
      let outcome: Awaited<ReturnType<typeof result.current.play>> | undefined;
      await act(async () => {
        outcome = await result.current.play(action);
      });
      expect(outcome?.ok).toBe(true);
      expect(outcome?.payload?.version).toBe(result.current.payload?.version);
    }
    expect(result.current.payload?.status).toBe("FINISHED");
    expect(result.current.payload?.view.result?.winner).toBe(0);
    expect(result.current.payload?.result).toBeNull();
    expect(result.current.lessonsWon).toEqual(["first-blood"]);
    expect(JSON.parse(localStorage.getItem("kessen:guestAcademy") ?? "[]")).toEqual([
      "first-blood",
    ]);
    expect(fetchCalls).toBe(0);
  });

  it("concedes and closes a Circuit match without a server", async () => {
    const { result } = renderHook(() => useGuestKessenMatch(CARDS));
    act(() => {
      result.current.startNpc("kazehiko", "AKASUMI");
    });
    expect(result.current.payload?.npcKey).toBe("kazehiko");
    expect(result.current.payload?.view.seats[0].faction).toBe("AKASUMI");
    await act(async () => {
      await result.current.concede();
    });
    expect(result.current.payload?.status).toBe("CONCEDED");
    act(() => result.current.close());
    expect(result.current.payload).toBeNull();
    expect(fetchCalls).toBe(0);
  });

  it("refuses to start before the catalog has loaded", () => {
    const { result } = renderHook(() => useGuestKessenMatch(undefined));
    act(() => {
      result.current.startNpc("kazehiko", "HYORIN");
    });
    expect(result.current.payload).toBeNull();
    expect(result.current.startError).toContain("still being laid out");
  });
});
