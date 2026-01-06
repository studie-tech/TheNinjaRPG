import {
  NearestFilter,
  LinearFilter,
  Sprite,
  SpriteMaterial,
  type Texture,
} from "three";
import type {
  SpriteDirection,
  CharacterAssetConfig as DbCharacterAssetConfig,
  CharacterAnimationState,
} from "@/validators/towerDefense";

/**
 * Animation state for a sprite.
 */
export type AnimationState = CharacterAnimationState;

/**
 * Extended asset configuration for a character, including optional basePath.
 */
export interface CharacterAssetConfig extends DbCharacterAssetConfig {
  /** Base path for assets (e.g., "/towerdefence/player"), optional if using absolute URLs */
  basePath?: string;
}

/**
 * Represents a single animated sprite with multiple frames per direction.
 */
export interface FrameAnimation {
  /** The sprite displaying the animation */
  sprite: Sprite;
  /** Current frame index */
  currentFrame: number;
  /** Time accumulated since last frame change */
  elapsedTime: number;
  /** Frame duration in ms */
  frameDurationMs: number;
  /** Whether animation is playing */
  playing: boolean;
  /** Whether animation should loop */
  loop: boolean;
  /** Callback when non-looping animation finishes */
  onFinish?: () => void;
  /** Current direction */
  currentDirection: SpriteDirection;
  /** Current animation state */
  currentState: AnimationState;
  /** Loaded textures per direction per state: state -> direction -> textures[] */
  textures: Map<AnimationState, Map<SpriteDirection, Texture[]>>;
  /** Static (idle) textures per direction */
  staticTextures: Map<SpriteDirection, Texture>;
  /** Current textures being displayed */
  currentTextures: Texture[];
}

/**
 * Pre-configured asset configs for tower defense characters.
 */
export const PLAYER_ASSET_CONFIG: CharacterAssetConfig = {
  basePath: "/towerdefence/player",
  rotations: {
    north: "rotations/north.png",
    "north-east": "rotations/north-east.png",
    east: "rotations/east.png",
    "south-east": "rotations/south-east.png",
    south: "rotations/south.png",
    "south-west": "rotations/south-west.png",
    west: "rotations/west.png",
    "north-west": "rotations/north-west.png",
  },
  animations: [
    {
      name: "fight-stance-idle-8-frames",
      state: "idle",
      frameDurationMs: 100,
      loop: true,
      frames: {
        north: Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/north/frame_00${i}.png`,
        ),
        "north-east": Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/north-east/frame_00${i}.png`,
        ),
        east: Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/east/frame_00${i}.png`,
        ),
        "south-east": Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/south-east/frame_00${i}.png`,
        ),
        south: Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/south/frame_00${i}.png`,
        ),
        "south-west": Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/south-west/frame_00${i}.png`,
        ),
        west: Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/west/frame_00${i}.png`,
        ),
        "north-west": Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/north-west/frame_00${i}.png`,
        ),
      },
    },
    {
      name: "throw-object",
      state: "throw",
      frameDurationMs: 60,
      loop: false,
      frames: {
        north: Array.from(
          { length: 7 },
          (_, i) => `animations/throw-object/north/frame_00${i}.png`,
        ),
        "north-east": Array.from(
          { length: 7 },
          (_, i) => `animations/throw-object/north-east/frame_00${i}.png`,
        ),
        east: Array.from(
          { length: 7 },
          (_, i) => `animations/throw-object/east/frame_00${i}.png`,
        ),
        "south-east": Array.from(
          { length: 7 },
          (_, i) => `animations/throw-object/south-east/frame_00${i}.png`,
        ),
        south: Array.from(
          { length: 7 },
          (_, i) => `animations/throw-object/south/frame_00${i}.png`,
        ),
        "south-west": Array.from(
          { length: 7 },
          (_, i) => `animations/throw-object/south-west/frame_00${i}.png`,
        ),
        west: Array.from(
          { length: 7 },
          (_, i) => `animations/throw-object/west/frame_00${i}.png`,
        ),
        "north-west": Array.from(
          { length: 7 },
          (_, i) => `animations/throw-object/north-west/frame_00${i}.png`,
        ),
      },
    },
  ],
};

export const LIGHT_ENEMY_ASSET_CONFIG: CharacterAssetConfig = {
  basePath: "/towerdefence/light_character",
  rotations: {
    north: "rotations/north.png",
    "north-east": "rotations/north-east.png",
    east: "rotations/east.png",
    "south-east": "rotations/south-east.png",
    south: "rotations/south.png",
    "south-west": "rotations/south-west.png",
    west: "rotations/west.png",
    "north-west": "rotations/north-west.png",
  },
  animations: [
    {
      name: "fight-stance-idle-8-frames",
      state: "idle",
      frameDurationMs: 120,
      loop: true,
      frames: {
        north: Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/north/frame_00${i}.png`,
        ),
        "north-east": Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/north-east/frame_00${i}.png`,
        ),
        east: Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/east/frame_00${i}.png`,
        ),
        "south-east": Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/south-east/frame_00${i}.png`,
        ),
        south: Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/south/frame_00${i}.png`,
        ),
        "south-west": Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/south-west/frame_00${i}.png`,
        ),
        west: Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/west/frame_00${i}.png`,
        ),
        "north-west": Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/north-west/frame_00${i}.png`,
        ),
      },
    },
    {
      name: "running-6-frames",
      state: "moving",
      frameDurationMs: 80,
      loop: true,
      frames: {
        north: Array.from(
          { length: 6 },
          (_, i) => `animations/running-6-frames/north/frame_00${i}.png`,
        ),
        "north-east": Array.from(
          { length: 6 },
          (_, i) => `animations/running-6-frames/north-east/frame_00${i}.png`,
        ),
        east: Array.from(
          { length: 6 },
          (_, i) => `animations/running-6-frames/east/frame_00${i}.png`,
        ),
        "south-east": Array.from(
          { length: 6 },
          (_, i) => `animations/running-6-frames/south-east/frame_00${i}.png`,
        ),
        south: Array.from(
          { length: 6 },
          (_, i) => `animations/running-6-frames/south/frame_00${i}.png`,
        ),
        "south-west": Array.from(
          { length: 6 },
          (_, i) => `animations/running-6-frames/south-west/frame_00${i}.png`,
        ),
        west: Array.from(
          { length: 6 },
          (_, i) => `animations/running-6-frames/west/frame_00${i}.png`,
        ),
        "north-west": Array.from(
          { length: 6 },
          (_, i) => `animations/running-6-frames/north-west/frame_00${i}.png`,
        ),
      },
    },
    {
      name: "lead-jab",
      state: "punch",
      frameDurationMs: 100,
      loop: false,
      frames: {
        north: Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/north/frame_00${i}.png`,
        ),
        "north-east": Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/north-east/frame_00${i}.png`,
        ),
        east: Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/east/frame_00${i}.png`,
        ),
        "south-east": Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/south-east/frame_00${i}.png`,
        ),
        south: Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/south/frame_00${i}.png`,
        ),
        "south-west": Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/south-west/frame_00${i}.png`,
        ),
        west: Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/west/frame_00${i}.png`,
        ),
        "north-west": Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/north-west/frame_00${i}.png`,
        ),
      },
    },
  ],
};

export const HEAVY_ENEMY_ASSET_CONFIG: CharacterAssetConfig = {
  basePath: "/towerdefence/heavy_character",
  rotations: {
    north: "rotations/north.png",
    "north-east": "rotations/north-east.png",
    east: "rotations/east.png",
    "south-east": "rotations/south-east.png",
    south: "rotations/south.png",
    "south-west": "rotations/south-west.png",
    west: "rotations/west.png",
    "north-west": "rotations/north-west.png",
  },
  animations: [
    {
      name: "fight-stance-idle-8-frames",
      state: "idle",
      frameDurationMs: 150, // Slower idle for heavy feel
      loop: true,
      frames: {
        north: Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/north/frame_00${i}.png`,
        ),
        "north-east": Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/north-east/frame_00${i}.png`,
        ),
        east: Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/east/frame_00${i}.png`,
        ),
        "south-east": Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/south-east/frame_00${i}.png`,
        ),
        south: Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/south/frame_00${i}.png`,
        ),
        "south-west": Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/south-west/frame_00${i}.png`,
        ),
        west: Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/west/frame_00${i}.png`,
        ),
        "north-west": Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/north-west/frame_00${i}.png`,
        ),
      },
    },
    {
      name: "walking-6-frames",
      state: "moving",
      frameDurationMs: 120, // Slower than light enemy's running
      loop: true,
      frames: {
        north: Array.from(
          { length: 6 },
          (_, i) => `animations/walking-6-frames/north/frame_00${i}.png`,
        ),
        "north-east": Array.from(
          { length: 6 },
          (_, i) => `animations/walking-6-frames/north-east/frame_00${i}.png`,
        ),
        east: Array.from(
          { length: 6 },
          (_, i) => `animations/walking-6-frames/east/frame_00${i}.png`,
        ),
        "south-east": Array.from(
          { length: 6 },
          (_, i) => `animations/walking-6-frames/south-east/frame_00${i}.png`,
        ),
        south: Array.from(
          { length: 6 },
          (_, i) => `animations/walking-6-frames/south/frame_00${i}.png`,
        ),
        "south-west": Array.from(
          { length: 6 },
          (_, i) => `animations/walking-6-frames/south-west/frame_00${i}.png`,
        ),
        west: Array.from(
          { length: 6 },
          (_, i) => `animations/walking-6-frames/west/frame_00${i}.png`,
        ),
        "north-west": Array.from(
          { length: 6 },
          (_, i) => `animations/walking-6-frames/north-west/frame_00${i}.png`,
        ),
      },
    },
    {
      name: "lead-jab",
      state: "punch",
      frameDurationMs: 150, // Slower punch animation for heavy feel
      loop: false,
      frames: {
        north: Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/north/frame_00${i}.png`,
        ),
        "north-east": Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/north-east/frame_00${i}.png`,
        ),
        east: Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/east/frame_00${i}.png`,
        ),
        "south-east": Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/south-east/frame_00${i}.png`,
        ),
        south: Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/south/frame_00${i}.png`,
        ),
        "south-west": Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/south-west/frame_00${i}.png`,
        ),
        west: Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/west/frame_00${i}.png`,
        ),
        "north-west": Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/north-west/frame_00${i}.png`,
        ),
      },
    },
  ],
};

/**
 * FrameAnimator - Manages frame-based sprite animations for ThreeJS.
 * Loads individual images as frames and cycles through them in the render loop.
 */
export class FrameAnimator {
  private animations: Map<string, FrameAnimation> = new Map();
  private textureLoader: (url: string) => Texture;
  private loadingPromises: Map<string, Promise<void>> = new Map();

  constructor(textureLoader: (url: string) => Texture) {
    this.textureLoader = textureLoader;
  }

  /**
   * Create a sprite for an entity and start loading its assets.
   *
   * @param id - Unique identifier for this entity
   * @param config - Asset configuration for this character type
   * @param initialDirection - Initial facing direction
   * @param initialState - Initial animation state
   * @returns The created sprite
   */
  createSprite(
    id: string,
    config: CharacterAssetConfig,
    initialDirection: SpriteDirection = "south",
    initialState: AnimationState = "idle",
  ): Sprite {
    const existing = this.animations.get(id);
    if (existing) {
      return existing.sprite;
    }

    // Create placeholder sprite
    const material = new SpriteMaterial({ transparent: true });
    const sprite = new Sprite(material);
    sprite.name = id;

    // Initialize animation entry
    const animation: FrameAnimation = {
      sprite,
      currentFrame: 0,
      elapsedTime: 0,
      frameDurationMs: 100,
      playing: false,
      loop: true,
      currentDirection: initialDirection,
      currentState: initialState,
      textures: new Map(),
      staticTextures: new Map(),
      currentTextures: [],
    };

    this.animations.set(id, animation);

    // Start loading assets
    void this.loadAssets(id, config);

    return sprite;
  }

  /**
   * Load all assets for a character.
   */
  private async loadAssets(id: string, config: CharacterAssetConfig): Promise<void> {
    const cacheKey = `${id}-${config.basePath}`;

    // Check if already loading
    if (this.loadingPromises.has(cacheKey)) {
      await this.loadingPromises.get(cacheKey);
      return;
    }

    const loadPromise = this.doLoadAssets(id, config);
    this.loadingPromises.set(cacheKey, loadPromise);

    try {
      await loadPromise;
    } finally {
      this.loadingPromises.delete(cacheKey);
    }
  }

  private async doLoadAssets(id: string, config: CharacterAssetConfig): Promise<void> {
    const animation = this.animations.get(id);
    if (!animation) return;

    const { basePath, rotations, animations: animConfigs } = config;

    // Helper to resolve paths - handles both absolute URLs and relative paths
    const resolvePath = (relativePath: string): string => {
      // If already an absolute URL, use as-is
      if (relativePath.startsWith("http://") || relativePath.startsWith("https://")) {
        return relativePath;
      }
      // Otherwise prepend basePath
      return basePath ? `${basePath}/${relativePath}` : relativePath;
    };

    // Load static rotation textures
    const directions = Object.keys(rotations) as SpriteDirection[];
    for (const direction of directions) {
      const path = resolvePath(rotations[direction]!);
      const texture = this.textureLoader(path);
      texture.generateMipmaps = false;
      texture.minFilter = LinearFilter;
      texture.magFilter = NearestFilter;
      animation.staticTextures.set(direction, texture);
    }

    // Load animation frame textures
    for (const animConfig of animConfigs) {
      const stateTextures = new Map<SpriteDirection, Texture[]>();

      for (const direction of directions) {
        const framePaths = animConfig.frames[direction];
        if (!framePaths) continue;

        const textures: Texture[] = [];
        for (const framePath of framePaths) {
          const path = resolvePath(framePath);
          const texture = this.textureLoader(path);
          texture.generateMipmaps = false;
          texture.minFilter = LinearFilter;
          texture.magFilter = NearestFilter;
          textures.push(texture);
        }

        stateTextures.set(direction, textures);
      }

      animation.textures.set(animConfig.state, stateTextures);
    }

    // Set initial texture
    this.updateSpriteTexture(animation);
  }

  /**
   * Update the sprite's texture based on current state and direction.
   * @param reset - Whether to reset animation to first frame (default: true)
   */
  private updateSpriteTexture(animation: FrameAnimation, reset: boolean = true): void {
    const { currentState, currentDirection, sprite } = animation;

    // Try to get animation textures for current state and direction
    const stateTextures = animation.textures.get(currentState);
    if (stateTextures) {
      const dirTextures = stateTextures.get(currentDirection);
      if (dirTextures && dirTextures.length > 0) {
        animation.currentTextures = dirTextures;
        if (reset) {
          animation.currentFrame = 0;
          animation.elapsedTime = 0;
        } else {
          // Ensure current frame is within bounds of the new texture set
          animation.currentFrame = animation.currentFrame % dirTextures.length;
        }
        animation.playing = true;

        // Show current frame
        const texture = dirTextures[animation.currentFrame];
        if (texture) {
          (sprite.material as SpriteMaterial).map = texture;
          (sprite.material as SpriteMaterial).needsUpdate = true;
        }
        return;
      }
    }

    // Fall back to static texture if no animation exists for this state
    if (currentState === "idle") {
      const texture = animation.staticTextures.get(currentDirection);
      if (texture) {
        (sprite.material as SpriteMaterial).map = texture;
        (sprite.material as SpriteMaterial).needsUpdate = true;
        animation.currentTextures = [];
        animation.playing = false;
      }
    }
  }

  /**
   * Set the direction for an entity.
   *
   * @param id - Entity identifier
   * @param direction - New direction
   */
  setDirection(id: string, direction: SpriteDirection): void {
    const animation = this.animations.get(id);
    if (!animation) return;

    if (animation.currentDirection !== direction) {
      animation.currentDirection = direction;
      // PERFORMANCE: Don't reset animation frame when just changing direction
      this.updateSpriteTexture(animation, false);
    }
  }

  /**
   * Set the animation state for an entity.
   *
   * @param id - Entity identifier
   * @param state - New animation state
   * @param config - Asset config (needed for frame duration)
   * @param onFinish - Optional callback when non-looping animation finishes
   */
  setState(
    id: string,
    state: AnimationState,
    config: CharacterAssetConfig,
    onFinish?: () => void,
  ): void {
    const animation = this.animations.get(id);
    if (!animation) return;

    // Find animation config for this state
    const animConfig = config.animations.find((a) => a.state === state);

    animation.currentState = state;
    animation.loop = animConfig?.loop ?? true;
    animation.frameDurationMs = animConfig?.frameDurationMs ?? 100;
    animation.onFinish = onFinish;

    this.updateSpriteTexture(animation);
  }

  /**
   * Play a one-shot animation (like throw or punch) then return to idle.
   *
   * @param id - Entity identifier
   * @param state - Animation state to play
   * @param config - Asset config
   */
  playOnce(id: string, state: AnimationState, config: CharacterAssetConfig): void {
    this.setState(id, state, config, () => {
      this.setState(id, "idle", config);
    });
  }

  /**
   * Update all animations. Call this in your animation loop.
   *
   * @param deltaTime - Time since last update in seconds
   */
  update(deltaTime: number): void {
    const deltaMs = deltaTime * 1000;

    this.animations.forEach((animation) => {
      if (!animation.playing || animation.currentTextures.length <= 1) return;

      animation.elapsedTime += deltaMs;

      if (animation.elapsedTime >= animation.frameDurationMs) {
        animation.elapsedTime -= animation.frameDurationMs;
        animation.currentFrame++;

        // Handle end of animation
        if (animation.currentFrame >= animation.currentTextures.length) {
          if (animation.loop) {
            animation.currentFrame = 0;
          } else {
            // Animation finished
            animation.playing = false;
            animation.currentFrame = animation.currentTextures.length - 1;

            if (animation.onFinish) {
              animation.onFinish();
            }
            return;
          }
        }

        // Update texture
        const texture = animation.currentTextures[animation.currentFrame];
        if (texture) {
          (animation.sprite.material as SpriteMaterial).map = texture;
          (animation.sprite.material as SpriteMaterial).needsUpdate = true;
        }
      }
    });
  }

  /**
   * Get the current animation state for an entity.
   */
  getState(id: string): AnimationState | undefined {
    return this.animations.get(id)?.currentState;
  }

  /**
   * Get the sprite for an entity.
   */
  getSprite(id: string): Sprite | undefined {
    return this.animations.get(id)?.sprite;
  }

  /**
   * Check if an entity exists.
   */
  has(id: string): boolean {
    return this.animations.has(id);
  }

  /**
   * Remove an entity and dispose its resources.
   */
  remove(id: string): void {
    const animation = this.animations.get(id);
    if (animation) {
      (animation.sprite.material as SpriteMaterial).dispose();
      this.animations.delete(id);
    }
  }

  /**
   * Dispose all resources.
   */
  dispose(): void {
    this.animations.forEach((animation) => {
      (animation.sprite.material as SpriteMaterial).dispose();
    });
    this.animations.clear();
    this.loadingPromises.clear();
  }
}
