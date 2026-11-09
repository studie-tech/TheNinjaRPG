import { describe, expect, it } from "bun:test";
import {
  activityTokensToPrune,
  buildActivityPayload,
} from "@/server/utils/push/liveActivity";

describe("live activity content state", () => {
  it("sends the end time as a number, not a Date or an ISO string", () => {
    // ActivityKit decodes remote updates with a stock JSONDecoder, whose default date
    // strategy reads a number as seconds since 2001 and rejects an ISO string outright.
    // Carrying epoch seconds and converting in Swift is what keeps the two in step.
    const endsAt = new Date("2026-08-30T12:00:00.000Z");
    const { aps } = buildActivityPayload({ title: "Recovering", endsAt }, "update") as {
      aps: { "content-state": Record<string, unknown>; event: string };
    };
    expect(aps["content-state"].endsAtEpoch).toBe(Math.floor(endsAt.getTime() / 1000));
    expect(typeof aps["content-state"].endsAtEpoch).toBe("number");
    expect(aps.event).toBe("update");
  });

  it("carries the optional fields explicitly so the Swift decoder always matches", () => {
    const bare = buildActivityPayload(
      { title: "Recovering", endsAt: new Date() },
      "update",
    ) as { aps: { "content-state": Record<string, unknown> } };
    expect(bare.aps["content-state"].subtitle).toBeNull();
    expect(bare.aps["content-state"].progress).toBeNull();

    const full = buildActivityPayload(
      {
        title: "Training",
        subtitle: "Ninjutsu",
        endsAt: new Date(),
        progress: 0.42,
      },
      "update",
    ) as { aps: { "content-state": Record<string, unknown> } };
    expect(full.aps["content-state"].subtitle).toBe("Ninjutsu");
    expect(full.aps["content-state"].progress).toBe(0.42);
  });

  it("gives an ended activity a dismissal date so it does not vanish mid-glance", () => {
    const { aps } = buildActivityPayload(
      { title: "Recovered", endsAt: new Date() },
      "end",
    ) as { aps: { event: string; "dismissal-date"?: number } };
    expect(aps.event).toBe("end");
    expect(typeof aps["dismissal-date"]).toBe("number");
    expect(aps["dismissal-date"]).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("keeps failed end tokens available for retry", () => {
    const results = [
      { token: "sent", status: "sent" as const },
      { token: "expired", status: "expired" as const, reason: "Unregistered" },
      {
        token: "retry",
        status: "failed" as const,
        reason: "503 Unavailable",
        retryable: true,
      },
    ];

    expect(activityTokensToPrune(results, "update")).toEqual(["expired"]);
    expect(activityTokensToPrune(results, "end")).toEqual(["sent", "expired"]);
  });
});
