import type { MetadataRoute } from "next";
import { createPwaManifest } from "@/libs/pwaManifest";

export default function manifest(): MetadataRoute.Manifest {
  return createPwaManifest();
}
