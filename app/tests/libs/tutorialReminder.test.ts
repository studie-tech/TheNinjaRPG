import { describe, expect, it } from "bun:test";
import { buildTutorialReminderEmail } from "@/libs/tutorialReminder";

describe("buildTutorialReminderEmail", () => {
  it("links back to the current lesson and escapes the player's name", () => {
    const email = buildTutorialReminderEmail({
      callName: "<Kai>",
      chapterTitle: "The Missing Pup",
      stepPage: "/travel",
      siteUrl: "https://www.theninja-rpg.com",
      unsubscribeUrl: "https://www.theninja-rpg.com/emailsettings?email=a&secret=b",
    });
    expect(email.resumeUrl).toBe("https://www.theninja-rpg.com/travel");
    expect(email.html).toContain("&lt;Kai&gt;,");
    expect(email.html).not.toContain("<Kai>");
    expect(email.text).toContain('You stopped at "The Missing Pup".');
    expect(email.html).toContain("secret=b");
  });

  it("falls back to the profile and a generic greeting", () => {
    const email = buildTutorialReminderEmail({
      callName: "  ",
      siteUrl: "https://www.theninja-rpg.com",
      unsubscribeUrl: "https://www.theninja-rpg.com/emailsettings",
    });
    expect(email.resumeUrl).toBe("https://www.theninja-rpg.com/profile");
    expect(email.text.startsWith("shinobi,")).toBe(true);
  });
});
