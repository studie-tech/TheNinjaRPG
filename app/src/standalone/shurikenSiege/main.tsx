import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ShurikenSiegeApp } from "@/standalone/shurikenSiege/App";
import { loadBuildData, readBuild } from "@/standalone/shurikenSiege/build";
import { activePlayables } from "@/standalone/shurikenSiege/portal";
import { serveBundledMedia } from "@/utils/image";

const root = document.getElementById("root");

/**
 * Load the game data, serve its bundled media from the page's folder, then play. The page
 * shows its loading screen meanwhile, which is YouTube's first frame.
 */
const start = async () => {
  if (!root) return;
  activePlayables(readBuild())?.game.firstFrameReady();
  try {
    const data = await loadBuildData();
    const missing = new Set<string>();
    serveBundledMedia(
      new Map(
        Object.entries(data.media).map(([url, file]) => [
          url,
          new URL(file, document.baseURI).href,
        ]),
      ),
      // Media the build did not bundle still loads from the CDN where the host allows it.
      (url) => {
        if (missing.has(url)) return;
        missing.add(url);
        console.debug("[shuriken-siege] unbundled media", url);
      },
    );
    createRoot(root).render(
      <StrictMode>
        <ShurikenSiegeApp />
      </StrictMode>,
    );
  } catch (error) {
    console.error(error);
    root.textContent = "Shuriken Siege could not load. Please reload the page.";
  }
};

void start();
