import { z } from "zod";

export interface MetaConversion {
  event: "register" | "tutorial_complete";
  eventId: string;
  occurredAt: Date;
  fbc: string | null;
  fbp: string | null;
  userAgent: string;
}

/** Send confirmed conversion times and the same opaque event IDs used by the Pixel. */
export const buildMetaCapiRequest = (conversions: MetaConversion[]) => ({
  data: conversions.map((row) => ({
    event_name: row.event === "register" ? "CompleteRegistration" : "TutorialComplete",
    event_id: row.eventId,
    event_time: Math.floor(row.occurredAt.getTime() / 1000),
    action_source: "website",
    event_source_url:
      row.event === "register"
        ? "https://www.theninja-rpg.com/register"
        : "https://www.theninja-rpg.com/",
    user_data: {
      client_user_agent: row.userAgent,
      ...(row.fbc && { fbc: row.fbc }),
      ...(row.fbp && { fbp: row.fbp }),
    },
  })),
});

/** Keep credentials out of URLs and errors; acknowledge only a fully accepted batch. */
export const sendMetaConversions = async (
  pixelId: string,
  token: string,
  conversions: MetaConversion[],
) => {
  if (!/^\d+$/.test(pixelId)) throw new Error("Invalid Meta dataset configuration");
  if (!conversions.length) return;
  let response: Response;
  try {
    response = await fetch(`https://graph.facebook.com/v24.0/${pixelId}/events`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildMetaCapiRequest(conversions)),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("Meta conversion delivery failed");
  }
  if (!response.ok)
    throw new Error(`Meta conversion delivery returned HTTP ${response.status}`);
  const result = z
    .object({ events_received: z.number().int() })
    .safeParse(await response.json().catch(() => null));
  if (!result.success || result.data.events_received !== conversions.length)
    throw new Error("Meta did not acknowledge the complete conversion batch");
};
