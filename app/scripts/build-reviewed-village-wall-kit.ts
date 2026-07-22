/**
 * Build the geometry-locked wall kit after the generator establishes its
 * masonry palette and tower language. Panels, gates and the seam pier are
 * deterministic so every connector lands on the hex lattice exactly.
 */
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { UTApi, UTFile } from "uploadthing/server";
import { servedUfsUrl } from "@/libs/uploadthing";

const VERSION = "stone-v13-seam-cap";
const SIZE = 256;
const palette = {
  outline: "#403930",
  mortar: "#5b5143",
  face: "#a9916b",
  faceLight: "#bda47a",
  faceDark: "#7b6d58",
  top: "#d4bd8d",
  topLight: "#ead8aa",
};

const point = (x: number, y: number) => `${x.toFixed(1)},${y.toFixed(1)}`;
const polygon = (points: [number, number][], fill: string) =>
  `<polygon points="${points.map(([x, y]) => point(x, y)).join(" ")}" fill="${fill}" stroke="${palette.outline}" stroke-width="3" stroke-linejoin="round"/>`;
const fillPolygon = (points: [number, number][], fill: string) =>
  `<polygon points="${points.map(([x, y]) => point(x, y)).join(" ")}" fill="${fill}"/>`;
const line = (x1: number, y1: number, x2: number, y2: number, width = 2) =>
  `<path d="M${point(x1, y1)}L${point(x2, y2)}" fill="none" stroke="${palette.mortar}" stroke-width="${width}"/>`;
const coloredLine = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width = 2,
) =>
  `<path d="M${point(x1, y1)}L${point(x2, y2)}" fill="none" stroke="${color}" stroke-width="${width}"/>`;

const wallSvg = (slope: number, gate: boolean) => {
  const left = 20;
  const right = 236;
  const centerY = (x: number) => 148 + slope * (x - 128);
  const topY = (x: number) => centerY(x) - 18;
  const bottomY = (x: number) => centerY(x) + 26;
  // Recede perpendicular to the authored screen axis. A 24px wall-walk is
  // intentionally bold: the in-game sprite is reduced to about 26%, where
  // the old 11px coping collapsed into a flat 2-3px stripe.
  const depth = 24;
  const normalLength = Math.sqrt(1 + slope * slope);
  const depthX = (depth * slope) / normalLength;
  const depthY = -depth / normalLength;
  const rearX = (x: number) => x + depthX;
  const rearY = (x: number) => topY(x) + depthY;
  const runs: [number, number][] = gate
    ? [
        [left, 88],
        [168, right],
      ]
    : [[left, right]];
  const shapes: string[] = [];

  for (const [start, end] of runs) {
    // The broad top plane and its transverse paving joints are the primary
    // depth cue. They are geometry, not a highlight painted on the facade.
    shapes.push(
      polygon(
        [
          [rearX(start), rearY(start)],
          [rearX(end), rearY(end)],
          [end, topY(end)],
          [start, topY(start)],
        ],
        palette.top,
      ),
    );
    shapes.push(
      coloredLine(
        rearX(start) + 1,
        rearY(start) + 2,
        rearX(end) - 1,
        rearY(end) + 2,
        palette.topLight,
        3,
      ),
    );
    for (let x = start + 26; x < end - 4; x += 28) {
      shapes.push(line(rearX(x), rearY(x) + 3, x, topY(x) - 1, 1.5));
    }

    // A distinct rear coping wall prevents the wall-walk from reading as a
    // narrow highlight. The crenels sit on this rear edge, behind the walk.
    shapes.push(
      polygon(
        [
          [rearX(start), rearY(start) - 3],
          [rearX(end), rearY(end) - 3],
          [rearX(end), rearY(end) + 7],
          [rearX(start), rearY(start) + 7],
        ],
        palette.faceLight,
      ),
    );
    for (let x = start + 4; x < end - 5; x += 28) {
      const crenelRight = Math.min(x + 15, end);
      const bevelX = slope >= 0 ? 4 : -4;
      shapes.push(
        polygon(
          [
            [rearX(x), rearY(x) - 20],
            [rearX(crenelRight), rearY(crenelRight) - 20],
            [rearX(crenelRight), rearY(crenelRight) + 2],
            [rearX(x), rearY(x) + 2],
          ],
          palette.faceLight,
        ),
      );
      shapes.push(
        fillPolygon(
          [
            [rearX(x) + bevelX, rearY(x) - 25],
            [rearX(crenelRight) + bevelX, rearY(crenelRight) - 25],
            [rearX(crenelRight), rearY(crenelRight) - 20],
            [rearX(x), rearY(x) - 20],
          ],
          palette.topLight,
        ),
      );
      shapes.push(
        fillPolygon(
          [
            [rearX(crenelRight), rearY(crenelRight) - 20],
            [rearX(crenelRight) + bevelX, rearY(crenelRight) - 25],
            [rearX(crenelRight) + bevelX, rearY(crenelRight) - 4],
            [rearX(crenelRight), rearY(crenelRight) + 2],
          ],
          palette.faceDark,
        ),
      );
    }

    // Front facade, deliberately darker than the walk so the two planes
    // remain legible after nearest-neighbour downsampling.
    shapes.push(
      polygon(
        [
          [start, topY(start)],
          [end, topY(end)],
          [end, bottomY(end)],
          [start, bottomY(start)],
        ],
        palette.face,
      ),
    );
    const brickColors = [palette.face, palette.faceLight, palette.face, palette.faceDark];
    for (let row = 0; row < 4; row++) {
      const brickWidth = 25;
      const offset = row % 2 === 0 ? 0 : brickWidth / 2;
      let brickIndex = 0;
      for (let x = start - offset; x < end; x += brickWidth) {
        const brickStart = Math.max(start, x);
        const brickEnd = Math.min(end, x + brickWidth);
        if (brickEnd <= brickStart) continue;
        const rowTop = (value: number) => topY(value) + row * 11;
        const rowBottom = (value: number) => topY(value) + (row + 1) * 11;
        shapes.push(
          fillPolygon(
            [
              [brickStart, rowTop(brickStart)],
              [brickEnd, rowTop(brickEnd)],
              [brickEnd, rowBottom(brickEnd)],
              [brickStart, rowBottom(brickStart)],
            ],
            brickColors[(row + brickIndex) % brickColors.length] ?? palette.face,
          ),
        );
        brickIndex++;
      }
    }
    shapes.push(
      fillPolygon(
        [
          [start, bottomY(start) - 4],
          [end, bottomY(end) - 4],
          [end, bottomY(end)],
          [start, bottomY(start)],
        ],
        palette.faceDark,
      ),
    );
    shapes.push(
      coloredLine(
        start + 1,
        topY(start) + 2,
        end - 1,
        topY(end) + 2,
        palette.topLight,
        3,
      ),
    );
    for (let row = 1; row < 4; row++) {
      const fraction = row / 4;
      shapes.push(
        line(
          start,
          topY(start) + 44 * fraction,
          end,
          topY(end) + 44 * fraction,
        ),
      );
      const brickWidth = 25;
      const offset = row % 2 === 0 ? 0 : brickWidth / 2;
      for (let x = start + brickWidth - offset; x < end; x += brickWidth) {
        shapes.push(
          line(
            x,
            topY(x) + 44 * fraction,
            x,
            topY(x) + 44 * Math.min(1, fraction + 0.25),
          ),
        );
      }
    }
  }

  if (gate) {
    const pillar = (start: number, end: number) => {
      shapes.push(
        polygon(
          [
            [start, topY(start) - 22],
            [end, topY(end) - 22],
            [end, bottomY(end) + 4],
            [start, bottomY(start) + 4],
          ],
          palette.faceLight,
        ),
      );
      shapes.push(
        polygon(
          [
            [start - 3, topY(start) - 29],
            [end + 3, topY(end) - 29],
            [end, topY(end) - 20],
            [start, topY(start) - 20],
          ],
          palette.topLight,
        ),
      );
      for (const offset of [-5, 13, 31, 49]) {
        shapes.push(
          line(
            start,
            topY(start) + offset,
            end,
            topY(end) + offset,
          ),
        );
      }
      const middle = (start + end) / 2;
      shapes.push(
        line(middle, topY(middle) - 5, middle, bottomY(middle) + 4),
      );
      shapes.push(
        polygon(
          [
            [start + 2, topY(start) - 38],
            [end - 2, topY(end) - 38],
            [end - 2, topY(end) - 24],
            [start + 2, topY(start) - 24],
          ],
          palette.topLight,
        ),
      );
    };
    pillar(82, 101);
    pillar(155, 174);
    shapes.push(
      polygon(
        [
          [94, topY(94) - 28],
          [162, topY(162) - 28],
          [162, topY(162) - 13],
          [94, topY(94) - 13],
        ],
        palette.top,
      ),
    );
    shapes.push(
      line(94, topY(94) - 20, 162, topY(162) - 20, 3),
    );
    shapes.push(
      line(116, topY(116) - 28, 116, topY(116) - 13),
    );
    shapes.push(
      line(140, topY(140) - 28, 140, topY(140) - 13),
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" shape-rendering="crispEdges">${shapes.join("")}</svg>`;
};

const pierSvg = () => `
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" shape-rendering="crispEdges">
  ${polygon([[101, 108], [137, 108], [149, 132], [113, 132]], palette.top)}
  ${line(106, 115, 142, 115, 2)}
  ${polygon([[101, 108], [113, 132], [113, 184], [101, 170]], palette.faceDark)}
  ${polygon([[113, 132], [149, 132], [149, 184], [113, 184]], palette.faceLight)}
  ${line(113, 149, 149, 149)}${line(113, 166, 149, 166)}
  ${line(131, 132, 131, 149)}${line(122, 149, 122, 166)}${line(140, 166, 140, 184)}
</svg>`;

/** A compact corner bastion using the exact panel/pier masonry language. */
const towerSvg = () => `
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" shape-rendering="crispEdges">
  ${polygon([[76, 76], [143, 76], [164, 107], [97, 107]], palette.top)}
  ${line(84, 86, 151, 86, 2)}
  ${line(108, 80, 122, 104, 2)}${line(137, 78, 157, 103, 2)}
  ${polygon([[76, 76], [97, 107], [97, 190], [76, 170]], palette.faceDark)}
  ${polygon([[97, 107], [164, 107], [164, 190], [97, 190]], palette.faceLight)}
  ${line(97, 128, 164, 128)}${line(97, 149, 164, 149)}${line(97, 170, 164, 170)}
  ${line(130, 107, 130, 128)}${line(113, 128, 113, 149)}${line(147, 149, 147, 170)}${line(130, 170, 130, 190)}
  ${polygon([[74, 56], [94, 56], [94, 84], [74, 84]], palette.faceLight)}
  ${polygon([[108, 56], [128, 56], [128, 82], [108, 82]], palette.faceLight)}
  ${polygon([[143, 56], [163, 56], [163, 106], [143, 106]], palette.faceLight)}
  ${fillPolygon([[80, 50], [100, 50], [94, 56], [74, 56]], palette.topLight)}
  ${fillPolygon([[114, 50], [134, 50], [128, 56], [108, 56]], palette.topLight)}
  ${fillPolygon([[149, 50], [169, 50], [163, 56], [143, 56]], palette.topLight)}
</svg>`;

const assets = {
  "panel-horizontal": wallSvg(0, false),
  "panel-diagonal-down": wallSvg(0.45, false),
  "panel-diagonal-up": wallSvg(-0.45, false),
  "gate-horizontal": wallSvg(0, true),
  "gate-diagonal-down": wallSvg(0.45, true),
  "gate-diagonal-up": wallSvg(-0.45, true),
  pier: pierSvg(),
  tower: towerSvg(),
} as const;

const main = async () => {
  const outputDir = join(tmpdir(), `tnr-wall-kit-${nanoid()}`);
  await mkdir(outputDir, { recursive: true });
  const utapi = new UTApi();
  const manifest: Record<string, string> = {};
  for (const [role, svg] of Object.entries(assets)) {
    const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
    await sharp(png).toFile(join(outputDir, `${role}.png`));
    const filename = `village-wall-${VERSION}-${role}.png`;
    const uploaded = await utapi.uploadFiles(
      new UTFile([png as BlobPart], filename, { customId: filename }),
    );
    if (!uploaded.data || uploaded.error) {
      throw new Error(`Upload failed for ${role}: ${uploaded.error?.message}`);
    }
    manifest[role] = servedUfsUrl(uploaded.data);
  }
  console.log(JSON.stringify({ version: VERSION, assets: manifest }, null, 2));
  console.log(`Local review candidates: ${outputDir}`);
};

void main();
