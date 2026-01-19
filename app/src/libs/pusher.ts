import crypto from "crypto";
import { env } from "@/env/server.mjs";
import type { UserStatus } from "@/drizzle/constants";

// declare Pusher class with async send method
// Taken from https://github.com/pusher/pusher-http-node/issues/173
// REASON: works with edge deployments, which the official package does not
export class Pusher {
  private app_id: string;
  private key: string;
  private secret: string;
  private cluster: string;

  constructor(app_id: string, key: string, secret: string, cluster: string) {
    this.app_id = app_id;
    this.key = key;
    this.secret = secret;
    this.cluster = cluster;
  }

  /**
   * Triggers event on the channel
   * @param channel - channel name
   * @param event - event name
   * @param data - data to send, nedd to be JSON object or string
   */
  async trigger(channel: string, event: string, data: object | string) {
    const timestamp = (Date.now() / 1000) | 0;
    const body = JSON.stringify({
      name: event,
      data: typeof data === "string" ? data : JSON.stringify(data),
      channel: channel,
    });
    const md5 = this._md5(body);
    const signature = await this._createSignature(timestamp, body, md5);

    // Send event to pusher using fetch, use try/catch to handle errors
    try {
      const endpoint =
        env.NODE_ENV === "development"
          ? `http://127.0.0.1:6001/apps/${this.app_id}/events?auth_key=${this.key}&auth_timestamp=${timestamp}&auth_version=1.0&body_md5=${md5}&auth_signature=${signature}`
          : `https://soketi.theninja-rpg.ai/apps/${this.app_id}/events?auth_key=${this.key}&auth_timestamp=${timestamp}&auth_version=1.0&body_md5=${md5}&auth_signature=${signature}`;
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body,
      });
    } catch (error) {
      console.error("Error", error);
    }
  }
  private _md5(str: string) {
    return crypto.createHash("md5").update(str).digest("hex");
  }

  private async _createSignature(timestamp: number, body: string, md5: string) {
    const stringToSign = `POST\n/apps/${this.app_id}/events\nauth_key=${this.key}&auth_timestamp=${timestamp}&auth_version=1.0&body_md5=${md5}`;
    const encoder = new TextEncoder();
    const encodedData = encoder.encode(stringToSign);
    const encodedSecret = encoder.encode(this.secret);
    const importedKey = await crypto.subtle.importKey(
      "raw",
      encodedSecret,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      { name: "HMAC", hash: "SHA-256" },
      importedKey,
      encodedData,
    );
    const signatureArray = Array.from(new Uint8Array(signature));
    const signatureHex = signatureArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return signatureHex;
  }
}

export const getServerPusher = () => {
  const pusher = new Pusher(
    process.env.PUSHER_APP_ID,
    process.env.NEXT_PUBLIC_PUSHER_APP_KEY,
    process.env.PUSHER_APP_SECRET,
    process.env.NEXT_PUBLIC_PUSHER_APP_CLUSTER,
  );
  return pusher;
};
export type PusherClient = ReturnType<typeof getServerPusher>;

/**
 * Updates the user's information on the map using Pusher, pushing it out to all users in the sector.
 * @param pusher - The Pusher client instance.
 * @param user - The user object containing the updated information.
 */
export const updateUserOnMap = async (
  pusher: PusherClient,
  sector: number,
  user: {
    userId: string;
    sector: number;
    longitude: number;
    latitude: number;
    username: string;
    avatar: string | null;
    avatarLight: string | null;
    location: string | null;
    villageId?: string | null;
    battleId?: string | null;
    curHealth?: number;
    maxHealth?: number;
    level: number;
    status: UserStatus;
    stealthActive?: boolean;
  },
) => {
  await pusher.trigger(sector.toString(), "event", {
    userId: user.userId,
    longitude: user.longitude,
    latitude: user.latitude,
    avatar: user.avatar,
    avatarLight: user.avatarLight,
    username: user.username,
    sector: user.sector,
    status: user.status,
    location: user.location,
    villageId: user?.villageId ?? null,
    battleId: user?.battleId ?? null,
    level: user.level,
    stealthActive: user?.stealthActive ?? false,
    ...(user.curHealth ? { curHealth: user.curHealth } : {}),
    ...(user.maxHealth ? { maxHealth: user.maxHealth } : {}),
  });
};
