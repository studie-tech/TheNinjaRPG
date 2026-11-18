import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as Sentry from "@sentry/nextjs";
import { GET } from "@/app/api/meta-conversions/route";
import * as settings from "@/libs/gamesettings";
import * as queries from "@/queries/metaTracking";
import * as transport from "@/server/utils/metaCapi";
import * as configuration from "@/server/utils/metaTracking";
import { timerClaimFixture } from "../../../setup/gameTimers";
import { resetServerModuleStubs, stubCronAuth } from "../../../setup/serverModules";

const request = () => new Request("https://www.theninja-rpg.com/api/meta-conversions");
const row = {
  userId: "private-player",
  consentId: crypto.randomUUID(),
  decidedAt: new Date(),
  fbc: "fb.1.1794993604000.Click",
  fbp: null,
  userAgent: "Browser",
  eventId: crypto.randomUUID(),
  occurredAt: new Date(),
};
const claim = () => ({
  ...timerClaimFixture(),
  prevTime: new Date(0),
  isNewMinute: true,
  response: Response.json(null),
});
beforeEach(() => {
  stubCronAuth(() => null);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(Sentry, "captureException").mockReturnValue("test-event");
  vi.spyOn(Sentry, "flush").mockResolvedValue(true);
  vi.spyOn(settings, "lockWithMinuteTimer").mockResolvedValue(claim());
  vi.spyOn(configuration, "isMetaCapiConfigured").mockReturnValue(true);
  vi.spyOn(queries, "deleteExpiredMetaTracking").mockResolvedValue([] as never);
  vi.spyOn(queries, "selectMetaConversions").mockResolvedValue([row] as never);
  vi.spyOn(queries, "markMetaConversionReported").mockResolvedValue({} as never);
  vi.spyOn(transport, "sendMetaConversions").mockResolvedValue();
});
afterEach(() => {
  vi.restoreAllMocks();
  resetServerModuleStubs();
});

it("authenticates before acquiring timers, reading data or invoking Meta", async () => {
  stubCronAuth(() => new Response("Unauthorized", { status: 401 }));
  expect((await GET(request())).status).toBe(401);
  expect(settings.lockWithMinuteTimer).not.toHaveBeenCalled();
  expect(transport.sendMetaConversions).not.toHaveBeenCalled();
});

it("retains privacy cleanup but performs no delivery while disabled", async () => {
  vi.spyOn(configuration, "isMetaCapiConfigured").mockReturnValue(false);
  expect(await (await GET(request())).json()).toEqual({ sent: 0, configured: false });
  expect(queries.deleteExpiredMetaTracking).toHaveBeenCalled();
  expect(queries.selectMetaConversions).not.toHaveBeenCalled();
  expect(transport.sendMetaConversions).not.toHaveBeenCalled();
});

it("retries unchanged IDs without settling a failed batch, then records accepted conversions", async () => {
  vi.spyOn(transport, "sendMetaConversions")
    .mockRejectedValueOnce(new Error("Meta temporarily unavailable"))
    .mockResolvedValue(undefined);
  expect((await GET(request())).status).toBe(500);
  expect(queries.markMetaConversionReported).not.toHaveBeenCalled();
  expect((await GET(request())).status).toBe(200);
  const calls = (transport.sendMetaConversions as ReturnType<typeof vi.fn>).mock.calls;
  expect(calls[0]?.[2]).toEqual(calls[1]?.[2]);
  expect(queries.markMetaConversionReported).toHaveBeenCalledTimes(2);
});
