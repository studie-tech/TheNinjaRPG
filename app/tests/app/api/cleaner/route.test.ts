import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ process: vi.fn(), lock: vi.fn(), reset: vi.fn(), execute: vi.fn() }));
vi.mock("@/server/db", () => ({ drizzleDB: {
  execute: mocks.execute,
  delete: () => ({ where: vi.fn().mockResolvedValue(undefined) }),
  update: () => ({ set: () => ({ where: vi.fn().mockResolvedValue(undefined) }) }),
} }));
vi.mock("@/libs/gamesettings", () => ({
  lockWithHourlyTimer: mocks.lock, lockWithDailyTimer: vi.fn().mockResolvedValue({ isNewDay: false }), updateGameSetting: mocks.reset,
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
    mocks.execute.mockResolvedValue([]);
    mocks.process.mockResolvedValue({ processed: 1, failed: 0 });
    mocks.lock.mockResolvedValue({ isNewHour: false, response: Response.json("hourly work already ran") });
  });
  it("skips deletion cleanup with the rest of hourly maintenance", async () => {
    expect((await GET(request())).status).toBe(200);
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated calls before any maintenance", async () => {
    expect((await GET(request("wrong"))).status).toBe(401);
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.lock).not.toHaveBeenCalled();
  });
  it("does not process deletions when the secret is unconfigured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request(""))).status).toBe(500);
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it("processes due deletions as part of the hourly cleanup", async () => {
    mocks.lock.mockResolvedValueOnce({ isNewHour: true, prevTime: new Date(0) });
    expect((await GET(request())).status).toBe(200);
    expect(mocks.execute).toHaveBeenCalled();
    expect(mocks.process).toHaveBeenCalledOnce();
    expect(mocks.reset).not.toHaveBeenCalled();
  });
  it("uses the standard cleaner failure and timer rollback for deletion failures", async () => {
    const previous = new Date(0);
    mocks.lock.mockResolvedValueOnce({ isNewHour: true, prevTime: previous });
    mocks.process.mockResolvedValue({ processed: 0, failed: 1 });
    expect((await GET(request())).status).toBe(500);
    expect(mocks.reset).toHaveBeenCalledWith(expect.anything(), "cleaner-hourly", 0, previous);
  });
});
