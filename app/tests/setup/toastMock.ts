import { vi } from "bun:test";
import * as toast from "@/libs/toast";

/** Bun shares module mocks across suites, so every toast export must remain available. */
export const createToastMock = () =>
  ({
    triggerConfetti: vi.fn(),
    showMutationToast: vi.fn(),
    showFormErrorsToast: vi.fn(),
    showRewardToast: vi.fn(),
  }) satisfies typeof import("@/libs/toast");

/** Replace every toast export with a no-op spy that `vi.restoreAllMocks()` undoes. */
export const spyOnToasts = () => {
  for (const name of Object.keys(createToastMock()) as (keyof typeof toast)[]) {
    vi.spyOn(toast, name).mockImplementation((() => undefined) as never);
  }
};
