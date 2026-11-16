import { vi } from "bun:test";
import type { RouterOutputs } from "@/app/_trpc/client";
import * as cosmetics from "@/hooks/useCosmetics";

/** Supply isolated wardrobe state and actions to inventory component tests. */
export const mockCosmetics = () => {
  const state = {
    wardrobe: {
      data: { owned: [], slots: [], unlocks: [] } as RouterOutputs["cosmetic"]["get"],
      isPending: false,
      refetch: vi.fn(),
    },
    make: { mutate: vi.fn(), isPending: false },
    select: { mutate: vi.fn(), isPending: false },
    error: null,
    refreshWardrobe: vi.fn(async () => undefined),
  };
  vi.spyOn(cosmetics, "useCosmetics").mockReturnValue(
    state as unknown as ReturnType<typeof cosmetics.useCosmetics>,
  );
  return state;
};
