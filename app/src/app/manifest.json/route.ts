import { createPwaManifest } from "@/libs/pwaManifest";

const manifestHeaders = {
  "Content-Type": "application/manifest+json",
};

export const dynamic = "force-static";

export function GET() {
  return new Response(JSON.stringify(createPwaManifest()), {
    headers: manifestHeaders,
  });
}

export function HEAD() {
  return new Response(null, {
    headers: manifestHeaders,
  });
}
