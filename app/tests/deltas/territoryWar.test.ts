import { expect, it } from "bun:test";
import {
  getTerritoryWarNotice,
  getTerritoryWarNoticePollInterval,
} from "@/deltas/territoryWar";
import { TERRITORY_WAR_INTERVAL_HOURS } from "@/drizzle/constants";
import type { territoryWar } from "@/drizzle/schema";

const now = Date.UTC(2026, 10, 1, 12);
const event: typeof territoryWar.$inferSelect = {
  id: "event",
  predecessorId: "previous",
  guardianId: "guardian",
  sector: 100,
  version: 0,
  startsAt: new Date(now - 3_600_000),
  endsAt: new Date(now + 60_000),
  resolvedAt: null,
};

it("keeps discovery active without a known event or after a missed opening", () => {
  expect(getTerritoryWarNotice(undefined, now)).toEqual({
    event: null,
    nextStartsAt: null,
  });
  expect(getTerritoryWarNoticePollInterval(undefined, now)).toBe(30_000);
  expect(
    getTerritoryWarNoticePollInterval({ event: null, nextStartsAt: null }, now),
  ).toBe(30_000);
  expect(
    getTerritoryWarNoticePollInterval(
      { event: null, nextStartsAt: new Date(now) },
      now,
    ),
  ).toBe(30_000);
});

it("retains active-event polling and derives the quiet window from an early victory", () => {
  const active = getTerritoryWarNotice(event, now);
  expect(active).toEqual({ event, nextStartsAt: null });
  expect(getTerritoryWarNoticePollInterval(active, now)).toBe(30_000);
  const resolvedAt = new Date(now - 1000);
  const closed = getTerritoryWarNotice({ ...event, resolvedAt }, now);
  expect(closed).toEqual({
    event: null,
    nextStartsAt: new Date(
      resolvedAt.getTime() + TERRITORY_WAR_INTERVAL_HOURS * 3_600_000,
    ),
  });
  expect(getTerritoryWarNoticePollInterval(closed, now)).toBe(false);
});

it("keeps checking an unresolved expiry until its actual resolution is durable", () => {
  const expired = getTerritoryWarNotice({ ...event, endsAt: new Date(now) }, now);
  expect(expired).toEqual({ event: null, nextStartsAt: null });
  expect(getTerritoryWarNoticePollInterval(expired, now)).toBe(30_000);
});

it("waits for the opening of a future event without showing its notice early", () => {
  const scheduled = { ...event, startsAt: new Date(now + 30_000) };
  const notice = getTerritoryWarNotice(scheduled, now);
  expect(notice).toEqual({ event: null, nextStartsAt: scheduled.startsAt });
  expect(getTerritoryWarNotice(scheduled, scheduled.startsAt.getTime()).event).toEqual(
    scheduled,
  );
});
