import { type Container, Matrix, type Sprite, Texture } from "pixi.js";

/** Repeated outfits and animation frames share one alpha silhouette instead of a generic body. */
export const createCharacterShadowPoses = () => {
  const cache = new Map<string, ShadowPose>();
  let bytes = 0;
  const capture = (root: Container, parts: readonly Sprite[]) => {
    const visible = parts.filter(
      (part) =>
        !part.destroyed &&
        part.visible &&
        part.alpha > 0 &&
        part.texture !== Texture.EMPTY,
    );
    const key = visible
      .map(
        (part) =>
          `${part.texture.uid}:${part.scale.x}:${part.scale.y}:${part.x}:${part.y}:${part.anchor.x}:${part.anchor.y}`,
      )
      .join("|");
    const cached = cache.get(key);
    if (cached) return cached;
    const first = visible[0];
    if (!first) return null;
    const layers = visible.map((part) => {
      let matrix = new Matrix();
      let node: Container | null = part;
      while (node && node !== root) {
        node.updateLocalTransform();
        matrix = node.localTransform.clone().append(matrix);
        node = node.parent;
      }
      const texture = part.texture,
        trim = texture.trim;
      const x = (trim?.x ?? 0) - part.anchor.x * texture.orig.width;
      const y = (trim?.y ?? 0) - part.anchor.y * texture.orig.height;
      return {
        part,
        matrix,
        x,
        y,
        width: trim?.width ?? texture.orig.width,
        height: trim?.height ?? texture.orig.height,
      };
    });
    const points = layers.flatMap((l) =>
      [
        { x: l.x, y: l.y },
        { x: l.x + l.width, y: l.y },
        { x: l.x, y: l.y + l.height },
        { x: l.x + l.width, y: l.y + l.height },
      ].map((point) => l.matrix.apply(point)),
    );
    const minX = Math.min(...points.map((p) => p.x)),
      minY = Math.min(...points.map((p) => p.y));
    const width = Math.max(...points.map((p) => p.x)) - minX,
      height = Math.max(...points.map((p) => p.y)) - minY;
    if (!(width > 0 && height > 0)) return null;
    const canvas = document.createElement("canvas");
    const scale = Math.min(128, 128 / Math.max(width, height));
    canvas.width = Math.max(1, Math.ceil(width * scale));
    canvas.height = Math.max(1, Math.ceil(height * scale));
    const context = canvas.getContext("2d");
    let texture = first.texture;
    let owned = false;
    try {
      if (context) {
        for (const l of layers) {
          const m = l.matrix,
            f = l.part.texture.frame;
          context.setTransform(
            m.a * scale,
            m.b * scale,
            m.c * scale,
            m.d * scale,
            (m.tx - minX) * scale,
            (m.ty - minY) * scale,
          );
          context.drawImage(
            l.part.texture.source.resource as CanvasImageSource,
            f.x,
            f.y,
            f.width,
            f.height,
            l.x,
            l.y,
            l.width,
            l.height,
          );
        }
        context.resetTransform();
        context.globalCompositeOperation = "source-in";
        context.fillStyle = "white";
        context.fillRect(0, 0, canvas.width, canvas.height);
        const fade = context.createLinearGradient(0, 0, 0, canvas.height);
        fade.addColorStop(0, "rgba(255,255,255,0.55)");
        fade.addColorStop(1, "white");
        context.globalCompositeOperation = "destination-in";
        context.fillStyle = fade;
        context.fillRect(0, 0, canvas.width, canvas.height);
        texture = Texture.from(canvas);
        texture.source.scaleMode = "linear";
        owned = true;
      }
    } catch {
      // Unsupported decoded resources still cast their shared artwork silhouette.
    }
    const pose: ShadowPose = {
      texture,
      minX,
      minY,
      width,
      height,
      owned,
      users: 0,
    };
    cache.set(key, pose);
    if (owned) bytes += texture.width * texture.height * 4;
    // Active silhouettes remain leased even when a long walk fills the idle frame budget.
    if (cache.size > 96 || bytes > 4 * 1024 * 1024)
      for (const [oldKey, old] of cache) {
        if (old.users || old === pose) continue;
        if (old.owned) {
          bytes -= old.texture.width * old.texture.height * 4;
          old.texture.destroy(true);
        }
        cache.delete(oldKey);
        if (cache.size <= 96 && bytes <= 4 * 1024 * 1024) break;
      }
    return pose;
  };
  return {
    capture,
    destroy: () => {
      for (const pose of cache.values()) if (pose.owned) pose.texture.destroy(true);
      cache.clear();
      bytes = 0;
    },
  };
};

export type ShadowPose = {
  texture: Texture;
  minX: number;
  minY: number;
  width: number;
  height: number;
  owned: boolean;
  users: number;
};
