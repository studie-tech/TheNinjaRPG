/** Render the snapshot's scene asset pixels for audits that judge narrative fit. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const snapshotPath = process.env.SNAPSHOT;
const outDir = process.env.OUT_DIR;
if (!snapshotPath || !outDir) throw new Error("SNAPSHOT and OUT_DIR are required");
const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const imageUrl = (asset) => {
  const candidate = asset.image || asset.url;
  try {
    const url = new URL(candidate);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
};
const assets = snapshot.assets.filter((asset) =>
  ["SCENE_CHARACTER", "SCENE_BACKGROUND"].includes(asset.type))
  .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: "chrome" }),
  args: ["--no-sandbox"],
});
const index = [];
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1300 }, deviceScaleFactor: 1 });
  // Images load as ordinary cross-origin pictures; no secret reaches the page or asset hosts.
  for (let offset = 0; offset < assets.length; offset += 16) {
    const group = assets.slice(offset, offset + 16);
    const file = `scene-catalog-${String(index.length + 1).padStart(3, "0")}.png`;
    await page.setViewportSize({ width: 1400, height: 70 + Math.ceil(group.length / 4) * 300 });
    await page.setContent(`<html><head><style>
      * {box-sizing:border-box} body {margin:0;padding:16px;background:#eee;font:16px Arial;color:#111}
      h1 {font-size:22px;margin:0 0 12px}.grid {display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
      article {background:white;border:1px solid #777;padding:8px;overflow:hidden}
      .pixels {height:220px;display:flex;align-items:center;justify-content:center;
        background:repeating-conic-gradient(#ddd 0% 25%,#fff 0% 50%) 0/20px 20px}
      img {max-width:100%;max-height:100%;object-fit:contain}.label {font-weight:bold;margin-top:6px}
      code {font-size:13px;overflow-wrap:anywhere}.failed .pixels {background:#fee;color:#900;font-weight:bold}
      .failed img {display:none}.failed .pixels::after {content:'IMAGE FAILED — DO NOT SELECT'}
    </style></head><body><h1>Scene catalog — inspect role, clothing, expression, silhouette and transparency</h1>
    <div class="grid">${group.map((asset) => `<article data-id="${escape(asset.id)}"><div class="pixels"><img src="${escape(imageUrl(asset))}" alt=""></div>
      <div class="label">${escape(asset.name)}</div><code>${escape(asset.id)}<br>${escape(asset.type)} · v ${escape(asset.v)}</code></article>`).join("")}</div></body></html>`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => [...document.images].every((image) => image.complete), undefined, { timeout: 45000 }).catch(() => {});
    const failedIds = await page.evaluate(() => [...document.querySelectorAll("article")].flatMap((article) => {
      const image = article.querySelector("img");
      if (!image?.complete || !image.naturalWidth) {
        article.classList.add("failed");
        return [article.dataset.id];
      }
      return [];
    }));
    await page.screenshot({ path: path.join(outDir, file), fullPage: true });
    index.push({ file, assets: group.map((asset) => ({ id: asset.id, name: asset.name, type: asset.type, v: asset.v, url: imageUrl(asset) })), failedIds });
  }
} finally { await browser.close(); }
await writeFile(path.join(outDir, "scene-index.json"), JSON.stringify(index, null, 2));
console.log(`Rendered ${assets.length} scene assets on ${index.length} contact sheets`);
