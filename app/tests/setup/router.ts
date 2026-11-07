import { vi } from "bun:test";

/** App Router instance for `AppRouterContext` or a `useRouter` spy. */
export const testRouter = (bfcacheId: string) => ({
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  bfcacheId,
});
