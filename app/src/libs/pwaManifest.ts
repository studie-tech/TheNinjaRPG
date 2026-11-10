import type { MetadataRoute } from "next";
import {
  IMG_FRONTPAGE_SCREENSHOT_COMBAT,
  IMG_FRONTPAGE_SCREENSHOT_GLOBAL,
  IMG_FRONTPAGE_SCREENSHOT_JUTSUS,
  IMG_FRONTPAGE_SCREENSHOT_SECTOR,
  IMG_FRONTPAGE_SCREENSHOT_VILLAGE,
} from "@/drizzle/constants";

export const createPwaManifest = (): MetadataRoute.Manifest => ({
  // Relative so it resolves against whichever origin serves the manifest. A
  // cross-origin id (e.g. the apex domain while the site runs on www) is ignored, so
  // browsers would treat each deploy as a new app.
  id: "/",
  name: "TheNinja-RPG",
  short_name: "TNR",
  description: "A free browser game with ninja set in the world of Seichi",
  start_url: "/",
  display: "standalone",
  display_override: ["standalone", "window-controls-overlay", "browser"],
  background_color: "#ffffff",
  theme_color: "#ce7e00",
  orientation: "portrait-primary",
  scope: "/",
  lang: "en",
  categories: ["games", "entertainment"],
  icons: [
    {
      src: "/icons/icon-72x72.png",
      sizes: "72x72",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/icons/icon-96x96.png",
      sizes: "96x96",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/icons/icon-128x128.png",
      sizes: "128x128",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/icons/icon-144x144.png",
      sizes: "144x144",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/icons/icon-152x152.png",
      sizes: "152x152",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/icons/icon-192x192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/icons/icon-384x384.png",
      sizes: "384x384",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/icons/icon-512x512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
    // Android and ChromeOS crop the launcher icon to their own shape. Without a maskable
    // variant they letterbox the "any" icon inside a white circle instead.
    {
      src: "/icons/icon-maskable-192x192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "maskable",
    },
    {
      src: "/icons/icon-maskable-512x512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
  screenshots: [
    {
      src: IMG_FRONTPAGE_SCREENSHOT_COMBAT,
      sizes: "1800x1400",
      type: "image/webp",
      form_factor: "wide",
      label: "Strategic 2d combat system",
    },
    {
      src: IMG_FRONTPAGE_SCREENSHOT_SECTOR,
      sizes: "1800x1400",
      type: "image/webp",
      form_factor: "wide",
      label: "Live local sector maps",
    },
    {
      src: IMG_FRONTPAGE_SCREENSHOT_JUTSUS,
      sizes: "1800x1400",
      type: "image/webp",
      form_factor: "wide",
      label: "500+ jutsus to master",
    },
    {
      src: IMG_FRONTPAGE_SCREENSHOT_VILLAGE,
      sizes: "1800x1400",
      type: "image/webp",
      form_factor: "wide",
      label: "Multifaceted village with many activities",
    },
    {
      src: IMG_FRONTPAGE_SCREENSHOT_GLOBAL,
      sizes: "1800x1400",
      type: "image/webp",
      form_factor: "wide",
      label: "Travel to other sectors and visit other villages",
    },
  ],
  related_applications: [],
  prefer_related_applications: false,
  shortcuts: [
    {
      name: "Training",
      url: "/traininggrounds",
      description: "Train character and jutsus",
    },
    {
      name: "Battle Arena",
      url: "/battlearena#PVP%20Rank",
      description: "Participate in ranked PvP seasons",
    },
    {
      name: "Tavern",
      url: "/tavern",
      description: "Chat and plan with fellow ninjas",
    },
  ],
});
