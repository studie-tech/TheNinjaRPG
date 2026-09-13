import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as gamesettings from "@/libs/gamesettings";
import * as raids from "@/routers/raids";
import * as grant from "@/server/utils/purchases/grant";
import * as processor from "@/server/utils/accountDeletion/process";
import { stubDatabase, resetServerModuleStubs } from "../../../setup/serverModules";
import { GET } from "@/app/api/cleaner/route";

const originalEnv = { ...process.env };

const mocks = { process: vi.fn(), lock: vi.fn(), reset: vi.fn(), execute: vi.fn() };

const request = (secret = "test-cron") => new Request("https://example.com/api/cleaner", {
  headers: { authorization: `Bearer ${secret}` },
});

afterEach(() => { process.env = { ...originalEnv }; vi.restoreAllMocks(); resetServerModuleStubs(); });
describe("account deletion in the existing cleaner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubDatabase({ execute: mocks.execute, delete: () => ({ where: vi.fn().mockResolvedValue(undefined) }), update: () => ({ set: () => ({ where: vi.fn().mockResolvedValue(undefined) }) }) });
    vi.spyOn(gamesettings, "lockWithHourlyTimer").mockImplementation(mocks.lock);
    vi.spyOn(gamesettings, "lockWithDailyTimer").mockResolvedValue({ isNewDay: false } as Awaited<ReturnType<typeof gamesettings.lockWithDailyTimer>>);
    vi.spyOn(gamesettings, "updateGameSetting").mockImplementation(mocks.reset);
    vi.spyOn(raids, "cleanupExpiredExclusiveRaids").mockImplementation(vi.fn());
    vi.spyOn(grant, "reconcileFederalStatuses").mockImplementation(vi.fn());
    vi.spyOn(processor, "processAccountDeletions").mockImplementation(mocks.process);
    process.env["CRON_SECRET"] = "test-cron";
    mocks.execute.mockResolvedValue([]);
    mocks.process.mockResolvedValue({ processed: 1, failed: 0 });
    mocks.lock.mockResolvedValue({ isNewHour: false, response: Response.json("hourly work already ran") });
  });
  it("skips deletion cleanup with the rest of hourly maintenance", async () => {
    expect((await GET(request())).status).toBe(200);
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
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
