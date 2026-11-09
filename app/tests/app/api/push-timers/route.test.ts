import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { GET } from "@/app/api/push-timers/route";
import * as settings from "@/libs/gamesettings";
import * as timers from "@/server/utils/push/timed";
import { resetServerModuleStubs, stubCronAuth } from "../../../setup/serverModules";

const previous = new Date("2026-10-19T10:00:00Z");
const run = vi.fn();
const lock = vi.fn();
const rollback = vi.fn();
const endpointError = vi.fn();
beforeEach(() => {
  run.mockReset().mockResolvedValue({ processed: 1 });
  lock.mockReset().mockResolvedValue({
    release: rollback,
    isClaimed: true,
    isNewMinute: true,
    prevTime: previous,
    response: Response.json(null),
  });
  rollback.mockReset().mockResolvedValue(undefined);
  endpointError
    .mockReset()
    .mockReturnValue(Response.json({ error: "worker failed" }, { status: 500 }));
  stubCronAuth(() => null);
  vi.spyOn(timers, "deliverDueTimedPushes").mockImplementation(run);
  vi.spyOn(settings, "lockWithMinuteTimer").mockImplementation(lock);
  vi.spyOn(settings, "handleEndpointError").mockImplementation(endpointError);
});
afterEach(() => {
  resetServerModuleStubs();
  vi.restoreAllMocks();
});
const request = () => new Request("https://example.com/api/push-timers");
it("rejects unauthenticated calls before timers or device reads", async () => {
  stubCronAuth(() => new Response(null, { status: 401 }));
  expect((await GET(request())).status).toBe(401);
  expect(lock).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});
it("retains the minute timer boundary", async () => {
  lock.mockResolvedValue({
    isClaimed: false,
    isNewMinute: false,
    prevTime: previous,
    response: new Response("wait"),
  });
  expect(await (await GET(request())).text()).toBe("wait");
  expect(run).not.toHaveBeenCalled();
});
it("runs the scheduled worker and leaves the claimed timer on success", async () => {
  expect(await (await GET(request())).json()).toEqual({ processed: 1 });
  expect(run).toHaveBeenCalledTimes(1);
  expect(rollback).not.toHaveBeenCalled();
});
it("rolls back a failed worker's minute timer so durable receipts can be retried", async () => {
  run.mockRejectedValue(new Error("Redis unavailable"));
  expect((await GET(request())).status).toBe(500);
  expect(rollback).toHaveBeenCalledWith();
  expect(endpointError).toHaveBeenCalledTimes(1);
});
