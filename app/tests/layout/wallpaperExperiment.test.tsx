import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "bun:test";
import { LayoutBackground } from "@/components/layout/shared/LayoutBackground";
import { WALLPAPER_IMAGES, WALLPAPER_VARIANTS } from "@/libs/wallpaperExperiment";
import { bunnyImageUrl } from "@/utils/image";
import { LayoutContextProvider } from "@/utils/LayoutContext";

// Assert the HTML a cached shell delivers, before cookies can be read in an effect.
describe("prerendered wallpaper", () => {
  it.each([...WALLPAPER_VARIANTS])("preloads and paints only the assigned %s image", (wallpaper) => {
    const html = renderToStaticMarkup(
      <LayoutContextProvider value="default" isPixelLanding={false} wallpaper={wallpaper}>
        <LayoutBackground variant="beta" />
      </LayoutContextProvider>,
    );
    const image = WALLPAPER_IMAGES[wallpaper];
    expect(html).toContain(bunnyImageUrl(image, 828).replaceAll("&", "&amp;"));
    expect(html).toContain(bunnyImageUrl(image, wallpaper === "horizon" ? 1792 : 1600).replaceAll("&", "&amp;"));
    expect(html).toContain('rel="preload"');
    expect(html).toContain('fetchPriority="high"');
    expect(html).toContain('width="1600" height="800"');
    expect(html.match(/<img /g)).toHaveLength(1);
    for (const other of WALLPAPER_VARIANTS.filter((variant) => variant !== wallpaper)) {
      expect(html).not.toContain(WALLPAPER_IMAGES[other]);
    }
  });
});
