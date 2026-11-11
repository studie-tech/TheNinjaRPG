import { describe, expect, it } from "bun:test";
import { AttackMethods, AttackTargets } from "@/drizzle/constants";
import {
  formatAmount,
  formatAttackMethod,
  formatAttackTarget,
  formatEnumLabel,
  humanizeConstant,
  stripHtmlPreview,
} from "@/utils/string";

describe("stripHtmlPreview", () => {
  it("separates block text and collapses whitespace", () => {
    expect(stripHtmlPreview("<p>Line one</p>\n<p>Line  two</p>")).toBe(
      "Line one. Line two",
    );
  });

  it("turns a heading into its own sentence", () => {
    expect(
      stripHtmlPreview("<h2>The Hunt</h2><p>Track the beast.</p><p>Return!</p>"),
    ).toBe("The Hunt. Track the beast. Return!");
  });

  it("keeps existing punctuation and inline tags inside a sentence", () => {
    expect(
      stripHtmlPreview(
        "<p>Ready?</p><p>Go <b>now</b><br>quickly</p><ul><li>a</li></ul>",
      ),
    ).toBe("Ready? Go now quickly. a");
  });

  it("decodes the entities sanitized content carries", () => {
    expect(
      stripHtmlPreview("Rock&nbsp;&amp;&nbsp;roll &lt;3 &quot;it&#39;s&quot;"),
    ).toBe(`Rock & roll <3 "it's"`);
  });

  it("decodes once, so escaped entities stay literal", () => {
    expect(stripHtmlPreview("&amp;lt;b&amp;gt;")).toBe("&lt;b&gt;");
  });

  it("does not turn encoded markup back into tags to strip", () => {
    expect(stripHtmlPreview("&lt;b&gt;bold&lt;/b&gt;")).toBe("<b>bold</b>");
  });

  it("treats a missing value as empty", () => {
    expect(stripHtmlPreview(null)).toBe("");
  });
});

describe("encyclopedia enum labels", () => {
  it("names every attack target and method in plain words", () => {
    expect(formatAttackTarget("OTHER_USER")).toBe("Other player");
    expect(formatAttackMethod("SINGLE")).toBe("Single target");
    for (const target of AttackTargets)
      expect(formatAttackTarget(target)).not.toContain("_");
    for (const method of AttackMethods)
      expect(formatAttackMethod(method)).not.toContain("_");
  });

  it("turns other enum values into sentence case", () => {
    expect(formatEnumLabel("FIST_WEAPON")).toBe("Fist weapon");
    expect(formatEnumLabel("HAND_1")).toBe("Hand 1");
  });
});

describe("humanizeConstant", () => {
  it("turns roles and reason constants into readable words", () => {
    expect(humanizeConstant("CONTENT-ADMIN")).toBe("Content Admin");
    expect(humanizeConstant("HEAD_BALANCE")).toBe("Head Balance");
    expect(humanizeConstant("ACTIVITY_STREAK_RECURRING")).toBe(
      "Activity Streak Recurring",
    );
  });

  it("leaves written text unchanged", () => {
    expect(humanizeConstant("Helped new players in chat")).toBe(
      "Helped new players in chat",
    );
    expect(humanizeConstant("PvP event winner")).toBe("PvP event winner");
  });
});

describe("formatAmount", () => {
  it("rounds to whole units with thousand separators", () => {
    expect(formatAmount(1.3)).toBe("1");
    expect(formatAmount(1234567.5)).toBe("1,234,568");
    expect(formatAmount(0)).toBe("0");
  });
});
