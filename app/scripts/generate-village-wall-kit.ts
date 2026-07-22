/**
 * Generate a coherent modular village-wall kit with the same model used by
 * the content editor, normalize every result to a fixed lossless canvas, and
 * upload the approved candidates to UploadThing.
 *
 * Every role is generated and reviewed separately. Dependent roles require
 * URLs from already-approved source gates; the script never silently chains
 * an unreviewed output into the next generation.
 *
 * Usage:
 *   bun run scripts/generate-village-wall-kit.ts --role panel-horizontal
 *   bun run scripts/generate-village-wall-kit.ts --role panel-horizontal --depth-pass --panel-url URL
 *   bun run scripts/generate-village-wall-kit.ts --role panel-diagonal-down --depth-pass --geometry-url URL --panel-url DEPTH_MASTER_URL
 *   bun run scripts/generate-village-wall-kit.ts --role pier --panel-url URL
 *   bun run scripts/generate-village-wall-kit.ts --role panel-diagonal-down --panel-url URL
 *   bun run scripts/generate-village-wall-kit.ts --role gate-horizontal --matching-panel-url URL --pier-url URL
 */
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nanoid } from "nanoid";
import type { FileOutput } from "replicate";
import Replicate from "replicate";
import sharp from "sharp";
import { UTApi, UTFile } from "uploadthing/server";
import { env } from "@/env/server.mjs";
import { servedUfsUrl } from "@/libs/uploadthing";
import { removeBackgroundReplicate } from "@/libs/replicate";

const SOURCE_TOWER =
  "https://uploadthing.b-cdn.net/f/aab037bb-7ac7-48f7-9994-548d87eb55f1-lga892.webp";
const OUTPUT_SIZE = 256;
const KIT_VERSION = "stone-v6";
const DEPTH_VERSION = "stone-depth-v2-wallwalk";

const depthMasterPrompt = `
Edit the supplied horizontal wall sprite; do not redesign or rotate it. Treat
its ground geometry as a locked technical template. Preserve the exact straight
left-to-right screen-horizontal axis, overall length, flush open end positions,
ground connector positions, three brick courses, and crenellation rhythm. The
old top strip is specifically NOT a silhouette constraint. Rebuild it as a
clearly visible elevated wall-walk: expose a 24-30 pixel-deep paved top plane,
move a separate rear coping/parapet behind it, and place the crenellations on
that rear parapet. The top plane must remain 6-8 pixels wide after the entire
sprite is reduced to one hex side. Show three unmistakable planes: light-beige
walkway, warm midtone front facade, and cool darker side facets, with hard-edged
2-3 tone pixel shading. Light comes from the upper-right. Keep mortar dark and
brick scale unchanged. The result remains screen-horizontal, not an isometric
diagonal wall.
No posts, end caps, towers, terrain, shadows, text, scenery, blur, glow, or
detached pieces. Plain solid white background.`;

const depthPropagationPrompt = (role: string) => `
The first image is the locked ${role} geometry template. The second image is
the approved horizontal depth-and-material master. Preserve the first image's
exact axis, length, opening (if any), ground connector positions, brick courses,
crenellation rhythm, and role. Reconstruct the second image's full depth grammar
relative to that axis: a 24-30 pixel-deep paved wall-walk, separate rear coping
and parapet, rear-mounted crenellations, warm midtone front stones, cool dark
side facets, hard-edged 2-3 tone pixel shading, brick scale, and upper-right
lighting. The visible top plane must survive reduction to 6-8 pixels. Do not
rotate, mirror, shorten, cap, or move the ground connectors. Keep flush modular ends. No
terrain, shadow, text, scenery, blur, glow, or detached pieces. Plain solid
white background.`;

const styleContract = `
Match the supplied TheNinjaRPG stone tower exactly: cute retro pixel art,
elevated orthographic three-quarter map view, warm grey-beige carved masonry,
2-3 tone hard-edged shading. Top planes are light beige, screen-left faces are
warm midtone, and screen-right faces are cool dark grey. Keep the
same brick scale, wall thickness, pixel density, and muted palette. Produce one
isolated modular game-map object only. No terrain, road, grass, text, scenery,
frame, loose rubble, glow, blur, perspective convergence, or dramatic shadow.
Use a plain solid white background. Keep transparent-safe padding on every side.
The object must read clearly after reduction to roughly one hex side.`;

const specs = [
  {
    role: "panel-horizontal",
    prompt: `The first image is a strict geometry silhouette and the second is only the masonry/palette reference. Follow the first image's exact left-to-right SCREEN-HORIZONTAL direction and endpoint locations. The long top and bottom edges must be level on screen, never diagonal. NEVER reproduce charcoal or magenta guide marks. Create one clean low wall with flush open ends, identical end cross-sections, five brick courses, and one modest crenellation row. No end caps, towers, or posts. ${styleContract}`,
  },
  {
    role: "pier",
    prompt: `The first image is a strict geometry silhouette, the second is the approved canonical horizontal wall, and the third is the old masonry reference. Create one small plain square seam pier with exactly the canonical wall's brick size, palette, wall thickness and crenellation language. It is one wall-thickness wide and only 15% taller than the wall. Never reproduce guide colors. ${styleContract}`,
  },
  {
    role: "panel-diagonal-down",
    prompt: `The first image is a strict geometry silhouette. The second is the approved canonical wall and must be matched exactly in brick scale, palette, five-course height, thickness, crenellation rhythm, and flush connector cross-section. Rebuild that same wall on the exact upper-left to lower-right screen axis. Never reproduce guide colors and add no caps, posts, medallions, or ornaments. ${styleContract}`,
  },
  {
    role: "panel-diagonal-up",
    prompt: `The first image is a strict geometry silhouette. The second is the approved canonical wall and must be matched exactly in brick scale, palette, five-course height, thickness, crenellation rhythm, and flush connector cross-section. Rebuild that same wall on the exact lower-left to upper-right screen axis. Never reproduce guide colors and add no caps, posts, medallions, or ornaments. ${styleContract}`,
  },
  {
    role: "gate-horizontal",
    prompt: `The first image is a strict geometry silhouette, the second is the approved matching wall panel, and the third is the approved seam pier. Replace the middle of that exact wall with one clearly open passage and a shallow lintel supported by two piers identical to the reference pier. Side stubs must preserve the panel connector exactly. Never reproduce guide colors. No road or ground. ${styleContract}`,
  },
  {
    role: "gate-diagonal-down",
    prompt: `The first image is a strict geometry silhouette, the second is the approved matching diagonal wall, and the third is the approved seam pier. Replace the wall center with an open passage and shallow lintel on the exact same axis. Side stubs and connectors must be unchanged from the panel. Never reproduce guide colors. No road or ground. ${styleContract}`,
  },
  {
    role: "gate-diagonal-up",
    prompt: `The first image is a strict geometry silhouette, the second is the approved matching diagonal wall, and the third is the approved seam pier. Replace the wall center with an open passage and shallow lintel on the exact same axis. Side stubs and connectors must be unchanged from the panel. Never reproduce guide colors. No road or ground. ${styleContract}`,
  },
  {
    role: "tower",
    prompt: `The first image is a strict geometry silhouette, the second is the old tower reference, the third is the approved canonical wall, and the fourth is the approved seam pier. Create one cleaned large corner watchtower using exactly the approved wall's brick scale, palette and crenellation language. It should be roughly twice the pier height and remain compact. No white or grey aura, background, ground, or detached shadow. ${styleContract}`,
  },
] as const;

const guideSvg = (role: (typeof specs)[number]["role"]) => {
  const horizontal = role.endsWith("horizontal");
  const diagonalDown = role.endsWith("diagonal-down");
  const gate = role.startsWith("gate-");
  let shape = "";
  if (role === "tower") {
    shape = '<rect x="91" y="44" width="74" height="150" rx="6" fill="#333"/>';
  } else if (role === "pier") {
    shape = '<rect x="108" y="104" width="40" height="76" rx="3" fill="#333"/>';
  } else if (horizontal) {
    shape = gate
      ? '<path d="M28 132H92V178H28ZM164 132H228V178H164ZM92 100H164V128H92Z" fill="#333"/>'
      : '<path d="M28 124H228V178H28Z" fill="#333"/>';
  } else if (diagonalDown) {
    shape = gate
      ? '<path d="M30 73L91 104V151L30 120ZM165 141L226 172V219L165 188ZM89 85L179 130L165 158L75 113Z" fill="#333"/>'
      : '<path d="M30 73L226 171V219L30 121Z" fill="#333"/>';
  } else {
    shape = gate
      ? '<path d="M30 172L91 141V188L30 219ZM165 104L226 73V120L165 151ZM77 130L167 85L181 113L91 158Z" fill="#333"/>'
      : '<path d="M30 171L226 73V121L30 219Z" fill="#333"/>';
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" fill="white"/>${shape}<circle cx="28" cy="178" r="5" fill="#ff00ff"/><circle cx="228" cy="178" r="5" fill="#ff00ff"/></svg>`;
};

const insideRoleMask = (
  role: (typeof specs)[number]["role"],
  x: number,
  y: number,
) => {
  if (role === "tower") return x >= 65 && x <= 191 && y >= 15 && y <= 238;
  if (role === "pier") return x >= 82 && x <= 174 && y >= 65 && y <= 220;
  if (role.endsWith("horizontal")) return x >= 12 && x <= 244 && y >= 58 && y <= 205;
  if (role.endsWith("diagonal-down")) {
    const center = x * 0.5 + 52;
    return x >= 12 && x <= 244 && y >= center - 55 && y <= center + 60;
  }
  const center = 210 - x * 0.5;
  return x >= 12 && x <= 244 && y >= center - 60 && y <= center + 55;
};

const normalizedPng = async (
  input: Buffer,
  role: (typeof specs)[number]["role"],
) => {
  const target =
    role === "tower"
      ? { width: 160, height: 224 }
      : role === "pier"
        ? { width: 100, height: 150 }
        : role.startsWith("gate-")
          ? { width: 232, height: 190 }
          : role.endsWith("horizontal")
            ? { width: 232, height: 150 }
            : { width: 232, height: 200 };
  const horizontalPadding = OUTPUT_SIZE - target.width;
  const verticalPadding = OUTPUT_SIZE - target.height;
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
    .resize(target.width, target.height, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.nearest,
    })
    .extend({
      left: Math.floor(horizontalPadding / 2),
      right: Math.ceil(horizontalPadding / 2),
      top: Math.floor(verticalPadding / 2),
      bottom: Math.ceil(verticalPadding / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let offset = 0; offset < data.length; offset += info.channels) {
    const pixel = offset / info.channels;
    const x = pixel % info.width;
    const y = Math.floor(pixel / info.width);
    const alphaOffset = offset + 3;
    const alpha = data[alphaOffset] ?? 0;
    if (alpha < 64 || !insideRoleMask(role, x, y)) {
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[alphaOffset] = 0;
    } else if (alpha < 255) {
      const normalizedAlpha = alpha / 255;
      for (let channel = 0; channel < 3; channel++) {
        const value = data[offset + channel] ?? 0;
        data[offset + channel] = Math.max(
          0,
          Math.min(255, Math.round((value - 255 * (1 - normalizedAlpha)) / normalizedAlpha)),
        );
      }
    }
  }
  return await sharp(data, { raw: info }).png({ compressionLevel: 9 }).toBuffer();
};

const roleReferences = (
  role: (typeof specs)[number]["role"],
  guideUrl: string,
  references: { panel?: string; matchingPanel?: string; pier?: string },
) => {
  if (role === "panel-horizontal") {
    return references.panel ? [guideUrl, references.panel] : [guideUrl];
  }
  if (role === "pier") {
    if (!references.panel) throw new Error("--panel-url is required for pier");
    return [guideUrl, references.panel, SOURCE_TOWER];
  }
  if (role === "panel-diagonal-down" || role === "panel-diagonal-up") {
    if (!references.panel) throw new Error(`--panel-url is required for ${role}`);
    return [guideUrl, references.panel];
  }
  if (role === "tower") {
    if (!references.panel || !references.pier) {
      throw new Error("--panel-url and --pier-url are required for tower");
    }
    return [guideUrl, SOURCE_TOWER, references.panel, references.pier];
  }
  if (!references.matchingPanel || !references.pier) {
    throw new Error(`--matching-panel-url and --pier-url are required for ${role}`);
  }
  return [guideUrl, references.matchingPanel, references.pier];
};

const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const main = async () => {
  const replicate = new Replicate({ auth: env.REPLICATE_API_TOKEN });
  const utapi = new UTApi();
  const outputDir = join(tmpdir(), `tnr-wall-kit-${nanoid()}`);
  await mkdir(outputDir, { recursive: true });
  const requestedRole = argument("--role");
  const selected = specs.find((spec) => spec.role === requestedRole);
  if (!selected) {
    throw new Error(`Pass --role with one of: ${specs.map(({ role }) => role).join(", ")}`);
  }
  const references = {
    geometry: argument("--geometry-url"),
    panel: argument("--panel-url"),
    matchingPanel: argument("--matching-panel-url"),
    pier: argument("--pier-url"),
  };
  const depthPass = process.argv.includes("--depth-pass");
  if (depthPass && !references.panel) {
    throw new Error("--depth-pass requires --panel-url");
  }
  if (depthPass && selected.role !== "panel-horizontal" && !references.geometry) {
    throw new Error(
      "Dependent --depth-pass roles require --geometry-url and --panel-url",
    );
  }
  const outputVersion = depthPass ? DEPTH_VERSION : KIT_VERSION;
  const manifest: Record<string, string> = {};

  for (const spec of [selected]) {
    console.log(`Generating ${spec.role} (single-role review gate)`);
    let imageInput: string[];
    let prompt: string;
    if (depthPass) {
      if (selected.role === "panel-horizontal") {
        imageInput = [references.panel as string];
        prompt = depthMasterPrompt;
      } else {
        imageInput = [references.geometry as string, references.panel as string];
        prompt = depthPropagationPrompt(selected.role);
      }
    } else {
      const guide = await sharp(Buffer.from(guideSvg(spec.role))).png().toBuffer();
      const guideName = `${outputVersion}-${spec.role}-geometry-guide.png`;
      const uploadedGuide = await utapi.uploadFiles(
        new UTFile([guide as BlobPart], guideName, { customId: guideName }),
      );
      if (!uploadedGuide.data || uploadedGuide.error) {
        throw new Error(`Guide upload failed for ${spec.role}`);
      }
      imageInput = roleReferences(
        spec.role,
        servedUfsUrl(uploadedGuide.data),
        references,
      );
      prompt = spec.prompt;
    }
    const generated = (await replicate.run("google/nano-banana", {
      input: {
        image_input: imageInput,
        prompt,
      },
    })) as FileOutput;
    if (!generated) throw new Error(`No generated image for ${spec.role}`);
    const removed = await removeBackgroundReplicate(String(generated.url()));
    const source = Buffer.from(await (await removed.blob()).arrayBuffer());
    const png = await normalizedPng(source, spec.role);
    const localPath = join(outputDir, `${spec.role}.png`);
    await sharp(png).toFile(localPath);

    const filename = `village-wall-${outputVersion}-${spec.role}.png`;
    const uploaded = await utapi.uploadFiles(
      new UTFile([png as BlobPart], filename, { customId: filename }),
    );
    if (!uploaded.data || uploaded.error) {
      throw new Error(`Upload failed for ${spec.role}: ${uploaded.error?.message}`);
    }
    manifest[spec.role] = servedUfsUrl(uploaded.data);
    console.log(`  ${spec.role}: ${manifest[spec.role]}`);
  }

  console.log("WALL_KIT_MANIFEST_START");
  console.log(JSON.stringify({ version: outputVersion, assets: manifest }, null, 2));
  console.log("WALL_KIT_MANIFEST_END");
  console.log(`Local review candidates: ${outputDir}`);
};

void main();
