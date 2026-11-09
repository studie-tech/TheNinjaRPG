import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as Sentry from "@sentry/nextjs";
import { GET } from "@/app/api/daily-bank/route";
import * as gamesettings from "@/libs/gamesettings";
import { timerClaimFixture } from "../../../setup/gameTimers";
import {
  resetServerModuleStubs,
  stubCronAuth,
  stubDatabase,
} from "../../../setup/serverModules";

const request = () => new Request("https://example.com/api/daily-bank");
const dailyClaim = (claim: ReturnType<typeof timerClaimFixture>) => ({
  ...claim,
  isNewDay: claim.isClaimed,
  prevTime: new Date(0),
  response: Response.json("wait"),
});

const capture = vi.fn();
const villages = vi.fn();

beforeEach(() => {
  capture.mockReset().mockReturnValue("test-event");
  villages.mockReset().mockRejectedValue(new Error("database down"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(Sentry, "captureException").mockImplementation(capture);
  vi.spyOn(Sentry, "flush").mockResolvedValue(true);
  stubCronAuth(() => null);
  stubDatabase({ query: { village: { findMany: villages } } });
});

afterEach(() => {
  vi.restoreAllMocks();
  resetServerModuleStubs();
});

it("rejects unauthenticated calls before the timer", async () => {
  stubCronAuth(() => new Response(null, { status: 401 }));
  const lock = vi.spyOn(gamesettings, "lockWithDailyTimer");
  expect((await GET(request())).status).toBe(401);
  expect(lock).not.toHaveBeenCalled();
});

it("leaves a claimed day alone", async () => {
  const claim = { ...timerClaimFixture(), isClaimed: false };
  vi.spyOn(gamesettings, "lockWithDailyTimer").mockResolvedValue(dailyClaim(claim));
  expect(await (await GET(request())).json()).toBe("wait");
  expect(villages).not.toHaveBeenCalled();
  expect(claim.release).not.toHaveBeenCalled();
});

it("reports a failure to Sentry and hands the day back for the next attempt", async () => {
  const claim = timerClaimFixture();
  vi.spyOn(gamesettings, "lockWithDailyTimer").mockResolvedValue(dailyClaim(claim));
  const response = await GET(request());
  expect(response.status).toBe(500);
  expect(claim.release).toHaveBeenCalledTimes(1);
  expect(capture).toHaveBeenCalledTimes(1);
  expect(capture.mock.calls[0]?.[1]).toMatchObject({
    extra: { endpoint: "/api/daily-bank" },
  });
});
