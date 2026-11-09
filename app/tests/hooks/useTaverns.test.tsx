import { afterEach, expect, it, vi } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import * as sector from "@/hooks/useSectorVillage";
import { useTaverns } from "@/hooks/useTaverns";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const render = (role: string) => {
  const villageQuery = vi.fn((_input: unknown, _options: { enabled: boolean }) => ({
    data: [{ name: "Hyorin", type: "VILLAGE" }],
  }));
  Object.assign(vi.spyOn(client, "api" as never), {
    village: { getAll: { useQuery: villageQuery } },
    misc: {
      getGlobalTavernEnabled: { useQuery: () => ({ data: true, isPending: false }) },
    },
  });
  vi.spyOn(sector, "useSectorVillage").mockReturnValue({
    sectorVillage: undefined,
    isLoading: false,
  } as never);
  const user = {
    role,
    village: { type: "VILLAGE", name: "Akikaze" },
    villageId: "v1",
  } as never;
  const { result } = renderHook(() => useTaverns(user));
  return {
    taverns: result.current.availTaverns,
    enabled: villageQuery.mock.calls[0]?.[1].enabled,
  };
};

it("loads the village list only for staff, who can open every village tavern", () => {
  expect(render("USER")).toEqual({ taverns: ["Global", "Akikaze"], enabled: false });
  expect(render("MODERATOR")).toEqual({
    taverns: ["Global", "Akikaze", "Hyorin"],
    enabled: true,
  });
});
