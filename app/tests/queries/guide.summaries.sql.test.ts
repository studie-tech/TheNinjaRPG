import { beforeEach, expect, it } from "bun:test";
import { guideArticle } from "@/drizzle/schema";
import { fetchPublishedGuides, listGuideArticleForGetAll } from "@/queries/guide";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../setup/testDatabase";

const guide = (id: string, patch: Partial<typeof guideArticle.$inferInsert> = {}) => ({
  id,
  slug: id,
  title: `Guide ${id}`,
  category: "combat" as const,
  content: `<p>${"Full article body. ".repeat(50)}</p>`,
  excerpt: `About ${id}`,
  image: `https://example.test/${id}.webp`,
  faq: [{ question: "Q", answer: "A" }],
  reviewNotes: "Staff notes",
  published: true,
  ...patch,
});

describeWithDatabase("guide hub summaries", () => {
  beforeEach(async () => {
    await resetTables(guideArticle);
    const db = await getTestDatabase();
    await db
      .insert(guideArticle)
      .values([
        guide("later", { sortOrder: 2 }),
        guide("first", { sortOrder: 1, title: "B guide" }),
        guide("also-first", { sortOrder: 1, title: "A guide" }),
        guide("draft", { published: false, sortOrder: 0 }),
      ]);
  });

  it("lists published cards in hub order without article bodies", async () => {
    const guides = await fetchPublishedGuides(await getTestDatabase());
    expect(guides.map((row) => row.slug)).toEqual(["also-first", "first", "later"]);
    expect(guides[0]).toEqual({
      id: "also-first",
      slug: "also-first",
      title: "A guide",
      excerpt: "About also-first",
      image: "https://example.test/also-first.webp",
      category: "combat",
      published: true,
    });
  });

  it("lists drafts for staff with the same card fields", async () => {
    const guides = await listGuideArticleForGetAll(await getTestDatabase());
    expect(guides.map((row) => [row.slug, row.published])).toEqual([
      ["draft", false],
      ["also-first", true],
      ["first", true],
      ["later", true],
    ]);
    expect(Object.keys(guides[0] ?? {}).sort()).toEqual([
      "category",
      "excerpt",
      "id",
      "image",
      "published",
      "slug",
      "title",
    ]);
  });
});
