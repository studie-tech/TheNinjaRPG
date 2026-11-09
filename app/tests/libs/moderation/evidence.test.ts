import { describe, expect, it } from "bun:test";
import { buildModerationEvidence } from "@/libs/moderation/evidence";
import sanitize, { htmlToModerationInput } from "@/utils/sanitize";
import { moderationDecisionSchema } from "@/validators/moderation";
import type { AdditionalContext } from "@/validators/reports";

const context = (content: string, at: string): AdditionalContext => ({
  userId: "speaker",
  username: "Speaker",
  avatar: null,
  level: 1,
  rank: "STUDENT",
  federalStatus: "NONE",
  isOutlaw: false,
  role: "USER",
  content,
  createdAt: new Date(at),
});
describe("moderation evidence", () => {
  it("uses reported content and keeps allegations and private account fields separate", () => {
    const evidence = buildModerationEvidence({
      infraction: {
        content: "<p>The actual message &amp; context</p>",
        username: "Target",
        lastIp: "private",
        email: "private",
        money: 99,
      },
      system: "conversation_comment",
      reportedUserId: "target",
      sourceId: "post",
      reporterReason: "An unverified allegation",
      context: [
        context("later", "2026-01-01T12:00Z"),
        context("earlier", "2026-01-01T11:00Z"),
      ],
    });
    expect(evidence.target.content).toBe("The actual message & context");
    expect(evidence.reporterAllegation).toBe("An unverified allegation");
    expect(evidence.reportedAuthorId).toBe("target");
    expect(evidence.conversation.map((row) => row.content)).toEqual([
      "earlier",
      "later",
    ]);
    expect(JSON.stringify(evidence)).not.toContain("private");
  });
  it("preserves quote attribution and private visibility", () => {
    const evidence = buildModerationEvidence({
      system: "privateMessage",
      infraction: {
        content:
          '<blockquote author="Other" date="yesterday">Offensive quote</blockquote><p>Please stop.</p>',
      },
    });
    expect(evidence.target.contentMarkup).toContain('author="Other"');
    expect(evidence.target.contentMarkup).toContain("</blockquote>");
    expect(evidence.visibility).toBe("private");
  });
  it("includes hidden link destinations in both the gate and decision evidence", () => {
    const content = '<a href="https://prohibited.example/path?a=1&amp;b=2">guide</a>';
    expect(htmlToModerationInput(content)).toContain(
      "https://prohibited.example/path?a=1&b=2",
    );
    expect(
      buildModerationEvidence({ system: "forumPost", infraction: { content } })
        .linkDestinations,
    ).toEqual(["https://prohibited.example/path?a=1&b=2"]);
  });
  it.each([
    [
      '<p>Game guide</p><iframe src="https://embed.example/video?a=1&amp;b=2"></iframe>',
      "https://embed.example/video?a=1&b=2",
    ],
    [
      '<img src="https://images.example/guide.png" onerror="alert(1)" />',
      "https://images.example/guide.png",
    ],
  ])(
    "preserves supported media destinations in gate, target and context evidence: %s",
    (html, destination) => {
      const content = sanitize(html);
      expect(content).toContain("src=");
      expect(content).not.toContain("onerror");
      expect(htmlToModerationInput(content)).toContain(
        `Link destination: ${destination}`,
      );
      const evidence = buildModerationEvidence({
        system: "forumPost",
        infraction: { content },
        context: [context(content, "2026-01-01T12:00Z")],
      });
      expect(evidence.linkDestinations).toEqual([destination]);
      expect(evidence.conversation[0]?.linkDestinations).toEqual([destination]);
    },
  );
  it("describes missing account, image and linked battle evidence explicitly", () => {
    for (const system of ["user_profile", "concept_art", "battle_log"]) {
      expect(
        buildModerationEvidence({ infraction: {}, system }).evidenceLimitations,
      ).toHaveLength(1);
    }
  });
  it("cannot emit an unviewed or escalation state as a model decision", () => {
    expect(
      moderationDecisionSchema.safeParse({
        createReport: "UNVIEWED",
        reasoning: "test",
      }).success,
    ).toBe(false);
    expect(
      moderationDecisionSchema.safeParse({
        createReport: "REPORT_CLEARED",
        reasoning: "test",
      }).success,
    ).toBe(true);
  });
});
