import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://www.theninja-rpg.com",
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      url: "https://www.theninja-rpg.com/news",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.5,
    },
    // TODO: Different news articles
    {
      url: "https://www.theninja-rpg.com/rules",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.5,
    },
    {
      url: "https://www.theninja-rpg.com/manual",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.5,
    },
    {
      url: "https://www.theninja-rpg.com/manual/combat",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.5,
    },
    {
      url: "https://www.theninja-rpg.com/manual/world",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.5,
    },
    {
      url: "https://www.theninja-rpg.com/manual/bloodline",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.5,
    },
    // TODO: Bloodline pages
    {
      url: "https://www.theninja-rpg.com/manual/jutsu",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.5,
    },
    // TODO: Jutsu pages
    {
      url: "https://www.theninja-rpg.com/manual/item",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.5,
    },
    // TODO: Item pages
    {
      url: "https://www.theninja-rpg.com/manual/ai",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.5,
    },
    // TODO: AI pages
    {
      url: "https://www.theninja-rpg.com/manual/quest",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.5,
    },
    // TODO: Quest pages
    {
      url: "https://www.theninja-rpg.com/manual/damage_calcs",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.5,
    },
    {
      url: "https://www.theninja-rpg.com/manual/badge",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.5,
    },
    {
      url: "https://www.theninja-rpg.com/manual/asset",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.5,
    },
    {
      url: "https://www.theninja-rpg.com/manual/opinions",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.5,
    },
    {
      url: "https://www.theninja-rpg.com/help",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.5,
    },
    {
      url: "https://www.theninja-rpg.com/conceptart",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.5,
    },
    // TODO: Different concept arts
  ];
}
