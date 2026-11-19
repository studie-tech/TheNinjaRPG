import { vi } from "bun:test";
import * as ActivityStreakPanel from "@/layout/ActivityStreakPanel";

// The lazy popup retains one resolved default export across suites. Reuse its spy so
// later tests can change the panel behavior without leaving an earlier mock cached.
export const activityPanel = vi.spyOn(ActivityStreakPanel, "default");
