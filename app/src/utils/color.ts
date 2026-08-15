/** Inclusive HSL lightness bounds for UI-readable village colours */
const MIN_LIGHTNESS = 0.28;
const MAX_LIGHTNESS = 0.72;

type Rgb = { r: number; g: number; b: number };

/**
 * Parse #RGB / #RRGGBB into 0–255 channels. Returns null if invalid.
 */
export const parseHexColor = (hex: string): Rgb | null => {
  const cleaned = hex.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
    return {
      r: Number.parseInt(cleaned.slice(0, 1).repeat(2), 16),
      g: Number.parseInt(cleaned.slice(1, 2).repeat(2), 16),
      b: Number.parseInt(cleaned.slice(2, 3).repeat(2), 16),
    };
  }
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return {
      r: Number.parseInt(cleaned.slice(0, 2), 16),
      g: Number.parseInt(cleaned.slice(2, 4), 16),
      b: Number.parseInt(cleaned.slice(4, 6), 16),
    };
  }
  return null;
};

/** WCAG relative luminance of an sRGB colour, 0–1 */
export const relativeLuminance = ({ r, g, b }: Rgb): number => {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
};

const toHexChannel = (n: number) =>
  Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, "0");

const rgbToHex = ({ r, g, b }: Rgb) =>
  `#${toHexChannel(r)}${toHexChannel(g)}${toHexChannel(b)}`;

const rgbToHsl = ({ r, g, b }: Rgb) => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case rn:
      h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
      break;
    case gn:
      h = ((bn - rn) / d + 2) / 6;
      break;
    default:
      h = ((rn - gn) / d + 4) / 6;
      break;
  }
  return { h, s, l };
};

const hslToRgb = (h: number, s: number, l: number): Rgb => {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
};

/**
 * Clamp a village hex so near-white / near-black colours stay visible as UI
 * swatches and map label fills on both light and dark surfaces, while keeping hue.
 * Unparsable input falls back to a neutral gray.
 */
export const getReadableVillageHexColor = (hex: string): string => {
  const rgb = parseHexColor(hex);
  if (!rgb) return "#9ca3af";
  const { h, s, l } = rgbToHsl(rgb);
  const clampedL = Math.min(MAX_LIGHTNESS, Math.max(MIN_LIGHTNESS, l));
  if (clampedL === l) return rgbToHex(rgb);
  return rgbToHex(hslToRgb(h, s, clampedL));
};

/** WCAG contrast ratio between two relative luminances (0–1) */
const contrastRatio = (a: number, b: number) => {
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
};

/**
 * Black or white text that maximizes WCAG contrast against the given fill colour.
 * Prefers black when ratios are equal.
 */
export const contrastingTextColor = (hex: string): "#000000" | "#FFFFFF" => {
  const rgb = parseHexColor(hex);
  if (!rgb) return "#000000";
  const fill = relativeLuminance(rgb);
  const blackContrast = contrastRatio(fill, 0);
  const whiteContrast = contrastRatio(fill, 1);
  return blackContrast >= whiteContrast ? "#000000" : "#FFFFFF";
};
