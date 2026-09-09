/**
 * Generate landscape covers for first-party system guides with gpt-image-2,
 * compress to webp, upload to UploadThing (Bunny CDN via the Image component).
 *
 * Usage (from /app): bun run scripts/generate-guide-covers.ts
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import OpenAI from "openai";
import sharp from "sharp";
import { UTApi, UTFile } from "uploadthing/server";
import { guideArticle } from "@/drizzle/schema";
import { SYSTEM_GUIDE_ARTICLES } from "@/libs/guide/articles";
import { servedUfsUrl } from "@/libs/uploadthing";
import { drizzleDB } from "@/server/db";

const STYLE =
  "Stylized painted illustration for a ninja browser game, bold readable shapes, smooth shading, no dithering, no film grain, no noise, no photorealism, no text, no letters, no UI, no watermark, no logos. Bright high-key daylight, saturated jewel tones (jade, vermillion, gold, turquoise, sakura), clear silhouettes, generous sky or sunlit ground so the scene stays readable as an 80px thumbnail on a light parchment background. Avoid large black areas, night scenes, muddy shadows and low-contrast dusk.";

const PROMPTS: Record<string, string> = {
  "getting-started":
    `${STYLE} Bright spring morning at a hidden academy courtyard. A young ninja with a travel pack stands at an orange torii, cherry blossoms and a turquoise sky, village rooftops in clear sunlight.`,
  combat:
    `${STYLE} Midday hex battlefield under a vivid blue sky. Two ninjas clash — one leaping with a bright blade, the other casting a bold vermillion fire jutsu. Green grass hexes, gold sparks, high contrast.`,
  "combat-tags":
    `${STYLE} A sunlit study table. A jutsu scroll unfurls into large glowing elemental orbs — fire orange, water teal, wind mint, earth gold — against warm wood and a bright window.`,
  "prevent-tags":
    `${STYLE} A sunlit training yard. A defensive ninja holds a glowing cyan hexagonal barrier that stops bright kunai and a puff of violet chakra. Clear blue sky behind the shield.`,
  "cleansable-tags":
    `${STYLE} A bright infirmary with open shoji and daylight. A medical ninja washes lime-green poison mist off an ally with a glowing gold-and-aqua water seal.`,
  "clearable-tags":
    `${STYLE} A sun-dappled forest path. A hunter-nin shatters a bright golden buff aura into sparkling shards. Warm greens and amber light, no dark canopy.`,
  "combat-tag-priority":
    `${STYLE} Overhead view of a bright hex arena at noon. Layered colorful effects: a cyan shield, a vermillion damage burst, gold residual sparkles on pale stone.`,
  "loadout-building":
    `${STYLE} A workshop flooded with window daylight. Arranged kunai, a vermillion vest, sealed scrolls and a gold bloodline charm on pale wood. Clear, colorful objects.`,
  "ai-rules":
    `${STYLE} A sunny outdoor training yard. A wooden dummy painted in bright red and white faces a ninja practicing colorful hand-sign seals. Blue sky, green grass.`,
  raids:
    `${STYLE} Four ninjas on a sunlit crater plain at golden hour. A colossal colorful tailed-beast silhouette against a vivid orange-and-turquoise sky, not night.`,
  "bracket-system":
    `${STYLE} Two ranked ninjas bowing in a circular stone arena at midday. Bright hanging banners in red, gold and teal, a cheerful crowd, clear sky above.`,
  farming:
    `${STYLE} Terraced herb gardens in bright morning sun. A farmer-ninja waters vivid magenta moonpetal and jade plants. Turquoise sky, lime terraces, village wall in warm stone.`,
  villages:
    `${STYLE} A brightly painted pictorial map of Seichi: five colorful hidden villages, teal rivers, gold mountains, spring-green fields. No readable names.`,
  world:
    `${STYLE} A ninja on a sunlit overlook looking down at a vivid hex-tiled countryside — gold roads, green fields, a turquoise sea and a bright island.`,
  "wake-island":
    `${STYLE} Tropical noon on Wake Island. Turquoise water, white sand, lime palms, a glass lab dome flashing in the sun, a ninja approaching a gold bloodline pavilion.`,
  bloodlines:
    `${STYLE} A hillside shrine in late-afternoon gold light. A ninja awakens a bloodline: bright eyes, swirling ancestral spirits in teal, gold and vermillion against a clear sky.`,
  ranks:
    `${STYLE} A pale stone stairway in golden sunlight, from a bright student headband to a vermillion jonin cloak. Each step a colorful ninja silhouette, turquoise sky.`,
  economy:
    `${STYLE} A busy sunlit village market: stacks of gleaming gold ryo, a bright bank window, paper lanterns in red and teal, colorful stalls, blue sky at the street end.`,
  "auction-house":
    `${STYLE} A well-lit auction hall with open windows. Ninjas bid on a gold-sealed scroll chest. Warm wood, red and teal banners, daylight mixing with lantern glow.`,
  "item-variants":
    `${STYLE} Three ornate katanas with vividly different scabbards — vermillion, jade and gold — on a pale weapons rack beside a bright workshop window.`,
};

const COVER_WIDTH = 1280;
const COVER_HEIGHT = 640;
const COVER_VERSION = "v3";

const generateOne = async (slug: string, prompt: string) => {
  const client = new OpenAI();
  const image = await client.images.generate({
    model: "gpt-image-2",
    prompt,
    size: "1536x1024",
    quality: "high",
    n: 1,
  });
  const b64 = image.data?.[0]?.b64_json;
  if (!b64) throw new Error(`No image bytes for ${slug}`);
  const webp = await sharp(Buffer.from(b64, "base64"))
    .resize({ width: COVER_WIDTH, height: COVER_HEIGHT, fit: "cover" })
    .webp({ quality: 88, effort: 4 })
    .toBuffer();
  const fileName = `guide-${slug}-${COVER_VERSION}.webp`;
  const utapi = new UTApi();
  const uploaded = await utapi.uploadFiles(
    new UTFile([webp as BlobPart], fileName, { customId: fileName }),
  );
  if (uploaded.error || !uploaded.data) {
    throw new Error(uploaded.error?.message ?? `Upload failed for ${slug}`);
  }
  return servedUfsUrl(uploaded.data);
};

const writeCoversModule = (covers: Record<string, string>) => {
  const body = [
    "/** Generated cover URLs for first-party system guides (UploadThing, served via Bunny). */",
    "export const GUIDE_SYSTEM_COVERS: Record<string, string> = {",
    ...Object.entries(covers).map(([slug, url]) => `  "${slug}": "${url}",`),
    "};",
    "",
  ].join("\n");
  writeFileSync(new URL("../src/libs/guide/covers.ts", import.meta.url), body);
};

const main = async () => {
  const covers: Record<string, string> = {};
  const slugs = SYSTEM_GUIDE_ARTICLES.map((article) => article.slug);
  for (const slug of slugs) {
    const prompt = PROMPTS[slug] ?? `${STYLE} A bright sunlit ninja scene about ${slug.replaceAll("-", " ")} in Seichi.`;
    console.log("generating", slug);
    covers[slug] = await generateOne(slug, prompt);
    console.log(" uploaded", slug);
    await drizzleDB
      .update(guideArticle)
      .set({ image: covers[slug] })
      .where(eq(guideArticle.slug, slug));
    writeCoversModule(covers);
  }
  console.log("wrote covers.ts", Object.keys(covers).length);
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
