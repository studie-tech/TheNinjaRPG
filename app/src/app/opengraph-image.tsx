import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { SITE_DESCRIPTION } from "@/libs/seo";

export const runtime = "nodejs";
export const alt = "TheNinja-RPG - a free browser-based ninja MMORPG";
export const contentType = "image/png";

// The site logo is a 512x768 portrait, which social platforms letterbox badly in a
// summary_large_image card. This renders a 1200x630 card instead.
export const size = { width: 1200, height: 630 };

/**
 * The CDN logo is a WebP, which satori cannot decode, so the PWA icon is inlined as a
 * data URI instead. If it cannot be read the card still renders, just text-only.
 */
const loadLogo = async () => {
  try {
    const file = await readFile(
      join(process.cwd(), "public", "icons", "icon-512x512.png"),
    );
    return `data:image/png;base64,${file.toString("base64")}`;
  } catch {
    return null;
  }
};

export default async function Image() {
  const logo = await loadLogo();
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        gap: 48,
        padding: 72,
        background: "linear-gradient(135deg, #1a1206 0%, #3b2607 55%, #ce7e00 100%)",
      }}
    >
      {logo && (
        // biome-ignore lint/performance/noImgElement: ImageResponse only supports img
        <img src={logo} alt="" width={340} height={340} />
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          maxWidth: logo ? 620 : 900,
          textAlign: logo ? "left" : "center",
        }}
      >
        <div style={{ fontSize: 72, fontWeight: 700, color: "#ffffff" }}>
          TheNinja-RPG
        </div>
        <div style={{ fontSize: 31, color: "#f7e2bd", marginTop: 22, lineHeight: 1.4 }}>
          {SITE_DESCRIPTION}
        </div>
      </div>
    </div>,
    size,
  );
}
