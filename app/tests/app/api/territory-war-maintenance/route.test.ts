import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { GET } from "@/app/api/territory-war-maintenance/route";
import * as gamesettings from "@/libs/gamesettings";
import * as discordEvents from "@/server/utils/discord/events";
import * as territoryWar from "@/server/utils/territoryWar";
import { timerClaimFixture } from "../../../setup/gameTimers";
import { resetServerModuleStubs, stubCronAuth } from "../../../setup/serverModules";

const request = () => new Request("https://example.com/api/territory-war-maintenance");

const sync = vi.fn();
const announce = vi.fn();
const endpointError = vi.fn();
let claim: ReturnType<typeof timerClaimFixture>;

beforeEach(() => {
  sync.mockReset().mockResolvedValue(undefined);
  announce.mockReset().mockResolvedValue(undefined);
  endpointError.mockReset().mockReturnValue(new Response(null, { status: 500 }));
  claim = timerClaimFixture();
  stubCronAuth(() => null);
  vi.spyOn(territoryWar, "syncTerritoryWars").mockImplementation(sync);
  vi.spyOn(discordEvents, "syncDiscordEvents").mockImplementation(announce);
  vi.spyOn(gamesettings, "handleEndpointError").mockImplementation(endpointError);
  vi.spyOn(gamesettings, "lockWithMinuteTimer").mockImplementation(async () => ({
    ...claim,
    isNewMinute: true,
    prevTime: new Date(0),
    response: Response.json(null),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  resetServerModuleStubs();
});

it("keeps the minute after a successful run", async () => {
  expect((await GET(request())).status).toBe(200);
  expect(claim.release).not.toHaveBeenCalled();
});

it.each([
  ["the territory war sync", sync],
  ["the Discord announcements", announce],
])("hands the minute back when %s fail", async (_, step) => {
  step.mockRejectedValue(new Error("database down"));
  expect((await GET(request())).status).toBe(500);
  expect(claim.release).toHaveBeenCalledTimes(1);
  expect(endpointError).toHaveBeenCalledTimes(1);
});
