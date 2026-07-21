import worldMap from "@/data/hexasphere.json";

export const dynamic = "force-static";

export const GET = () =>
  Response.json(worldMap, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
