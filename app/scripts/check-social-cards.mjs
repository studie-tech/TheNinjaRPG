#!/usr/bin/env node
/**
 * Validates the OpenGraph / Twitter card contract for a set of URLs the way the social
 * platforms do: fetch the page as their crawler, read the tags, then fetch the declared
 * image and check it is actually servable at a usable size.
 *
 * Facebook, LinkedIn and X cannot reach a protected Vercel preview, so this stands in
 * for their debuggers before a deploy is public.
 *
 * Usage:
 *   node scripts/check-social-cards.mjs [baseUrl] [path ...]
 *   node scripts/check-social-cards.mjs https://www.theninja-rpg.com / /news
 */

// Roughly what each platform will accept. Facebook hard-rejects images under 200px on
// either edge; the 1200x630 target is what every platform documents for a large card.
const LIMITS = {
  minEdge: 200,
  recommendedWidth: 1200,
  recommendedHeight: 630,
  maxBytes: 8 * 1024 * 1024, // Facebook rejects above this
  slowBytes: 1024 * 1024, // above this, previews get noticeably slow to generate
  targetRatio: 1200 / 630,
  ratioTolerance: 0.15,
};

const CRAWLER_UA =
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

const DEFAULT_PATHS = ["/", "/news", "/manual", "/manual/bloodline"];

const readTag = (html, patterns) => {
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return undefined;
};

const metaContent = (html, key) =>
  readTag(html, [
    new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${key}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${key}["']`, "i"),
  ]);

/** Reads intrinsic dimensions straight from the file header, no image library needed. */
const probeDimensions = (buf) => {
  // PNG: IHDR width/height at fixed offsets
  if (buf.length > 24 && buf.toString("hex", 0, 8) === "89504e470d0a1a0a") {
    return { type: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: walk the segment markers to the start-of-frame
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return {
          type: "jpeg",
          height: buf.readUInt16BE(i + 5),
          width: buf.readUInt16BE(i + 7),
        };
      }
      i += 2 + len;
    }
  }
  // WebP: VP8X / VP8 / VP8L variants each store size differently
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF") {
    const fourcc = buf.toString("ascii", 12, 16);
    if (fourcc === "VP8X") {
      return {
        type: "webp",
        width: 1 + buf.readUIntLE(24, 3),
        height: 1 + buf.readUIntLE(27, 3),
      };
    }
    if (fourcc === "VP8 ") {
      return {
        type: "webp",
        width: buf.readUInt16LE(26) & 0x3fff,
        height: buf.readUInt16LE(28) & 0x3fff,
      };
    }
    if (fourcc === "VP8L") {
      const b = buf.readUInt32LE(21);
      return {
        type: "webp",
        width: (b & 0x3fff) + 1,
        height: ((b >> 14) & 0x3fff) + 1,
      };
    }
  }
  return undefined;
};

const check = (ok, label, detail) => ({ ok, label, detail });

/**
 * Metadata always declares absolute production URLs, because that is what the platforms
 * require. When testing a local server or a preview deploy, those would resolve against
 * production instead of the build under test, so they are pointed back at the base.
 */
const CANONICAL_ORIGIN = "https://www.theninja-rpg.com";
const resolveAgainstBase = (rawUrl, base) => {
  if (!rawUrl) return rawUrl;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  // Compared as a parsed origin rather than a string prefix: "https://www.theninja-rpg.com"
  // is also a prefix of "https://www.theninja-rpg.com.example.org".
  if (parsed.origin !== CANONICAL_ORIGIN) return rawUrl;
  const baseOrigin = new URL(base).origin;
  if (baseOrigin === CANONICAL_ORIGIN) return rawUrl;
  return `${baseOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
};

async function inspect(base, path) {
  const url = new URL(path, base).toString();
  const results = [];
  let html;
  try {
    const res = await fetch(url, { headers: { "user-agent": CRAWLER_UA }, redirect: "follow" });
    results.push(check(res.ok, `page returns ${res.status}`, res.status));
    if (!res.ok) return { url, results, fatal: true };
    html = await res.text();
  } catch (err) {
    results.push(check(false, `page unreachable: ${err.message}`));
    return { url, results, fatal: true };
  }

  const tags = {
    "og:title": metaContent(html, "og:title"),
    "og:description": metaContent(html, "og:description"),
    "og:image": metaContent(html, "og:image"),
    "og:url": metaContent(html, "og:url"),
    "og:type": metaContent(html, "og:type"),
    "twitter:card": metaContent(html, "twitter:card"),
    "twitter:image": metaContent(html, "twitter:image"),
  };

  for (const [key, value] of Object.entries(tags)) {
    results.push(check(Boolean(value), `${key} present`, value?.slice(0, 78)));
  }

  // Every platform requires an absolute image URL; relative ones are silently dropped.
  const img = tags["og:image"];
  if (img) {
    results.push(check(/^https?:\/\//i.test(img), "og:image is absolute", img.slice(0, 78)));
    if (tags["og:url"]) {
      results.push(
        check(/^https?:\/\//i.test(tags["og:url"]), "og:url is absolute", tags["og:url"]),
      );
    }
    const fetchTarget = resolveAgainstBase(img, base);
    try {
      const imgRes = await fetch(fetchTarget, { headers: { "user-agent": CRAWLER_UA } });
      results.push(
        check(
          imgRes.ok,
          `image returns ${imgRes.status}`,
          fetchTarget === img ? imgRes.status : `${imgRes.status} (fetched ${fetchTarget})`,
        ),
      );
      if (imgRes.ok) {
        const ct = imgRes.headers.get("content-type") ?? "";
        results.push(check(ct.startsWith("image/"), `content-type is ${ct}`, ct));
        const buf = Buffer.from(await imgRes.arrayBuffer());
        results.push(
          check(buf.length <= LIMITS.maxBytes, `size ${(buf.length / 1024).toFixed(0)} KB under 8MB`),
        );
        if (buf.length > LIMITS.slowBytes) {
          results.push(check(false, `size ${(buf.length / 1024).toFixed(0)} KB over 1MB (slow previews)`));
        }
        const dim = probeDimensions(buf);
        if (!dim) {
          results.push(check(false, "could not read image dimensions"));
        } else {
          const { width, height } = dim;
          results.push(
            check(
              width >= LIMITS.minEdge && height >= LIMITS.minEdge,
              `dimensions ${width}x${height} above 200px floor`,
            ),
          );
          results.push(
            check(
              width >= LIMITS.recommendedWidth && height >= LIMITS.recommendedHeight,
              `dimensions ${width}x${height} meet 1200x630 target`,
            ),
          );
          const ratio = width / height;
          results.push(
            check(
              Math.abs(ratio - LIMITS.targetRatio) <= LIMITS.ratioTolerance,
              `aspect ratio ${ratio.toFixed(2)} near 1.91 (large card)`,
            ),
          );
        }
      }
    } catch (err) {
      results.push(check(false, `image unreachable: ${err.message}`));
    }
  }

  if (tags["twitter:card"]) {
    results.push(
      check(
        ["summary", "summary_large_image", "app", "player"].includes(tags["twitter:card"]),
        `twitter:card value "${tags["twitter:card"]}" is valid`,
      ),
    );
  }

  return { url, results, fatal: false };
}

const [, , baseArg, ...pathArgs] = process.argv;
const base = baseArg ?? "http://localhost:3007";
const paths = pathArgs.length > 0 ? pathArgs : DEFAULT_PATHS;

let failures = 0;
for (const path of paths) {
  const { url, results } = await inspect(base, path);
  console.log(`\n${url}`);
  for (const { ok, label, detail } of results) {
    if (!ok) failures++;
    const suffix = detail !== undefined && String(detail) !== label ? `  ${detail}` : "";
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${suffix}`);
  }
}
console.log(`\n${failures === 0 ? "All checks passed" : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
