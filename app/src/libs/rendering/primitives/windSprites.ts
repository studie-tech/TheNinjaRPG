import {
  BatchableSprite,
  Batcher,
  type BatcherOptions,
  BatchGeometry,
  colorBitGl,
  compileHighShaderGlProgram,
  ExtensionType,
  extensions,
  generateTextureBatchBitGl,
  getBatchSamplersUniformGroup,
  type InstructionSet,
  type Renderer,
  roundPixelsBitGl,
  Shader,
  Sprite,
  type Texture,
  UniformGroup,
  type WebGLRenderer,
} from "pixi.js";
import { type WorldWind, worldWindShader } from "@/libs/rendering/worldWind";

const uniforms = new WeakMap<
  Renderer,
  { group: ReturnType<typeof createWindUniforms>; key: string }
>();

/** Keeps scenery in painter-ordered sprite batches while its gust is applied on the GPU. */
export const createWindSprite = (
  renderer: Renderer,
  texture: Texture,
  group: number,
) => {
  if (!uniforms.has(renderer)) return new Sprite(texture);
  return new WindSprite(texture, group);
};

/** One renderer-local gust drives every color batch, matching the physical passes. */
export const updateWindSprites = (renderer: Renderer, breeze: WorldWind) => {
  const current = uniforms.get(renderer);
  if (!current || current.key === breeze.key) return;
  current.key = breeze.key;
  current.group.uniforms.uWind.set(breeze.large);
  current.group.uniforms.uWindSmall.set(breeze.small);
  current.group.update();
};

/** A base pose remains immutable while the batch shader moves rows above its root. */
export class WindSprite extends Sprite {
  override readonly renderPipeId = "worldWindSprite";
  constructor(
    texture: Texture,
    readonly windGroup = 0,
  ) {
    super(texture);
  }
}

// Pixi's extension registry constructs render pipes and batchers through classes.
/** Publishes changing gusts before retained sprite-batch instructions execute. */
export class WindSpritePipe {
  static extension = { type: [ExtensionType.WebGLPipes], name: "worldWindSprite" };
  private sprites = new WeakMap<WindSprite, BatchableSprite>();
  private instructions = new WeakMap<InstructionSet, WindInstruction>();
  private wind = createWindUniforms();

  constructor(private renderer: WebGLRenderer) {
    uniforms.set(renderer, { group: this.wind, key: "" });
  }

  private getSprite(sprite: WindSprite) {
    let entry = this.sprites.get(sprite);
    if (!entry) {
      entry = new BatchableSprite();
      entry.batcherName = "worldWindSprite";
      entry.renderable = sprite;
      entry.transform = sprite.groupTransform;
      entry.roundPixels = this.renderer.roundPixels || sprite.roundPixels ? 1 : 0;
      entry.texture = sprite.texture;
      entry.bounds = sprite.visualBounds;
      this.sprites.set(sprite, entry);
    }
    if (sprite.didViewUpdate) {
      entry.texture = sprite.texture;
      entry.bounds = sprite.visualBounds;
    }
    return entry;
  }

  addRenderable(sprite: WindSprite, instructions: InstructionSet) {
    const entry = this.getSprite(sprite);
    let wind = this.instructions.get(instructions);
    if (
      !wind ||
      wind.index >= instructions.instructionSize ||
      instructions.instructions[wind.index] !== wind
    ) {
      this.renderer.renderPipes.batch.break(instructions);
      wind = {
        renderPipeId: "worldWindSprite",
        canBundle: false,
        shader: null,
        index: instructions.instructionSize,
      };
      instructions.add(wind);
      this.instructions.set(instructions, wind);
    }
    this.renderer.renderPipes.batch.addToBatch(entry, instructions);
    if (entry._batcher && wind.shader !== entry._batcher.shader) {
      wind.shader = entry._batcher.shader;
      wind.shader.resources.wind = this.wind;
    }
  }

  execute(instruction: WindInstruction) {
    // Pixi batches sync custom uniforms only on first use; retained gusts need each-frame binding.
    if (instruction.shader) this.renderer.shader.bind(instruction.shader);
  }

  updateRenderable(sprite: WindSprite) {
    const entry = this.getSprite(sprite);
    entry._batcher?.updateElement(entry);
  }

  validateRenderable(sprite: WindSprite) {
    const entry = this.getSprite(sprite);
    return !entry._batcher?.checkAndUpdateTexture(entry, sprite.texture);
  }

  destroy() {
    uniforms.delete(this.renderer);
    this.sprites = new WeakMap();
    this.instructions = new WeakMap();
  }
}

/** Extends Pixi's quad format with a gust bucket and its transformed displacement axis. */
class WindBatcher extends Batcher {
  static extension = { type: [ExtensionType.Batcher], name: "worldWindSprite" };
  name = "worldWindSprite";
  vertexSize = 9;
  geometry = new BatchGeometry();
  shader: ReturnType<typeof createWindShader>;

  constructor(options: BatcherOptions) {
    super(options);
    this.name = "worldWindSprite";
    this.vertexSize = 9;
    for (const attribute of Object.values(this.geometry.attributes))
      attribute.stride = 36;
    this.geometry.addAttribute("aWind", {
      buffer: this.geometry.getBuffer("aPosition"),
      format: "float32x3",
      stride: 36,
      offset: 24,
    });
    this.shader = createWindShader(options.maxTextures);
  }

  override packQuadAttributes(
    element: BatchableSprite,
    floats: Float32Array,
    integers: Uint32Array,
    index: number,
    textureId: number,
  ) {
    const sprite = element.renderable as WindSprite;
    const transform = element.transform,
      local = sprite.localTransform;
    // Remove the sprite's own basis to recover its parent's horizontal axis.
    // A row's distance above the root then produces the same rooted shear in every pass.
    const determinant = local.a * local.d - local.b * local.c;
    const axisX = determinant
      ? (transform.a * local.d - transform.c * local.b) / determinant
      : 0;
    const axisY = determinant
      ? (transform.b * local.d - transform.d * local.b) / determinant
      : 0;
    const { bounds, texture } = element;
    const uv = texture.uvs;
    const root = 1 - sprite.anchor.y;
    const height = texture.orig.height;
    const color = element.color;
    const textureAndRound = (textureId << 16) | element.roundPixels;
    for (let vertex = 0; vertex < 4; vertex++) {
      const x = vertex === 1 || vertex === 2 ? bounds.maxX : bounds.minX;
      const y = vertex < 2 ? bounds.minY : bounds.maxY;
      const amount = sprite.windGroup ? root - y / height : 0;
      floats[index] = transform.a * x + transform.c * y + transform.tx;
      floats[index + 1] = transform.b * x + transform.d * y + transform.ty;
      floats[index + 2] =
        vertex === 0 ? uv.x0 : vertex === 1 ? uv.x1 : vertex === 2 ? uv.x2 : uv.x3;
      floats[index + 3] =
        vertex === 0 ? uv.y0 : vertex === 1 ? uv.y1 : vertex === 2 ? uv.y2 : uv.y3;
      integers[index + 4] = color;
      integers[index + 5] = textureAndRound;
      floats[index + 6] = sprite.windGroup;
      floats[index + 7] = axisX * amount;
      floats[index + 8] = axisY * amount;
      index += 9;
    }
  }

  override packAttributes() {
    throw new Error("Wind batches accept sprite quads only");
  }

  _updateMaxTextures(maxTextures: number) {
    if (this.shader.maxTextures === maxTextures) return;
    const group = this.shader.resources.wind as ReturnType<typeof createWindUniforms>;
    this.shader.destroy();
    this.shader = createWindShader(maxTextures, group);
  }

  override destroy() {
    super.destroy({ shader: true });
  }
}

const createWindUniforms = () =>
  new UniformGroup(
    {
      uWind: { value: new Float32Array(4), type: "vec4<f32>" },
      uWindSmall: { value: new Float32Array(4), type: "vec4<f32>" },
    },
    { isStatic: true },
  );

const createWindShader = (maxTextures: number, wind = createWindUniforms()) =>
  Object.assign(
    new Shader({
      glProgram: compileHighShaderGlProgram({
        name: "world-wind-sprite",
        bits: [
          colorBitGl,
          generateTextureBatchBitGl(maxTextures),
          roundPixelsBitGl,
          {
            name: "world-wind",
            vertex: {
              header: `in vec3 aWind;\n${worldWindShader}`,
              main: "position += aWind.yz * worldWind(aWind.x);",
            },
          },
        ],
      }),
      resources: { wind, batchSamplers: getBatchSamplersUniformGroup(maxTextures) },
    }),
    { maxTextures },
  );

extensions.add(WindSpritePipe, WindBatcher);

type WindInstruction = {
  renderPipeId: "worldWindSprite";
  canBundle: false;
  shader: Shader | null;
  index: number;
};
