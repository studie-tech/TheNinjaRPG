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
