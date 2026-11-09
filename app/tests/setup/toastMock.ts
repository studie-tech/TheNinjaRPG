import { vi } from "bun:test";
import * as toast from "@/libs/toast";

/** Replace every toast export with a no-op spy that `vi.restoreAllMocks()` undoes. */
export const spyOnToasts = () => {
  for (const name of Object.keys(toast) as (keyof typeof toast)[]) {
    vi.spyOn(toast, name).mockImplementation((() => undefined) as never);
  }
};
