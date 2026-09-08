import { env } from "@/env/server.mjs";

/**
 * Android App Links verification.
 *
 * Play verifies this at install time; if it is missing or the fingerprints do not match,
 * links fall back to the browser and the disambiguation dialog reappears. Both the upload
 * key and the Play App Signing key have to be listed, which is why the variable takes a
 * comma-separated list.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const packageName = env.ANDROID_PACKAGE_NAME;
  const fingerprints = (env.ANDROID_CERT_FINGERPRINTS ?? "")
    .split(",")
    .map((fingerprint) => fingerprint.trim().toUpperCase())
    .filter(Boolean);

  if (!packageName || fingerprints.length === 0) {
    return new Response("Not found", { status: 404 });
  }

  const statements = [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: packageName,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];

  return new Response(JSON.stringify(statements), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
