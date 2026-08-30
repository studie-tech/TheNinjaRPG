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
    expect(toPlainText("Tsukimori &amp; Syndicate &lt;3")).toBe("Tsukimori & Syndicate <3");
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
