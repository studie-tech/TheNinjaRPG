import {
  Group,
  LineBasicMaterial,
  LineSegments,
  LinearFilter,
  Sprite,
  SpriteMaterial,
  Vector3,
  BufferGeometry,
  CanvasTexture,
} from "three";
import fetchRetry from "fetch-retry";
import * as Sentry from "@sentry/nextjs";
import { IMG_MAP_HEXASPHERE } from "@/drizzle/constants";
import { IMG_AVATAR_DEFAULT, IMG_SECTOR_USER_SPRITE_MASK } from "@/drizzle/constants";
import { loadTexture } from "@/libs/threejs/util";
import type { GlobalPoint } from "@/libs/threejs/types";
import type { GlobalMapData } from "@/libs/threejs/types";

/**
 * Fetches the map data from the server.
 */
export const fetchMap = async () => {
  const fetch = fetchRetry(global.fetch);
  
  try {
    const response = await fetch(IMG_MAP_HEXASPHERE, {
      retries: 3,
      retryDelay: function (attempt) {
        return Math.pow(2, attempt) * 1000; // 1000, 2000, 4000
      },
      retryOn: function (attempt, error, response) {
        // Retry on network errors (error is not null)
        if (error !== null) {
          console.warn(
            `[fetchMap] Network error on attempt ${attempt}, retrying...`,
            error
          );
          return true;
        }
        
        // Retry on non-OK HTTP responses (e.g., 500, 502, 503, 504)
        if (response && !response.ok) {
          console.warn(
            `[fetchMap] HTTP error ${response.status} on attempt ${attempt}, retrying...`
          );
          return true;
        }
        
        // Don't retry if we got a successful response
        return false;
      },
    });

    // Check if response is OK before attempting to parse JSON
    if (!response.ok) {
      const errorMessage = `Failed to fetch map data: HTTP ${response.status} ${response.statusText}`;
      
      // Try to read response text for additional context
      let responseText = "";
      try {
        responseText = await response.text();
      } catch (e) {
        // Ignore errors reading response text
      }
      
      // Log to Sentry with context
      Sentry.captureException(new Error(errorMessage), {
        extra: {
          url: IMG_MAP_HEXASPHERE,
          status: response.status,
          statusText: response.statusText,
          responseText: responseText.substring(0, 500), // Limit to first 500 chars
          headers: Object.fromEntries(response.headers.entries()),
        },
      });
      
      throw new Error(errorMessage);
    }

    // Attempt to parse JSON with error handling
    let hexasphere: GlobalMapData;
    try {
      hexasphere = await response.json();
    } catch (jsonError) {
      // Try to get response text for debugging
      let responseText = "";
      try {
        // Clone the response before reading text (can only read body once)
        const clonedResponse = response.clone();
        responseText = await clonedResponse.text();
      } catch (e) {
        responseText = "(unable to read response text)";
      }
      
      const errorMessage = `Failed to parse map data as JSON: ${
        jsonError instanceof Error ? jsonError.message : String(jsonError)
      }`;
      
      // Log to Sentry with context
      Sentry.captureException(jsonError, {
        extra: {
          url: IMG_MAP_HEXASPHERE,
          status: response.status,
          responseText: responseText.substring(0, 500), // Limit to first 500 chars
          contentType: response.headers.get("content-type"),
          errorMessage,
        },
      });
      
      throw new Error(errorMessage);
    }

    return hexasphere;
  } catch (error) {
    // Log any uncaught errors to Sentry
    if (error instanceof Error && !error.message.includes("HTTP")) {
      Sentry.captureException(error, {
        extra: {
          url: IMG_MAP_HEXASPHERE,
          context: "fetchMap",
        },
      });
    }
    
    // Re-throw the error so calling code can handle it
    throw error;
  }
};

/**
 * Create a user avatar sprite for the global map
 */
export const createUserAvatarSprite = (info: {
  userData: {
    userId: string;
    sector: number;
    avatar: string | null;
    avatarLight: string | null;
  };
  sector: GlobalPoint;
  showLine: boolean;
  borderColor: string;
  distance: number;
}) => {
  const { userData, sector, borderColor = "white", distance } = info;
  if (!userData) return new Group();

  const group = new Group();

  // Distance from the surface
  const d = 3 - distance;

  // Create the line connecting to the surface
  if (info.showLine) {
    const points = [];
    points.push(new Vector3(sector.x / 3, sector.y / 3, sector.z / 3));
    points.push(new Vector3(sector.x / d, sector.y / d, sector.z / d));
    const lineMaterial = new LineBasicMaterial({
      color: "#000000",
      linewidth: 1,
    });
    const geometry = new BufferGeometry().setFromPoints(points);
    const line = new LineSegments(geometry, lineMaterial);
    group.add(line);
  }

  // Create white circular border sprite
  const borderCanvas = document.createElement("canvas");
  const borderSize = 64; // Size in pixels
  borderCanvas.width = borderSize;
  borderCanvas.height = borderSize;
  const borderContext = borderCanvas.getContext("2d");

  if (borderContext) {
    // Clear the canvas
    borderContext.clearRect(0, 0, borderSize, borderSize);

    // Draw white circle border
    const centerX = borderSize / 2;
    const centerY = borderSize / 2;
    const radius = borderSize / 2 - 2; // Leave some padding for the border

    borderContext.beginPath();
    borderContext.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    borderContext.fillStyle = borderColor;
    borderContext.fill();
  }

  const borderTexture = new CanvasTexture(borderCanvas);
  borderTexture.generateMipmaps = false;
  borderTexture.minFilter = LinearFilter;

  const borderMaterial = new SpriteMaterial({
    map: borderTexture,
    depthWrite: false,
    depthTest: false,
  });
  const borderSprite = new Sprite(borderMaterial);
  borderSprite.scale.set(1.2, 1.2, 1.2); // Slightly larger than avatar
  borderSprite.position.set(sector.x / d, sector.y / d, sector.z / d);
  group.add(borderSprite);

  // User avatar sprite
  const alphaMap = loadTexture(IMG_SECTOR_USER_SPRITE_MASK);
  const avatar = userData?.avatarLight || userData?.avatar || IMG_AVATAR_DEFAULT;
  const avatarTexture = loadTexture(avatar);
  avatarTexture.generateMipmaps = false;
  avatarTexture.minFilter = LinearFilter;
  const avatarMaterial = new SpriteMaterial({
    map: avatarTexture,
    alphaMap: alphaMap,
    depthWrite: false,
    depthTest: false,
  });
  const avatarSprite = new Sprite(avatarMaterial);
  avatarSprite.scale.set(1, 1, 1);
  avatarSprite.position.set(sector.x / d, sector.y / d, sector.z / d);
  group.add(avatarSprite);

  return group;
};
