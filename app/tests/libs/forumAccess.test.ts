import { forumMentionNames, hasForumContent } from "@/libs/forumContent";
import { describe, expect, it } from "bun:test";
import { forumPermissions } from "@/libs/forumAccess";
import type { ForumCapability } from "@/validators/forum";
const board = { id: "board", sectionId: "section", policy: {}, archived: false };
const section = { policy: {}, archived: false };
const actor = { userId: "player", role: "USER" as const };
const grant = (permissions: ForumCapability[], denies: ForumCapability[] = []) => ({
  userId: actor.userId,
  scope: "BOARD" as const,
  scopeId: board.id,
  permissions,
  denies,
});
describe("forum effective access", () => {
  it("keeps guests read-only and does not infer moderation from a support staff label", () => {
    expect(forumPermissions(null, board, section, [])).toMatchObject({
      read: true,
      create: false,
      reply: false,
      moderate: false,
    });
    expect(
      forumPermissions({ ...actor, role: "CONTENT" }, board, section, []).moderate,
    ).toBe(false);
  });
  it("inherits a private section and a staff-only posting policy", () => {
    expect(
      forumPermissions(null, board, { ...section, policy: { read: "STAFF" } }, []).read,
    ).toBe(false);
    expect(
      forumPermissions(actor, { ...board, policy: { create: "STAFF" } }, section, [])
        .create,
    ).toBe(false);
  });
  it("applies scoped assignments and lets explicit denies win over grants", () => {
    expect(
      forumPermissions(actor, board, section, [grant(["moderate"])]).moderate,
    ).toBe(true);
    expect(
      forumPermissions(actor, { ...board, id: "other" }, section, [grant(["moderate"])])
        .moderate,
    ).toBe(false);
    expect(
      forumPermissions(actor, board, section, [grant(["moderate"], ["moderate"])])
        .moderate,
    ).toBe(false);
  });
  it("keeps archive and account restrictions above ordinary posting grants", () => {
    expect(
      forumPermissions(actor, { ...board, archived: true }, section, [grant(["reply"])])
        .reply,
    ).toBe(false);
    expect(
      forumPermissions({ ...actor, isSilenced: true }, board, section, [
        grant(["create", "reply"]),
      ]).create,
    ).toBe(false);
  });
  it("requires a distinct explicit purge grant even for bootstrap administrators", () => {
    const admin = { ...actor, role: "MODERATOR-ADMIN" as const };
    expect(forumPermissions(admin, board, section, []).purge).toBe(false);
    expect(forumPermissions(admin, board, section, [grant(["purge"])]).purge).toBe(
      true,
    );
  });
});

describe("forum message meaning and mentions", () => {
  it("rejects empty markup while retaining media and useful text", () => {
    expect(hasForumContent("<p><br></p>")).toBe(false);
    expect(hasForumContent("<p>    </p>")).toBe(false);
    expect(hasForumContent("<p>A useful answer.</p>")).toBe(true);
    expect(hasForumContent('<img src="https://example.com/guide.png">')).toBe(true);
  });
  it("recognizes authored mentions once and leaves quoted people unpinged", () => {
    expect(
      forumMentionNames(
        "<blockquote>@QuotedPlayer said this</blockquote><p>Thanks @HelpfulPlayer, and @HelpfulPlayer!</p>",
      ),
    ).toEqual(["HelpfulPlayer"]);
  });
});
