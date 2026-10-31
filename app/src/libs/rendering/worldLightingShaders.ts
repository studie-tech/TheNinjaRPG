import { MAX_BVH_NODES, MAX_CELL_INSTANCES } from "@/libs/rendering/worldOcclusion";
import { worldWindShader } from "@/libs/rendering/worldWind";

/** Numerical material buffers use unpremultiplied RGBA8 and world-space octahedral normals. */
export const materialShader = `
vec3 worldNormal(vec2 encoded) {
  vec2 f = encoded * 2.0 - 1.0;
  vec3 n = vec3(f, 1.0 - abs(f.x) - abs(f.y));
  if (n.z < 0.0) n.xy = (1.0 - abs(n.yx)) * vec2(n.x < 0.0 ? -1.0 : 1.0, n.y < 0.0 ? -1.0 : 1.0);
  return normalize(n);
}
vec2 octNormal(vec3 n) {
  n /= abs(n.x) + abs(n.y) + abs(n.z);
  if (n.z < 0.0) n.xy = (1.0 - abs(n.yx)) * vec2(n.x < 0.0 ? -1.0 : 1.0, n.y < 0.0 ? -1.0 : 1.0);
  return n.xy * 0.5 + 0.5;
}
vec3 receiverNormal(vec4 data) {
  if (mod(floor(data.r * 255.0 + 0.5), 4.0) < 0.5) return vec3(0.0, 0.0, 1.0);
  return worldNormal(vec2(floor(floor(data.r * 255.0 + 0.5) / 8.0) / 31.0, data.g));
}
float receiverHeight(vec4 data) {
  return (data.b + data.a / 255.0) * 1024.0 - 512.0;
}
vec2 packHeight(float height) {
  float value = clamp(height / 1024.0 + 0.5, 0.0, 1.0) * 255.0;
  return vec2(floor(value) / 255.0, fract(value));
}
vec3 receiverPosition(vec2 screen, float height, vec3 normal, vec4 viewport, vec2 size) {
  vec2 uv = (screen - viewport.xy) / viewport.zw;
  vec2 center = viewport.xy + (floor(uv * size) + 0.5) * viewport.zw / size;
  vec2 offset = screen - center;
  float facingCamera = normal.z - 2.0 * normal.y;
  if (abs(facingCamera) > 0.05)
    height -= (normal.x * offset.x + 2.0 * normal.y * offset.y) / facingCamera;
  return vec3(screen.x, 2.0 * (screen.y - height), height);
}
`;

/** Cropped point-light quads use the ground grid to find exact authored triangular prisms. */
export const pointLightFragment = `precision highp float;
precision highp sampler2D; // Preserve encoded bytes in texture results before numeric decoding.
varying vec2 vWorld;
varying vec4 vLight;
varying vec3 vColor;
varying float vCastsShadows;
uniform sampler2D uReceiver;
uniform sampler2D uStaticField;
uniform sampler2D uStaticReferences;
uniform sampler2D uStaticPrisms;
uniform sampler2D uDynamicField;
uniform sampler2D uDynamicReferences;
uniform sampler2D uDynamicPrisms;
uniform vec4 uViewport;
uniform vec2 uReceiverSize;
uniform vec4 uStaticBounds;
uniform vec4 uDynamicBounds;
uniform vec4 uStaticGeometry;
uniform vec4 uDynamicGeometry;
uniform vec4 uStaticTables;
uniform vec4 uDynamicTables;
uniform vec4 uFieldHeights;
${worldWindShader}
uniform float uLightStrength;
uniform vec2 uInstanceCounts;
${materialShader}
float unsigned16(vec2 bytes) { return dot(bytes, vec2(256.0, 1.0)) / 257.0; }
float unsigned24(vec3 bytes) { return dot(floor(bytes * 255.0 + 0.5), vec3(65536.0, 256.0, 1.0)); }
vec4 tableTexel(sampler2D source, vec2 size, float index) {
  return texture2D(source, (vec2(mod(index, size.x), floor(index / size.x)) + 0.5) / size);
}
vec2 prismXY(sampler2D source, vec2 size, float index, vec4 bounds) {
  vec4 data = tableTexel(source, size, index);
  return bounds.xy + vec2(unsigned16(data.rg), unsigned16(data.ba)) * bounds.zw;
}
// Clip a segment against a linear inside >= 0 constraint. Barycentric coordinates
// describe the three footprint halfplanes and both affine height planes without a mesh walk.
bool constrain(inout vec2 interval, float value, float slope) {
  if (abs(slope) < 0.0000001) return value >= -0.000001;
  float crossing = -value / slope;
  if (slope > 0.0) interval.x = max(interval.x, crossing);
  else interval.y = min(interval.y, crossing);
  return interval.x <= interval.y + 0.000001;
}
float cross2(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }
float prismHit(sampler2D source, vec2 size, vec4 bounds, float heightRange,
  float index, vec3 origin, vec3 ray) {
  vec2 a = prismXY(source, size, index, bounds);
  vec2 b = prismXY(source, size, index + 2.0, bounds) - a;
  vec2 c = prismXY(source, size, index + 4.0, bounds) - a;
  float area = cross2(b, c);
  if (area == 0.0) return 0.0;
  vec2 relative = origin.xy - a;
  vec2 barycentric = vec2(cross2(relative, c), cross2(b, relative)) / area;
  vec2 velocity = vec2(cross2(ray.xy, c), cross2(b, ray.xy)) / area;
  vec2 interval = vec2(0.0, 1.0);
  if (!constrain(interval, barycentric.x, velocity.x) ||
    !constrain(interval, barycentric.y, velocity.y) ||
    !constrain(interval, 1.0 - barycentric.x - barycentric.y, -velocity.x - velocity.y)) return 0.0;
  vec4 ah = tableTexel(source, size, index + 1.0);
  vec4 bh = tableTexel(source, size, index + 3.0);
  vec4 ch = tableTexel(source, size, index + 5.0);
  vec2 heightA = vec2(unsigned16(ah.rg), unsigned16(ah.ba)) * heightRange;
  vec2 heightB = vec2(unsigned16(bh.rg), unsigned16(bh.ba)) * heightRange - heightA;
  vec2 heightC = vec2(unsigned16(ch.rg), unsigned16(ch.ba)) * heightRange - heightA;
  vec2 initial = heightA + heightB * barycentric.x + heightC * barycentric.y;
  vec2 change = heightB * velocity.x + heightC * velocity.y;
  if (!constrain(interval, origin.z - initial.x, ray.z - change.x) ||
    !constrain(interval, initial.y - origin.z, change.y - ray.z)) return 0.0;
  return 1.0;
}
// Numeric geometry tables retain full Float32 instance transforms without float-texture support.
float float32(vec4 encoded) {
  vec4 bytes = floor(encoded * 255.0 + 0.5);
  float signValue = bytes.r < 128.0 ? 1.0 : -1.0;
  float exponent = mod(bytes.r, 128.0) * 2.0 + floor(bytes.g / 128.0);
  float mantissa = mod(bytes.g, 128.0) * 65536.0 + bytes.b * 256.0 + bytes.a;
  if (exponent < 0.5) return signValue * (mantissa / 8388608.0) * exp2(-126.0);
  return signValue * (1.0 + mantissa / 8388608.0) * exp2(exponent - 127.0);
}
float tableFloat(sampler2D source, vec2 size, float index) {
  return float32(tableTexel(source, size, index));
}
bool intersectsBounds(vec3 origin, vec3 ray, vec3 lower, vec3 upper) {
  vec2 interval = vec2(0.0, 1.0);
  return constrain(interval, origin.x - lower.x, ray.x) &&
    constrain(interval, upper.x - origin.x, -ray.x) &&
    constrain(interval, origin.y - lower.y, ray.y) &&
    constrain(interval, upper.y - origin.y, -ray.y) &&
    constrain(interval, origin.z - lower.z, ray.z) &&
    constrain(interval, upper.z - origin.z, -ray.z);
}
float casterHit(sampler2D source, vec2 size, float instance, vec2 worldOffset,
  vec3 origin, vec3 ray) {
  vec4 entry = tableTexel(source, size, instance);
  float geometry = unsigned24(entry.rgb);
  float flags = floor(entry.a * 255.0 + 0.5);
  float code = floor(flags / 2.0);
  float dx = worldWind(code);
  origin.xy -= worldOffset;
  if (mod(flags, 2.0) > 0.5) {
    float a = tableFloat(source, size, instance + 1.0);
    float b = tableFloat(source, size, instance + 2.0);
    float c = tableFloat(source, size, instance + 3.0) - dx;
    float d = tableFloat(source, size, instance + 4.0);
    vec2 translation = vec2(tableFloat(source, size, instance + 5.0), tableFloat(source, size, instance + 6.0));
    translation.x += dx;
    float height = tableFloat(source, size, instance + 7.0);
    // Invert the source-camera projection before entering the shared physical mesh.
    vec2 projected = vec2(origin.x, origin.y * 0.5 + origin.z) - translation;
    vec2 velocity = vec2(ray.x, ray.y * 0.5 + ray.z);
    float determinant = a * d - b * c;
    vec2 uv = vec2(d * projected.x - c * projected.y, a * projected.y - b * projected.x) / determinant;
    vec2 duv = vec2(d * velocity.x - c * velocity.y, a * velocity.y - b * velocity.x) / determinant;
    origin = vec3(uv.x, -2.0 * (uv.y + origin.z / height), origin.z / height);
    ray = vec3(duv.x, -2.0 * (duv.y + ray.z / height), ray.z / height);
  } else if (code > 0.5) {
    // Global custom geometry uses the source-V affine weight, including rotation and mirroring.
    vec3 weight = vec3(tableFloat(source, size, instance + 1.0), tableFloat(source, size, instance + 2.0), tableFloat(source, size, instance + 3.0));
    float stretch = 1.0 + dx * weight.x;
    origin.x = (origin.x - dx * (weight.y * (origin.y * 0.5 + origin.z) + weight.z)) / stretch;
    ray.x = (ray.x - dx * weight.y * (ray.y * 0.5 + ray.z)) / stretch;
  }
  vec2 minimum = vec2(tableFloat(source, size, geometry), tableFloat(source, size, geometry + 1.0));
  vec2 span = vec2(tableFloat(source, size, geometry + 2.0), tableFloat(source, size, geometry + 3.0));
  float heightRange = tableFloat(source, size, geometry + 4.0);
  origin.xy -= minimum;
  vec4 bounds = vec4(0.0, 0.0, span);
  float node = geometry + 5.0;
  float end = unsigned24(tableTexel(source, size, node + 3.0).rgb);
  // Preorder escape links avoid recursion and a per-fragment stack. The CPU validates
  // every mesh against this visit bound before publishing its complete table.
  for (int visit = 0; visit < ${MAX_BVH_NODES}; visit++) {
    if (node >= end) break;
    vec4 lowerXY = tableTexel(source, size, node);
    vec4 upperXY = tableTexel(source, size, node + 1.0);
    vec4 heights = tableTexel(source, size, node + 2.0);
    vec4 metadata = tableTexel(source, size, node + 3.0);
    vec3 lower = vec3(vec2(unsigned16(lowerXY.rg), unsigned16(lowerXY.ba)) * span, unsigned16(heights.rg) * heightRange);
    vec3 upper = vec3(vec2(unsigned16(upperXY.rg), unsigned16(upperXY.ba)) * span, unsigned16(heights.ba) * heightRange);
    float escape = unsigned24(metadata.rgb);
    float count = floor(metadata.a * 255.0 + 0.5);
    if (!intersectsBounds(origin, ray, lower, upper)) {
      node = escape;
      continue;
    }
    if (count > 0.0) {
      float first = unsigned24(tableTexel(source, size, node + 4.0).rgb);
      for (int i = 0; i < 8; i++) {
        if (float(i) >= count) break;
        if (prismHit(source, size, bounds, heightRange, first + float(i) * 6.0, origin, ray) > 0.5) return 1.0;
      }
      node = escape;
    } else node += 5.0;
  }
  return 0.0;
}
float blocked(sampler2D header, sampler2D references, sampler2D prisms,
  vec4 bounds, vec4 geometry, vec4 tables, float heightRange,
  vec2 samplePosition, vec3 first, vec3 last, vec3 origin, vec3 ray, inout float previousInstance) {
  vec2 uv = (samplePosition - bounds.xy) / bounds.zw;
  if (min(uv.x, uv.y) < 0.0 || max(uv.x, uv.y) >= 1.0) return 0.0;
  vec2 cell = floor(uv * 512.0);
  vec2 center = (cell + 0.5) / 512.0;
  vec4 base = texture2D(header, center / vec2(2.0, 1.0));
  vec4 metadata = texture2D(header, (vec2(1.0, 0.0) + center) / vec2(2.0, 1.0));
  float offset = unsigned24(base.rgb);
  float count = floor(base.a * 255.0 + 0.5) + floor(metadata.r * 255.0 + 0.5) * 256.0;
  float lower = min(first.z, last.z), upper = max(first.z, last.z);
  vec2 cellOrigin = bounds.xy + cell * bounds.zw / 512.0;
  vec2 firstXY = (first.xy - cellOrigin) * 512.0 / bounds.zw;
  vec2 lastXY = (last.xy - cellOrigin) * 512.0 / bounds.zw;
  vec2 minimum = min(firstXY, lastXY), maximum = max(firstXY, lastXY);
  // A cell references instances, so hundreds of copies share one exact local mesh.
  for (int i = 0; i < ${MAX_CELL_INSTANCES}; i++) {
    if (float(i) >= count) break;
    vec4 reference = tableTexel(references, tables.xy, (offset + float(i)) * 2.0);
    if (reference.a * heightRange > upper + 0.00001) break;
    vec4 detail = tableTexel(references, tables.xy, (offset + float(i)) * 2.0 + 1.0);
    if (detail.r < 1.0 && detail.r * heightRange < lower - 0.00001) continue;
    vec2 packedBounds = floor(detail.gb * 255.0 + 0.5);
    vec2 minXY = vec2(mod(packedBounds.x, 16.0), floor(packedBounds.x / 16.0)) / 15.0;
    vec2 maxXY = vec2(mod(packedBounds.y, 16.0), floor(packedBounds.y / 16.0)) / 15.0;
    if (any(lessThan(maximum, minXY)) || any(greaterThan(minimum, maxXY))) continue;
    float instance = unsigned24(reference.rgb);
    if (instance == previousInstance) continue;
    // Test the complete ray once per consecutive instance; a miss stays valid across cell boundaries.
    previousInstance = instance;
    if (casterHit(prisms, tables.zw, instance, geometry.xy, origin, ray) > 0.5) return 1.0;
  }
  return 0.0;
}
float nextBoundary(float position, float delta, float origin, float cell) {
  if (abs(delta) < 0.00001) return 1.0;
  float index = (position - origin) / cell;
  float edge = (delta > 0.0 ? floor(index) + 1.0 : ceil(index) - 1.0) * cell + origin;
  return max(0.00001, (edge - position) / delta);
}
void main() {
  vec4 data = texture2D(uReceiver, (vWorld - uViewport.xy) / uViewport.zw);
  float height = receiverHeight(data);
  vec3 normal = receiverNormal(data);
  vec3 p = receiverPosition(vWorld, height, normal, uViewport, uReceiverSize);
  vec3 delta = vLight.xyz - p;
  vec3 scaledDelta = delta / max(vLight.w, 1.0);
  float distanceToLight = length(scaledDelta) * vLight.w;
  if (distanceToLight >= vLight.w) discard;
  vec3 direction = scaledDelta / max(length(scaledDelta), 0.0001);
  float diffuse = max(dot(normal, direction), 0.0);
  if (diffuse <= 0.001) discard;
  float visibility = 1.0;
  // Foot-centered fill lights bypass occlusion; sunlight and fixed fixtures own projected shadows.
  if (vCastsShadows > 0.5) {
    float surface = mod(floor(data.r * 255.0 + 0.5), 4.0);
    float heightError = (surface < 0.5 ? 0.0 : uFieldHeights.z) + 512.0 / 65025.0;
    float guard = heightError * abs(normal.z - 2.0 * normal.y) + uFieldHeights.w;
    vec3 origin = p + normal * guard;
    vec3 ray = vLight.xyz - direction * uFieldHeights.w - origin;
    float t = 0.0;
    float previousStatic = -1.0, previousDynamic = -1.0;
    float staticCell = uStaticBounds.z / 512.0, dynamicCell = uDynamicBounds.z / 512.0;
    // Traverse both broad-phase grids; the complete ray segment in each cell is clipped
    // against authored geometry. Grid size never expands an occluder or the receiver bias.
    for (int i = 0; i < 192; i++) {
      if (distanceToLight <= guard + uFieldHeights.w) break;
      float sampleT = min(1.0, t + 0.00001);
      vec3 q = origin + ray * sampleT;
      // A complete-ray miss exhausts a singleton field; empty fields need no traversal either.
      bool staticDone = uInstanceCounts.x < 0.5 || (uInstanceCounts.x < 1.5 && previousStatic >= 0.0);
      bool dynamicDone = uInstanceCounts.y < 0.5 || (uInstanceCounts.y < 1.5 && previousDynamic >= 0.0);
      float stepT = min(
        staticDone ? 1.0 : min(nextBoundary(q.x, ray.x, uStaticBounds.x, staticCell), nextBoundary(q.y, ray.y, uStaticBounds.y, staticCell)),
        dynamicDone ? 1.0 : min(nextBoundary(q.x, ray.x, uDynamicBounds.x, dynamicCell), nextBoundary(q.y, ray.y, uDynamicBounds.y, dynamicCell)));
      float endT = min(1.0, sampleT + stepT);
      vec3 first = origin + ray * t, last = origin + ray * endT;
      // A boundary probe can round onto the preceding cell while its next edge advances.
      // Query the segment interior so grid membership agrees with the tested prism segment.
      vec2 samplePosition = (first.xy + last.xy) * 0.5;
      float occluded = staticDone ? 0.0 : blocked(uStaticField, uStaticReferences, uStaticPrisms, uStaticBounds,
        uStaticGeometry, uStaticTables, uFieldHeights.x, samplePosition, first, last, origin, ray, previousStatic);
      if (occluded < 0.5 && !dynamicDone)
        occluded = blocked(uDynamicField, uDynamicReferences, uDynamicPrisms, uDynamicBounds,
          uDynamicGeometry, uDynamicTables, uFieldHeights.y, samplePosition, first, last, origin, ray, previousDynamic);
      visibility *= 1.0 - occluded;
      if (visibility < 0.5 || endT >= 1.0) break;
      t = endT;
    }
  }
  float falloff = max(0.0, 1.0 - distanceToLight / vLight.w);
  gl_FragColor = vec4(vColor * diffuse * falloff * falloff * visibility * uLightStrength, 1.0);
}`;

/** A single filter shades physical albedo; interface artwork is drawn after this layer. */
export const lightingFragment = `precision highp float;
precision highp sampler2D; // Receiver and depth buffers carry numeric channels, including byte flags.
varying vec2 vTextureCoord;
varying vec2 vScreen;
uniform sampler2D uTexture;
uniform sampler2D uReceiver;
uniform sampler2D uPoints;
uniform sampler2D uStaticSun;
uniform sampler2D uDynamicSun;
uniform sampler2D uStaticField;
uniform sampler2D uDynamicField;
uniform vec4 uStaticBounds;
uniform vec4 uDynamicBounds;
uniform vec4 uViewport;
uniform vec2 uReceiverSize;
uniform vec3 uSun;
uniform vec3 uSunRight;
uniform vec3 uSunUp;
uniform vec3 uSunOrigin;
uniform vec4 uSunBounds;
uniform vec4 uSunDepth;
uniform vec3 uAmbient;
uniform vec3 uSunColor;
uniform float uDay;
${materialShader}
vec3 linearColor(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
vec3 displayColor(vec3 c) { return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); }
float visibility(sampler2D map, vec2 uv, float depth, float bias) {
  vec4 sample = texture2D(map, uv);
  float caster = sample.r + sample.g / 255.0;
  return 1.0 - step(depth + bias, caster) * step(0.5, sample.a);
}
// Compare packed depths before interpolating coverage; filtering encoded RG values changes depth.
float sunVisibility(vec2 sampleUV, vec2 receiverUV, float depth, vec2 gradient, float bias) {
  vec2 edge = vec2(0.5 / uSunDepth.w);
  sampleUV = clamp(sampleUV, edge, vec2(1.0) - edge);
  // Reproject the receiver plane at every sample to keep sloped surfaces from shadowing themselves.
  float referenceDepth = depth - dot(gradient, sampleUV - receiverUV);
  return min(visibility(uStaticSun, sampleUV, referenceDepth, bias),
    visibility(uDynamicSun, sampleUV, referenceDepth, bias));
}
float contactCoverage(sampler2D map, vec2 uv) {
  if (min(uv.x, uv.y) < 0.0 || max(uv.x, uv.y) > 1.0) return 0.0;
  return texture2D(map, (vec2(1.0, 0.0) + clamp(uv, vec2(0.5 / 512.0), vec2(1.0 - 0.5 / 512.0))) / vec2(2.0, 1.0)).b;
}
void main() {
  vec4 color = texture2D(uTexture, vTextureCoord);
  vec2 uv = vec2(vScreen.x, 1.0 - vScreen.y);
  vec4 data = texture2D(uReceiver, uv);
  float height = receiverHeight(data);
  vec2 screenWorld = uViewport.xy + uv * uViewport.zw;
  vec3 n = receiverNormal(data);
  vec3 p = receiverPosition(screenWorld, height, n, uViewport, uReceiverSize);
  float shade = 1.0;
  float facingSun = dot(n, uSun);
  if (uDay > 0.0 && facingSun > 0.001) {
    vec3 relative = p - uSunOrigin;
    vec2 sunUV = (vec2(dot(relative, uSunRight), dot(relative, uSunUp)) - uSunBounds.xy) / uSunBounds.zw;
    float depth = (dot(relative, uSun) - uSunDepth.x) / uSunDepth.y;
    if (min(sunUV.x, sunUV.y) >= 0.0 && max(sunUV.x, sunUV.y) <= 1.0) {
      vec2 texel = sunUV * uSunDepth.w - 0.5;
      vec2 blend = fract(texel);
      vec2 firstUV = (floor(texel) + 0.5) / uSunDepth.w;
      vec2 gradient = vec2(dot(n, uSunRight), dot(n, uSunUp)) * uSunBounds.zw
        / (max(facingSun, 0.08) * uSunDepth.y);
      float surface = mod(floor(data.r * 255.0 + 0.5), 4.0);
      float heightError = surface < 0.5 ? 0.0 : uSunDepth.z;
      // B8 receiver height and the packed light depth have known quantization bounds;
      // a fixed world-distance bias would visibly detach ground shadows from their feet.
      float bias = heightError * abs(n.z - 2.0 * n.y) / (max(facingSun, 0.08) * uSunDepth.y)
        + 1.0 / 65025.0;
      vec2 stepUV = vec2(1.0 / uSunDepth.w, 0.0);
      shade = mix(
        mix(sunVisibility(firstUV, sunUV, depth, gradient, bias),
          sunVisibility(firstUV + stepUV, sunUV, depth, gradient, bias), blend.x),
        mix(sunVisibility(firstUV + stepUV.yx, sunUV, depth, gradient, bias),
          sunVisibility(firstUV + stepUV.xx, sunUV, depth, gradient, bias), blend.x), blend.y);
    }
  }
  vec2 staticUV = (p.xy - uStaticBounds.xy) / uStaticBounds.zw;
  vec2 dynamicUV = (p.xy - uDynamicBounds.xy) / uDynamicBounds.zw;
  float contact = max(contactCoverage(uStaticField, staticUV), contactCoverage(uDynamicField, dynamicUV)) * (1.0 - smoothstep(1.0, 8.0, p.z));
  vec3 light = uAmbient * (1.0 - contact * 0.22) + uSunColor * max(dot(n, uSun), 0.0) * shade * uDay + texture2D(uPoints, uv).rgb;
  vec3 albedo = color.rgb / max(color.a, 0.00001);
  // The diffuse art already contains painted highlights. Bounded compensation preserves their pixel detail under a moving sun.
  float baked = 0.4 + 0.6 * max(dot(n, normalize(vec3(-0.5, -0.4, 0.8))), 0.0);
  float compensation = mix(1.0, 1.0 / baked, 0.25);
  vec3 result = displayColor(linearColor(albedo) * light * compensation);
  float emission = step(4.0, mod(floor(data.r * 255.0 + 0.5), 8.0));
  result = mix(result, max(albedo, vec3(0.95, 0.56, 0.18)), emission * (1.0 - uDay * 0.7));
  gl_FragColor = vec4(result * color.a, color.a);
}`;

export const lightingVertex = `precision highp float;
attribute vec2 aPosition;
varying vec2 vTextureCoord;
varying vec2 vScreen;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
uniform vec2 uScreenSize;
void main() {
  vec2 p = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  vScreen = p / uScreenSize;
  gl_Position = vec4(p.x * 2.0 / uOutputTexture.x - 1.0,
    p.y * 2.0 * uOutputTexture.z / uOutputTexture.y - uOutputTexture.z, 0.0, 1.0);
  vTextureCoord = aPosition * uOutputFrame.zw * uInputSize.zw;
}`;
