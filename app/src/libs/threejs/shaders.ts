import type { MeshBasicMaterial, SpriteMaterial } from "three";

// Wind effect parameters
export const WIND_CONFIG = {
  enabled: true,
  speed: 2.0, // How fast the wind moves
  strength: 0.005, // How much distortion (0.0 - 1.0)
  scale: 0.05, // How large the wind waves are
};

// Wave effect parameters for water
export const WAVE_CONFIG = {
  enabled: true,
  speed: 1, // How fast the waves move
  distortion: 0.1, // How much the texture wiggles (0.0 - 1.0)
  frequency: 0.2, // Wave frequency (higher = more ripples)
};

/**
 * Applies a wind effect shader to a SpriteMaterial
 * This modifies the vertex shader to add procedural wind distortion
 *
 * @param material - The SpriteMaterial to apply the wind effect to
 * @param randomOffset - A random offset (0 to 2*PI) to desynchronize the animation
 */
export const applyWindShader = (
  material: SpriteMaterial | MeshBasicMaterial,
  randomOffset: number,
) => {
  if (!WIND_CONFIG.enabled) return;

  // Mark as animated BEFORE onBeforeCompile runs (for detection in callbacks)
  material.userData.isAnimated = true;
  material.userData.animationType = "wind";
  material.userData.windOffset = randomOffset;

  material.onBeforeCompile = (shader) => {
    // Add uniforms for wind animation
    shader.uniforms.time = { value: 0 };
    shader.uniforms.windStrength = { value: WIND_CONFIG.strength };
    shader.uniforms.windSpeed = { value: WIND_CONFIG.speed };
    shader.uniforms.windScale = { value: WIND_CONFIG.scale };
    shader.uniforms.windOffset = { value: randomOffset };

    // Declare uniforms in the vertex shader
    shader.vertexShader = shader.vertexShader.replace(
      "void main() {",
      `
      uniform float time;
      uniform float windStrength;
      uniform float windSpeed;
      uniform float windScale;
      uniform float windOffset;
      
      void main() {
      `,
    );

    // Inject wind effect into vertex shader
    shader.vertexShader = shader.vertexShader.replace(
      "#include <fog_vertex>",
      `
      #include <fog_vertex>
      
      // Wind effect: distort the sprite based on position and time
      float windTime = time * windSpeed + windOffset;
      float windOffset2 = sin(windTime + position.x * windScale) * 
                         cos(windTime * 0.7 + position.y * windScale * 0.8);
      
      // Apply wind distortion more strongly to the top of the sprite
      float heightFactor = (position.y + 0.5); // 0.0 at bottom, 1.0 at top
      vec3 windDisplacement = vec3(
        windOffset2 * windStrength * heightFactor,
        windOffset2 * windStrength * heightFactor * 0.3,
        0.0
      );
      
      gl_Position.xy += windDisplacement.xy * gl_Position.w;
      `,
    );

    // Store shader reference for updating time uniform
    material.userData.shader = shader;
  };
};

/**
 * Applies a blur effect shader to a SpriteMaterial
 * This modifies the fragment shader to blur the texture
 *
 * @param material - The SpriteMaterial to apply the blur effect to
 * @param blurAmount - The amount of blur (default: 0.003, higher = more blur)
 */
export const applyBlurShader = (material: SpriteMaterial, blurAmount = 0.003) => {
  material.onBeforeCompile = (shader) => {
    // Add uniform for blur amount
    shader.uniforms.blurAmount = { value: blurAmount };

    // Declare uniform in fragment shader
    shader.fragmentShader = shader.fragmentShader.replace(
      "void main() {",
      `
      uniform float blurAmount;
      
      void main() {
      `,
    );

    // Replace the texture sampling with a blur kernel
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `
      #ifdef USE_MAP
        // 9-tap blur kernel
        vec4 texelColor = vec4(0.0);
        vec2 uv = vMapUv;
        
        // Sample in a 3x3 grid around the current pixel
        texelColor += texture2D(map, uv + vec2(-blurAmount, -blurAmount)) * 0.077;
        texelColor += texture2D(map, uv + vec2(0.0, -blurAmount)) * 0.123;
        texelColor += texture2D(map, uv + vec2(blurAmount, -blurAmount)) * 0.077;
        
        texelColor += texture2D(map, uv + vec2(-blurAmount, 0.0)) * 0.123;
        texelColor += texture2D(map, uv) * 0.195;
        texelColor += texture2D(map, uv + vec2(blurAmount, 0.0)) * 0.123;
        
        texelColor += texture2D(map, uv + vec2(-blurAmount, blurAmount)) * 0.077;
        texelColor += texture2D(map, uv + vec2(0.0, blurAmount)) * 0.123;
        texelColor += texture2D(map, uv + vec2(blurAmount, blurAmount)) * 0.077;
        
        diffuseColor *= texelColor;
      #endif
      `,
    );
  };
};

/**
 * Applies a wave effect shader to a MeshBasicMaterial
 * This modifies the fragment shader to create a wiggling/rippling water texture effect
 *
 * @param material - The MeshBasicMaterial to apply the wave effect to
 * @param randomOffset - A random offset (0 to 2*PI) to desynchronize the animation
 */
export const applyWaveShader = (material: MeshBasicMaterial, randomOffset: number) => {
  if (!WAVE_CONFIG.enabled) return;

  // Mark as animated BEFORE onBeforeCompile runs (for detection in callbacks)
  material.userData.isAnimated = true;
  material.userData.animationType = "wave";
  material.userData.waveOffset = randomOffset;

  material.onBeforeCompile = (shader) => {
    // Add uniforms for wave animation
    shader.uniforms.time = { value: 0 };
    shader.uniforms.waveDistortion = { value: WAVE_CONFIG.distortion };
    shader.uniforms.waveSpeed = { value: WAVE_CONFIG.speed };
    shader.uniforms.waveFrequency = { value: WAVE_CONFIG.frequency };
    shader.uniforms.waveOffset = { value: randomOffset };

    // Inject uniforms at the top of fragment shader (before main)
    shader.fragmentShader = `
      uniform float time;
      uniform float waveDistortion;
      uniform float waveSpeed;
      uniform float waveFrequency;
      uniform float waveOffset;
      ${shader.fragmentShader}
    `;

    // Modify UV coordinates for wiggle/ripple effect in fragment shader
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `
      #ifdef USE_MAP
        // Create wiggling/rippling water effect
        float waveTime = time * waveSpeed + waveOffset;
        
        // Generate multiple overlapping wave patterns for realistic water movement
        // Horizontal waves
        float wave1 = sin(vMapUv.y * waveFrequency * 6.28318 + waveTime) * waveDistortion;
        float wave2 = sin(vMapUv.y * waveFrequency * 4.0 + waveTime * 1.3) * waveDistortion * 0.5;
        
        // Vertical waves
        float wave3 = cos(vMapUv.x * waveFrequency * 6.28318 + waveTime * 0.7) * waveDistortion;
        float wave4 = cos(vMapUv.x * waveFrequency * 4.5 + waveTime * 0.9) * waveDistortion * 0.5;
        
        // Diagonal waves for more complexity
        float wave5 = sin((vMapUv.x + vMapUv.y) * waveFrequency * 3.0 + waveTime * 1.1) * waveDistortion * 0.3;
        float wave6 = cos((vMapUv.x - vMapUv.y) * waveFrequency * 3.5 + waveTime * 0.8) * waveDistortion * 0.3;
        
        // Combine all waves to create complex water motion
        vec2 distortedUV = vMapUv;
        distortedUV.x += wave1 + wave2 + wave5 + wave6;
        distortedUV.y += wave3 + wave4 + wave5 - wave6;
        
        // Sample texture with distorted UVs
        vec4 texelColor = texture2D(map, distortedUV);
        diffuseColor *= texelColor;
      #endif
      `,
    );

    // Store shader reference for updating time uniform
    material.userData.shader = shader;
  };

  // Mark material as needing update to trigger shader compilation
  material.needsUpdate = true;
};

/**
 * Helper to update shader time for an object (Sprite, Mesh, or material)
 */
const updateShaderTime = (item: any, time: number) => {
  if (!item) return;
  // Get shader - either from material.userData or directly from userData
  const shader = item.material?.userData?.shader ?? item.userData?.shader;
  if (shader?.uniforms?.time) {
    shader.uniforms.time.value = time;
  }
};

/**
 * Updates the wind animation time for all materials/sprites in a list or group
 * Supports both: array of materials (TowerDefense) and Group (Sector/Combat)
 * PERFORMANCE OPTIMIZATION: Uses a Set to ensure each material is only updated once.
 */
export const updateWindAnimation = (items: any[] | any, time: number) => {
  if (!WIND_CONFIG.enabled) return;

  const processedMaterials = new Set<any>();

  // If items has a traverse method (it's a Group/Object3D), use it for recursive traversal
  if (typeof items?.traverse === "function") {
    items.traverse((object: any) => {
      // Only process Sprites (they have isSprite property)
      if (object.isSprite && object.material) {
        if (!processedMaterials.has(object.material)) {
          updateShaderTime(object, time);
          processedMaterials.add(object.material);
        }
      }
    });
    return;
  }

  // Otherwise treat as array of materials
  if (!Array.isArray(items)) return;
  for (let i = 0; i < items.length; i++) {
    const material = items[i];
    if (material && !processedMaterials.has(material)) {
      updateShaderTime(material, time);
      processedMaterials.add(material);
    }
  }
};

/**
 * Updates the wave animation time for all materials/tiles in a list or group
 * Supports both: array of materials (TowerDefense) and Group (Sector/Combat)
 * PERFORMANCE OPTIMIZATION: Uses a Set to ensure each material is only updated once.
 */
export const updateWaveAnimation = (items: any[] | any, time: number) => {
  if (!WAVE_CONFIG.enabled) return;

  const processedMaterials = new Set<any>();

  // If items has a traverse method (it's a Group/Object3D), use it for recursive traversal
  if (typeof items?.traverse === "function") {
    items.traverse((object: any) => {
      // Only process Meshes with ocean tiles
      if (object.isMesh && object.material) {
        if (!processedMaterials.has(object.material)) {
          updateShaderTime(object, time);
          processedMaterials.add(object.material);
        }
      }
    });
    return;
  }

  // Otherwise treat as array of materials
  if (!Array.isArray(items)) return;
  for (let i = 0; i < items.length; i++) {
    const material = items[i];
    if (material && !processedMaterials.has(material)) {
      updateShaderTime(material, time);
      processedMaterials.add(material);
    }
  }
};
