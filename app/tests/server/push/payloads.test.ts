import { describe, expect, it } from "vitest";
import { apnsAlertPayload, fcmMessage } from "@/server/utils/push/payloads";
import type { PushMessage } from "@/server/utils/push/types";

const base: PushMessage = {
  title: "Recovered",
  body: "You have left the hospital.",
  category: "recovery",
};

describe("apnsAlertPayload", () => {
  it("groups notifications by category so a burst collapses in the shade", () => {
    const payload = apnsAlertPayload(base) as { aps: Record<string, unknown> };
    expect(payload.aps["thread-id"]).toBe("recovery");
    expect(payload.aps.alert).toEqual({
      title: "Recovered",
      body: "You have left the hospital.",
    });
  });

  it("omits the badge entirely rather than sending zero", () => {
    const payload = apnsAlertPayload(base) as { aps: Record<string, unknown> };
    expect("badge" in payload.aps).toBe(false);
    const withBadge = apnsAlertPayload({ ...base, badge: 0 }) as {
      aps: Record<string, unknown>;
    };
    expect(withBadge.aps.badge).toBe(0);
  });

  it("puts the deep link and custom data beside aps, not inside it", () => {
    const payload = apnsAlertPayload({
      ...base,
      url: "/hospital",
      data: { battleId: "abc" },
    }) as Record<string, unknown>;
    expect(payload.url).toBe("/hospital");
    expect(payload.battleId).toBe("abc");
  });
});

describe("fcmMessage", () => {
  it("routes to the channel named after the category", () => {
    const message = fcmMessage("token-1", base) as {
      android: { notification: Record<string, unknown>; priority: string };
      token: string;
    };
    expect(message.token).toBe("token-1");
    expect(message.android.notification.channel_id).toBe("recovery");
    expect(message.android.priority).toBe("HIGH");
  });

  it("carries only strings in the data map", () => {
    const message = fcmMessage("token-1", {
      ...base,
      url: "/hospital",
      data: { battleId: "abc" },
    }) as { data: Record<string, unknown> };
    for (const value of Object.values(message.data)) {
      expect(typeof value).toBe("string");
    }
    expect(message.data.category).toBe("recovery");
    expect(message.data.url).toBe("/hospital");
  });

  it("only sets collapse_key when the message supersedes itself", () => {
    const plain = fcmMessage("token-1", base) as { android: Record<string, unknown> };
    expect("collapse_key" in plain.android).toBe(false);
    const collapsing = fcmMessage("token-1", { ...base, collapseId: "war-42" }) as {
      android: Record<string, unknown>;
    };
    expect(collapsing.android.collapse_key).toBe("war-42");
  });
});

describe("live activity content state", () => {
  const load = () => import("@/server/utils/push/liveActivity");

  it("sends the end time as a number, not a Date or an ISO string", async () => {
    // ActivityKit decodes remote updates with a stock JSONDecoder, whose default date
    // strategy reads a number as seconds since 2001 and rejects an ISO string outright.
    // Carrying epoch seconds and converting in Swift is what keeps the two in step.
    const { buildActivityPayload } = await load();
    const endsAt = new Date("2026-08-30T12:00:00.000Z");
    const { aps } = buildActivityPayload({ title: "Recovering", endsAt }, "update") as {
      aps: { "content-state": Record<string, unknown>; event: string };
    };
    expect(aps["content-state"].endsAtEpoch).toBe(Math.floor(endsAt.getTime() / 1000));
    expect(typeof aps["content-state"].endsAtEpoch).toBe("number");
    expect(aps.event).toBe("update");
  });

  it("carries the optional fields explicitly so the Swift decoder always matches", async () => {
    const { buildActivityPayload } = await load();
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

  it("gives an ended activity a dismissal date so it does not vanish mid-glance", async () => {
    const { buildActivityPayload } = await load();
    const { aps } = buildActivityPayload(
      { title: "Recovered", endsAt: new Date() },
      "end",
    ) as { aps: { event: string; "dismissal-date"?: number } };
    expect(aps.event).toBe("end");
    expect(typeof aps["dismissal-date"]).toBe("number");
    expect(aps["dismissal-date"]).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});
