import { NEBULA_LEVELS, NEBULA_SHADE_FLOOR, nebulaTint } from './world-appearance.js';

export const NEBULA_FRAGMENT = `#version 300 es
precision highp float;
uniform vec3 u_researchWave;
uniform vec2 u_resolution;
uniform float u_renderScale;
uniform vec2 u_camera;
uniform float u_viewScale;
flat in vec4 v_shape0;
flat in vec4 v_shape1;
flat in vec4 v_shape2;
flat in vec4 v_style;
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec3 networkHueTint(float hue) {
  vec3 p = abs(fract(hue + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return clamp(p - 1.0, 0.0, 1.0);
}

void main() {
  vec2 screen = vec2(gl_FragCoord.x / u_renderScale, u_resolution.y - gl_FragCoord.y / u_renderScale);
  vec2 world = (screen - u_resolution * 0.5) * u_viewScale + u_camera;
  vec2 delta = world - v_shape0.xy;
  vec2 local = vec2(
    delta.x * v_shape1.x + delta.y * v_shape1.y,
    -delta.x * v_shape1.y + delta.y * v_shape1.x
  );
  vec2 normalized = local / v_shape0.zw;
  float radius = length(normalized);
  vec2 normal = radius > 0.000001 ? normalized / radius : vec2(1.0, 0.0);
  float x2 = normal.x * normal.x;
  float y2 = normal.y * normal.y;
  float harmonic2 = x2 - y2;
  float harmonic3 = normal.x * (x2 - 3.0 * y2);
  float harmonic5 = normal.y * (5.0 * x2 * x2 - 10.0 * x2 * y2 + y2 * y2);
  float biteFacing = max(dot(normal, v_shape2.zw), 0.0);
  float biteSquared = biteFacing * biteFacing;
  float boundary = max(0.58, 1.0
    + v_shape1.z * harmonic2
    + v_shape1.w * harmonic3
    + v_shape2.x * harmonic5
    - v_shape2.y * biteSquared * biteSquared);
  float field = radius / boundary - 1.0;
  if (field >= 0.0) discard;

  float edgeDepth = -field * min(v_shape0.z, v_shape0.w);
  bool linked = v_style.z > 1.5;
  bool pending = v_style.z > 0.5 && !linked;
  vec3 tint = linked ? networkHueTint(v_style.w)
    : pending ? vec3(${nebulaTint({ tier: 1 }).join(',')})
    : vec3(${nebulaTint({ tier: 0 }).join(',')});
  vec3 floorInk = vec3(${NEBULA_SHADE_FLOOR});
  vec3 color = floorInk + tint * ${NEBULA_LEVELS.interior};

  // Contour shelves and mineral cuts stay fixed in world space while zooming/panning.
  // Every decoration remains inside the exact shared harmonic placement boundary.
  if (u_viewScale <= 5.0) {
    float shelf = mod(floor(edgeDepth / 18.0), 3.0);
    if (shelf < 1.0 && edgeDepth > 8.0)
      color = floorInk + tint * ${NEBULA_LEVELS.band};
    vec2 mineral = world + vec2(v_style.x * 1130.0, v_style.x * 670.0);
    vec2 scratchCell = floor(mineral / vec2(32.0, 24.0));
    vec2 scratchPixel = mod(mineral, vec2(32.0, 24.0));
    if (edgeDepth > u_viewScale * 3.0 && hash21(scratchCell) > 0.86
        && scratchPixel.y < min(u_viewScale, 2.0) && scratchPixel.x < 8.0)
      color = floorInk + tint * ${NEBULA_LEVELS.scratch};
  }

  vec2 edgeCell = floor(world / 24.0);
  float edgeScar = hash21(edgeCell + vec2(v_style.x * 97.0, v_style.x * 53.0));
  if (edgeDepth <= u_viewScale * 1.1) {
    color = floorInk + tint * ${NEBULA_LEVELS.rim};
    if (edgeScar > 0.78) color = floorInk + tint * ${NEBULA_LEVELS.scar};
    if (edgeScar > 0.987) color = floorInk + tint * ${NEBULA_LEVELS.glint};
  }
  if (v_style.z > 0.5 && u_viewScale <= 5.0) {
    vec2 circuit = mod(world + vec2(8000.0), 96.0);
    vec2 cell = floor((world + vec2(8000.0)) / 96.0);
    float traceWidth = min(u_viewScale, 3.0);
    bool trace = (circuit.y < traceWidth && circuit.x < 48.0)
      || (abs(circuit.x - 48.0) < traceWidth && circuit.y < 24.0);
    if (edgeDepth > u_viewScale * 3.0 && hash21(cell) > 0.65 && trace) {
      color = floorInk + tint * ${NEBULA_LEVELS.trace};
      float arrival = distance(world, u_researchWave.xy) / 1800.0;
      float age = u_researchWave.z - arrival;
      if (u_researchWave.z >= 0.0 && age >= 0.0 && age < 0.18)
        color = floorInk + tint * ${NEBULA_LEVELS.research};
    }
  }
  outColor = vec4(color, 1.0);
}
`;
