import { afterEach, describe, expect, it, vi } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import { useUnspentSkillPoints } from "@/hooks/useUnspentSkillPoints";
import type { UserWithRelations } from "@/server/api/routers/profile";
import * as userContext from "@/utils/UserContext";

const mockUser = (user: { rank: string; skillPoints: number }) =>
  vi
    .spyOn(userContext, "useUserDataSelector")
    .mockImplementation(
      (select) => ({ data: select(user as NonNullable<UserWithRelations>) }) as never,
    );

const mockUserSkills = (usedSkillPoints?: number) => {
  const useQuery = vi.fn((_input: undefined, _options: { enabled: boolean }) => ({
    data: usedSkillPoints === undefined ? undefined : { usedSkillPoints },
  }));
  Object.assign(vi.spyOn(client, "api" as never), {
    skillTree: { getUserSkills: { useQuery } },
  });
  return useQuery;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useUnspentSkillPoints", () => {
  it("counts earned points not yet activated on the skill tree", () => {
    mockUser({ rank: "CHUNIN", skillPoints: 20 });
    const useQuery = mockUserSkills(5);
    const { result } = renderHook(() => useUnspentSkillPoints());
    expect(result.current).toBe(15);
    expect(useQuery.mock.calls[0]?.[1]?.enabled).toBe(true);
  });

  it("skips the skills query below the skill tree rank", () => {
    mockUser({ rank: "GENIN", skillPoints: 3 });
    const useQuery = mockUserSkills(0);
    const { result } = renderHook(() => useUnspentSkillPoints());
    expect(result.current).toBe(0);
    expect(useQuery.mock.calls[0]?.[1]?.enabled).toBe(false);
  });

  it("shows nothing until the activated skills load or when none are left", () => {
    mockUser({ rank: "JONIN", skillPoints: 10 });
    mockUserSkills(undefined);
    expect(renderHook(() => useUnspentSkillPoints()).result.current).toBe(0);
    mockUserSkills(12);
    expect(renderHook(() => useUnspentSkillPoints()).result.current).toBe(0);
  });
});
