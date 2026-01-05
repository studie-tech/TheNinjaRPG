import {
  CanvasTexture,
  NearestFilter,
  LinearFilter,
  Sprite,
  SpriteMaterial,
} from "three";
import { parseGIF, decompressFrames } from "gifuct-js";
import type { ParsedFrame } from "gifuct-js";

/**
 * Represents a single animated GIF with its frames and playback state.
 */
export interface AnimatedGif {
  /** The sprite displaying the GIF */
  sprite: Sprite;
  /** Parsed GIF frames (null while loading) */
  frames: ParsedFrame[] | null;
  /** Current frame index */
  currentFrame: number;
  /** Time accumulated since last frame change */
  elapsedTime: number;
  /** Canvas for rendering frames */
  canvas: HTMLCanvasElement;
  /** Canvas 2D context */
  ctx: CanvasRenderingContext2D;
  /** Texture for ThreeJS */
  texture: CanvasTexture;
  /** Temporary canvas for frame compositing */
  tempCanvas: HTMLCanvasElement;
  /** Temporary canvas context */
  tempCtx: CanvasRenderingContext2D;
  /** GIF width */
  width: number;
  /** GIF height */
  height: number;
  /** Whether animation is playing */
  playing: boolean;
  /** Whether the GIF has finished loading */
  loaded: boolean;
}

/**
 * GifAnimator - Manages animated GIF textures for ThreeJS.
 * Decodes GIF files and cycles through frames in the render loop.
 */
export class GifAnimator {
  private animatedGifs: Map<string, AnimatedGif> = new Map();
  private loadingPromises: Map<string, Promise<ParsedFrame[] | null>> = new Map();
  /** Fixed cycle duration in ms. If set, overrides frame delays so full animation plays in this time. */
  private cycleDurationMs: number | null = null;

  /**
   * Set a fixed cycle duration for all GIF animations.
   * When set, all GIFs will complete one full animation cycle in this duration,
   * regardless of the frame delays encoded in the GIF files.
   *
   * @param durationMs - Duration in milliseconds for one complete animation cycle, or null to use GIF's native timing
   */
  setCycleDuration(durationMs: number | null): void {
    this.cycleDurationMs = durationMs;
  }

  /**
   * Load a GIF and associate it with an existing sprite (created via createSprite).
   * The sprite's texture will be updated when loading completes.
   *
   * @param url - URL of the GIF file
   * @param id - Unique identifier for this GIF instance
   * @returns Promise resolving when loaded
   */
  async loadGif(url: string, id: string): Promise<void> {
    const existing = this.animatedGifs.get(id);
    if (existing?.loaded) {
      return; // Already loaded
    }

    // Check if we're already loading this URL
    let framesPromise = this.loadingPromises.get(url);
    if (!framesPromise) {
      framesPromise = this.fetchAndParseGif(url);
      this.loadingPromises.set(url, framesPromise);
    }

    const frames = await framesPromise;
    if (!frames || frames.length === 0) {
      console.warn(`GIF has no frames or failed to load: ${url}`);
      return;
    }

    // Get or create the AnimatedGif entry
    const gifEntry = this.animatedGifs.get(id);
    if (!gifEntry) {
      console.warn(`GIF entry was removed before loading completed: ${id}`);
      return; // Sprite was removed before loading completed
    }

    // Get dimensions from the parsed GIF data (logical screen descriptor)
    const parsedGif = this.parsedGifs.get(url);
    const width = parsedGif?.width ?? frames[0]!.dims.width;
    const height = parsedGif?.height ?? frames[0]!.dims.height;

    // Dispose old texture and material
    gifEntry.texture.dispose();
    (gifEntry.sprite.material as SpriteMaterial).dispose();

    // Create new canvas with correct dimensions
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext("2d")!;

    // Create new texture and material
    const texture = new CanvasTexture(canvas);
    texture.minFilter = LinearFilter;
    texture.magFilter = NearestFilter;

    const material = new SpriteMaterial({ map: texture, transparent: true });

    // Update sprite with new material
    gifEntry.sprite.material = material;

    // Update entry with new canvas/texture/context
    gifEntry.canvas = canvas;
    gifEntry.ctx = ctx;
    gifEntry.texture = texture;
    gifEntry.tempCanvas = tempCanvas;
    gifEntry.tempCtx = tempCtx;
    gifEntry.width = width;
    gifEntry.height = height;
    gifEntry.frames = frames;
    gifEntry.loaded = true;

    // Render first frame
    this.renderFrame(gifEntry, 0);
  }

  /**
   * Parsed GIF data including dimensions
   */
  private parsedGifs: Map<
    string,
    { frames: ParsedFrame[]; width: number; height: number }
  > = new Map();

  /**
   * Fetch and parse a GIF file.
   */
  private async fetchAndParseGif(url: string): Promise<ParsedFrame[] | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`Failed to fetch GIF: ${url}, status: ${response.status}`);
        return null;
      }
      const arrayBuffer = await response.arrayBuffer();
      const gif = parseGIF(arrayBuffer);
      const frames = decompressFrames(gif, true);

      if (frames.length > 0) {
        // Store the full GIF dimensions from the logical screen descriptor
        this.parsedGifs.set(url, {
          frames,
          width: gif.lsd.width,
          height: gif.lsd.height,
        });
      }

      return frames.length > 0 ? frames : null;
    } catch (error) {
      console.error(`Failed to load GIF: ${url}`, error);
      return null;
    }
  }

  /**
   * Create a sprite that will display the GIF once loaded.
   * Call loadGif() to start loading the GIF data.
   */
  createSprite(id: string): Sprite {
    const existing = this.animatedGifs.get(id);
    if (existing) {
      return existing.sprite;
    }

    // Create canvas and texture for this sprite
    const canvas = document.createElement("canvas");
    canvas.width = 64; // Placeholder size until GIF loads
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "transparent";
    ctx.fillRect(0, 0, 64, 64);

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = 64;
    tempCanvas.height = 64;
    const tempCtx = tempCanvas.getContext("2d")!;

    const texture = new CanvasTexture(canvas);
    texture.minFilter = LinearFilter;
    texture.magFilter = NearestFilter;

    const material = new SpriteMaterial({ map: texture, transparent: true });
    const sprite = new Sprite(material);
    sprite.name = id;

    const animatedGif: AnimatedGif = {
      sprite,
      frames: null, // Will be set when loaded
      currentFrame: 0,
      elapsedTime: 0,
      canvas,
      ctx,
      texture,
      tempCanvas,
      tempCtx,
      width: 64,
      height: 64,
      playing: true,
      loaded: false,
    };

    this.animatedGifs.set(id, animatedGif);
    return sprite;
  }

  private renderFrame(gif: AnimatedGif, frameIndex: number): void {
    if (!gif.frames) return;

    const frame = gif.frames[frameIndex];
    if (!frame) return;

    const { ctx, tempCtx, tempCanvas, width, height } = gif;

    // Handle disposal method from previous frame
    if (frameIndex > 0 && gif.frames) {
      const prevFrame = gif.frames[frameIndex - 1];
      if (prevFrame) {
        switch (prevFrame.disposalType) {
          case 2: // Restore to background
            ctx.clearRect(0, 0, width, height);
            break;
          case 3: // Restore to previous - complex, just clear for now
            ctx.clearRect(0, 0, width, height);
            break;
          // case 0 or 1: Do not dispose, keep current
        }
      }
    } else {
      // First frame - clear canvas
      ctx.clearRect(0, 0, width, height);
    }

    // Create ImageData for the frame
    const imageData = new ImageData(
      new Uint8ClampedArray(frame.patch),
      frame.dims.width,
      frame.dims.height,
    );

    // Draw frame to temp canvas
    tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
    tempCtx.putImageData(imageData, 0, 0);

    // Draw temp canvas to main canvas at correct position
    ctx.drawImage(
      tempCanvas,
      0,
      0,
      frame.dims.width,
      frame.dims.height,
      frame.dims.left,
      frame.dims.top,
      frame.dims.width,
      frame.dims.height,
    );

    // Update texture
    gif.texture.needsUpdate = true;
  }

  /**
   * Update all animated GIFs. Call this in your animation loop.
   *
   * @param deltaTime - Time since last update in seconds
   */
  update(deltaTime: number): void {
    const deltaMs = deltaTime * 1000;

    this.animatedGifs.forEach((gif) => {
      // Skip if not loaded, not playing, or single frame
      if (!gif.loaded || !gif.playing || !gif.frames || gif.frames.length <= 1) return;

      gif.elapsedTime += deltaMs;

      const currentFrame = gif.frames[gif.currentFrame];
      if (!currentFrame) return;

      // Calculate frame delay
      let frameDelay: number;
      if (this.cycleDurationMs !== null) {
        // Fixed cycle duration: distribute time evenly across all frames
        frameDelay = this.cycleDurationMs / gif.frames.length;
      } else {
        // Default delay from GIF (in centiseconds, so multiply by 10)
        frameDelay = (currentFrame.delay || 10) * 10;
      }

      if (gif.elapsedTime >= frameDelay) {
        gif.elapsedTime -= frameDelay;
        gif.currentFrame = (gif.currentFrame + 1) % gif.frames.length;
        this.renderFrame(gif, gif.currentFrame);
      }
    });
  }

  /**
   * Remove an animated GIF by ID.
   */
  remove(id: string): void {
    const gif = this.animatedGifs.get(id);
    if (gif) {
      gif.texture.dispose();
      (gif.sprite.material as SpriteMaterial).dispose();
      this.animatedGifs.delete(id);
    }
  }

  /**
   * Pause animation for a specific GIF.
   */
  pause(id: string): void {
    const gif = this.animatedGifs.get(id);
    if (gif) {
      gif.playing = false;
    }
  }

  /**
   * Resume animation for a specific GIF.
   */
  play(id: string): void {
    const gif = this.animatedGifs.get(id);
    if (gif) {
      gif.playing = true;
    }
  }

  /**
   * Check if a GIF is fully loaded.
   */
  isLoaded(id: string): boolean {
    return this.animatedGifs.get(id)?.loaded ?? false;
  }

  /**
   * Get the sprite for a loaded GIF.
   */
  getSprite(id: string): Sprite | undefined {
    return this.animatedGifs.get(id)?.sprite;
  }

  /**
   * Dispose all resources.
   */
  dispose(): void {
    this.animatedGifs.forEach((gif) => {
      gif.texture.dispose();
      (gif.sprite.material as SpriteMaterial).dispose();
    });
    this.animatedGifs.clear();
    this.loadingPromises.clear();
    this.parsedGifs.clear();
  }
}
