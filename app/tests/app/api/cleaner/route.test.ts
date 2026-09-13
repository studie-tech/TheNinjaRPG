import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ process: vi.fn(), lock: vi.fn() }));
vi.mock("@/server/db", () => ({ drizzleDB: {} }));
vi.mock("@/libs/gamesettings", () => ({
  lockWithHourlyTimer: mocks.lock, lockWithDailyTimer: vi.fn(), updateGameSetting: vi.fn(),
}));
vi.mock("@/routers/raids", () => ({ cleanupExpiredExclusiveRaids: vi.fn() }));
vi.mock("@/server/utils/purchases/grant", () => ({ reconcileFederalStatuses: vi.fn() }));
vi.mock("@/server/utils/accountDeletion/process", () => ({ processAccountDeletions: mocks.process }));

import { GET } from "@/app/api/cleaner/route";
const request = (secret = "test-cron") => new Request("https://example.com/api/cleaner", {
  headers: { authorization: `Bearer ${secret}` },
});

afterEach(() => vi.unstubAllEnvs());
describe("account deletion in the existing cleaner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "test-cron");
    mocks.process.mockResolvedValue({ processed: 1, failed: 0 });
    mocks.lock.mockResolvedValue({ isNewHour: false, response: Response.json("hourly work already ran") });
  });
  it("processes due deletions even when hourly maintenance is skipped", async () => {
    expect((await GET(request())).status).toBe(200);
    expect(mocks.process).toHaveBeenCalledOnce();
    expect(mocks.process.mock.invocationCallOrder[0]).toBeLessThan((mocks.lock.mock.invocationCallOrder[0] ?? 0));
  });
  it("does not expose deletion processing to unauthenticated maintenance calls", async () => {
    expect((await GET(request("wrong"))).status).toBe(200);
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.lock).toHaveBeenCalledOnce();
  });
  it("does not process deletions when the secret is unconfigured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    await GET(request(""));
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it("reports deletion failures while still running the maintenance gate", async () => {
    mocks.process.mockResolvedValue({ processed: 0, failed: 1 });
    expect((await GET(request())).status).toBe(503);
    expect(mocks.lock).toHaveBeenCalledOnce();
  });
});
