// SpriteMixer.ts — TypeScript rewrite
// Author (original): Felix Mariotto
// Texture-offset core logic inspired by Lee Stemkoski
// https://github.com/stemkoski/stemkoski.github.io/blob/master/Three.js/Texture-Animation.html

import type { Texture } from "three";
import { RepeatWrapping, Sprite, SpriteMaterial } from "three";

/* ------------------------------------------------------------------ *
 *  Types & helpers
 * ------------------------------------------------------------------ */

type EventName = "loop" | "finished";

interface SpriteMixerEvent {
  type: EventName;
  action: Action;
}

interface Listener {
  eventName: EventName;
  callback: (e: SpriteMixerEvent) => void;
}

/* ------------------------------------------------------------------ *
 *  ActionSprite – an animated sprite built from a texture atlas
 * ------------------------------------------------------------------ */

export class ActionSprite extends Sprite {
  /* animation params ------------------------------------------------ */
  public readonly tilesHoriz: number;
  public readonly tilesVert: number;
  public readonly tiles: number;

  public currentDisplayTime = 0; // ms already spent on the current frame
  public currentTile = 0; // frame index
  public paused = true; // stops update() when true
  public readonly isIndexedSprite = true;

  /** Back-pointer to the action currently driving this sprite (§ SpriteMixer.update) */
  public currentAction?: Action;

  constructor(texture: Texture, tilesHoriz: number, tilesVert: number) {
    /* prepare atlas texture */
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.set(1 / tilesHoriz, 1 / tilesVert);

    /* build THREE.Sprite */
    const material = new SpriteMaterial({
      map: texture,
      color: 0xffffff,
      depthTest: false,
    });
    super(material);

    /* store geometry data */
    this.tilesHoriz = tilesHoriz;
    this.tilesVert = tilesVert;
    this.tiles = tilesHoriz * tilesVert;

    /* show the very first frame */
    this.offsetTexture();
  }

  /* ----------------------------------------------------- utilities */
  public getRow(): number {
    return Math.floor(this.currentTile / this.tilesHoriz);
  }
  public getColumn(): number {
    return this.currentTile % this.tilesHoriz;
  }

  /** Manually force a specific frame (indexing starts at 0). */
  public setFrame(frameID: number): void {
    this.paused = true;
    this.currentTile = frameID;
    this.offsetTexture();
  }

  /* ------------------------------------------------- internal use */
  public offsetTexture(): void {
    // y is flipped because WebGL's (0,0) is bottom-left
    if (this.material.map) {
      this.material.map.offset.set(
        this.getColumn() / this.tilesHoriz,
        (this.tilesVert - this.getRow() - 1) / this.tilesVert,
      );
    }
  }
}

/* ------------------------------------------------------------------ *
 *  Action – a subsection of an ActionSprite's atlas (start ⇢ end)
 * ------------------------------------------------------------------ */

export class Action {
  /** Sprite driven by this action */
  public readonly actionSprite: ActionSprite;

  /** first / last tile indices (inclusive) */
  public readonly indexStart: number;
  public readonly indexEnd: number;

  /** milliseconds one frame stays on screen */
  public readonly tileDisplayDuration: number;

  /** playback options (runtime-tweakable) */
  public clampWhenFinished = true;
  public hideWhenFinished = false;
  public mustLoop = true;

  /* — runtime helpers — */
  public readonly type = "spriteAction";

  constructor(
    actionSprite: ActionSprite,
    indexStart: number,
    indexEnd: number,
    tileDisplayDuration: number,
  ) {
    if (!actionSprite.isIndexedSprite) {
      throw new Error('"actionSprite" must come from SpriteMixer.ActionSprite');
    }
    this.actionSprite = actionSprite;
    this.indexStart = indexStart;
    this.indexEnd = indexEnd;
    this.tileDisplayDuration = tileDisplayDuration;
  }

  /* -------------------------------------------------- playback API */

  /** Reveal sprite and play **once**. */
  public playOnce(): void {
    this.mustLoop = false;
    this.startPlayback();
  }

  /** Reveal sprite and play **in loop**. */
  public playLoop(): void {
    this.mustLoop = true;
    this.startPlayback();
  }

  /** Resume if paused (re-sync to first frame if outside range). */
  public resume(): void {
    if (
      this.actionSprite.currentTile < this.indexStart ||
      this.actionSprite.currentTile > this.indexEnd
    ) {
      this.actionSprite.currentTile = this.indexStart;
    }
    this.actionSprite.paused = false;
    this.actionSprite.visible = true;
  }

  /** Pause at **next** end-frame. */
  public pauseNextEnd(): void {
    this.mustLoop = false;
  }

  /** Pause **now**. */
  public pause(): void {
    this.actionSprite.paused = true;
  }

  /** Pause and reset to first frame. */
  public stop(): void {
    const s = this.actionSprite;
    s.currentDisplayTime = 0;
    s.currentTile = this.indexStart;
    s.paused = true;
    if (this.hideWhenFinished) s.visible = false;
    s.offsetTexture();
  }

  /* -------------------------------------------------- helpers */
  private startPlayback(): void {
    const s = this.actionSprite;
    s.currentAction = this;
    s.currentTile = this.indexStart;
    s.offsetTexture();
    s.paused = false;
    s.visible = true;
  }
}

/* ------------------------------------------------------------------ *
 *  SpriteMixer – keeps animations ticking & dispatches events
 * ------------------------------------------------------------------ */

export class SpriteMixer {
  private readonly actionSprites: ActionSprite[] = [];
  private readonly listeners: Listener[] = [];

  /* ----------------------------------------------- public factory */

  /**
   * Create and register an ActionSprite.
   *
   * @param texture  Texture atlas
   * @param tilesHoriz  # tiles horizontally
   * @param tilesVert   # tiles vertically
   */
  public createActionSprite(
    texture: Texture,
    tilesHoriz: number,
    tilesVert: number,
  ): ActionSprite {
    const sprite = new ActionSprite(texture, tilesHoriz, tilesVert);
    this.actionSprites.push(sprite);
    return sprite;
  }

  /**
   * Create an Action tied to a previously created ActionSprite.
   * @throws if the sprite was not created by this mixer
   */
  public createAction(
    sprite: ActionSprite,
    indexStart: number,
    indexEnd: number,
    tileDisplayDuration: number,
  ): Action {
    if (!this.actionSprites.includes(sprite)) {
      throw new Error("ActionSprite must be registered with this SpriteMixer");
    }
    return new Action(sprite, indexStart, indexEnd, tileDisplayDuration);
  }

  /**
   * Unregister an ActionSprite so it's no longer updated.
   */
  public removeActionSprite(sprite: ActionSprite): void {
    const idx = this.actionSprites.indexOf(sprite);
    if (idx !== -1) {
      this.actionSprites.splice(idx, 1);
    }
  }

  /* --------------------------------------------- event management */

  /**
   * Listen for `'loop'` or `'finished'` events.
   * Throws if `eventName` or `callback` is missing.
   */
  public addEventListener(
    eventName: EventName,
    callback: (e: SpriteMixerEvent) => void,
  ): void {
    if (!eventName || !callback) {
      throw new Error("addEventListener: missing arguments");
    }
    this.listeners.push({ eventName, callback });
  }

  /**
   * Remove a previously added listener.
   */
  public removeEventListener(
    eventName: EventName,
    callback: (e: SpriteMixerEvent) => void,
  ): void {
    const idx = this.listeners.findIndex(
      (l) => l.eventName === eventName && l.callback === callback,
    );
    if (idx !== -1) {
      this.listeners.splice(idx, 1);
    }
  }

  /* ----------------------------------------------------- main tick */

  /**
   * Advance all registered ActionSprites.
   *
   * @param delta  Elapsed *seconds* since previous frame (same unit as THREE.Clock.getDelta()).
   */
  public update(delta: number): void {
    // convert to ms for compatibility with original implementation
    const milli = delta * 1000;

    for (const sprite of this.actionSprites) {
      if (!sprite.paused && sprite.currentAction) {
        this.updateAction(sprite.currentAction, milli);
      }
    }
  }

  /* -------------------------------------------------- internals */

  private updateAction(action: Action, milliSec: number): void {
    const s = action.actionSprite;
    s.currentDisplayTime += milliSec;

    while (s.currentDisplayTime > action.tileDisplayDuration) {
      s.currentDisplayTime -= action.tileDisplayDuration;
      s.currentTile++;

      /* Last frame reached? */
      if (s.currentTile > action.indexEnd) {
        s.currentTile = action.indexStart;

        if (action.mustLoop) {
          this.dispatch("loop", action);
        } else {
          /* —— action must end —— */
          if (action.clampWhenFinished) {
            s.paused = true;
            if (action.hideWhenFinished) s.visible = false;
            this.dispatch("finished", action);
          } else {
            /* restart then stop (one extra frame) */
            s.paused = true;
            if (action.hideWhenFinished) s.visible = false;

            // Fix setTimeout context issue by using arrow function
            setTimeout(() => {
              this.updateAction(action, action.tileDisplayDuration);
              this.dispatch("finished", action);
            }, action.tileDisplayDuration);
          }
        }
      }

      /* draw new frame */
      s.offsetTexture();
    }
  }

  private dispatch(type: EventName, action: Action): void {
    for (const l of this.listeners) {
      if (l.eventName === type) {
        l.callback({ type, action });
      }
    }
  }
}
