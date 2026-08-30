import { describe, expect, it } from "vitest";
import { announcement, deliveryTest, toPlainText } from "@/server/utils/push/messages";
import { summarise } from "@/server/utils/push/types";

describe("toPlainText", () => {
  it("strips the markup announcements carry", () => {
    expect(toPlainText("<b>Akikaze</b> has declared war on <i>Shirohana</i>")).toBe(
      "Akikaze has declared war on Shirohana",
    );
  });

  it("turns line breaks into spaces instead of running words together", () => {
    expect(toPlainText("Round over.<br />Next round starts soon.")).toBe(
      "Round over. Next round starts soon.",
    );
  });

  it("decodes the entities that reach the feed", () => {
    expect(toPlainText("Tsukimori &amp; Syndicate &lt;3")).toBe(
      "Tsukimori & Syndicate <3",
    );
  });

  it("decodes each entity once, so an escaped entity survives as text", () => {
    expect(toPlainText("Write &amp;lt; for a less-than sign")).toBe(
      "Write &lt; for a less-than sign",
    );
  });

  it("leaves unknown entities alone rather than mangling them", () => {
    expect(toPlainText("100&percnt; done")).toBe("100&percnt; done");
  });

  it("strips to a fixpoint, so a nested tag cannot reassemble itself", () => {
    expect(toPlainText("<<b>b>bold<<\/b>\/b>")).toBe("bold");
    expect(toPlainText("<<script>script>alert(1)")).toBe("alert(1)");
  });
});

describe("announcement", () => {
  it("keeps the payload inside the APNs size limit", () => {
    const message = announcement("a".repeat(1000));
    expect(message.body.length).toBeLessThanOrEqual(300);
    expect(message.body.endsWith("…")).toBe(true);
  });

  it("leaves short announcements untouched and links to the news feed", () => {
    const message = announcement("Server maintenance at 02:00 UTC");
    expect(message.body).toBe("Server maintenance at 02:00 UTC");
    expect(message.url).toBe("/news");
    expect(message.category).toBe("system");
  });
});

describe("deliveryTest", () => {
  it("collapses so repeated taps do not stack alerts", () => {
    expect(deliveryTest().collapseId).toBe("push-delivery-test");
  });
});

describe("summarise", () => {
  it("counts outcomes and collects only the tokens worth deleting", () => {
    const summary = summarise([
      { token: "a", status: "sent" },
      { token: "b", status: "expired", reason: "Unregistered" },
      { token: "c", status: "failed", reason: "503 Unavailable", retryable: true },
      { token: "d", status: "sent" },
    ]);
    expect(summary).toEqual({ sent: 2, failed: 2, expiredTokens: ["b"] });
  });

  it("returns a zeroed summary for an empty batch", () => {
    expect(summarise([])).toEqual({ sent: 0, failed: 0, expiredTokens: [] });
  });
});

describe("dead-token classification", () => {
  it("prunes only APNs reasons that are about this one device", async () => {
    const { isDeadApnsToken } = await import("@/server/utils/push/types");
    expect(isDeadApnsToken(410, "Unregistered")).toBe(true);
    expect(isDeadApnsToken(400, "BadDeviceToken")).toBe(true);
    expect(isDeadApnsToken(400, "ExpiredToken")).toBe(true);
    // A misconfigured bundle id rejects every token at once; pruning on it would empty
    // the table on a bad deploy.
    expect(isDeadApnsToken(400, "DeviceTokenNotForTopic")).toBe(false);
    expect(isDeadApnsToken(429, "TooManyRequests")).toBe(false);
    expect(isDeadApnsToken(503, "ServiceUnavailable")).toBe(false);
  });

  it("does not treat an FCM payload error as a dead token", async () => {
    const { isDeadFcmToken } = await import("@/server/utils/push/types");
    // UNREGISTERED is the only code that specifically means this token is gone.
    expect(isDeadFcmToken("UNREGISTERED")).toBe(true);
    // INVALID_ARGUMENT covers a malformed payload and NOT_FOUND is the status behind
    // several unrelated failures including a wrong project id. Both would come back for
    // every device in the batch, so pruning on either empties the table.
    expect(isDeadFcmToken("INVALID_ARGUMENT")).toBe(false);
    expect(isDeadFcmToken("NOT_FOUND")).toBe(false);
    expect(isDeadFcmToken("UNAVAILABLE")).toBe(false);
    expect(isDeadFcmToken("INTERNAL")).toBe(false);
  });
});

describe("numeric character references", () => {
  it("decodes decimal and hexadecimal apostrophes", () => {
    // Most editors emit these rather than &apos;, so a named-entity table alone leaves
    // raw markup in the notification body.
    expect(toPlainText("Tom&#39;s squad")).toBe("Tom's squad");
    expect(toPlainText("Tom&#039;s squad")).toBe("Tom's squad");
    expect(toPlainText("Tom&#x27;s squad")).toBe("Tom's squad");
    expect(toPlainText("Tom&#X27;s squad")).toBe("Tom's squad");
  });

  it("leaves references it cannot safely decode as written", () => {
    expect(toPlainText("lone surrogate &#xD800; here")).toBe(
      "lone surrogate &#xD800; here",
    );
    expect(toPlainText("out of range &#1114112;")).toBe("out of range &#1114112;");
    expect(toPlainText("null &#0;")).toBe("null &#0;");
  });
});
