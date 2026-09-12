import { pixelHudLayout, fitPixelTelemetry, pixelActionLayout } from './ui/pixel-layout.js';
import { drawSweep, drawLaserPulse, sweepPose } from './render/laser-effects.js';
import { compactMetric } from './core/format.js';
import { RESEARCH_NODES, researchNode, arsenalChoices, hasResearch, reactorRank, reactorQuote, REACTOR_CATEGORIES } from './core/research.js';
import { towerPlacementClear, MIN_TOWER_SPACING } from './core/placement.js';
import { drawCompactTowerSprite, towerScreenBounds } from './render/tower-sprites.js';
import { NEBULA_FRAGMENT } from './render/nebula-shader.js';
import { BaseDamagePresentation, DEFAULT_RELAY_PALETTE, enemyPointSize,
  hashString32, relayNetworkPresentation, riftAppearance } from './render/world-appearance.js';
import { drawBaseSprite, drawBodyBrackets, drawRiftSprite, RIFT_BOUNDS } from './render/world-sprites.js';
import { EmbeddedAuthority, EmbeddedClient } from './core/embedded-session.js';
import { AUTHORITY_TICK_RATE, COMMAND, EVENT, PROTOCOL_VERSION } from './core/protocol.js';
import { PROTOTYPE_SESSION_CONFIG, TEST_FIELD_SESSION_CONFIG } from './core/session-config.js';
import { strikeImpactPoints, supportsStrikePoint } from './core/strike-pattern.js';
import { normalizeControlGeometry } from './core/control-system.js';
import { towerBuildQuote } from './core/tower-catalog.js';
import { NETWORK_DESCENDANT_IDS, controlSource, isRelayForm, networkSources, purchaseCost, saleRefund, socketPoint } from './core/network-descendants.js';
import { defenseAreaBounds, defenseAreaField, findDefenseAreaAt, getMapDefinition, playableMaps } from './core/world-config.js';
import { loadSoloRun, saveSoloRun } from './core/persistence.js';
import { DEFAULT_PACE, PACE_MAX, PACE_MIN, PACE_STEP, normalizePace } from './core/progression.js';
import { P2PGuestSession, P2PHostSession } from './core/p2p-session.js';
import { PeerConnectionCoordinator, RelayConnectionCoordinator, SIGNALING_URL, relayUrlForPage, sanitizeRoomCode } from './core/p2p-transport.js';

let logicalWidth = 640;
let logicalHeight = 360;
let displayPixelScale = 1;
let renderScale = 1;
let HUD_TOP_HEIGHT = 23;
let hudBottomY = logicalHeight - 31;
const TOWER_DEFINITION_ID = 'frame';
const BUILD_CATALOG_PAGES = Object.freeze({
  network: Object.freeze({ label: 'network iii', rows: Object.freeze([
    NETWORK_DESCENDANT_IDS.slice(0, 3).map((definitionId, i) => ({ key: String(i + 1), definitionId })),
    NETWORK_DESCENDANT_IDS.slice(3, 6).map((definitionId, i) => ({ key: String(i + 4), definitionId })),
    NETWORK_DESCENDANT_IDS.slice(6, 9).map((definitionId, i) => ({ key: String(i + 7), definitionId }))
  ]) }),
  core: Object.freeze({
    label: 'core',
    rows: Object.freeze([
      Object.freeze([Object.freeze({ key: '1', definitionId: 'frame' })]),
      Object.freeze([
        Object.freeze({ key: '2', definitionId: 'assault' }),
        Object.freeze({ key: '5', definitionId: 'barrage' }),
        Object.freeze({ key: '6', definitionId: 'rocket' }),
        Object.freeze({ key: '7', definitionId: 'laser' })
      ]),
      Object.freeze([
        Object.freeze({ key: '3', definitionId: 'tether' }),
        Object.freeze({ key: '8', definitionId: 'anchor' }),
        Object.freeze({ key: '9', definitionId: 'knot' }),
        Object.freeze({ key: '0', definitionId: 'backwash' })
      ]),
      Object.freeze([
        Object.freeze({ key: '4', definitionId: 'network' }),
        Object.freeze({ key: 'o', definitionId: 'overclock' }),
        Object.freeze({ key: 'f', definitionId: 'forge' }),
        Object.freeze({ key: 'r', definitionId: 'relay' })
      ])
    ])
  }),
  assault: Object.freeze({
    label: 'assault iii',
    rows: Object.freeze([
      Object.freeze([
        Object.freeze({ key: '1', definitionId: 'broadside' }),
        Object.freeze({ key: '2', definitionId: 'flechette' }),
        Object.freeze({ key: '3', definitionId: 'cyclone' })
      ]),
      Object.freeze([
        Object.freeze({ key: '4', definitionId: 'warhead' }),
        Object.freeze({ key: '5', definitionId: 'cluster' }),
        Object.freeze({ key: '6', definitionId: 'salvo' })
      ]),
      Object.freeze([
        Object.freeze({ key: '7', definitionId: 'cutter' }),
        Object.freeze({ key: '8', definitionId: 'prism' }),
        Object.freeze({ key: '9', definitionId: 'sweeper' })
      ])
    ])
  }),
  tether: Object.freeze({
    label: 'tether iii',
    rows: Object.freeze([
      Object.freeze([
        Object.freeze({ key: '1', definitionId: 'stasis' }),
        Object.freeze({ key: '2', definitionId: 'recall' }),
        Object.freeze({ key: '3', definitionId: 'dragnet' })
      ]),
      Object.freeze([
        Object.freeze({ key: '4', definitionId: 'singularity' }),
        Object.freeze({ key: '5', definitionId: 'bond' }),
        Object.freeze({ key: '6', definitionId: 'braid' })
      ]),
      Object.freeze([
        Object.freeze({ key: '7', definitionId: 'breaker' }),
        Object.freeze({ key: '8', definitionId: 'crosswind' }),
        Object.freeze({ key: '9', definitionId: 'breakwater' })
      ])
    ])
  })
});
const BUILD_CATALOG_PAGE_IDS = Object.freeze(Object.keys(BUILD_CATALOG_PAGES));

const COLOR = Object.freeze({
  black: [1 / 255, 6 / 255, 7 / 255, 1],
  cyan: [53 / 255, 242 / 255, 1, 1],
  mint: [85 / 255, 1, 194 / 255, 1],
  green: [116 / 255, 1, 106 / 255, 1],
  amber: [1, 200 / 255, 87 / 255, 1],
  red: [1, 77 / 255, 90 / 255, 1],
  dimMint: [14 / 255, 66 / 255, 59 / 255, 1],
  ink: [189 / 255, 233 / 255, 223 / 255, 1],
  uiMuted: [101 / 255, 149 / 255, 139 / 255, 1]
});

const canvas = document.querySelector('#game');
const errorPanel = document.querySelector('#gpu-error');
const sessions = new Map();
let sessionMode = 'game';
let authority = null;
let session = null;
let sessionSnapshot = null;
let currentMap = getMapDefinition(PROTOTYPE_SESSION_CONFIG.mapId);
let gl = null;

function showFatal(message, kind = 'gpu') {
  errorPanel.hidden = false;
  errorPanel.textContent = `${kind} failure // reload after reporting\n\n${String(message).toLowerCase()}`;
  window.__hordeDiagnostics = { ...(window.__hordeDiagnostics || {}), [`${kind}Error`]: String(message) };
}

addEventListener('error', (event) => showFatal(event.error?.stack || event.message || 'uncaught runtime error', 'runtime'));
addEventListener('unhandledrejection', (event) => showFatal(event.reason?.stack || event.reason || 'unhandled promise rejection', 'runtime'));

function fitCanvas() {
  displayPixelScale = innerWidth >= 960 && innerHeight >= 540 ? 2 : 1;
  const nextWidth = Math.max(320, Math.floor(innerWidth / displayPixelScale));
  const nextHeight = Math.max(180, Math.floor(innerHeight / displayPixelScale));
  logicalWidth = nextWidth;
  logicalHeight = nextHeight;
  const hud = pixelHudLayout(logicalWidth, sessionMode);
  HUD_TOP_HEIGHT = hud.topHeight;
  hudBottomY = logicalHeight - hud.bottomHeight;
  renderScale = displayPixelScale * Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(logicalWidth * renderScale);
  canvas.height = Math.round(logicalHeight * renderScale);
  canvas.style.width = `${logicalWidth * displayPixelScale}px`;
  canvas.style.height = `${logicalHeight * displayPixelScale}px`;
  if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
  window.__hordeDiagnostics = { ...(window.__hordeDiagnostics || {}), nativeRenderScale: renderScale };
}

fitCanvas();
addEventListener('resize', () => {
  fitCanvas();
  if (sessionSnapshot) clampCameraToMap();
}, { passive: true });

gl = canvas.getContext('webgl2', {
  alpha: false,
  antialias: true,
  depth: false,
  desynchronized: false,
  failIfMajorPerformanceCaveat: true,
  powerPreference: 'high-performance',
  premultipliedAlpha: false,
  preserveDrawingBuffer: false,
  stencil: false
});

if (!gl) {
  showFatal('webgl2 is unavailable. this prototype does not silently fall back to a softened renderer.');
  throw new Error('webgl2 unavailable');
}

canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  showFatal('webgl2 context lost');
});

gl.disable(gl.BLEND);
gl.disable(gl.DEPTH_TEST);
gl.disable(gl.DITHER);
gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
gl.viewport(0, 0, canvas.width, canvas.height);

function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const detail = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${detail}`);
  }
  return shader;
}

function createProgram(vertexSource, fragmentSource, feedbackVaryings = null) {
  const program = gl.createProgram();
  const vertex = compileShader(gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  if (feedbackVaryings) gl.transformFeedbackVaryings(program, feedbackVaryings, gl.INTERLEAVED_ATTRIBS);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const detail = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`program link failed: ${detail}`);
  }
  return program;
}

const FULLSCREEN_VERTEX = `#version 300 es
precision highp float;
const vec2 positions[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
void main() { gl_Position = vec4(positions[gl_VertexID], 0.0, 1.0); }
`;

const BACKGROUND_FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform float u_renderScale;
uniform vec2 u_camera;
uniform float u_viewScale;
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 screen = vec2(gl_FragCoord.x / u_renderScale, u_resolution.y - gl_FragCoord.y / u_renderScale);
  vec2 world = (screen - u_resolution * 0.5) * u_viewScale + u_camera;
  vec3 color = vec3(${COLOR.black.slice(0, 3).join(',')});

  vec2 starCell = floor(world / 42.0);
  vec2 starPixel = mod(floor(world / u_viewScale), 11.0);
  float star = hash21(starCell);
  if (star > 0.965 && starPixel.x < 1.0 && starPixel.y < 1.0) color = vec3(0.07, 0.24, 0.23);
  if (star > 0.993 && starPixel.x < 1.0 && starPixel.y < 1.0) color = vec3(0.21, 0.95, 1.0);

  vec2 majorCell = abs(mod(world + 100.0, 400.0) - 200.0);
  if ((majorCell.x < u_viewScale * 0.5 || majorCell.y < u_viewScale * 0.5) && hash21(floor(world / 400.0)) > 0.58) {
    color = max(color, vec3(0.015, 0.08, 0.075));
  }

  outColor = vec4(color, 1.0);
}
`;

const NEBULA_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec4 a_bounds;
layout(location=1) in vec4 a_shape0;
layout(location=2) in vec4 a_shape1;
layout(location=3) in vec4 a_shape2;
layout(location=4) in vec4 a_style;
uniform vec2 u_resolution;
uniform float u_renderScale;
uniform vec2 u_camera;
uniform float u_viewScale;
flat out vec4 v_shape0;
flat out vec4 v_shape1;
flat out vec4 v_shape2;
flat out vec4 v_style;
const vec2 corners[6] = vec2[6](
  vec2(0.0,0.0), vec2(1.0,0.0), vec2(1.0,1.0),
  vec2(0.0,0.0), vec2(1.0,1.0), vec2(0.0,1.0)
);
void main() {
  vec2 world = mix(a_bounds.xy, a_bounds.zw, corners[gl_VertexID]);
  vec2 screen = ((world - u_camera) / u_viewScale + u_resolution * 0.5);
  vec2 clip = vec2(screen.x / u_resolution.x * 2.0 - 1.0, 1.0 - screen.y / u_resolution.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  v_shape0 = a_shape0;
  v_shape1 = a_shape1;
  v_shape2 = a_shape2;
  v_style = a_style;
}
`;

const SWARM_RENDER_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec4 a_state;
layout(location=1) in float a_status;
layout(location=2) in float a_units;
layout(location=3) in float a_hp;
uniform vec2 u_resolution;
uniform float u_renderScale;
uniform vec2 u_camera;
uniform float u_viewScale;
uniform float u_tickAlpha;
uniform vec2 u_pointSizes;
flat out float v_status;
flat out float v_units;
flat out float v_hp;
flat out float v_pointSize;
void main() {
  vec2 world = a_state.xy + a_state.zw * (u_tickAlpha / ${AUTHORITY_TICK_RATE.toFixed(1)});
  vec2 screen = ((world - u_camera) / u_viewScale + u_resolution * 0.5);
  vec2 clip = vec2(screen.x / u_resolution.x * 2.0 - 1.0, 1.0 - screen.y / u_resolution.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  v_pointSize = a_units > 1.5 ? u_pointSizes.y : u_pointSizes.x;
  gl_PointSize = v_pointSize * u_renderScale;
  v_status = a_status;
  v_units = a_units;
  v_hp = a_hp;
}
`;

const SWARM_RENDER_FRAGMENT = `#version 300 es
precision highp float;
flat in float v_status;
flat in float v_units;
flat in float v_hp;
flat in float v_pointSize;
uniform float u_renderScale;
out vec4 outColor;
void main() {
  vec2 point = gl_PointCoord;
  vec2 center = abs(point - vec2(0.5));
  bool body = true;
  if (v_units > 1.5 && v_units < 2.5) {
    body = (point.x < 0.44 && point.y < 0.44) || (point.x > 0.56 && point.y > 0.56);
  } else if (v_units > 2.5 && v_units < 3.5) {
    body = (point.x < 0.44 && point.y < 0.44)
      || (point.x > 0.56 && point.y < 0.44)
      || (point.x > 0.28 && point.x < 0.72 && point.y > 0.56);
  } else if (v_units > 3.5) {
    body = (point.x < 0.44 || point.x > 0.56) && (point.y < 0.44 || point.y > 0.56);
    if (v_units > 4.5 && center.x < 0.08 && center.y < 0.08) body = true;
  }
  // A centred device-pixel block also survives the smallest, even-sized sprites.
  // Leave body pixels visible so a status can never hide the remaining-hp colour.
  float deviceSize = max(2.0, floor(v_pointSize * u_renderScale + 0.5));
  float markerSize = min(deviceSize - 1.0, max(1.0, floor(max(u_renderScale, deviceSize * 0.3) + 0.5)));
  float markerStart = floor((deviceSize - markerSize) * 0.5);
  vec2 cell = floor(point * deviceSize);
  bool statusPixel = v_status > 0.5 && all(greaterThanEqual(cell, vec2(markerStart)))
    && all(lessThan(cell, vec2(markerStart + markerSize)));
  if (!body && !statusPixel) discard;
  if (statusPixel) {
    if (v_status > 4.5) outColor = vec4(${COLOR.green.join(',')});
    else if (v_status > 3.5) outColor = vec4(${COLOR.mint.join(',')});
    else if (v_status > 2.5) outColor = vec4(${COLOR.amber.join(',')});
    else outColor = vec4(${COLOR.cyan.join(',')});
  } else {
    if (v_hp < 1.5) outColor = vec4(${COLOR.red.join(',')});
    else if (v_hp < 2.5) outColor = vec4(1.0, 0.48, 0.12, 1.0);
    else if (v_hp < 3.5) outColor = vec4(1.0, 0.86, 0.18, 1.0);
    else if (v_hp < 4.5) outColor = vec4(0.64, 0.40, 1.0, 1.0);
    else if (v_hp < 5.5) outColor = vec4(1.0, 0.30, 0.75, 1.0);
    else {
      float tier = mod(floor(log2(v_hp)), 3.0);
      vec3 shell = tier < 0.5 ? vec3(1.0, 0.58, 0.18) : tier < 1.5 ? vec3(0.74, 0.48, 1.0) : vec3(1.0, 0.38, 0.70);
      bool stripe = abs(point.y - 0.5) < 0.10;
      outColor = vec4(stripe ? vec3(1.0) : shell, 1.0);
    }
  }
}
`;

// Shape vertices carry an optional ring descriptor (centre, integer pixel radius, flag).
// Plain rectangles leave the flag at zero. Ring quads/annuli cover the pixel ring's
// footprint and the fragment shader keeps exactly the midpoint-circle pixels, so one
// ring costs a handful of vertices instead of one rectangle per pixel.
const SHAPE_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_position;
layout(location=1) in vec4 a_color;
layout(location=2) in vec4 a_ring;
uniform vec2 u_resolution;
uniform float u_renderScale;
out vec4 v_color;
flat out vec4 v_ring;
void main() {
  vec2 snapped = a_position;
  gl_Position = vec4(snapped.x / u_resolution.x * 2.0 - 1.0, 1.0 - snapped.y / u_resolution.y * 2.0, 0.0, 1.0);
  v_color = a_color;
  v_ring = a_ring;
}
`;

const SHAPE_FRAGMENT = `#version 300 es
precision highp float;
in vec4 v_color;
flat in vec4 v_ring;
uniform vec2 u_resolution;
uniform float u_renderScale;
out vec4 outColor;
void main() {
  if (v_ring.w > 0.5) {
    // Logical pixel offset from the ring centre, matching a 1x1 rect placed at
    // (centre + offset): the fragment belongs to that rect when floor(L - c) == offset.
    vec2 logical = vec2(gl_FragCoord.x, u_resolution.y * u_renderScale - gl_FragCoord.y) / u_renderScale;
    float dx = abs(floor(logical.x - v_ring.x));
    float dy = abs(floor(logical.y - v_ring.y));
    float major = max(dx, dy);
    float minor = min(dx, dy);
    float radius = v_ring.z;
    // Midpoint-circle membership in exact integers: major == round(sqrt(r^2 - minor^2))
    // <=> (2*major-1)^2 <= 4*(r^2 - minor^2) < (2*major+1)^2.
    float q = 4.0 * (radius * radius - minor * minor);
    float low = (2.0 * major - 1.0) * (2.0 * major - 1.0);
    float high = (2.0 * major + 1.0) * (2.0 * major + 1.0);
    if (q < low || q >= high) discard;
  }
  outColor = v_color;
}
`;

const TEXT_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_position;
layout(location=1) in vec2 a_uv;
layout(location=2) in vec4 a_color;
uniform vec2 u_resolution;
uniform float u_renderScale;
out vec2 v_uv;
out vec4 v_color;
void main() {
  vec2 snapped = a_position;
  gl_Position = vec4(snapped.x / u_resolution.x * 2.0 - 1.0, 1.0 - snapped.y / u_resolution.y * 2.0, 0.0, 1.0);
  v_uv = a_uv;
  v_color = a_color;
}
`;

const TEXT_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_atlas;
in vec2 v_uv;
in vec4 v_color;
out vec4 outColor;
void main() {
  float pixel = texture(u_atlas, v_uv).a;
  if (pixel < 0.5) discard;
  outColor = v_color;
}
`;

class EnemyRenderer {
  constructor(capacity = 4096) {
    this.capacity = Math.max(64, capacity);
    this.lastTick = -1;
    this.lastCount = -1;
    this.lastState = null;
    this.program = createProgram(SWARM_RENDER_VERTEX, SWARM_RENDER_FRAGMENT);
    this.stateBuffer = gl.createBuffer();
    this.statusBuffer = gl.createBuffer();
    this.unitsBuffer = gl.createBuffer();
    this.hpBuffer = gl.createBuffer();
    this.hpData = new Float32Array(this.capacity);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.stateBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.capacity * 16, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.statusBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.capacity * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 4, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.unitsBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.capacity * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 4, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.hpBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.capacity * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 4, 0);
    gl.bindVertexArray(null);
  }

  ensureCapacity(required) {
    if (required <= this.capacity) return;
    while (this.capacity < required) this.capacity *= 2;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.stateBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.capacity * 16, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.statusBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.capacity * 4, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.unitsBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.capacity * 4, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.hpBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.capacity * 4, gl.DYNAMIC_DRAW);
    this.hpData = new Float32Array(this.capacity);
    this.lastTick = -1;
  }

  upload(frame) {
    if (frame.tick === this.lastTick && frame.count === this.lastCount && frame.state === this.lastState) return;
    this.ensureCapacity(frame.capacity || frame.count);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.stateBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, frame.state.subarray(0, frame.count * 4));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.statusBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, frame.status.subarray(0, frame.count));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.unitsBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, frame.units.subarray(0, frame.count));
    for (let i = 0; i < frame.count; i++) this.hpData[i] = Math.ceil(frame.hpById[frame.idByIndex[i]]);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.hpBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.hpData.subarray(0, frame.count));
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.lastTick = frame.tick;
    this.lastCount = frame.count;
    this.lastState = frame.state;
  }

  draw(camera, frame) {
    this.upload(frame);
    gl.useProgram(this.program);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_resolution'), logicalWidth, logicalHeight);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_renderScale'), renderScale);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_camera'), camera.x, camera.y);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_viewScale'), camera.scale);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_tickAlpha'), frame.alpha);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_pointSizes'), enemyPointSize(camera.scale), enemyPointSize(camera.scale, 2));
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, frame.count);
    gl.bindVertexArray(null);
  }
}

// Growable typed-array vertex store shared by the shape and glyph batches: no per-vertex
// array allocation, no spread, and one subarray upload per flush.
class VertexStore {
  constructor(floatsPerVertex, initialVertices = 4096) {
    this.stride = floatsPerVertex;
    this.data = new Float32Array(floatsPerVertex * initialVertices);
    this.length = 0;
  }

  reserve(vertexCount) {
    const needed = this.length + vertexCount * this.stride;
    if (needed <= this.data.length) return;
    let capacity = this.data.length * 2;
    while (capacity < needed) capacity *= 2;
    const grown = new Float32Array(capacity);
    grown.set(this.data.subarray(0, this.length));
    this.data = grown;
  }

  get vertexCount() {
    return this.length / this.stride;
  }

  view() {
    return this.data.subarray(0, this.length);
  }

  clear() {
    this.length = 0;
  }
}

const SHAPE_FLOATS = 10;
// Unit-circle tables per segment count, built once and reused by every ring.
const ringPolygonCache = new Map();
function ringPolygon(segments) {
  let table = ringPolygonCache.get(segments);
  if (!table) {
    table = new Float32Array((segments + 1) * 2);
    for (let index = 0; index <= segments; index += 1) {
      const angle = index / segments * Math.PI * 2;
      table[index * 2] = Math.cos(angle);
      table[index * 2 + 1] = Math.sin(angle);
    }
    ringPolygonCache.set(segments, table);
  }
  return table;
}

class ShapeBatch {
  constructor() {
    this.program = createProgram(SHAPE_VERTEX, SHAPE_FRAGMENT);
    this.buffer = gl.createBuffer();
    this.vao = gl.createVertexArray();
    this.store = new VertexStore(SHAPE_FLOATS, 8192);
    this.uniforms = {
      resolution: gl.getUniformLocation(this.program, 'u_resolution'),
      renderScale: gl.getUniformLocation(this.program, 'u_renderScale')
    };
    this.bufferCapacity = 0;
    this.ringsDrawn = 0;
    this.ringsCulled = 0;
    this.lastFlushFloats = 0;
    this.frameFloats = 0;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, SHAPE_FLOATS * 4, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, SHAPE_FLOATS * 4, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, SHAPE_FLOATS * 4, 24);
    gl.bindVertexArray(null);
  }

  // Writes one vertex; callers reserve space first.
  put(x, y, color, ringX = 0, ringY = 0, ringRadius = 0, ringFlag = 0) {
    const data = this.store.data;
    let offset = this.store.length;
    data[offset++] = x;
    data[offset++] = y;
    data[offset++] = color[0];
    data[offset++] = color[1];
    data[offset++] = color[2];
    data[offset++] = color[3];
    data[offset++] = ringX;
    data[offset++] = ringY;
    data[offset++] = ringRadius;
    data[offset++] = ringFlag;
    this.store.length = offset;
  }

  vertex(x, y, color) {
    this.store.reserve(1);
    this.put(x, y, color);
  }

  triangle(a, b, c, color) {
    this.store.reserve(3);
    this.put(a.x, a.y, color);
    this.put(b.x, b.y, color);
    this.put(c.x, c.y, color);
  }

  rect(x, y, width, height, color) {
    this.store.reserve(6);
    const right = x + width;
    const bottom = y + height;
    this.put(x, y, color);
    this.put(right, y, color);
    this.put(right, bottom, color);
    this.put(x, y, color);
    this.put(right, bottom, color);
    this.put(x, bottom, color);
  }

  line(x1, y1, x2, y2, width, color) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length * width * 0.5;
    const ny = dx / length * width * 0.5;
    this.store.reserve(6);
    this.put(x1 + nx, y1 + ny, color);
    this.put(x2 + nx, y2 + ny, color);
    this.put(x2 - nx, y2 - ny, color);
    this.put(x1 + nx, y1 + ny, color);
    this.put(x2 - nx, y2 - ny, color);
    this.put(x1 - nx, y1 - ny, color);
  }

  // One-pixel-thick midpoint-circle ring of integer pixel radius around a logical-pixel
  // centre. Geometry is a thin annulus (or a quad for tiny radii) whose fragments are
  // filtered to the exact ring pixels on the GPU. Rings entirely outside the viewport
  // are skipped; on-screen cost is a few dozen vertices regardless of radius.
  ring(centerX, centerY, radius, color) {
    const reach = radius + 3;
    if (centerX + reach < 0 || centerX - reach > logicalWidth || centerY + reach < 0 || centerY - reach > logicalHeight) {
      this.ringsCulled += 1;
      return;
    }
    this.ringsDrawn += 1;
    if (radius < 7) {
      this.store.reserve(6);
      const left = centerX - reach, top = centerY - reach, right = centerX + reach, bottom = centerY + reach;
      this.put(left, top, color, centerX, centerY, radius, 1);
      this.put(right, top, color, centerX, centerY, radius, 1);
      this.put(right, bottom, color, centerX, centerY, radius, 1);
      this.put(left, top, color, centerX, centerY, radius, 1);
      this.put(right, bottom, color, centerX, centerY, radius, 1);
      this.put(left, bottom, color, centerX, centerY, radius, 1);
      return;
    }
    const segments = radius < 24 ? 12 : radius < 64 ? 16 : radius < 160 ? 24 : radius < 400 ? 32 : 48;
    const table = ringPolygon(segments);
    // The ring pixels lie within radius +/- ~1.5 of the true circle; pad both sides and
    // circumscribe the outer polygon so every ring pixel is covered by the band.
    const inner = Math.max(0, radius - 2.5);
    const outer = (radius + 2.5) / Math.cos(Math.PI / segments) + 0.5;
    this.store.reserve(segments * 6);
    for (let index = 0; index < segments; index += 1) {
      const c0 = table[index * 2], s0 = table[index * 2 + 1];
      const c1 = table[index * 2 + 2], s1 = table[index * 2 + 3];
      const ox0 = centerX + c0 * outer, oy0 = centerY + s0 * outer;
      const ox1 = centerX + c1 * outer, oy1 = centerY + s1 * outer;
      const ix0 = centerX + c0 * inner, iy0 = centerY + s0 * inner;
      const ix1 = centerX + c1 * inner, iy1 = centerY + s1 * inner;
      this.put(ox0, oy0, color, centerX, centerY, radius, 1);
      this.put(ox1, oy1, color, centerX, centerY, radius, 1);
      this.put(ix0, iy0, color, centerX, centerY, radius, 1);
      this.put(ix0, iy0, color, centerX, centerY, radius, 1);
      this.put(ox1, oy1, color, centerX, centerY, radius, 1);
      this.put(ix1, iy1, color, centerX, centerY, radius, 1);
    }
  }

  flush() {
    if (!this.store.length) return;
    const vertices = this.store.view();
    gl.useProgram(this.program);
    gl.uniform2f(this.uniforms.resolution, logicalWidth, logicalHeight);
    gl.uniform1f(this.uniforms.renderScale, renderScale);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    // Grow the GPU buffer geometrically and stream into it; no per-flush reallocation.
    if (this.store.data.byteLength > this.bufferCapacity) {
      this.bufferCapacity = this.store.data.byteLength;
      gl.bufferData(gl.ARRAY_BUFFER, this.bufferCapacity, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices);
    gl.drawArrays(gl.TRIANGLES, 0, this.store.vertexCount);
    gl.bindVertexArray(null);
    this.frameFloats += this.store.length;
    this.store.clear();
  }

  // Called once per rendered frame so diagnostics report per-frame ring and vertex work.
  endFrame() {
    this.lastFlushFloats = this.frameFloats;
    this.frameFloats = 0;
    this.ringsDrawn = 0;
    this.ringsCulled = 0;
  }
}

const glyph = (...rows) => rows.join('');
const GLYPHS = Object.freeze({
  a:glyph('00000','00000','01110','00001','01111','10001','01111'),
  b:glyph('10000','10000','10110','11001','10001','10001','11110'),
  c:glyph('00000','00000','01111','10000','10000','10000','01111'),
  d:glyph('00001','00001','01101','10011','10001','10001','01111'),
  e:glyph('00000','00000','01110','10001','11111','10000','01111'),
  f:glyph('00110','01001','01000','11100','01000','01000','01000'),
  g:glyph('00000','01111','10001','01111','00001','10001','01110'),
  h:glyph('10000','10000','10110','11001','10001','10001','10001'),
  i:glyph('00100','00000','01100','00100','00100','00100','01110'),
  j:glyph('00010','00000','00110','00010','00010','10010','01100'),
  k:glyph('10000','10010','10100','11000','10100','10010','10001'),
  l:glyph('01100','00100','00100','00100','00100','00100','01110'),
  m:glyph('00000','00000','11010','10101','10101','10101','10101'),
  n:glyph('00000','00000','10110','11001','10001','10001','10001'),
  o:glyph('00000','00000','01110','10001','10001','10001','01110'),
  p:glyph('00000','11110','10001','11110','10000','10000','10000'),
  q:glyph('00000','01111','10001','01111','00001','00001','00001'),
  r:glyph('00000','00000','10110','11001','10000','10000','10000'),
  s:glyph('00000','00000','01111','10000','01110','00001','11110'),
  t:glyph('01000','01000','11100','01000','01000','01001','00110'),
  u:glyph('00000','00000','10001','10001','10001','10011','01101'),
  v:glyph('00000','00000','10001','10001','10001','01010','00100'),
  w:glyph('00000','00000','10001','10001','10101','10101','01010'),
  x:glyph('00000','00000','10001','01010','00100','01010','10001'),
  y:glyph('00000','10001','10001','01111','00001','10001','01110'),
  z:glyph('00000','00000','11111','00010','00100','01000','11111'),
  0:glyph('01110','10001','10011','10101','11001','10001','01110'),
  1:glyph('00100','01100','00100','00100','00100','00100','01110'),
  2:glyph('01110','10001','00001','00010','00100','01000','11111'),
  3:glyph('11110','00001','00001','01110','00001','00001','11110'),
  4:glyph('00010','00110','01010','10010','11111','00010','00010'),
  5:glyph('11111','10000','10000','11110','00001','00001','11110'),
  6:glyph('01110','10000','10000','11110','10001','10001','01110'),
  7:glyph('11111','00001','00010','00100','01000','01000','01000'),
  8:glyph('01110','10001','10001','01110','10001','10001','01110'),
  9:glyph('01110','10001','10001','01111','00001','00001','01110'),
  '/':glyph('00001','00010','00100','01000','10000','00000','00000'),
  ':':glyph('00000','00100','00100','00000','00100','00100','00000'),
  '[':glyph('01110','01000','01000','01000','01000','01000','01110'),
  ']':glyph('01110','00010','00010','00010','00010','00010','01110'),
  '-':glyph('00000','00000','00000','11111','00000','00000','00000'),
  '.':glyph('00000','00000','00000','00000','00000','00110','00110'),
  '+':glyph('00000','00100','00100','11111','00100','00100','00000'),
  '=':glyph('00000','00000','11111','00000','11111','00000','00000'),
  '%':glyph('11001','11010','00100','01000','10110','00110','00000'),
  '?':glyph('01110','10001','00001','00110','00100','00000','00100'),
  ',':glyph('00000','00000','00000','00000','00110','00100','01000'),
  ';':glyph('00000','00110','00110','00000','00110','00100','01000'),
  '<':glyph('00001','00010','00100','01000','00100','00010','00001'),
  '>':glyph('10000','01000','00100','00010','00100','01000','10000'),
  '(':glyph('00010','00100','01000','01000','01000','00100','00010'),
  ')':glyph('01000','00100','00010','00010','00010','00100','01000'),
  "'":glyph('00100','00100','01000','00000','00000','00000','00000'),
  ' ':glyph('00000','00000','00000','00000','00000','00000','00000')
});

class BitmapText {
  constructor() {
    this.characters = Object.keys(GLYPHS);
    this.index = new Map(this.characters.map((character, index) => [character, index]));
    this.columns = 16;
    this.cellWidth = 6;
    this.cellHeight = 8;
    this.rows = Math.ceil(this.characters.length / this.columns);
    const atlas = document.createElement('canvas');
    atlas.width = this.columns * this.cellWidth;
    atlas.height = this.rows * this.cellHeight;
    const context = atlas.getContext('2d', { alpha: true });
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, atlas.width, atlas.height);
    context.fillStyle = '#ffffff';
    this.characters.forEach((character, index) => {
      const bits = GLYPHS[character];
      const originX = (index % this.columns) * this.cellWidth;
      const originY = Math.floor(index / this.columns) * this.cellHeight;
      for (let y = 0; y < 7; y += 1) {
        for (let x = 0; x < 5; x += 1) {
          if (bits[y * 5 + x] === '1') context.fillRect(originX + x, originY + y, 1, 1);
        }
      }
    });
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.program = createProgram(TEXT_VERTEX, TEXT_FRAGMENT);
    this.buffer = gl.createBuffer();
    this.vao = gl.createVertexArray();
    this.store = new VertexStore(8, 4096);
    this.bufferCapacity = 0;
    this.uniforms = {
      resolution: gl.getUniformLocation(this.program, 'u_resolution'),
      renderScale: gl.getUniformLocation(this.program, 'u_renderScale'),
      atlas: gl.getUniformLocation(this.program, 'u_atlas')
    };
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 32, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
    gl.bindVertexArray(null);
  }

  glyphVertex(x, y, u, v, color) {
    const data = this.store.data;
    let offset = this.store.length;
    data[offset++] = x;
    data[offset++] = y;
    data[offset++] = u;
    data[offset++] = v;
    data[offset++] = color[0];
    data[offset++] = color[1];
    data[offset++] = color[2];
    data[offset++] = color[3];
    this.store.length = offset;
  }

  draw(text, x, y, color, scale = 1) {
    let cursor = Math.round(x);
    const characters = String(text).toLowerCase();
    this.store.reserve(characters.length * 6);
    const atlasWidth = this.columns * this.cellWidth;
    const atlasHeight = this.rows * this.cellHeight;
    for (const rawCharacter of characters) {
      const character = this.index.has(rawCharacter) ? rawCharacter : '?';
      const index = this.index.get(character);
      const column = index % this.columns;
      const row = Math.floor(index / this.columns);
      const u0 = column * this.cellWidth / atlasWidth;
      const v0 = row * this.cellHeight / atlasHeight;
      const u1 = (column * this.cellWidth + 5) / atlasWidth;
      const v1 = (row * this.cellHeight + 7) / atlasHeight;
      const width = 5 * scale;
      const height = 7 * scale;
      this.glyphVertex(cursor, y, u0, v0, color);
      this.glyphVertex(cursor + width, y, u1, v0, color);
      this.glyphVertex(cursor + width, y + height, u1, v1, color);
      this.glyphVertex(cursor, y, u0, v0, color);
      this.glyphVertex(cursor + width, y + height, u1, v1, color);
      this.glyphVertex(cursor, y + height, u0, v1, color);
      cursor += this.cellWidth * scale;
    }
    return cursor;
  }

  flush() {
    if (!this.store.length) return;
    const vertices = this.store.view();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program);
    gl.uniform2f(this.uniforms.resolution, logicalWidth, logicalHeight);
    gl.uniform1f(this.uniforms.renderScale, renderScale);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uniforms.atlas, 0);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    if (this.store.data.byteLength > this.bufferCapacity) {
      this.bufferCapacity = this.store.data.byteLength;
      gl.bufferData(gl.ARRAY_BUFFER, this.bufferCapacity, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices);
    gl.drawArrays(gl.TRIANGLES, 0, this.store.vertexCount);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    this.store.clear();
  }
}

class NebulaRenderer {
  constructor() {
    this.program = createProgram(NEBULA_VERTEX, NEBULA_FRAGMENT);
    this.buffer = gl.createBuffer();
    this.vao = gl.createVertexArray();
    this.mapId = null;
    this.count = 0;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const stride = 20 * Float32Array.BYTES_PER_ELEMENT;
    for (let location = 0; location < 5; location += 1) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 4, gl.FLOAT, false, stride, location * 4 * Float32Array.BYTES_PER_ELEMENT);
      gl.vertexAttribDivisor(location, 1);
    }
    gl.bindVertexArray(null);
  }

  setMap(map, presentation) {
    const key = `${map.id}:${[...presentation.entries()].sort(([a], [b]) => a < b ? -1 : 1)
      .map(([id, info]) => `${id}=${info.tier}:${info.hue.toFixed(8)}`).join(',')}`;
    if (this.mapId === key) return;
    const data = [];
    for (const area of map.defenseAreas) {
      const bounds = defenseAreaBounds(area, 12);
      const shape = area.shape;
      const info = presentation.get(area.id) || { tier: 0, hue: 0 };
      data.push(bounds.left, bounds.top, bounds.right, bounds.bottom);
      data.push(shape.x, shape.y, shape.radiusX, shape.radiusY);
      data.push(shape.cosRotation, shape.sinRotation, shape.amplitude2, shape.amplitude3);
      data.push(shape.amplitude5, shape.notchDepth, shape.notchX, shape.notchY);
      data.push(shape.styleSeed, shape.family, info.tier, info.hue);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    this.mapId = key;
    this.count = map.defenseAreas.length;
  }

  draw(map, viewCamera) {
    this.setMap(map, networkPresentation);
    if (!this.count) return;
    gl.useProgram(this.program);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_resolution'), logicalWidth, logicalHeight);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_renderScale'), renderScale);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_camera'), viewCamera.x, viewCamera.y);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_viewScale'), viewCamera.scale);
    const waveAge = researchWave && researchWave.mapId === map.id && !reducedNetworkMotion.matches
      ? (sessionSnapshot.runTick - researchWave.startedTick) / AUTHORITY_TICK_RATE : -1;
    gl.uniform3f(gl.getUniformLocation(this.program, 'u_researchWave'),
      researchWave?.x || 0, researchWave?.y || 0, waveAge >= 0 && waveAge < 4 ? waveAge : -1);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    gl.bindVertexArray(null);
  }
}

const backgroundProgram = createProgram(FULLSCREEN_VERTEX, BACKGROUND_FRAGMENT);
const nebulaRenderer = new NebulaRenderer();
// Presentation only: one wave, replaced by the next purchase; never queued.
let researchWave = null;
let devToolsOpen = false;
let networkPresentation = new Map();
const baseDamage = new BaseDamagePresentation();
const reducedNetworkMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const enemyRenderer = new EnemyRenderer(PROTOTYPE_SESSION_CONFIG.swarm.initialCapacity);
const shapes = new ShapeBatch();
const bitmapText = new BitmapText();
const camera = { ...currentMap.camera };
const cameraByMode = new Map();
const zoomLevels = [1, 2, 3, 4, 5, 6, 8];
let frontEndScreen = 'main';
let menuConfirm = null;
let escapeMenuPage = 'main';
let mapSelectOrigin = 'main';
let selectedRunMapId = PROTOTYPE_SESSION_CONFIG.mapId;
let gameRestorePending = false;
let gameHasEnteredGameplay = false;
let soloGameBundle = null;
let peerCoordinator = null;
let multiplayerClosing = false;
const multiplayerState = {
  role: null,
  phase: 'idle',
  roomCode: null,
  codeInput: '',
  status: 'peer link idle',
  detail: '',
  expiresAt: 0,
  playerName: loadPlayerName(),
  editingName: false
};
const multiplayerSocial = {
  messages: [],
  presenceByPlayer: new Map(),
  presenceSequenceByPlayer: new Map(),
  pings: [],
  chatOpen: false,
  chatInput: '',
  rosterExpanded: false,
  pingArmed: false,
  lastPresenceSentAt: -Infinity,
  lastPresenceSignature: '',
  idleSent: true
};
const PLAYER_COLORS = [COLOR.cyan, COLOR.mint, COLOR.amber, COLOR.green];
let dragging = false;
let pointer = { x: logicalWidth * 0.5, y: logicalHeight * 0.5 };
let lastPointerMotionAt = -Infinity;
let pointerDown = null;
let dragDistance = 0;
let placementArmed = false;
let bulkPlacementDefinitionId = null;
let buildCatalogOpen = false;
let buildCatalogPageId = 'core';
let selectedTowerId = null;
let towerActionPage = 0;
let towerActionPageTowerId = null;
let towerMenuMode = null;
let statusMessage = 'build live // no pause';
let statusUntil = 0;
const projectilePresentation = new Map();
const impactBursts = [];
const attackFlashes = [];
// Relay completion transition: retired connectors upload themselves along their own link.
// Purely presentational and derived from the authoritative event payload plus elapsed
// time, so it cannot influence simulation or diverge between peers.
let relayCollapse = null;
const RELAY_COLLAPSE_SECONDS = 2.2;
// Rolling render-cost telemetry for the diagnostics object (last / average / worst ms).
const frameTiming = { last: 0, average: 0, worst: 0 };
const uiHitboxes = [];
const telemetryByMode = new Map();
const gameplayPreferences = loadGameplayPreferences();
let uiDrag = null;
let controlDrag = null;
let showAllRanges = false;
let showKps = true;
let showStatsPanel = false;
let testKeepSwarm = false;
let lastAutosaveAt = performance.now();
let saveInFlight = false;
let saveQueued = false;

function allowedZoomLevels() {
  return zoomLevels;
}

function clampCameraToMap() {
  if (!zoomLevels.includes(camera.scale)) camera.scale = zoomLevels.at(-1);
  const bounds = currentMap.bounds;
  const halfWidth = logicalWidth * camera.scale * 0.5;
  const minimumX = bounds.left + halfWidth;
  const maximumX = bounds.right - halfWidth;
  camera.x = minimumX <= maximumX ? Math.max(minimumX, Math.min(maximumX, camera.x)) : (bounds.left + bounds.right) / 2;
  const minimumY = bounds.top + (logicalHeight * 0.5 - HUD_TOP_HEIGHT) * camera.scale;
  // The lower edge of the playable viewport must never show space below the wall.
  const maximumY = bounds.bottom - (hudBottomY - logicalHeight * 0.5) * camera.scale;
  camera.y = Math.min(maximumY, Math.max(minimumY, camera.y));
}

function loadTestPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem('framebound_horde_test_field') || 'null');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

function loadGameplayPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem('framebound_horde_preferences') || 'null');
    return {
      autoSelectPlacedFrame: saved?.autoSelectPlacedFrame !== false,
      pace: normalizePace(saved?.pace ?? DEFAULT_PACE)
    };
  } catch {
    return { autoSelectPlacedFrame: true, pace: DEFAULT_PACE };
  }
}

function loadPlayerName() {
  try {
    return sanitizePlayerName(localStorage.getItem('framebound_horde_player_name')) || 'pilot';
  } catch {
    return 'pilot';
  }
}

function sanitizePlayerName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9 _-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
}

function savePlayerName(value) {
  const name = sanitizePlayerName(value) || 'pilot';
  multiplayerState.playerName = name;
  try { localStorage.setItem('framebound_horde_player_name', name); } catch {}
  if (session?.networkRole && session.playerId) session.send(COMMAND.PLAYER_RENAME, { label: name });
}

function playerColor(playerOrId) {
  const player = typeof playerOrId === 'string'
    ? sessionSnapshot?.players.find((candidate) => candidate.id === playerOrId)
    : playerOrId;
  const index = Number(String(player?.colorId || 'player_0').split('_').at(-1)) || 0;
  return PLAYER_COLORS[index % PLAYER_COLORS.length];
}

function saveGameplayPreferences() {
  try {
    localStorage.setItem('framebound_horde_preferences', JSON.stringify(gameplayPreferences));
  } catch {
    setStatus('gameplay options could not save');
  }
}

function saveTestPreferences(test) {
  if (!test) return;
  try {
    localStorage.setItem('framebound_horde_test_field', JSON.stringify({
      spawnRatePerSecond: test.spawnRatePerSecond,
      enemyHp: test.enemyHp,
      invincibleBase: test.invincibleBase,
      timeScale: test.timeScale,
      activeSpawnSourceIds: test.activeSpawnSourceIds,
      spawnSourceOverrides: test.spawnSourceOverrides || {},
      keepSwarm: testKeepSwarm
    }));
  } catch {
    setStatus('test settings could not save');
  }
}

function randomNetworkId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, '')}`;
  const values = new Uint32Array(2);
  globalThis.crypto.getRandomValues(values);
  return `${prefix}_${values[0].toString(36)}${values[1].toString(36)}`;
}

function localPeerClientId() {
  const key = 'framebound_horde_peer_client';
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const created = randomNetworkId('client').slice(0, 64);
    sessionStorage.setItem(key, created);
    return created;
  } catch {
    return randomNetworkId('client').slice(0, 64);
  }
}

function loadResumeToken(code) {
  try {
    return sessionStorage.getItem(`framebound_horde_resume_${code}`);
  } catch {
    return null;
  }
}

function saveResumeToken(code, token) {
  if (!code || !token) return;
  try {
    sessionStorage.setItem(`framebound_horde_resume_${code}`, token);
  } catch {
    setStatus('reconnect token could not save');
  }
}

function createNetworkAuthority(role) {
  const seedWords = new Uint32Array(1);
  globalThis.crypto.getRandomValues(seedWords);
  return new EmbeddedAuthority({
    ...PROTOTYPE_SESSION_CONFIG,
    sessionId: randomNetworkId(`session_${role}`),
    seed: seedWords[0] >>> 0,
    autoStart: false
  });
}

function createHostNetworkBundle() {
  const bundleAuthority = createNetworkAuthority('host');
  const bundleSession = new P2PHostSession(bundleAuthority, {
    clientId: localPeerClientId(),
    label: multiplayerState.playerName
  });
  bundleSession.connect();
  bundleSession.advance(20);
  return {
    mode: 'game',
    authority: bundleAuthority,
    session: bundleSession,
    map: getMapDefinition(bundleAuthority.state.mapId, bundleAuthority.state.seed),
    networkRole: 'host'
  };
}

function createGuestNetworkBundle(code) {
  const bundleAuthority = createNetworkAuthority('guest');
  const clientId = localPeerClientId();
  const bundleSession = new P2PGuestSession(bundleAuthority, {
    clientId,
    label: multiplayerState.playerName,
    resumeToken: loadResumeToken(code)
  });
  bundleSession.roomCode = code;
  bundleSession.onResumeToken = (token) => saveResumeToken(code, token);
  return {
    mode: 'game',
    authority: bundleAuthority,
    session: bundleSession,
    map: getMapDefinition(bundleAuthority.state.mapId, bundleAuthority.state.seed),
    networkRole: 'guest'
  };
}

function switchGameBundle(bundle) {
  const previous = sessions.get('game');
  if (previous && !previous.networkRole && !soloGameBundle) soloGameBundle = previous;
  sessions.set('game', bundle);
  cameraByMode.delete('game');
  activateSession('game');
}

function updateMultiplayerStatus(phase, status, detail = '') {
  if (phase) multiplayerState.phase = phase;
  multiplayerState.status = String(status || '').toLowerCase();
  multiplayerState.detail = String(detail || '').toLowerCase();
  setStatus(multiplayerState.status);
}

function resetMultiplayerSocial() {
  multiplayerSocial.messages.length = 0;
  multiplayerSocial.presenceByPlayer.clear();
  multiplayerSocial.presenceSequenceByPlayer.clear();
  multiplayerSocial.pings.length = 0;
  multiplayerSocial.chatOpen = false;
  multiplayerSocial.chatInput = '';
  multiplayerSocial.rosterExpanded = false;
  multiplayerSocial.pingArmed = false;
  multiplayerSocial.lastPresenceSignature = '';
  multiplayerSocial.idleSent = true;
}

function addSystemMessage(text) {
  addChatMessage({ kind: 'system', text: String(text || '').toLowerCase() });
}

function addChatMessage(message) {
  multiplayerSocial.messages.push({ ...message, receivedAt: performance.now() });
  if (multiplayerSocial.messages.length > 50) multiplayerSocial.messages.splice(0, multiplayerSocial.messages.length - 50);
}

function receiveSocialMessage(message) {
  if (message.kind === 'chat') addChatMessage(message);
  else if (message.kind === 'ping') multiplayerSocial.pings.push({ ...message, receivedAt: performance.now() });
}

function receivePresenceMessage(message) {
  const sequence = Number.isSafeInteger(message.sequence) ? message.sequence : -1;
  const previous = multiplayerSocial.presenceSequenceByPlayer.get(message.playerId) || -1;
  if (sequence <= previous) return;
  multiplayerSocial.presenceSequenceByPlayer.set(message.playerId, sequence);
  if (!message.active) {
    multiplayerSocial.presenceByPlayer.delete(message.playerId);
    return;
  }
  multiplayerSocial.presenceByPlayer.set(message.playerId, { ...message, receivedAt: performance.now() });
}

function bindPeerCoordinator(bundle, role, code = null) {
  const relayMode = new URLSearchParams(window.location.search).get('relay') === '1';
  const coordinator = relayMode
    ? new RelayConnectionCoordinator({ relayUrl: relayUrlForPage() })
    : new PeerConnectionCoordinator();
  peerCoordinator = coordinator;
  bundle.coordinator = coordinator;
  const networkSession = bundle.session;
  networkSession.onSocial = receiveSocialMessage;
  networkSession.onPresence = receivePresenceMessage;

  networkSession.onStatus = (status, detail) => {
    if (status === 'peer_ready') {
      const current = networkSession.authority.snapshot();
      const players = current.players.filter((player) => player.connected && !player.spectator).length;
      updateMultiplayerStatus(current.phase === 'lobby' ? 'host_lobby' : 'running', `${players}/4 pilots linked`);
    } else if (status === 'error') {
      updateMultiplayerStatus('error', detail || 'peer session error');
    }
  };

  if (role === 'guest') {
    networkSession.onReady = (snapshot, { firstSync = true } = {}) => {
      bundle.map = getMapDefinition(snapshot.mapId, snapshot.seed);
      if (session === networkSession) {
        sessionSnapshot = snapshot;
        resetWorldPresentation();
        if (firstSync || currentMap.id !== snapshot.mapId || (currentMap.randomRifts && currentMap.layoutSeed !== snapshot.seed)) adoptActiveMap(snapshot.mapId);
      }
      if (!firstSync) {
        setStatus('host correction applied');
        return;
      }
      if (snapshot.phase !== 'lobby') {
        gameHasEnteredGameplay = true;
        frontEndScreen = 'game';
        updateMultiplayerStatus('running', 'rejoined host simulation');
      } else {
        frontEndScreen = 'coop';
        updateMultiplayerStatus('guest_lobby', 'linked // waiting for host');
      }
    };
  }

  coordinator.onStatus = (status, detail) => {
    const labels = {
      creating_session: 'waking signaling relay',
      signaling_connected: 'signaling online',
      waiting_for_peers: 'room open // waiting for pilots',
      joining_session: 'finding room',
      connecting_to_host: 'negotiating direct link',
      peer_connecting: 'pilot found // opening direct link',
      connected: relayMode ? 'relay link open' : 'direct p2p link open',
      reconnecting: 'reconnecting direct link',
      join_timeout: 'room connection timed out',
      connection_lost: 'direct connection lost',
      host_left: 'host left the beta',
      invalid_code: 'invalid room code',
      error: detail || 'network error'
    };
    const error = ['join_timeout', 'connection_lost', 'host_left', 'invalid_code', 'error'].includes(status);
    updateMultiplayerStatus(error ? 'error' : multiplayerState.phase, labels[status] || status, detail || '');
  };
  coordinator.onHosted = ({ code: roomCode, expiresAt }) => {
    multiplayerState.roomCode = roomCode;
    multiplayerState.expiresAt = expiresAt;
    networkSession.roomCode = roomCode;
    updateMultiplayerStatus('host_lobby', 'room ready // share the code');
  };
  coordinator.onConnected = ({ peerId, transport }) => {
    if (role === 'host') networkSession.attachPeer(peerId, transport);
    else networkSession.attachTransport(transport);
  };
  coordinator.onDisconnected = ({ peerId, reason }) => {
    if (multiplayerClosing) return;
    if (role === 'host') networkSession.detachPeer(peerId, reason, false);
    else networkSession.detachTransport(reason);
  };
  coordinator.onClosed = ({ reason }) => {
    if (multiplayerClosing) return;
    if (reason === 'host_left') addSystemMessage('host left // room ended');
    updateMultiplayerStatus('error', reason === 'host_left' ? 'host left // migration is not in this beta' : `peer session closed // ${reason}`);
    frontEndScreen = 'coop';
  };

  if (role === 'host') coordinator.host();
  else coordinator.join(code);
  return coordinator;
}

function beginHostingCoop() {
  if (gameRestorePending) return setStatus('loading solo save');
  cancelMultiplayer(false);
  resetMultiplayerSocial();
  const bundle = createHostNetworkBundle();
  switchGameBundle(bundle);
  multiplayerState.role = 'host';
  multiplayerState.roomCode = null;
  multiplayerState.codeInput = '';
  frontEndScreen = 'coop';
  updateMultiplayerStatus('connecting', 'waking signaling relay');
  bindPeerCoordinator(bundle, 'host');
}

function openJoinCoop() {
  if (gameRestorePending) return setStatus('loading solo save');
  multiplayerState.role = 'guest';
  multiplayerState.phase = 'join_entry';
  multiplayerState.roomCode = null;
  multiplayerState.codeInput = '';
  multiplayerState.status = 'type the six-character room code';
  multiplayerState.detail = '';
  frontEndScreen = 'coop';
}

function beginJoiningCoop() {
  const code = sanitizeRoomCode(multiplayerState.codeInput);
  if (!code) return updateMultiplayerStatus('join_entry', 'need all six code characters');
  cancelMultiplayer(false);
  resetMultiplayerSocial();
  const bundle = createGuestNetworkBundle(code);
  switchGameBundle(bundle);
  multiplayerState.role = 'guest';
  multiplayerState.roomCode = code;
  multiplayerState.codeInput = code;
  frontEndScreen = 'coop';
  updateMultiplayerStatus('connecting', `joining ${code}`);
  bindPeerCoordinator(bundle, 'guest', code);
}

function cancelMultiplayer(returnToMenu = true) {
  multiplayerClosing = true;
  try {
    const activeBundle = sessions.get('game');
    if (activeBundle?.networkRole) activeBundle.session.disconnect?.();
    peerCoordinator?.disconnect('player_cancelled');
  } finally {
    peerCoordinator = null;
    multiplayerClosing = false;
  }
  if (soloGameBundle) {
    sessions.set('game', soloGameBundle);
    if (sessionMode === 'game') activateSession('game');
  }
  Object.assign(multiplayerState, {
    role: null,
    phase: 'idle',
    roomCode: null,
    codeInput: '',
    status: 'peer link idle',
    detail: '',
    expiresAt: 0,
    editingName: false
  });
  resetMultiplayerSocial();
  if (returnToMenu) {
    gameHasEnteredGameplay = Boolean(sessionSnapshot?.runTick > 0);
    frontEndScreen = 'main';
    setStatus('multiplayer closed');
  }
}

async function copyRoomCode() {
  if (!multiplayerState.roomCode) return;
  try {
    await navigator.clipboard.writeText(multiplayerState.roomCode);
    updateMultiplayerStatus(multiplayerState.phase, 'room code copied');
  } catch {
    updateMultiplayerStatus(multiplayerState.phase, `copy failed // code ${multiplayerState.roomCode}`);
  }
}

function createSessionBundle(mode) {
  const config = mode === 'test' ? TEST_FIELD_SESSION_CONFIG : PROTOTYPE_SESSION_CONFIG;
  const bundleAuthority = new EmbeddedAuthority(mode === 'game' ? { ...config, seed: globalThis.crypto.getRandomValues(new Uint32Array(1))[0] } : config);
  const bundleSession = new EmbeddedClient(bundleAuthority, {
    clientId: mode === 'test' ? 'client_test_1' : 'client_local_1',
    label: 'host'
  });
  bundleSession.connect();
  bundleSession.advance(20);
  const bundle = { mode, authority: bundleAuthority, session: bundleSession, map: getMapDefinition(config.mapId) };
  sessions.set(mode, bundle);
  if (mode === 'game' && !soloGameBundle) soloGameBundle = bundle;
  if (mode === 'game') {
    gameRestorePending = true;
    void restoreGameBundle(bundle).finally(() => {
      gameRestorePending = false;
    });
  }
  if (mode === 'test') {
    const saved = loadTestPreferences();
    testKeepSwarm = Boolean(saved.keepSwarm);
    bundleSession.send(COMMAND.TEST_CONFIG_SET, {
      spawnRatePerSecond: saved.spawnRatePerSecond,
      enemyHp: saved.enemyHp,
      invincibleBase: saved.invincibleBase,
      timeScale: saved.timeScale,
      activeSpawnSourceIds: saved.activeSpawnSourceIds,
      spawnSourceOverrides: saved.spawnSourceOverrides
    });
    bundleSession.send(COMMAND.TOWER_PLACE, { definitionId: 'frame', x: 0, y: 238 });
    bundleSession.advance(20);
  }
  return bundle;
}

async function restoreGameBundle(bundle) {
  try {
    const saved = await loadSoloRun(bundle.authority.state.sessionId);
    if (!saved?.correction || bundle.authority.state.runTick > 30 || bundle.authority.state.towers.length > 0) return;
    bundle.authority.applyCorrectionSnapshot(saved.correction);
    bundle.session.sequence = bundle.authority.lastSequenceByClient.get(bundle.session.clientId) || bundle.session.sequence;
    bundle.session.latestSnapshot = bundle.authority.snapshot();
    bundle.map = getMapDefinition(bundle.authority.state.mapId, bundle.authority.state.seed);
    if (sessionMode === 'game' && session === bundle.session) {
      sessionSnapshot = bundle.session.latestSnapshot;
      resetWorldPresentation();
      currentMap = bundle.map;
      selectedRunMapId = currentMap.id;
      cameraByMode.delete('game');
      Object.assign(camera, currentMap.camera);
      clampCameraToMap();
      setStatus('solo autosave restored');
    }
  } catch (error) {
    window.__hordeDiagnostics = { ...(window.__hordeDiagnostics || {}), saveError: String(error) };
    if (sessionMode === 'game') setStatus('autosave restore unavailable');
  }
}

async function saveGameBundle() {
  const activeBundle = sessions.get('game');
  const bundle = activeBundle?.networkRole ? soloGameBundle : activeBundle;
  if (!bundle || gameRestorePending) return;
  if (saveInFlight) {
    saveQueued = true;
    return;
  }
  saveInFlight = true;
  try {
    await saveSoloRun(
      bundle.authority.state.sessionId,
      bundle.authority.correctionSnapshot(),
      bundle.authority.replayLog()
    );
  } catch (error) {
    window.__hordeDiagnostics = { ...(window.__hordeDiagnostics || {}), saveError: String(error) };
    if (sessionMode === 'game') setStatus('autosave unavailable');
  } finally {
    saveInFlight = false;
    if (saveQueued) {
      saveQueued = false;
      void saveGameBundle();
    }
  }
}

window.__saveHordeRun = saveGameBundle;
addEventListener('pagehide', () => { void saveGameBundle(); });
// Mobile browsers may suspend a page without dispatching pagehide.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void saveGameBundle();
});

function resetWorldPresentation() {
  baseDamage.reset();
  researchWave = null;
  relayCollapse = null;
}

function activateSession(mode) {
  cameraByMode.set(sessionMode, { ...camera, mapId: currentMap.id });
  const bundle = sessions.get(mode) || createSessionBundle(mode);
  sessionMode = mode;
  authority = bundle.authority;
  session = bundle.session;
  sessionSnapshot = session.snapshot();
  currentMap = getMapDefinition(sessionSnapshot.mapId, sessionSnapshot.seed);
  resetWorldPresentation();
  devToolsOpen = false;
  bundle.map = currentMap;
  const savedCamera = cameraByMode.get(mode);
  Object.assign(camera, savedCamera?.mapId === currentMap.id ? savedCamera : currentMap.camera);
  selectedTowerId = mode === 'test' ? sessionSnapshot.towers[0]?.id || null : null;
  towerMenuMode = null;
  placementArmed = false;
  bulkPlacementDefinitionId = null;
  buildCatalogOpen = false;
  projectilePresentation.clear();
  impactBursts.length = 0;
  attackFlashes.length = 0;
  enemyRenderer.lastTick = -1;
  enemyRenderer.lastState = null;
  fitCanvas();
  clampCameraToMap();
  setStatus(mode === 'test' ? 'test field // local tools' : 'game field // still live');
}

activateSession('game');

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * logicalWidth / rect.width,
    y: (event.clientY - rect.top) * logicalHeight / rect.height
  };
}

function registerHitbox(id, x, y, width, height, options = {}) {
  uiHitboxes.push({ id, x, y, width, height, ...options });
}

function hitboxAt(point) {
  for (let index = uiHitboxes.length - 1; index >= 0; index -= 1) {
    const hitbox = uiHitboxes[index];
    if (point.x >= hitbox.x && point.x <= hitbox.x + hitbox.width && point.y >= hitbox.y && point.y <= hitbox.y + hitbox.height) return hitbox;
  }
  return null;
}

function setTestConfig(patch) {
  if (sessionMode !== 'test') return;
  session.send(COMMAND.TEST_CONFIG_SET, patch);
}

function sliderRateAt(screenX, hitbox) {
  const fraction = Math.max(0, Math.min(1, (screenX - hitbox.x) / hitbox.width));
  return Math.min(100000, Math.round(Math.pow(10, fraction * 5) - 1));
}

function handleUiDrag(point, final = false) {
  if (!uiDrag) return;
  uiDrag.distance += Math.hypot(point.x - uiDrag.last.x, point.y - uiDrag.last.y);
  uiDrag.last = { ...point };
  if (uiDrag.kind === 'spawn-rate') {
    setTestConfig({ spawnRatePerSecond: sliderRateAt(point.x, uiDrag.hitbox) });
  } else if (uiDrag.kind === 'spawn-point') {
    const world = unproject(point.x, point.y);
    uiDrag.overrides[uiDrag.sourceId] = { x: world.x, y: world.y };
    setTestConfig({ spawnSourceOverrides: uiDrag.overrides });
    if (final && uiDrag.distance <= 2) {
      const active = new Set(sessionSnapshot.test.activeSpawnSourceIds || []);
      if (active.has(uiDrag.sourceId)) active.delete(uiDrag.sourceId);
      else active.add(uiDrag.sourceId);
      setTestConfig({ activeSpawnSourceIds: [...active] });
    }
  } else if (uiDrag.kind === 'tower') {
    if (final && uiDrag.distance <= 2) {
      selectedTowerId = uiDrag.towerId;
      setStatus('test tower selected // drag to move');
    } else {
      const world = unproject(point.x, point.y);
      session.send(COMMAND.TEST_TOWER_MOVE, { towerId: uiDrag.towerId, x: world.x, y: world.y });
    }
  }
}

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !event.isPrimary) return;
  pointer = canvasPoint(event);
  const hitbox = hitboxAt(pointer);
  if (hitbox) {
    event.preventDefault();
    if (hitbox.action) hitbox.action();
    if (hitbox.drag) {
      uiDrag = {
        ...hitbox.drag,
        hitbox,
        last: { ...pointer },
        distance: 0,
        overrides: { ...(sessionSnapshot.test?.spawnSourceOverrides || {}) }
      };
      handleUiDrag(pointer);
      canvas.setPointerCapture(event.pointerId);
    }
    return;
  }
  if (buildCatalogOpen || devToolsOpen) return;
  if (frontEndScreen !== 'game' || sessionSnapshot.phase === 'defeated' || towerMenuMode === 'research') return;
  if (towerMenuMode === 'control' && selectedTowerId) {
    const tower = sessionSnapshot.towers.find((candidate) => candidate.id === selectedTowerId);
    const definition = weaponView(sessionSnapshot, tower);
    if (tower && definition?.control?.input === 'line') {
      const world = unproject(pointer.x, pointer.y);
      controlDrag = { towerId: tower.id, start: world, current: world };
      canvas.setPointerCapture(event.pointerId);
      setStatus('drag the control line');
      return;
    }
  }
  dragging = true;
  pointerDown = { ...pointer };
  dragDistance = 0;
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', (event) => {
  if (!event.isPrimary) return;
  const previous = pointer;
  pointer = canvasPoint(event);
  lastPointerMotionAt = performance.now();
  if (uiDrag) {
    handleUiDrag(pointer);
    return;
  }
  if (controlDrag) {
    controlDrag.current = unproject(pointer.x, pointer.y);
    return;
  }
  if (!dragging) return;
  const next = pointer;
  dragDistance += Math.hypot(next.x - previous.x, next.y - previous.y);
  if (dragDistance <= 2) return;
  camera.x -= (next.x - previous.x) * camera.scale;
  camera.y -= (next.y - previous.y) * camera.scale;
  clampCameraToMap();
});

canvas.addEventListener('pointerup', (event) => {
  if (!event.isPrimary || event.button !== 0) return;
  if (uiDrag) {
    pointer = canvasPoint(event);
    handleUiDrag(pointer, true);
    uiDrag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    return;
  }
  if (controlDrag) {
    pointer = canvasPoint(event);
    controlDrag.current = unproject(pointer.x, pointer.y);
    const drag = controlDrag;
    controlDrag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    sendSelectedControlGeometry({
      kind: 'line',
      x1: drag.start.x,
      y1: drag.start.y,
      x2: drag.current.x,
      y2: drag.current.y
    });
    return;
  }
  if (!dragging) return;
  pointer = canvasPoint(event);
  const clicked = dragDistance <= 2 && pointerDown
    && Math.hypot(pointer.x - pointerDown.x, pointer.y - pointerDown.y) <= 2;
  cancelPointerGesture();
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (clicked && pointer.y > HUD_TOP_HEIGHT && pointer.y < hudBottomY) {
    if (multiplayerSocial.pingArmed && session.networkRole) {
      const world = unproject(pointer.x, pointer.y);
      session.sendPing?.(world.x, world.y);
      multiplayerSocial.pingArmed = false;
      setStatus('ping sent');
    } else handleWorldClick(pointer);
  }
});

function cancelPointerGesture() {
  dragging = false;
  pointerDown = null;
  dragDistance = 0;
  uiDrag = null;
  controlDrag = null;
}
canvas.addEventListener('pointercancel', cancelPointerGesture);
canvas.addEventListener('lostpointercapture', cancelPointerGesture);
addEventListener('blur', cancelPointerGesture);

canvas.addEventListener('contextmenu', (event) => {
  cancelPointerGesture();
  event.preventDefault();
  if (frontEndScreen !== 'game') return;
  placementArmed = false;
  bulkPlacementDefinitionId = null;
  buildCatalogOpen = false;
  selectedTowerId = null;
  towerMenuMode = null;
  controlDrag = null;
  setStatus('cancelled');
});

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  if (frontEndScreen !== 'game' || devToolsOpen) return;
  const levels = allowedZoomLevels();
  const current = levels.reduce((closestIndex, scale, index) => (
    Math.abs(scale - camera.scale) < Math.abs(levels[closestIndex] - camera.scale) ? index : closestIndex
  ), 0);
  const nextIndex = Math.max(0, Math.min(levels.length - 1, current + Math.sign(event.deltaY)));
  camera.scale = levels[nextIndex];
  clampCameraToMap();
}, { passive: false });

addEventListener('keydown', (event) => {
  if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
  const key = event.key.toLowerCase();
  if (multiplayerState.editingName) {
    if (event.key === 'Escape') multiplayerState.editingName = false;
    else if (event.key === 'Enter') {
      savePlayerName(multiplayerState.playerName);
      multiplayerState.editingName = false;
    } else if (event.key === 'Backspace') multiplayerState.playerName = multiplayerState.playerName.slice(0, -1);
    else if (/^[a-z0-9 _-]$/i.test(event.key) && multiplayerState.playerName.length < 20) multiplayerState.playerName += event.key.toLowerCase();
    event.preventDefault();
    return;
  }
  if (multiplayerSocial.chatOpen) {
    if (event.key === 'Escape') multiplayerSocial.chatOpen = false;
    else if (event.key === 'Enter') {
      if (multiplayerSocial.chatInput.trim()) session.sendChat?.(multiplayerSocial.chatInput);
      multiplayerSocial.chatInput = '';
      multiplayerSocial.chatOpen = false;
    } else if (event.key === 'Backspace') multiplayerSocial.chatInput = multiplayerSocial.chatInput.slice(0, -1);
    else if (event.key.length === 1 && multiplayerSocial.chatInput.length < 160) multiplayerSocial.chatInput += event.key;
    event.preventDefault();
    return;
  }
  if (event.key === 'F2' && frontEndScreen === 'game') {
    event.preventDefault(); cancelPointerGesture(); devToolsOpen = !devToolsOpen; return;
  }
  if (devToolsOpen) {
    if (event.key === 'Escape') { event.preventDefault(); devToolsOpen = false; }
    return;
  }
  if (frontEndScreen === 'game' && session.networkRole && event.key === 'Tab' && towerMenuMode !== 'research' && !buildCatalogOpen) {
    event.preventDefault();
    multiplayerSocial.rosterExpanded = true;
    return;
  }
  if (event.key === '?' && (frontEndScreen === 'game' || frontEndScreen === 'escape')) {
    cancelPointerGesture();
    frontEndScreen = 'escape';
    escapeMenuPage = escapeMenuPage === 'help' ? 'main' : 'help';
    return;
  }
  if (event.key === 'Escape') {
    cancelPointerGesture();
    if (frontEndScreen === 'game' && towerMenuMode === 'research') { towerMenuMode = 'actions'; return; }
    if (frontEndScreen === 'game' && towerMenuMode === 'control') {
      towerMenuMode = sessionMode === 'game' ? 'actions' : null;
      controlDrag = null;
      setStatus('control edit cancelled');
    } else if (frontEndScreen === 'game' && buildCatalogOpen) closeBuildCatalog();
    else if (frontEndScreen === 'game') openEscapeMenu();
    else if (frontEndScreen === 'escape' && escapeMenuPage !== 'main') closeEscapeOptions();
    else if (frontEndScreen === 'escape') resumeSession();
    else if (frontEndScreen === 'map_select') closeMapSelection();
    else if (frontEndScreen === 'coop') cancelMultiplayer(true);
    return;
  }
  if (frontEndScreen === 'main') {
    if (event.key === 'Enter') startOrContinueGame();
    else if (key === 't') enterTestField();
    else if (key === 'h') {
      if (sessions.get('game')?.networkRole) frontEndScreen = 'coop';
      else beginHostingCoop();
    } else if (key === 'j') {
      if (sessions.get('game')?.networkRole) frontEndScreen = 'coop';
      else openJoinCoop();
    }
    return;
  }
  if (frontEndScreen === 'coop') {
    if (multiplayerState.phase === 'join_entry') {
      if (/^[a-z0-9]$/i.test(event.key) && multiplayerState.codeInput.length < 6) {
        multiplayerState.codeInput += event.key.toUpperCase();
        updateMultiplayerStatus('join_entry', `${multiplayerState.codeInput.length}/6 code characters`);
      } else if (event.key === 'Backspace') {
        multiplayerState.codeInput = multiplayerState.codeInput.slice(0, -1);
        updateMultiplayerStatus('join_entry', 'type the six-character room code');
      } else if (event.key === 'Enter') beginJoiningCoop();
    } else if (multiplayerState.phase === 'host_lobby' && event.key === 'Enter') {
      openCoopMapSelection();
    } else if (multiplayerState.phase === 'guest_lobby' && event.key === 'Enter') {
      setStatus('only the host can deploy');
    }
    return;
  }
  if (frontEndScreen === 'map_select') {
    if (/^[1-9]$/.test(event.key)) {
      const map = playableMaps()[Number(event.key) - 1];
      if (map) selectRunMap(map.id);
    } else if (event.key === 'Enter') {
      deploySelectedMap();
    } else if (event.key === '[' || event.key === '-') {
      adjustRunPace(-1);
    } else if (event.key === ']' || event.key === '=' || event.key === '+') {
      adjustRunPace(1);
    }
    return;
  }
  if (frontEndScreen === 'escape') {
    if (escapeMenuPage === 'options' && (event.key === '1' || event.key === 'Enter')) {
      event.preventDefault();
      toggleAutoSelectPlacedFrame();
    }
    return;
  }
  if (towerMenuMode === 'research') {
    const tower=sessionSnapshot.towers.find((item)=>item.id===selectedTowerId);
    if (!tower) { towerMenuMode=null; return; }
    const items=stationItems(sessionSnapshot,tower);
    const perPage=Math.min(288,logicalHeight-16)<240?1:3;
    const visible=items.slice(researchPage*perPage,(researchPage+1)*perPage);
    if(event.key==='Tab') { event.preventDefault(); researchPage=(researchPage+1)%Math.max(1,Math.ceil(items.length/perPage)); researchDetailPage=0; }
    else if(['1','2','3'].includes(event.key)) { researchSelection=visible[Number(event.key)-1]?.id ?? researchSelection; researchDetailPage=0; }
    else if(event.key==='Enter') { const item=items.find((item)=>item.id===researchSelection); if(item) purchaseStationItem(tower,item); }
    return;
  }
  if (buildCatalogOpen) {
    const page = BUILD_CATALOG_PAGES[buildCatalogPageId];
    const entry = page.rows.flat().find((candidate) => candidate.key === key);
    if (event.key === 'Tab') {
      event.preventDefault();
      const currentPage = BUILD_CATALOG_PAGE_IDS.indexOf(buildCatalogPageId);
      buildCatalogPageId = BUILD_CATALOG_PAGE_IDS[(currentPage + 1) % BUILD_CATALOG_PAGE_IDS.length];
      setStatus(`${BUILD_CATALOG_PAGES[buildCatalogPageId].label} catalog`);
    } else if ((sessionMode === 'game' && key === 'b') || (sessionMode === 'test' && key === 'u')) closeBuildCatalog();
    else if (entry) selectBulkPlacementDefinition(entry.definitionId);
    return;
  }
  if (selectedTowerId && towerMenuMode && (sessionMode === 'game' || ['arsenal','reactor'].includes(sessionSnapshot.towers.find((tower) => tower.id === selectedTowerId)?.definitionId) || isRelayForm(sessionSnapshot.towers.find((tower) => tower.id === selectedTowerId)?.definitionId) || ['relay', 'strike', 'control'].includes(towerMenuMode))) {
    const tower = sessionSnapshot.towers.find((candidate) => candidate.id === selectedTowerId);
    const towerDefinition = sessionSnapshot.towerCatalog.find((candidate) => candidate.id === tower?.definitionId);
    if (towerMenuMode === 'actions' && event.key === '1') {
      event.preventDefault();
      if (['arsenal','reactor'].includes(tower?.definitionId)) openResearchStation(tower);
      else if (towerDefinition?.evolutionChoices?.length) openUpgradeMenu(sessionSnapshot, tower);
      else if (isRelayForm(tower?.definitionId)) openRelayTargetMenu(sessionSnapshot, tower);
      return;
    }
    if (towerMenuMode === 'actions' && event.key === '2') {
      event.preventDefault();
      sellSelectedTower();
      return;
    }
    if (towerMenuMode === 'actions' && event.key === '3') {
      event.preventDefault();
      if (isRelayForm(tower?.definitionId)) openRelayTargetMenu(sessionSnapshot, tower);
      else if (towerDefinition?.control?.input && towerDefinition.control.input !== 'none') openControlGeometryMenu(sessionSnapshot, tower);
      else openStrikeTargetMenu(sessionSnapshot, tower);
      return;
    }
    if (towerMenuMode === 'actions' && event.key === '0') {
      event.preventDefault();
      if (towerDefinition?.control?.input && towerDefinition.control.input !== 'none') resetSelectedControlGeometry();
      else clearSelectedStrikePoint();
      return;
    }
    if (towerMenuMode === 'upgrades' && ['1', '2', '3'].includes(event.key)) {
      event.preventDefault();
      const definition = sessionSnapshot.towerCatalog.find((candidate) => candidate.id === tower?.definitionId);
      const definitionId = definition?.evolutionChoices?.[Number(event.key) - 1];
      if (definitionId) evolveSelectedTower(definitionId);
      else setStatus('that branch is not designed yet');
      return;
    }
    if (towerMenuMode === 'relay' && event.key === '1') {
      event.preventDefault();
      setStatus('click a highlighted nebula');
      return;
    }
    if (towerMenuMode === 'relay' && event.key === '2') {
      event.preventDefault();
      towerMenuMode = sessionMode === 'game' ? 'actions' : null;
      setStatus('relay selection cancelled');
      return;
    }
    if (towerMenuMode === 'strike' && event.key === '0') {
      event.preventDefault();
      clearSelectedStrikePoint();
      return;
    }
    if (towerMenuMode === 'strike' && event.key === '2') {
      event.preventDefault();
      towerMenuMode = sessionMode === 'game' ? 'actions' : null;
      setStatus('strike selection cancelled');
      return;
    }
    if (towerMenuMode === 'control' && event.key === '0') {
      event.preventDefault();
      resetSelectedControlGeometry();
      return;
    }
    if (towerMenuMode === 'control' && event.key === '2') {
      event.preventDefault();
      towerMenuMode = sessionMode === 'game' ? 'actions' : null;
      controlDrag = null;
      setStatus('control edit cancelled');
      return;
    }
  }
  if (session.networkRole && event.key === 'Enter' && frontEndScreen === 'game') {
    event.preventDefault();
    multiplayerSocial.chatOpen = true;
  } else if (session.networkRole && key === 'p' && frontEndScreen === 'game') {
    const world = unproject(pointer.x, pointer.y);
    if (pointer.y > HUD_TOP_HEIGHT && pointer.y < hudBottomY) session.sendPing?.(world.x, world.y);
  } else if (key === 't') {
    if (sessionMode === 'test') activateSession('game');
    else enterTestField();
  } else if (key === 'k') {
    showKps = !showKps;
    setStatus(`kps ${showKps ? 'shown' : 'hidden'}`);
  } else if (key === 'g') {
    showAllRanges = !showAllRanges;
    setStatus(`all ranges ${showAllRanges ? 'shown' : 'hidden'}`);
  } else if (key === 'i' && frontEndScreen === 'game') {
    showStatsPanel = !showStatsPanel;
    setStatus(`modifier summary ${showStatsPanel ? 'shown' : 'hidden'}`);
  } else if (sessionMode === 'test' && ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(event.key)) {
    switchTestTowerForm({
      0: 'backwash',
      1: 'frame',
      2: 'assault',
      3: 'tether',
      4: 'network',
      5: 'barrage',
      6: 'rocket',
      7: 'laser',
      8: 'anchor',
      9: 'knot'
    }[event.key]);
  } else if (sessionMode === 'test' && ['o', 'f', 'r'].includes(key)) {
    switchTestTowerForm({ o: 'overclock', f: 'forge', r: 'relay' }[key]);
  } else if (sessionMode === 'test' && event.code === 'Space') {
    event.preventDefault();
    setTestConfig({ paused: !sessionSnapshot.test.paused });
  } else if (sessionMode === 'test' && event.key === '.') {
    session.send(COMMAND.TEST_STEP);
  } else if (sessionMode === 'test' && key === 'c') {
    session.send(COMMAND.TEST_CLEAR, { resetCounters: true });
  } else if (sessionMode === 'test' && key === 'b') {
    placementArmed = !placementArmed;
    setStatus(placementArmed ? 'place support frame // 8 max' : 'support placement off');
  } else if (sessionMode === 'test' && key === 'u') {
    openBuildCatalog('assault');
  } else if (sessionMode === 'test' && key === 'n') {
    openBuildCatalog('network');
  } else if (sessionMode === 'game' && key === 'b') {
    openBuildCatalog('core');
  } else if (event.key === '1') {
    armFramePlacement();
  } else if (sessionMode === 'test' && key === 'x' && selectedTowerId) {
    session.send(COMMAND.TOWER_SELL, { towerId: selectedTowerId });
  } else if ((key === 'q' || key === 'e') && selectedTowerId) {
    cycleSelectedTargeting(key === 'q' ? -1 : 1);
  } else if (key === 'a' && selectedTowerId) {
    const tower = sessionSnapshot.towers.find((candidate) => candidate.id === selectedTowerId);
    const definition = weaponView(sessionSnapshot, tower);
    if (definition?.control?.input && definition.control.input !== 'none') openControlGeometryMenu(sessionSnapshot, tower);
    else openStrikeTargetMenu(sessionSnapshot, tower);
  } else if (key === 'r' && sessionSnapshot.phase === 'defeated' && !session.networkRole) {
    session.send(COMMAND.SESSION_RESTART);
  }
});

addEventListener('keyup', (event) => {
  if (event.key === 'Tab') multiplayerSocial.rosterExpanded = false;
});

addEventListener('paste', (event) => {
  if (frontEndScreen !== 'coop' || multiplayerState.phase !== 'join_entry') return;
  const pasted = String(event.clipboardData?.getData('text') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (!pasted) return;
  event.preventDefault();
  multiplayerState.codeInput = pasted;
  updateMultiplayerStatus('join_entry', pasted.length === 6 ? 'code ready // press enter' : `${pasted.length}/6 code characters`);
});

function clearTransientUi() {
  dragging = false;
  pointerDown = null;
  dragDistance = 0;
  uiDrag = null;
  controlDrag = null;
  placementArmed = false;
  bulkPlacementDefinitionId = null;
  buildCatalogOpen = false;
  selectedTowerId = null;
  towerMenuMode = null;
}

function adoptActiveMap(mapId) {
  resetWorldPresentation();
  const map = getMapDefinition(mapId, sessionSnapshot.seed);
  currentMap = map;
  const bundle = sessions.get(sessionMode);
  if (bundle) bundle.map = map;
  cameraByMode.delete(sessionMode);
  Object.assign(camera, map.camera);
  clampCameraToMap();
  if (sessionMode === 'game') selectedRunMapId = map.id;
}

function startOrContinueGame() {
  if (gameRestorePending) {
    setStatus('loading autosave');
    return;
  }
  if (sessionMode !== 'game') activateSession('game');
  if (session.networkRole && sessionSnapshot.phase !== 'running') {
    frontEndScreen = 'coop';
    setStatus(multiplayerState.role === 'host' ? 'coop lobby // share the code' : 'coop lobby // waiting for host');
    return;
  }
  if (sessionSnapshot.phase !== 'running') {
    openMapSelection('main');
    return;
  }
  gameHasEnteredGameplay = true;
  frontEndScreen = 'game';
  menuConfirm = null;
  clearTransientUi();
  setStatus('run resumed // no pause');
}

function openNewSoloRun() {
  if (sessions.get('game')?.networkRole) cancelMultiplayer(false);
  openMapSelection('main');
}

function openMapSelection(origin = frontEndScreen) {
  if (gameRestorePending) {
    setStatus('loading autosave');
    return;
  }
  if (sessionMode !== 'game') activateSession('game');
  clearTransientUi();
  selectedRunMapId = sessionSnapshot.mapId;
  mapSelectOrigin = ['escape', 'coop'].includes(origin) ? origin : 'main';
  menuConfirm = null;
  frontEndScreen = 'map_select';
  setStatus('choose the field // horde does not pause');
}

function closeMapSelection() {
  menuConfirm = null;
  frontEndScreen = mapSelectOrigin === 'escape' ? 'escape' : mapSelectOrigin === 'coop' ? 'coop' : 'main';
  setStatus(frontEndScreen === 'escape' ? 'menu open // horde still live' : frontEndScreen === 'coop' ? 'coop lobby' : 'main menu');
}

function openCoopMapSelection() {
  const connected = sessionSnapshot.players.filter((player) => player.connected && !player.spectator).length;
  if (multiplayerState.role !== 'host') return setStatus('only the host can deploy');
  if (connected < 2) return updateMultiplayerStatus('host_lobby', 'need another pilot before deployment');
  openMapSelection('coop');
}

// Horde pace for the next deployment: a time stretch on the threat clock.
function selectedRunPace() {
  return normalizePace(gameplayPreferences.pace ?? DEFAULT_PACE);
}

function adjustRunPace(direction) {
  const next = normalizePace(selectedRunPace() + direction * PACE_STEP);
  if (next === selectedRunPace()) return;
  gameplayPreferences.pace = next;
  saveGameplayPreferences();
  menuConfirm = null;
  setStatus(`horde pace x${next.toFixed(1)} // ${next < 1 ? 'slower curve, later surges' : next > 1 ? 'faster curve, earlier surges' : 'designed pace'}`);
}

function selectRunMap(mapId) {
  const map = playableMaps().find((candidate) => candidate.id === mapId);
  if (!map) return;
  selectedRunMapId = map.id;
  menuConfirm = null;
  setStatus(`${map.label} selected`);
}

function deploySelectedMap() {
  if (gameRestorePending) {
    setStatus('loading autosave');
    return;
  }
  const map = playableMaps().find((candidate) => candidate.id === selectedRunMapId);
  if (!map) {
    setStatus('select a map');
    return;
  }
  const networkBundle = sessions.get('game');
  if (networkBundle?.networkRole === 'guest') {
    setStatus('only the host can deploy');
    return;
  }
  if (networkBundle?.networkRole === 'host' && sessionSnapshot.phase !== 'lobby') {
    setStatus('multiplayer restart voting comes later');
    return;
  }
  if (sessionSnapshot.phase === 'running' && menuConfirm !== 'map_deploy') {
    menuConfirm = 'map_deploy';
    setStatus('deploy again // wipes the live run');
    return;
  }
  const pace = selectedRunPace();
  if (sessionSnapshot.phase === 'lobby') session.send(COMMAND.SESSION_START, { mapId: map.id, pace });
  else session.send(COMMAND.SESSION_RESTART, { mapId: map.id, pace });
  gameHasEnteredGameplay = true;
  frontEndScreen = 'game';
  menuConfirm = null;
  clearTransientUi();
  setStatus(`${map.label} // pace x${pace.toFixed(1)} // deploying`);
}

function openEscapeMenu() {
  clearTransientUi();
  menuConfirm = null;
  escapeMenuPage = 'main';
  frontEndScreen = 'escape';
  setStatus('menu open // horde still live');
}

function resumeSession() {
  frontEndScreen = 'game';
  menuConfirm = null;
  escapeMenuPage = 'main';
  setStatus('back in // horde never stopped');
}

function openEscapeOptions() {
  menuConfirm = null;
  escapeMenuPage = 'options';
  setStatus('gameplay options // local only');
}

function closeEscapeOptions() {
  escapeMenuPage = 'main';
  setStatus('menu open // horde still live');
}

function toggleAutoSelectPlacedFrame() {
  gameplayPreferences.autoSelectPlacedFrame = !gameplayPreferences.autoSelectPlacedFrame;
  saveGameplayPreferences();
  setStatus(`auto-select frame ${gameplayPreferences.autoSelectPlacedFrame ? 'on' : 'off'}`);
}

function returnToMainMenu() {
  if (sessionMode !== 'game') activateSession('game');
  clearTransientUi();
  menuConfirm = null;
  escapeMenuPage = 'main';
  frontEndScreen = 'main';
  setStatus(gameHasEnteredGameplay ? 'main menu // run still live' : 'main menu');
}

function enterTestField() {
  if (sessions.get('game')?.networkRole) {
    setStatus('leave coop before entering the test field');
    return;
  }
  activateSession('test');
  frontEndScreen = 'game';
  menuConfirm = null;
  setStatus('test field // local tools');
}

function armFramePlacement() {
  const definition = sessionSnapshot.towerCatalog.find((candidate) => candidate.id === TOWER_DEFINITION_ID);
  const economy = sessionSnapshot.teamEconomy;
  if ((sessionSnapshot.dev?.infiniteMoney ? Number.MAX_SAFE_INTEGER : (economy?.credits || 0)) < (definition?.cost ?? Infinity)) {
    placementArmed = false;
    bulkPlacementDefinitionId = null;
    setStatus(`need ${compactMetric(definition?.cost || 100)} credits`);
    return;
  }
  placementArmed = true;
  bulkPlacementDefinitionId = null;
  buildCatalogOpen = false;
  selectedTowerId = null;
  towerMenuMode = null;
  setStatus('place one frame // click nebula');
}

function openBuildCatalog(pageId = buildCatalogPageId) {
  if (sessionMode === 'game' && sessionSnapshot.phase !== 'running') {
    setStatus('start a run before building');
    return;
  }
  if (BUILD_CATALOG_PAGES[pageId]) buildCatalogPageId = pageId;
  placementArmed = false;
  bulkPlacementDefinitionId = null;
  buildCatalogOpen = true;
  if (sessionMode === 'game') {
    selectedTowerId = null;
    towerMenuMode = null;
    setStatus('choose a tower // full path price');
  } else {
    setStatus('choose a test form // tab changes page');
  }
}

function closeBuildCatalog() {
  buildCatalogOpen = false;
  setStatus('tower catalog closed');
}

function selectBulkPlacementDefinition(definitionId) {
  const definition = sessionSnapshot.towerCatalog.find((candidate) => candidate.id === definitionId);
  if (sessionMode === 'test') {
    if (!definition) {
      setStatus('test form is unavailable');
      return;
    }
    buildCatalogOpen = false;
    switchTestTowerForm(definitionId);
    return;
  }
  const quote = towerBuildQuote(sessionSnapshot.towerCatalog, definitionId);
  const economy = sessionSnapshot.teamEconomy;
  if (!definition || !quote) {
    setStatus('tower build path is unavailable');
    return;
  }
  if ((sessionSnapshot.dev?.infiniteMoney ? Number.MAX_SAFE_INTEGER : (economy?.credits || 0)) < Math.min(...currentMap.defenseAreas.map((area) => purchaseCost(sessionSnapshot, area.id, quote.cost, { placement: true })))) {
    setStatus(`need ${compactMetric(purchaseCost(sessionSnapshot, null, quote.cost, { placement: true }))} credits for ${definition.label}`);
    return;
  }
  bulkPlacementDefinitionId = definitionId;
  placementArmed = true;
  buildCatalogOpen = false;
  selectedTowerId = null;
  towerMenuMode = null;
  setStatus(`${definition.label} ${compactMetric(purchaseCost(sessionSnapshot, null, quote.cost, { placement: true }))} // place many // right click ends`);
}

function switchTestTowerForm(definitionId) {
  const tower = sessionSnapshot.towers.find((candidate) => candidate.id === selectedTowerId) || sessionSnapshot.towers[0];
  if (!tower) return;
  if (!testKeepSwarm) session.send(COMMAND.TEST_CLEAR, { resetCounters: true });
  session.send(COMMAND.TEST_TOWER_FORM_SET, { towerId: tower.id, definitionId });
  selectedTowerId = tower.id;
  setStatus(`${definitionId} loaded${testKeepSwarm ? ' // swarm kept' : ' // reset'}`);
}

function evolveSelectedTower(definitionId) {
  const tower = sessionSnapshot.towers.find((candidate) => candidate.id === selectedTowerId);
  if (!tower) return;
  const definition = sessionSnapshot.towerCatalog.find((candidate) => candidate.id === tower.definitionId);
  if (!definition?.evolutionChoices?.includes(definitionId)) {
    setStatus('next branch not designed yet');
    return;
  }
  session.send(COMMAND.TOWER_EVOLVE, { towerId: tower.id, definitionId });
  setStatus(`${definitionId} command sent`);
}

function cycleSelectedTargeting(direction) {
  const tower = sessionSnapshot.towers.find((candidate) => candidate.id === selectedTowerId);
  const definition = sessionSnapshot.towerCatalog.find((candidate) => candidate.id === tower?.definitionId);
  if (!tower || !definition?.targetingModes?.length) return;
  const modes=[...definition.targetingModes,...(hasResearch(sessionSnapshot,16)?['execution']:[]),...(hasResearch(sessionSnapshot,36)?['highest_hp']:[])];
  const current=Math.max(0,modes.indexOf(tower.targetingMode));
  const next=(current+direction+modes.length)%modes.length;
  session.send(COMMAND.TOWER_TARGETING_SET,{towerId:tower.id,mode:modes[next]});
}

function project(x, y) {
  return {
    x: (x - camera.x) / camera.scale + logicalWidth * 0.5,
    y: (y - camera.y) / camera.scale + logicalHeight * 0.5
  };
}

function unproject(screenX, screenY) {
  return {
    x: Math.round((screenX - logicalWidth * 0.5) * camera.scale + camera.x),
    y: Math.round((screenY - logicalHeight * 0.5) * camera.scale + camera.y)
  };
}

function setStatus(message, duration = 1800) {
  statusMessage = String(message).toLowerCase().slice(0, 36);
  statusUntil = performance.now() + duration;
}

function selectedControlContext() {
  const tower = sessionSnapshot.towers.find((candidate) => candidate.id === selectedTowerId);
  const definition = weaponView(sessionSnapshot, tower);
  return { tower, definition, control: definition?.control || null };
}

function sendSelectedControlGeometry(geometry) {
  const { tower, definition, control } = selectedControlContext();
  if (!tower || !control || control.input === 'none') {
    setStatus('tower has no editable control');
    return;
  }
  const range = tower.effectiveRange || definition.range || 0;
  if (control.input === 'line') {
    if (geometry?.kind !== 'line') return;
    const length = Math.hypot(geometry.x2 - geometry.x1, geometry.y2 - geometry.y1);
    const outside = Math.hypot(geometry.x1 - tower.x, geometry.y1 - tower.y) > range
      || Math.hypot(geometry.x2 - tower.x, geometry.y2 - tower.y) > range;
    if (length < 12 || length > control.maxLength || outside) {
      setStatus(outside ? 'line endpoints outside range' : `line must be 12-${control.maxLength}u`);
      return;
    }
  }
  const normalized = normalizeControlGeometry(definition, tower, geometry, currentMap);
  if (!normalized) {
    setStatus(control.type === 'crosswind' ? 'choose a side // no upstream push' : 'control geometry outside map');
    return;
  }
  session.send(COMMAND.TOWER_CONTROL_GEOMETRY_SET, { towerId: tower.id, geometry: normalized });
  setStatus('control geometry sent // reboot 1s');
}

function handleWorldClick(screenPoint) {
  if (devToolsOpen) return;
  const world = unproject(screenPoint.x, screenPoint.y);
  if (['echo', 'socket'].includes(towerMenuMode) && selectedTowerId) {
    const tower = sessionSnapshot.towers.find((candidate) => candidate.id === selectedTowerId);
    if (!tower) return;
    if (towerMenuMode === 'echo') {
      const source = sessionSnapshot.towers.find((candidate) => Math.hypot(candidate.x - world.x, candidate.y - world.y) <= 18 && controlSource(sessionSnapshot, tower, candidate.id));
      if (!source) { setStatus('click a connected control turret'); return; }
      session.send(COMMAND.TOWER_ECHO_SOURCE_SET, { towerId: tower.id, sourceTowerId: source.id });
    } else {
      const target = defenseAreaCenterById(tower.relayTargetAreaId);
      if (!target) { setStatus('link a nebula first'); return; }
      const dx = target.x - tower.x, dy = target.y - tower.y;
      const fraction = Math.max(0, Math.min(1, ((world.x - tower.x) * dx + (world.y - tower.y) * dy) / (dx * dx + dy * dy || 1)));
      session.send(COMMAND.TOWER_SOCKET_SET, { towerId: tower.id, fraction });
    }
    towerMenuMode = 'actions';
    return;
  }
  if (towerMenuMode === 'control' && selectedTowerId) {
    const { tower, definition, control } = selectedControlContext();
    const range = tower?.effectiveRange || definition?.range || 0;
    if (!tower || !control || control.input === 'none') {
      towerMenuMode = sessionMode === 'game' ? 'actions' : null;
      setStatus('tower has no editable control');
      return;
    }
    if (control.input === 'line') {
      setStatus('click-drag to draw the line');
      return;
    }
    const distance = Math.hypot(world.x - tower.x, world.y - tower.y);
    if (distance > range || (control.input === 'direction' && distance <= 0.001)) {
      setStatus(distance > range ? 'control point outside range' : 'direction needs an arrow');
      return;
    }
    sendSelectedControlGeometry({ kind: control.input, x: world.x, y: world.y });
    return;
  }
  if (towerMenuMode === 'strike' && selectedTowerId) {
    const tower = sessionSnapshot.towers.find((candidate) => candidate.id === selectedTowerId);
    const definition = weaponView(sessionSnapshot, tower);
    const range = tower?.effectiveRange || definition?.range || 0;
    if (!tower || !supportsStrikePoint(definition?.attack)) {
      towerMenuMode = sessionMode === 'game' ? 'actions' : null;
      setStatus('tower cannot set a strike point');
      return;
    }
    if (Math.hypot(world.x - tower.x, world.y - tower.y) > range) {
      setStatus('strike point outside range');
      return;
    }
    session.send(COMMAND.TOWER_STRIKE_POINT_SET, { towerId: tower.id, x: world.x, y: world.y });
    setStatus('strike point command sent');
    return;
  }
  if (towerMenuMode === 'relay' && selectedTowerId) {
    const tower = sessionSnapshot.towers.find((candidate) => candidate.id === selectedTowerId);
    const areaId = findDefenseAreaAt(currentMap, world.x, world.y);
    const eligible = relayCandidateAreas(sessionSnapshot, tower).some((area) => area.id === areaId);
    if (!areaId || !eligible) {
      setStatus(areaId === tower?.areaId ? 'choose another nebula' : 'nebula outside relay range');
      return;
    }
    session.send(COMMAND.TOWER_RELAY_TARGET_SET, { towerId: tower.id, targetAreaId: areaId });
    setStatus('relay link command sent');
    return;
  }
  if (placementArmed) {
    if (sessionMode === 'test' && sessionSnapshot.towers.length >= 9) {
      setStatus('all 8 support slots are used');
      return;
    }
    if (!findDefenseAreaAt(currentMap, world.x, world.y) && !sessionSnapshot.towers.some((tower) => {
      const point = socketPoint(sessionSnapshot, currentMap, tower);
      return point && Math.hypot(point.x - world.x, point.y - world.y) <= 10;
    })) {
      setStatus('build inside nebula');
      return;
    }
    const definitionId = bulkPlacementDefinitionId || TOWER_DEFINITION_ID;
    const definition = sessionSnapshot.towerCatalog.find((candidate) => candidate.id === definitionId);
    const quote = towerBuildQuote(sessionSnapshot.towerCatalog, definitionId);
    session.send(COMMAND.TOWER_PLACE, { definitionId, x: world.x, y: world.y });
    if (bulkPlacementDefinitionId) {
      selectedTowerId = null;
      towerMenuMode = null;
      setStatus(`${definition?.label || definitionId} ${compactMetric(quote?.cost || 0)} // click next // right click ends`);
    } else {
      placementArmed = false;
      selectedTowerId = null;
      towerMenuMode = null;
      setStatus('frame placement command sent');
    }
    return;
  }
  let nearest = null;
  let nearestDistance = 11 * camera.scale;
  for (const tower of sessionSnapshot.towers) {
    const distance = Math.hypot(tower.x - world.x, tower.y - world.y);
    if (distance < nearestDistance) {
      nearest = tower;
      nearestDistance = distance;
    }
  }
  selectedTowerId = nearest?.id || null;
  towerMenuMode = nearest && (sessionMode === 'game' || isRelayForm(nearest.definitionId)) ? 'actions' : null;
  if (nearest && ['arsenal','reactor'].includes(nearest.definitionId)) openResearchStation(nearest);
  setStatus(nearest ? `${nearest.definitionId} selected` : 'selection cleared');
}

function drawBackground() {
  gl.useProgram(backgroundProgram);
  gl.uniform2f(gl.getUniformLocation(backgroundProgram, 'u_resolution'), logicalWidth, logicalHeight);
  gl.uniform1f(gl.getUniformLocation(backgroundProgram, 'u_renderScale'), renderScale);
  gl.uniform2f(gl.getUniformLocation(backgroundProgram, 'u_camera'), camera.x, camera.y);
  gl.uniform1f(gl.getUniformLocation(backgroundProgram, 'u_viewScale'), camera.scale);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  nebulaRenderer.draw(currentMap, camera);
}

function drawTower(tower, override = null) {
  const p = project(tower.x, tower.y);
  const tick = sessionSnapshot?.runTick || 0;
  const control = tower.definitionId === 'bond'
    ? tower.effectiveControl || sessionSnapshot?.towerCatalog.find((item) => item.id === 'bond')?.control
    : null;
  const period = Math.max(1, Math.round((control?.periodSeconds || 6) * AUTHORITY_TICK_RATE));
  const pulseTick = tick % period;
  const bounds = drawCompactTowerSprite(shapes, COLOR, p, tower, camera.scale, override, {
    runTick: reducedNetworkMotion.matches ? 0 : tick,
    sweepPhase: (() => {
      if (tower.definitionId !== 'sweeper' || reducedNetworkMotion.matches) return null;
      const field = sessionSnapshot?.attackFields.find((f) => f.kind === 'sweep_line' && f.attack.sourceTowerId === tower.id);
      const pose = field ? sweepPose(field, tick) : null;
      return pose ? (field.sweepDirection < 0 ? 1-pose.phase : pose.phase) : null;
    })(),
    controlActive: pulseTick < Math.round((control?.durationSeconds || 2) * AUTHORITY_TICK_RATE)
      && tick - pulseTick >= (tower.controlReadyTick || 0)
  });
  if (session.networkRole && tower.ownerId) shapes.rect(p.x - 1, p.y + bounds.bottom + 4, 3, 2, playerColor(tower.ownerId));
  if (tower.definitionId === 'hardpoint') {
    const point = socketPoint(sessionSnapshot, currentMap, tower);
    if (point) {
      const socket = project(point.x, point.y);
      drawDashedLink(p, socket, COLOR.dimMint);
      shapes.rect(socket.x - 5, socket.y - 5, 11, 1, COLOR.amber);
      shapes.rect(socket.x - 5, socket.y + 5, 11, 1, COLOR.amber);
      shapes.rect(socket.x - 5, socket.y - 4, 1, 9, COLOR.amber);
      shapes.rect(socket.x + 5, socket.y - 4, 1, 9, COLOR.amber);
    }
  }
}

function defenseAreaCenterById(areaId) {
  const area = currentMap.defenseAreas.find((candidate) => candidate.id === areaId);
  if (!area) return null;
  return { x: area.shape.x, y: area.shape.y };
}

function drawDashedLink(from, to, color) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy) || 1;
  for (let offset = 0; offset < distance; offset += 8) {
    const end = Math.min(distance, offset + 4);
    shapes.line(
      from.x + dx * offset / distance,
      from.y + dy * offset / distance,
      from.x + dx * end / distance,
      from.y + dy * end / distance,
      1,
      color
    );
  }
}

let perimeterIntel = [];
let perimeterIntelTick = -1;
function drawPerimeterIntel(snapshot, frame) {
  if (!hasResearch(snapshot,36)) return;
  if (snapshot.runTick < perimeterIntelTick || snapshot.runTick - perimeterIntelTick >= 30 || perimeterIntelTick < 0) {
    perimeterIntelTick = snapshot.runTick;
    const sources = snapshot.towers.filter((tower) => snapshot.towerCatalog.find((definition)=>definition.id===tower.definitionId)?.networkNode);
    const seen = [];
    for (let i=0;i<frame.count;i++) {
      const hp=frame.hpById[frame.idByIndex[i]], x=frame.state[i*4], y=frame.state[i*4+1];
      if(hp<2 || !sources.some((tower)=>Math.hypot(tower.x-x,tower.y-y)<=(tower.effectiveRange||170)*2)) continue;
      seen.push({x,y,hp});
    }
    seen.sort((a,b)=>b.hp-a.hp||a.x-b.x||a.y-b.y);
    perimeterIntel=[];
    for(const enemy of seen) {
      if(perimeterIntel.every((group)=>Math.hypot(group.x-enemy.x,group.y-enemy.y)>96)) perimeterIntel.push(enemy);
      if(perimeterIntel.length===6) break;
    }
  }
  for(const group of perimeterIntel) {
    const p=project(group.x,group.y);
    shapes.rect(p.x-6,p.y-6,13,1,COLOR.amber);
    shapes.rect(p.x-6,p.y+6,13,1,COLOR.amber);
    bitmapText.draw(`${Math.ceil(group.hp)} hp`,p.x+9,p.y-3,COLOR.amber,1);
  }
}

function relayColors(areaId) {
  return networkPresentation.get(areaId)?.palette || DEFAULT_RELAY_PALETTE;
}

function drawNetworkLinks(snapshot) {
  const definitions = new Map(snapshot.towerCatalog.map((definition) => [definition.id, definition]));
  const relayPairs = new Set();
  const pulseClock = snapshot.runTick / AUTHORITY_TICK_RATE;
  const relays = snapshot.towers.filter((tower) => isRelayForm(tower.definitionId) && tower.relayTargetAreaId);
  const pulseSource = relays[Math.floor(pulseClock / 8) % Math.max(1, relays.length)];
  for (const source of snapshot.towers) {
    if (!isRelayForm(source.definitionId) || !source.relayTargetAreaId) continue;
    const pair = [source.areaId, source.relayTargetAreaId].sort().join(':');
    if (relayPairs.has(pair)) continue;
    relayPairs.add(pair);
    const targetCenter = defenseAreaCenterById(source.relayTargetAreaId);
    if (!targetCenter) continue;
    const from = project(source.x, source.y);
    const to = project(targetCenter.x, targetCenter.y);
    const palette = relayColors(source.areaId);
    const focused = source.id === selectedTowerId;
    drawDashedLink(from, to, focused ? palette.pulse : palette.link);
    shapes.rect(to.x - 1, to.y - 1, 2, 2, focused ? palette.focus : palette.pulse);
    // One two-pixel packet across the entire network, followed by six quiet seconds.
    const phase = pulseClock % 8;
    if (!reducedNetworkMotion.matches && source === pulseSource && phase < 2) {
      const progress = phase / 2;
      shapes.rect(from.x + (to.x - from.x) * progress,
        from.y + (to.y - from.y) * progress, 2, 1, palette.pulse);
    }
  }

  // Established links of a completed network: drawn from the retired relay's last
  // position when known, so the geometry the player built stays legible.
  const retiredByPair = new Map();
  for (const record of snapshot.relayNetwork?.retired || []) {
    if (record.targetAreaId) retiredByPair.set([record.areaId, record.targetAreaId].sort().join(':'), record);
  }
  const persistedLinks = snapshot.relayNetwork?.links || [];
  for (let index = 0; index < persistedLinks.length; index += 1) {
    const [areaA, areaB] = persistedLinks[index];
    const pair = [areaA, areaB].sort().join(':');
    if (relayPairs.has(pair)) continue;
    relayPairs.add(pair);
    const record = retiredByPair.get(pair);
    const sourceCenter = record ? { x: record.x, y: record.y } : defenseAreaCenterById(areaA);
    const targetCenter = defenseAreaCenterById(record ? record.targetAreaId : areaB);
    if (!sourceCenter || !targetCenter) continue;
    const from = project(sourceCenter.x, sourceCenter.y);
    const to = project(targetCenter.x, targetCenter.y);
    const palette = relayColors(areaA);
    if (Math.max(from.x, to.x) < 0 || Math.min(from.x, to.x) > logicalWidth || Math.max(from.y, to.y) < 0 || Math.min(from.y, to.y) > logicalHeight) continue;
    drawDashedLink(from, to, palette.link);
    shapes.rect(from.x - 1, from.y - 1, 2, 2, palette.pulse);
    shapes.rect(to.x - 1, to.y - 1, 2, 2, palette.pulse);
    const phase = (pulseClock + index * 0.37) % 8;
    if (!reducedNetworkMotion.matches && relays.length === 0 && phase < 2 && index === Math.floor(pulseClock / 8) % persistedLinks.length) {
      const progress = phase / 2;
      shapes.rect(from.x + (to.x - from.x) * progress, from.y + (to.y - from.y) * progress, 2, 1, palette.pulse);
    }
  }

  const selected = snapshot.towers.find((tower) => tower.id === selectedTowerId);
  if (!selected || !definitions.get(selected.definitionId)?.networkNode) return;
  const linkedAreas = new Set(selected.networkAreaIds || [selected.areaId]);
  const targets = snapshot.towers
    .filter((tower) => tower.id !== selected.id && linkedAreas.has(tower.areaId))
    .sort((left, right) => {
      const leftDistance = (left.x - selected.x) ** 2 + (left.y - selected.y) ** 2;
      const rightDistance = (right.x - selected.x) ** 2 + (right.y - selected.y) ** 2;
      return leftDistance - rightDistance || left.id.localeCompare(right.id);
    })
    .slice(0, 32);
  const from = project(selected.x, selected.y);
  const palette = relayColors(selected.areaId);
  for (const target of targets) {
    const to = project(target.x, target.y);
    shapes.line(from.x, from.y, to.x, to.y, 1, palette.link);
    shapes.rect(to.x, to.y, 1, 1, palette.pulse);
  }
}

function drawBase(snapshot) {
  const p = project(snapshot.base.x, snapshot.base.y);
  drawBaseSprite(shapes, COLOR, p, baseDamage.appearance(snapshot, reducedNetworkMotion.matches));
}

function presentProjectiles(projectiles, dt) {
  const liveIds = new Set();
  const presented = [];
  for (const projectile of projectiles) {
    liveIds.add(projectile.id);
    let visual = projectilePresentation.get(projectile.id);
    if (!visual) {
      visual = { sourceX: projectile.x, sourceY: projectile.y, age: 0 };
      projectilePresentation.set(projectile.id, visual);
    } else if (visual.sourceX !== projectile.x || visual.sourceY !== projectile.y) {
      visual.sourceX = projectile.x;
      visual.sourceY = projectile.y;
      visual.age = 0;
    } else {
      visual.age = Math.min(1 / AUTHORITY_TICK_RATE, visual.age + dt);
    }
    presented.push({
      ...projectile,
      x: projectile.x + projectile.vx * visual.age,
      y: projectile.y + projectile.vy * visual.age
    });
  }
  for (const projectileId of projectilePresentation.keys()) {
    if (!liveIds.has(projectileId)) projectilePresentation.delete(projectileId);
  }
  return presented;
}

function drawProjectiles(projectiles) {
  for (const projectile of projectiles) {
    if (['rocket', 'warhead', 'cluster', 'salvo'].includes(projectile.formId)) {
      const speed = Math.hypot(projectile.vx, projectile.vy) || 1;
      const trailLength = projectile.formId === 'warhead' ? 42 : projectile.formId === 'salvo' ? 27 : 34;
      const tail = project(projectile.x - projectile.vx / speed * trailLength, projectile.y - projectile.vy / speed * trailLength);
      const ember = project(projectile.x - projectile.vx / speed * 13, projectile.y - projectile.vy / speed * 13);
      const head = project(projectile.x, projectile.y);
      shapes.line(tail.x, tail.y, ember.x, ember.y, 1, COLOR.red);
      shapes.line(ember.x, ember.y, head.x, head.y, 2, COLOR.amber);
      const headRadiusX = projectile.formId === 'warhead' ? 4 : projectile.formId === 'salvo' ? 2 : 3;
      shapes.rect(head.x - headRadiusX, head.y - 2, headRadiusX * 2 + 1, 5, COLOR.black);
      shapes.rect(head.x - headRadiusX + 1, head.y - 1, Math.max(3, headRadiusX * 2 - 1), 3, projectile.formId === 'cluster' ? COLOR.amber : COLOR.red);
      if (projectile.formId === 'cluster') {
        shapes.rect(head.x - 3, head.y - 3, 2, 2, COLOR.red);
        shapes.rect(head.x + 2, head.y + 2, 2, 2, COLOR.red);
      }
      shapes.rect(head.x, head.y, 2, 1, COLOR.mint);
      continue;
    }
    if (projectile.formId === 'flechette') {
      const speed = Math.hypot(projectile.vx, projectile.vy) || 1;
      const tail = project(projectile.x - projectile.vx / speed * 34, projectile.y - projectile.vy / speed * 34);
      const head = project(projectile.x, projectile.y);
      shapes.line(tail.x, tail.y, head.x, head.y, 1, COLOR.amber);
      shapes.rect(head.x - 1, head.y - 1, 3, 3, COLOR.mint);
      shapes.rect(tail.x, tail.y, 1, 1, COLOR.cyan);
      continue;
    }
    const palette = ['tether', 'anchor', 'stasis', 'recall', 'dragnet'].includes(projectile.formId)
      ? { trail: COLOR.cyan, head: COLOR.mint }
      : ['knot', 'singularity', 'bond', 'braid'].includes(projectile.formId)
        ? { trail: COLOR.green, head: COLOR.cyan }
        : ['backwash', 'breaker', 'crosswind', 'breakwater'].includes(projectile.formId)
          ? { trail: COLOR.amber, head: COLOR.cyan }
          : projectile.formId === 'overclock'
            ? { trail: COLOR.amber, head: COLOR.green }
            : projectile.formId === 'forge'
              ? { trail: COLOR.amber, head: COLOR.mint }
              : projectile.formId === 'relay'
                ? { trail: COLOR.cyan, head: COLOR.green }
          : projectile.formId === 'network'
            ? { trail: COLOR.green, head: COLOR.cyan }
            : ['assault', 'barrage', 'broadside', 'cyclone'].includes(projectile.formId)
              ? { trail: COLOR.amber, head: COLOR.mint }
              : { trail: COLOR.amber, head: COLOR.cyan };
    const speed = Math.hypot(projectile.vx, projectile.vy) || 1;
    const tail = project(projectile.x - projectile.vx / speed * 22, projectile.y - projectile.vy / speed * 22);
    const head = project(projectile.x, projectile.y);
    shapes.line(tail.x, tail.y, head.x, head.y, 1, palette.trail);
    shapes.rect(head.x - 1, head.y - 1, 3, 3, palette.head);
  }
}

function drawClusterPayloads(fields, runTick) {
  for (const field of fields || []) {
    if (field.kind !== 'delayed_blast' || field.attack?.sourceFormId !== 'cluster') continue;
    if (![field.originX, field.originY, field.x, field.y].every(Number.isFinite)) continue;
    const durationTicks = Math.max(1, field.durationTicks || 1);
    const progress = Math.max(0, Math.min(1, (runTick - field.createdTick) / durationTicks));
    const previousProgress = Math.max(0, progress - 0.16);
    const head = project(
      field.originX + (field.x - field.originX) * progress,
      field.originY + (field.y - field.originY) * progress
    );
    const tail = project(
      field.originX + (field.x - field.originX) * previousProgress,
      field.originY + (field.y - field.originY) * previousProgress
    );
    shapes.line(tail.x, tail.y, head.x, head.y, 1, COLOR.amber);
    shapes.rect(head.x - 1, head.y - 1, 3, 3, COLOR.red);
    shapes.rect(head.x, head.y, 1, 1, COLOR.mint);
  }
}

function drawReworkedCombat(snapshot) {
  const state = snapshot.turretRework;
  if (!state) return;
  for (const shot of state.shots) {
    const p = project(shot.x, shot.y);
    const damage = ['pellet','nail','embedded','splinter','orbit'].includes(shot.type);
    const color = damage ? COLOR.amber : shot.type === 'gravity_seed' ? COLOR.mint : COLOR.cyan;
    const size = ['freeze_shell','gravity_seed','embedded'].includes(shot.type) ? 4 : 2;
    shapes.rect(p.x-size/2,p.y-size/2,size,size,color);
    if (shot.type === 'nail' || shot.type === 'splinter') shapes.line(p.x,p.y,p.x-shot.dx*7,p.y-shot.dy*7,1,color);
    if (shot.type === 'chain') drawWorldRing(shot.x,shot.y,7,COLOR.cyan);
  }
  for (const v of state.visuals) {
    if (v.x2 !== undefined) {
      const p=project(v.x,v.y), q=project(v.x2,v.y2);
      shapes.line(p.x,p.y,q.x,q.y,v.type === 'ray' ? 2 : 1,COLOR.cyan);
      if(v.type === 'ray') shapes.rect(q.x-2,q.y-2,4,4,COLOR.mint);
    } else {
      drawWorldRing(v.x,v.y,v.radius,v.type === 'gravity' ? COLOR.dimMint : COLOR.cyan);
      if(v.type === 'gravity') drawWorldRing(v.x,v.y,v.radius*((snapshot.runTick%30)/30),COLOR.cyan);
    }
  }
  // Enemy positions come from the already received swarm presentation.
  if (!state.chains.length) return;
  const presentation = session.presentation();
  const positions = new Map();
  for(let i=0;i<presentation.count;i++) {
    const id=presentation.ids?.[i] ?? presentation.idByIndex?.[i];
    if(id !== undefined) positions.set(id,{x:presentation.state[i*4],y:presentation.state[i*4+1]});
  }
  for(const chain of state.chains) for(let i=1;i<chain.members.length;i++) {
    const a=positions.get(chain.members[i-1].id), b=positions.get(chain.members[i].id);
    if(a&&b) drawDashedLink(project(a.x,a.y),project(b.x,b.y),COLOR.cyan);
  }
}

function drawControlFields(snapshot) {
  for (const field of snapshot.forceFields || []) {
    const fieldSelected = selectedTowerId === field.sourceTowerId;
    if (field.kind === 'barricade') {
      const a=project(field.x1,field.y1), b=project(field.x2,field.y2);
      shapes.line(a.x,a.y,b.x,b.y,Math.max(2,field.thickness*2/camera.scale),fieldSelected?COLOR.cyan:COLOR.dimMint);
      shapes.line(a.x,a.y,b.x,b.y,1,COLOR.black);
      continue;
    }
    const persistent = field.persistentControl === true;
    const durationTicks = Math.max(1, field.expiresTick - field.createdTick);
    const phase = persistent
      ? (snapshot.runTick % Math.max(1, field.periodTicks || 120)) / Math.max(1, field.periodTicks || 120)
      : Math.max(0, Math.min(1, (snapshot.runTick - field.createdTick) / durationTicks));
    if (!persistent && phase >= 1) continue;
    const center = project(field.x, field.y);
    // Ambient battlefield rendering stays subdued; the selected tower gets the brighter preview.
    const activeColor = !fieldSelected && persistent ? COLOR.dimMint : persistent || phase < 0.72 ? COLOR.cyan : COLOR.dimMint;
    const ringColor = fieldSelected ? COLOR.cyan : COLOR.dimMint;

    if (field.kind === 'stasis_zone') {
      const pulsePhase = (snapshot.runTick % field.periodTicks) / field.periodTicks;
      const freezing = snapshot.runTick % field.periodTicks < field.durationTicks
        && snapshot.runTick - snapshot.runTick % field.periodTicks >= field.activeFromTick;
      drawWorldRing(field.x, field.y, field.radius, ringColor);
      drawWorldRing(field.x, field.y, field.radius * (0.22 + pulsePhase * 0.72), freezing ? COLOR.mint : COLOR.dimMint);
      const radiusPixels = Math.max(4, Math.round(field.radius / camera.scale));
      for (const angle of [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5]) {
        const outerX = center.x + Math.round(Math.cos(angle) * radiusPixels);
        const outerY = center.y + Math.round(Math.sin(angle) * radiusPixels);
        const innerX = center.x + Math.round(Math.cos(angle) * (radiusPixels - 7));
        const innerY = center.y + Math.round(Math.sin(angle) * (radiusPixels - 7));
        shapes.line(outerX, outerY, innerX, innerY, freezing ? 2 : 1, freezing ? COLOR.amber : COLOR.dimMint);
      }
      shapes.rect(center.x - 1, center.y - 1, 3, 3, COLOR.amber);
      continue;
    }

    if (field.kind === 'recall_gate') {
      const first = project(field.x1, field.y1);
      const second = project(field.x2, field.y2);
      shapes.line(first.x, first.y, second.x, second.y, 3, COLOR.amber);
      shapes.line(first.x, first.y, second.x, second.y, 1, COLOR.cyan);
      for (let index = 0; index < 7; index += 1) {
        const travel = ((index / 7) + phase) % 1;
        const marker = project(field.x1 + (field.x2 - field.x1) * travel, field.y1 + (field.y2 - field.y1) * travel);
        shapes.rect(marker.x - 1, marker.y - 1, 3, 3, index % 2 ? COLOR.mint : COLOR.amber);
      }
      continue;
    }

    if (field.kind === 'slow_field') {
      drawWorldRing(field.x, field.y, field.radius, ringColor);
      // Ambient net stays a faint centre mark; the full crosshatch net only shows for the selected tower.
      const radiusPixels = Math.max(3, Math.round(field.radius / camera.scale));
      const offsets = fieldSelected ? [-0.5, 0, 0.5] : [0];
      for (const offsetFraction of offsets) {
        const offset = Math.round(radiusPixels * offsetFraction);
        const span = Math.round(Math.sqrt(Math.max(0, radiusPixels * radiusPixels - offset * offset)) * 0.82);
        const lineColor = offset === 0 && fieldSelected ? COLOR.mint : COLOR.dimMint;
        shapes.line(center.x + offset, center.y - span, center.x + offset, center.y + span, 1, lineColor);
        shapes.line(center.x - span, center.y + offset, center.x + span, center.y + offset, 1, lineColor);
      }
      continue;
    }

    if (field.kind === 'radial_force') {
      const singularity = field.sourceFormId === 'singularity';
      const pulse = singularity ? 1 - phase * 0.45 : 1 - phase * 0.25;
      drawWorldRing(field.x, field.y, field.radius * pulse, fieldSelected ? (singularity ? COLOR.green : activeColor) : COLOR.dimMint);
      drawWorldRing(field.x, field.y, Math.max(6, field.radius * pulse * 0.48), fieldSelected ? (singularity ? COLOR.cyan : COLOR.green) : COLOR.dimMint);
      const reach = Math.max(3, Math.round(field.radius * pulse / camera.scale));
      const inset = singularity ? Math.max(2, Math.round(reach * 0.18)) : 2;
      const spokeColor = fieldSelected ? COLOR.mint : COLOR.dimMint;
      shapes.line(center.x - reach, center.y, center.x - inset, center.y, singularity && fieldSelected ? 2 : 1, spokeColor);
      shapes.line(center.x + reach, center.y, center.x + inset, center.y, singularity && fieldSelected ? 2 : 1, spokeColor);
      shapes.line(center.x, center.y - reach, center.x, center.y - inset, singularity && fieldSelected ? 2 : 1, spokeColor);
      shapes.line(center.x, center.y + reach, center.x, center.y + inset, singularity && fieldSelected ? 2 : 1, spokeColor);
      shapes.rect(center.x - 1, center.y - 1, 3, 3, singularity ? COLOR.amber : COLOR.cyan);
      continue;
    }

    if (field.kind === 'singularity_force') {
      const pulseTick = snapshot.runTick % field.periodTicks;
      const active = pulseTick < field.activeTicks;
      const pulse = active ? 1 - pulseTick / Math.max(1, field.activeTicks) * 0.62 : 1;
      drawWorldRing(field.x, field.y, field.radius, active ? COLOR.green : COLOR.dimMint);
      drawWorldRing(field.x, field.y, field.radius * (active ? pulse : 0.22), active ? COLOR.cyan : COLOR.dimMint);
      const reach = Math.max(4, Math.round(field.radius * (active ? pulse : 0.35) / camera.scale));
      for (const axis of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        shapes.line(center.x + axis[0] * reach, center.y + axis[1] * reach, center.x + axis[0] * 3, center.y + axis[1] * 3, active ? 2 : 1, active ? COLOR.mint : COLOR.dimMint);
      }
      shapes.rect(center.x - 2, center.y - 2, 5, 5, COLOR.black);
      shapes.rect(center.x - 1, center.y - 1, 3, 3, active ? COLOR.amber : COLOR.green);
      continue;
    }

    if (field.kind === 'bond_zone') {
      const active = snapshot.runTick % field.periodTicks < field.durationTicks
        && snapshot.runTick - snapshot.runTick % field.periodTicks >= field.activeFromTick;
      const selected = selectedTowerId === field.sourceTowerId;
      if (selected || showAllRanges) drawWorldRing(field.x, field.y, field.radius, active ? COLOR.green : COLOR.dimMint);
      // Sparse paired pips, not a web of thousands of opaque connections.
      if (active) {
        const pulseRadius = field.radius * (0.85 + phase * 0.3);
        for (const side of [-1, 1]) {
          const pip = project(field.x + side * pulseRadius * 0.65, field.y - pulseRadius * 0.55);
          shapes.rect(pip.x - 2, pip.y, 2, 2, COLOR.green);
          shapes.rect(pip.x + 1, pip.y, 2, 2, COLOR.mint);
        }
      }
      continue;
    }

    if (field.kind === 'vortex_force') {
      drawWorldRing(field.x, field.y, field.radius, fieldSelected && phase < 0.75 ? COLOR.green : COLOR.dimMint);
      drawWorldRing(field.x, field.y, field.radius * 0.45, ringColor);
      const orbitRadius = field.radius * (0.68 - phase * 0.12);
      const spin = field.spin || 1;
      for (let index = 0; index < 6; index += 1) {
        const angle = spin * phase * Math.PI * 4 + index * Math.PI / 3;
        const satellite = project(field.x + Math.cos(angle) * orbitRadius, field.y + Math.sin(angle) * orbitRadius);
        shapes.rect(satellite.x - 1, satellite.y - 1, 3, 3, index % 2 ? COLOR.dimMint : (fieldSelected ? COLOR.mint : COLOR.dimMint));
      }
      shapes.rect(center.x - 1, center.y - 1, 3, 3, COLOR.amber);
      continue;
    }

    if (field.kind === 'pinch_force') {
      drawWorldRing(field.x, field.y, field.radius, fieldSelected && phase < 0.75 ? COLOR.green : COLOR.dimMint);
      const perpendicularX = -field.axisY;
      const perpendicularY = field.axisX;
      const axisFrom = project(field.x - field.axisX * field.radius, field.y - field.axisY * field.radius);
      const axisTo = project(field.x + field.axisX * field.radius, field.y + field.axisY * field.radius);
      drawDashedLink(axisFrom, axisTo, COLOR.dimMint);
      for (const side of [-1, 1]) {
        const outside = project(
          field.x + perpendicularX * field.radius * 0.72 * side,
          field.y + perpendicularY * field.radius * 0.72 * side
        );
        const inside = project(
          field.x + perpendicularX * field.radius * 0.12 * side,
          field.y + perpendicularY * field.radius * 0.12 * side
        );
        shapes.line(outside.x, outside.y, inside.x, inside.y, fieldSelected ? 2 : 1, fieldSelected ? (side < 0 ? COLOR.cyan : COLOR.mint) : COLOR.dimMint);
        shapes.rect(outside.x - 2, outside.y - 2, 5, 5, COLOR.amber);
      }
      continue;
    }

    if (field.kind === 'braid_force') {
      const first = project(field.x1, field.y1);
      const second = project(field.x2, field.y2);
      const nx = field.normalX * field.width * 0.5;
      const ny = field.normalY * field.width * 0.5;
      const edgeA1 = project(field.x1 + nx, field.y1 + ny);
      const edgeA2 = project(field.x2 + nx, field.y2 + ny);
      const edgeB1 = project(field.x1 - nx, field.y1 - ny);
      const edgeB2 = project(field.x2 - nx, field.y2 - ny);
      shapes.line(edgeA1.x, edgeA1.y, edgeA2.x, edgeA2.y, fieldSelected ? 2 : 1, fieldSelected ? COLOR.green : COLOR.dimMint);
      shapes.line(edgeB1.x, edgeB1.y, edgeB2.x, edgeB2.y, fieldSelected ? 2 : 1, fieldSelected ? COLOR.cyan : COLOR.dimMint);
      drawDashedLink(first, second, fieldSelected ? COLOR.mint : COLOR.dimMint);
      for (const travel of [0.18, 0.5, 0.82]) {
        const midX = field.x1 + (field.x2 - field.x1) * travel;
        const midY = field.y1 + (field.y2 - field.y1) * travel;
        const outsideA = project(midX + nx * 0.85, midY + ny * 0.85);
        const outsideB = project(midX - nx * 0.85, midY - ny * 0.85);
        const middle = project(midX, midY);
        shapes.line(outsideA.x, outsideA.y, middle.x, middle.y, 1, COLOR.amber);
        shapes.line(outsideB.x, outsideB.y, middle.x, middle.y, 1, COLOR.amber);
      }
      continue;
    }

    if (field.kind === 'splitter_force') {
      const first = project(field.x1, field.y1);
      const second = project(field.x2, field.y2);
      drawDashedLink(first, second, COLOR.dimMint);
      const normalX = -field.axisY;
      const normalY = field.axisX;
      for (const side of [-1, 1]) {
        const start = project(field.x + field.axisX * side * 8, field.y + field.axisY * side * 8);
        const endX = field.x + field.axisX * field.halfLength * side;
        const endY = field.y + field.axisY * field.halfLength * side;
        const end = project(endX, endY);
        shapes.line(start.x, start.y, end.x, end.y, 1, fieldSelected ? COLOR.amber : COLOR.dimMint);
        for (const wing of [-1, 1]) {
          const tip = project(endX - field.axisX * side * 13 + normalX * wing * 9, endY - field.axisY * side * 13 + normalY * wing * 9);
          shapes.line(end.x, end.y, tip.x, tip.y, 1, fieldSelected ? COLOR.mint : COLOR.dimMint);
          const edgeStart = project(field.x1 + normalX * field.thickness * wing, field.y1 + normalY * field.thickness * wing);
          const edgeEnd = project(field.x2 + normalX * field.thickness * wing, field.y2 + normalY * field.thickness * wing);
          if (side === 1) drawDashedLink(edgeStart, edgeEnd, COLOR.dimMint);
        }
      }
      shapes.rect(center.x - 1, center.y - 2, 3, 5, COLOR.cyan);
      continue;
    }

    if (field.kind === 'force_wall') {
      const wallFrom = project(
        field.x - field.wallAxisX * field.halfLength,
        field.y - field.wallAxisY * field.halfLength
      );
      const wallTo = project(
        field.x + field.wallAxisX * field.halfLength,
        field.y + field.wallAxisY * field.halfLength
      );
      const screenOffsetX = Math.round((field.wallNormalX ?? field.pushX) * field.thickness / camera.scale);
      const screenOffsetY = Math.round((field.wallNormalY ?? field.pushY) * field.thickness / camera.scale);
      shapes.line(wallFrom.x - screenOffsetX, wallFrom.y - screenOffsetY, wallTo.x - screenOffsetX, wallTo.y - screenOffsetY, fieldSelected ? 2 : 1, fieldSelected ? COLOR.amber : COLOR.dimMint);
      shapes.line(wallFrom.x + screenOffsetX, wallFrom.y + screenOffsetY, wallTo.x + screenOffsetX, wallTo.y + screenOffsetY, fieldSelected ? 2 : 1, fieldSelected ? activeColor : COLOR.dimMint);
      drawDashedLink(wallFrom, wallTo, fieldSelected ? COLOR.mint : COLOR.dimMint);
      for (const along of [-0.55, 0, 0.55]) {
        const arrowStart = project(
          field.x + field.wallAxisX * field.halfLength * along - field.pushX * field.thickness,
          field.y + field.wallAxisY * field.halfLength * along - field.pushY * field.thickness
        );
        const arrowEnd = project(
          field.x + field.wallAxisX * field.halfLength * along + field.pushX * field.thickness * 1.8,
          field.y + field.wallAxisY * field.halfLength * along + field.pushY * field.thickness * 1.8
        );
        shapes.line(arrowStart.x, arrowStart.y, arrowEnd.x, arrowEnd.y, 1, fieldSelected ? COLOR.cyan : COLOR.dimMint);
      }
      continue;
    }

    if (field.kind === 'breaker_wave') {
      const pulseTick = snapshot.runTick % field.periodTicks;
      if (pulseTick >= field.travelTicks) continue;
      const travel = pulseTick / Math.max(1, field.travelTicks - 1);
      const waveX = field.x + field.directionX * field.range * travel;
      const waveY = field.y + field.directionY * field.range * travel;
      const perpendicularX = -field.directionY;
      const perpendicularY = field.directionX;
      const first = project(waveX - perpendicularX * field.halfWidth, waveY - perpendicularY * field.halfWidth);
      const second = project(waveX + perpendicularX * field.halfWidth, waveY + perpendicularY * field.halfWidth);
      shapes.line(first.x, first.y, second.x, second.y, 4, COLOR.amber);
      shapes.line(first.x, first.y, second.x, second.y, 2, COLOR.mint);
      const rear = project(waveX - field.directionX * field.waveThickness, waveY - field.directionY * field.waveThickness);
      const front = project(waveX + field.directionX * field.waveThickness, waveY + field.directionY * field.waveThickness);
      shapes.line(rear.x, rear.y, front.x, front.y, 2, COLOR.cyan);
      continue;
    }

    if (field.kind === 'crosswind_force') {
      drawWorldRing(field.x, field.y, field.radius, ringColor);
      const perpendicularX = -field.directionY;
      const perpendicularY = field.directionX;
      for (const offset of fieldSelected ? [-0.48, 0, 0.48] : [0]) {
        const start = project(
          field.x + perpendicularX * field.radius * offset - field.directionX * field.radius * 0.48,
          field.y + perpendicularY * field.radius * offset - field.directionY * field.radius * 0.48
        );
        const end = project(
          field.x + perpendicularX * field.radius * offset + field.directionX * field.radius * 0.48,
          field.y + perpendicularY * field.radius * offset + field.directionY * field.radius * 0.48
        );
        shapes.line(start.x, start.y, end.x, end.y, offset === 0 && fieldSelected ? 2 : 1, offset === 0 ? (fieldSelected ? COLOR.mint : COLOR.dimMint) : COLOR.amber);
      }
      continue;
    }

    if (field.kind === 'directional_force') {
      const breaker = field.sourceFormId === 'breaker';
      drawWorldRing(field.x, field.y, field.radius, fieldSelected ? (breaker ? COLOR.amber : activeColor) : COLOR.dimMint);
      const perpendicularX = -field.directionY;
      const perpendicularY = field.directionX;
      const lineCount = breaker ? 5 : 3;
      for (let index = 0; index < lineCount; index += 1) {
        const offset = (index - (lineCount - 1) * 0.5) * (breaker ? 10 : 7);
        const start = project(
          field.x + perpendicularX * offset - field.directionX * field.radius * 0.18,
          field.y + perpendicularY * offset - field.directionY * field.radius * 0.18
        );
        const end = project(
          field.x + perpendicularX * offset + field.directionX * field.radius * (0.45 + phase * 0.38),
          field.y + perpendicularY * offset + field.directionY * field.radius * (0.45 + phase * 0.38)
        );
        shapes.line(start.x, start.y, end.x, end.y, breaker && index === 2 && fieldSelected ? 2 : 1, !fieldSelected ? COLOR.dimMint : index % 2 ? COLOR.amber : COLOR.mint);
      }
    }
  }
}

function drawSelectedBondLinks(snapshot, frame) {
  if (!selectedTowerId || !frame.bondPartnerById) return;
  const field = snapshot.forceFields?.find((candidate) => candidate.kind === 'bond_zone' && candidate.sourceTowerId === selectedTowerId);
  if (!field || snapshot.runTick % field.periodTicks >= field.durationTicks) return;
  const source = frame.bondSourceIds.indexOf(selectedTowerId);
  if (source < 1) return;
  let drawn = 0;
  // A small visual sample only. Every valid pair still participates in combat.
  for (let index = 0; index < frame.count && drawn < 24; index += 1) {
    const id = frame.idByIndex[index];
    const partner = frame.bondPartnerById[id];
    if (partner <= id || frame.bondSourceById[id] !== source || frame.bondUntilById[id] <= frame.tick) continue;
    const partnerIndex = frame.indexById[partner];
    if (partnerIndex < 0) continue;
    const a = project(frame.state[index * 4], frame.state[index * 4 + 1]);
    const b = project(frame.state[partnerIndex * 4], frame.state[partnerIndex * 4 + 1]);
    if ((a.x < 0 && b.x < 0) || (a.x >= logicalWidth && b.x >= logicalWidth)
      || (a.y < HUD_TOP_HEIGHT && b.y < HUD_TOP_HEIGHT) || (a.y >= hudBottomY && b.y >= hudBottomY)) continue;
    shapes.line(a.x, a.y, b.x, b.y, 1, COLOR.dimMint);
    shapes.rect(a.x, a.y, 1, 1, COLOR.green);
    shapes.rect(b.x, b.y, 1, 1, COLOR.green);
    drawn += 1;
  }
}

function addAttackFlash(event) {
  const payload = event.payload;
  const geometry = payload.geometry;
  if (payload.sourceFormId === 'sweeper') return;
  if (['laser', 'cutter', 'prism'].includes(payload.sourceFormId) && geometry?.type === 'line'
    && [geometry.x1, geometry.y1, geometry.x2, geometry.y2].every(Number.isFinite)) {
    attackFlashes.push({
      kind: 'laser',
      age: 0,
      formId: payload.sourceFormId,
      beamIndex: geometry.beamIndex || 0,
      x1: geometry.x1,
      y1: geometry.y1,
      x2: geometry.x2,
      y2: geometry.y2,
      width: geometry.width || 10
    });
  } else if (['rocket', 'warhead', 'cluster', 'salvo'].includes(payload.sourceFormId) && geometry?.type === 'circle'
    && Number.isFinite(payload.x) && Number.isFinite(payload.y)) {
    attackFlashes.push({
      kind: 'rocket',
      age: 0,
      x: payload.x,
      y: payload.y,
      radius: geometry.radius || 64
    });
  }
}

function addSupportFlash(event) {
  if (event.payload.type !== 'kill_income' || !Number.isFinite(event.payload.x) || !Number.isFinite(event.payload.y)) return;
  const flash = {
    kind: 'forge',
    age: 0,
    sourceTowerId: event.payload.sourceTowerId,
    x: event.payload.x,
    y: event.payload.y,
    credits: event.payload.credits || 1
  };
  const existing = attackFlashes.findIndex((candidate) => candidate.kind === 'forge' && candidate.sourceTowerId === flash.sourceTowerId);
  if (existing >= 0) attackFlashes[existing] = flash;
  else attackFlashes.push(flash);
}

function drawAttackFlashes(dt) {
  let write = 0;
  for (const flash of attackFlashes) {
    flash.age += dt;
    if (flash.kind === 'laser') {
      if (!drawLaserPulse(shapes, COLOR, project, camera.scale, flash)) continue;
    } else if (flash.kind === 'rocket') {
      if (flash.age >= 0.3) continue;
      const progress = Math.min(1, flash.age / 0.16);
      const radius = flash.radius * progress;
      drawWorldRing(flash.x, flash.y, radius, flash.age < 0.12 ? COLOR.amber : COLOR.red);
      if (radius > 14) drawWorldRing(flash.x, flash.y, Math.max(4, radius - 12), flash.age < 0.08 ? COLOR.mint : COLOR.amber);
      const center = project(flash.x, flash.y);
      const cross = flash.age < 0.1 ? 4 : 2;
      shapes.rect(center.x - cross, center.y, cross * 2 + 1, 1, COLOR.red);
      shapes.rect(center.x, center.y - cross, 1, cross * 2 + 1, COLOR.red);
    } else if (flash.kind === 'knot') {
      if (flash.age >= flash.duration) continue;
      const phase = Math.min(1, flash.age / flash.duration);
      const radius = flash.radius * (1 - phase * 0.3);
      drawWorldRing(flash.x, flash.y, radius, phase < 0.55 ? COLOR.green : COLOR.dimMint);
      if (phase < 0.45) drawWorldRing(flash.x, flash.y, Math.max(8, radius * 0.55), COLOR.cyan);
      const center = project(flash.x, flash.y);
      const reach = Math.max(2, Math.round(radius / camera.scale));
      shapes.rect(center.x - reach, center.y, 3, 1, COLOR.mint);
      shapes.rect(center.x + reach - 2, center.y, 3, 1, COLOR.mint);
      shapes.rect(center.x, center.y - reach, 1, 3, COLOR.mint);
      shapes.rect(center.x, center.y + reach - 2, 1, 3, COLOR.mint);
    } else if (flash.kind === 'backwash') {
      if (flash.age >= flash.duration) continue;
      const phase = Math.min(1, flash.age / flash.duration);
      drawWorldRing(flash.x, flash.y, flash.radius, phase < 0.5 ? COLOR.amber : COLOR.dimMint);
      const center = project(flash.x, flash.y);
      const endpoint = project(
        flash.x + flash.directionX * flash.radius * (0.45 + phase * 0.45),
        flash.y + flash.directionY * flash.radius * (0.45 + phase * 0.45)
      );
      const perpendicularX = -flash.directionY;
      const perpendicularY = flash.directionX;
      for (const offset of [-5, 0, 5]) {
        const ox = Math.round(perpendicularX * offset);
        const oy = Math.round(perpendicularY * offset);
        shapes.line(center.x + ox, center.y + oy, endpoint.x + ox, endpoint.y + oy, 1, offset === 0 ? COLOR.mint : COLOR.amber);
      }
    } else if (flash.kind === 'forge') {
      if (flash.age >= 0.5) continue;
      const phase = Math.min(1, flash.age / 0.5);
      const radius = 8 + phase * 30;
      drawWorldRing(flash.x, flash.y, radius, phase < 0.55 ? COLOR.amber : COLOR.dimMint);
      const center = project(flash.x, flash.y);
      shapes.rect(center.x - 4, center.y, 9, 1, COLOR.green);
      shapes.rect(center.x, center.y - 4, 1, 9, COLOR.green);
      bitmapText.draw(`+${compactMetric(flash.credits)}`, center.x + 7, center.y - 10 - Math.round(phase * 5), COLOR.amber, 1);
    }
    attackFlashes[write++] = flash;
  }
  attackFlashes.length = write;
}

function startRelayCollapse(event) {
  const links = event.payload.retired
    .map((record) => ({ ...record, target: record.targetAreaId ? defenseAreaCenterById(record.targetAreaId) : null }));
  relayCollapse = { startedTick: event.payload.tick ?? sessionSnapshot.runTick,
    links, areaIds: event.payload.areaIds || [], mapId: currentMap.id };
}

function drawRelayCollapse(snapshot) {
  if (!relayCollapse) return;
  const age = (snapshot.runTick - relayCollapse.startedTick) / AUTHORITY_TICK_RATE;
  if (age < 0 || age >= RELAY_COLLAPSE_SECONDS || relayCollapse.mapId !== currentMap.id || reducedNetworkMotion.matches) {
    relayCollapse = null;
    return;
  }
  const scale = towerScreenBounds('relay', camera.scale).scale;
  for (const record of relayCollapse.links) {
    const from = project(record.x, record.y);
    if (from.x < -80 || from.x > logicalWidth + 80 || from.y < -80 || from.y > logicalHeight + 80) continue;
    const palette = relayColors(record.areaId);
    const box = (x, y, w, h, color) => shapes.rect(from.x + x * scale, from.y + y * scale, w * scale, h * scale, color);
    const seed = hashString32(record.towerId);
    const collapse = Math.min(1, age / 0.5);
    const mastHeight = Math.round(15 * (1 - collapse));
    if (mastHeight > 0) {
      box(0, -8 + (15 - mastHeight), 1, mastHeight, collapse < 0.5 ? palette.focus : palette.link);
      box(-5 + Math.round(collapse * 4), 4, 11 - Math.round(collapse * 8), 2, palette.pulse);
    }
    if (collapse >= 1) {
      const fade = Math.max(0, 1 - (age - 0.5) / 0.6);
      const halo = Math.round(2 + (1 - fade) * 6);
      if (fade > 0) {
        box(-halo, 0, 2, 1, fade > 0.5 ? palette.pulse : palette.link);
        box(halo - 1, 0, 2, 1, fade > 0.5 ? palette.pulse : palette.link);
        box(0, -halo, 1, 2, fade > 0.5 ? palette.pulse : palette.link);
        box(0, halo - 1, 1, 2, fade > 0.5 ? palette.pulse : palette.link);
      }
    }
    if (!record.target) continue;
    const to = project(record.target.x, record.target.y);
    for (let packet = 0; packet < 8; packet += 1) {
      const start = 0.3 + packet * 0.11 + ((seed >>> (packet * 3)) & 7) * 0.01;
      const progress = (age - start) / 0.75;
      if (progress < 0 || progress >= 1) continue;
      const eased = progress * progress * (3 - 2 * progress);
      const wobble = (((seed >>> packet) & 3) - 1.5) * (1 - eased);
      const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy) || 1;
      const x = Math.round(from.x + dx * eased - dy / length * wobble);
      const y = Math.round(from.y + dy * eased + dx / length * wobble);
      const size = progress < 0.85 ? 2 : 1;
      shapes.rect(x, y, size, size, packet % 3 === 0 ? palette.focus : palette.pulse);
    }
  }
  const ringAge = age - 1.2;
  if (ringAge >= 0) {
    for (const areaId of relayCollapse.areaIds) {
      const center = defenseAreaCenterById(areaId);
      if (!center) continue;
      const area = currentMap.defenseAreas.find((candidate) => candidate.id === areaId);
      const reach = Math.max(area?.shape.radiusX || 60, area?.shape.radiusY || 40) * 0.9;
      const radius = Math.max(4, reach * Math.min(1, ringAge / 0.8));
      const palette = relayColors(areaId);
      drawWorldRing(center.x, center.y, radius, ringAge < 0.4 ? palette.pulse : palette.link);
    }
  }
}

function addImpactBurst(event) {
  if (!Number.isFinite(event.payload.x) || !Number.isFinite(event.payload.y)) return;
  impactBursts.push({
    x: event.payload.x,
    y: event.payload.y,
    age: 0,
    seed: event.payload.enemyId || 1,
    sourceFormId: event.payload.sourceFormId,
    controlTargets: event.payload.controlTargets || []
  });
}

function drawImpactBursts(dt) {
  let write = 0;
  for (const burst of impactBursts) {
    burst.age += dt;
    if (burst.age >= 0.22) continue;
    const p = project(burst.x, burst.y);
    const radius = 1 + Math.floor(burst.age * 38);
    const alternate = burst.seed & 1;
    const anchorFamily = ['tether', 'anchor', 'stasis', 'recall', 'dragnet'].includes(burst.sourceFormId);
    const knotFamily = ['knot', 'singularity', 'bond', 'braid'].includes(burst.sourceFormId);
    const color = anchorFamily
      ? (burst.sourceFormId === 'recall' ? COLOR.amber : burst.age < 0.1 ? COLOR.cyan : COLOR.green)
      : knotFamily
        ? (burst.age < 0.1 ? COLOR.green : COLOR.cyan)
        : (burst.age < 0.08 ? COLOR.mint : COLOR.red);
    const controlColor = burst.sourceFormId === 'recall'
      ? COLOR.amber
      : burst.sourceFormId === 'stasis'
        ? COLOR.mint
        : COLOR.cyan;
    for (const target of burst.controlTargets.slice(0, 4)) {
      const endpoint = project(target.x, target.y);
      shapes.line(p.x, p.y, endpoint.x, endpoint.y, 1, controlColor);
      shapes.rect(endpoint.x - 1, endpoint.y - 1, 3, 3, controlColor);
    }
    shapes.rect(p.x - radius, p.y + alternate, 2, 1, color);
    shapes.rect(p.x + radius - 1, p.y - alternate, 2, 1, color);
    shapes.rect(p.x + alternate, p.y - radius, 1, 2, color);
    shapes.rect(p.x - alternate, p.y + radius - 1, 1, 2, color);
    impactBursts[write++] = burst;
  }
  impactBursts.length = write;
}

// Arena maps are enclosed on every side: the same hazard-striped wall frames all four
// edges because pressure arrives from every direction instead of over a southern wall.
function drawArenaFrame(map) {
  const topLeft = project(map.bounds.left, map.bounds.top);
  const bottomRight = project(map.bounds.right, map.bounds.bottom);
  const left = Math.round(topLeft.x), top = Math.round(topLeft.y);
  const right = Math.round(bottomRight.x), bottom = Math.round(bottomRight.y);
  const x0 = Math.max(0, left), x1 = Math.min(logicalWidth, right);
  const y0 = Math.max(0, top), y1 = Math.min(logicalHeight, bottom);
  if (x1 <= x0 || y1 <= y0) return;
  if (bottom <= logicalHeight) {
    shapes.rect(x0, bottom - 3, x1 - x0, 3, COLOR.dimMint);
    for (let x = x0 - ((x0 - left) % 24); x < x1; x += 24) shapes.rect(Math.max(x0, x), bottom - 3, 12, 1, COLOR.amber);
  }
  if (top >= 0) {
    shapes.rect(x0, top, x1 - x0, 3, COLOR.dimMint);
    for (let x = x0 - ((x0 - left) % 24); x < x1; x += 24) shapes.rect(Math.max(x0, x), top + 2, 12, 1, COLOR.amber);
  }
  if (left >= 0) {
    shapes.rect(left, y0, 3, y1 - y0, COLOR.dimMint);
    for (let y = y0 - ((y0 - top) % 24); y < y1; y += 24) shapes.rect(left + 2, Math.max(y0, y), 1, 12, COLOR.amber);
  }
  if (right <= logicalWidth) {
    shapes.rect(right - 3, y0, 3, y1 - y0, COLOR.dimMint);
    for (let y = y0 - ((y0 - top) % 24); y < y1; y += 24) shapes.rect(right - 3, Math.max(y0, y), 1, 12, COLOR.amber);
  }
}

// Pixelated world-space ring. The visible result is the classic midpoint circle (one
// pixel thick, eight-way symmetric); the pixels themselves are selected on the GPU.
function drawWorldRing(x, y, radius, color) {
  const pixelRadius = Math.max(1, Math.round(radius / camera.scale));
  shapes.ring((x - camera.x) / camera.scale + logicalWidth * 0.5, (y - camera.y) / camera.scale + logicalHeight * 0.5, pixelRadius, color);
}

function drawAreaTargetBrackets(area, color) {
  const bounds = defenseAreaBounds(area, 4);
  const upperLeft = project(bounds.left, bounds.top);
  const lowerRight = project(bounds.right, bounds.bottom);
  const left = Math.min(upperLeft.x, lowerRight.x);
  const right = Math.max(upperLeft.x, lowerRight.x);
  const top = Math.min(upperLeft.y, lowerRight.y);
  const bottom = Math.max(upperLeft.y, lowerRight.y);
  const corner = 5;
  shapes.line(left, top, left + corner, top, 1, color);
  shapes.line(left, top, left, top + corner, 1, color);
  shapes.line(right - corner, top, right, top, 1, color);
  shapes.line(right, top, right, top + corner, 1, color);
  shapes.line(left, bottom, left + corner, bottom, 1, color);
  shapes.line(left, bottom - corner, left, bottom, 1, color);
  shapes.line(right - corner, bottom, right, bottom, 1, color);
  shapes.line(right, bottom - corner, right, bottom, 1, color);
}

function drawRelayTargetOverlay(snapshot, tower) {
  const definition = snapshot.towerCatalog.find((candidate) => candidate.id === tower.definitionId);
  const linkRange = definition?.linkRange || 0;
  const candidates = relayCandidateAreas(snapshot, tower);
  const pointerWorld = unproject(pointer.x, pointer.y);
  const hoveredAreaId = findDefenseAreaAt(currentMap, pointerWorld.x, pointerWorld.y);
  const from = project(tower.x, tower.y);
  if (linkRange > 0) drawWorldRing(tower.x, tower.y, linkRange, COLOR.cyan);
  for (const area of candidates) {
    const selected = area.id === tower.relayTargetAreaId;
    const hovered = area.id === hoveredAreaId;
    const palette = relayColors(area.id);
    const color = hovered ? palette.glint : selected ? COLOR.amber : palette.focus;
    const center = project(area.shape.x, area.shape.y);
    drawAreaTargetBrackets(area, color);
    shapes.rect(center.x - 2, center.y - 2, 5, 5, COLOR.black);
    shapes.rect(center.x - 1, center.y - 1, 3, 3, color);
    if (hovered || selected) drawDashedLink(from, center, color);
  }
}

function strikeAttackForDisplay(tower, definition) {
  return {
    ...definition.attack,
    range: tower.effectiveRange || definition.range || 0
  };
}

function drawStrikePointPattern(tower, definition, point, color) {
  const attack = strikeAttackForDisplay(tower, definition);
  if (attack.mechanic === 'shotgun') {
    // Broadside aims a facing, not an impact: show the fan edges and centre line.
    const from = project(tower.x, tower.y), range = attack.range;
    const angle = Math.atan2(point.y - tower.y, point.x - tower.x);
    const half = (attack.rework?.fanRadians || 1.3) * 0.5;
    for (const offset of [-half, 0, half]) {
      drawDashedLink(from, project(tower.x + Math.cos(angle + offset) * range, tower.y + Math.sin(angle + offset) * range), color);
    }
    const tip = project(tower.x + Math.cos(angle) * range * 0.6, tower.y + Math.sin(angle) * range * 0.6);
    shapes.rect(tip.x - 1, tip.y - 1, 3, 3, color);
    return;
  }
  if (['hitscan','persistent'].includes(attack.delivery.type)) {
    const from=project(tower.x,tower.y),range=attack.range;
    const angle=Math.atan2(point.y-tower.y,point.x-tower.x);
    const count=attack.volley.count||1;
    const angles=attack.delivery.motion==='sweep' ? [-.5,0,.5].map((offset)=>angle+offset*attack.delivery.sweepRadians)
      : Array.from({length:count},(_,i)=>angle+(i-(count-1)/2)*.12);
    for(const theta of angles) drawDashedLink(from,project(tower.x+Math.cos(theta)*range,tower.y+Math.sin(theta)*range),color);
    return;
  }
  const impacts = strikeImpactPoints(tower, attack, point);
  const radius = Math.max(1, attack.geometry?.radius || 1);
  const towerPoint = project(tower.x, tower.y);
  const center = project(point.x, point.y);
  drawDashedLink(towerPoint, center, color);
  for (const impact of impacts) {
    drawWorldRing(impact.x, impact.y, radius, color);
    const marker = project(impact.x, impact.y);
    shapes.rect(marker.x - 4, marker.y, 9, 1, color);
    shapes.rect(marker.x, marker.y - 4, 1, 9, color);
    shapes.rect(marker.x - 1, marker.y - 1, 3, 3, COLOR.black);
    shapes.rect(marker.x, marker.y, 1, 1, color);
  }
}

function drawStrikeTargetOverlay(snapshot, tower) {
  const definition = weaponView(snapshot, tower);
  if (!supportsStrikePoint(definition?.attack)) return;
  const range = tower.effectiveRange || definition.range || 0;
  drawWorldRing(tower.x, tower.y, range, COLOR.cyan);
  if (tower.strikePoint) drawStrikePointPattern(tower, definition, tower.strikePoint, COLOR.amber);
  if (pointer.y <= HUD_TOP_HEIGHT || pointer.y >= hudBottomY) return;
  const world = unproject(pointer.x, pointer.y);
  const valid = Math.hypot(world.x - tower.x, world.y - tower.y) <= range;
  drawStrikePointPattern(tower, definition, world, valid ? COLOR.mint : COLOR.red);
}

function drawControlDirectionArrow(tower, direction, length, color) {
  const rawX = direction?.dx ?? direction?.x ?? 0;
  const rawY = direction?.dy ?? direction?.y ?? 0;
  const directionLength = Math.hypot(rawX, rawY);
  if (directionLength <= 0.0001) return;
  const dx = rawX / directionLength;
  const dy = rawY / directionLength;
  const from = project(tower.x, tower.y);
  const to = project(tower.x + dx * length, tower.y + dy * length);
  drawDashedLink(from, to, color);
  const wing = Math.max(3, Math.round(7 / Math.max(1, camera.scale * 0.5)));
  const backwardsX = -dx * wing;
  const backwardsY = -dy * wing;
  const perpendicularX = -dy * wing * 0.65;
  const perpendicularY = dx * wing * 0.65;
  shapes.line(to.x, to.y, to.x + backwardsX + perpendicularX, to.y + backwardsY + perpendicularY, 2, color);
  shapes.line(to.x, to.y, to.x + backwardsX - perpendicularX, to.y + backwardsY - perpendicularY, 2, color);
  shapes.rect(from.x - 1, from.y - 1, 3, 3, COLOR.cyan);
}

function drawControlGeometryShape(tower, definition, geometry, color) {
  const control = tower.effectiveControl || definition?.control;
  if (!control || !geometry) return;
  const from = project(tower.x, tower.y);
  if (geometry.kind === 'direction') {
    drawControlDirectionArrow(tower, geometry, (tower.effectiveRange || definition.range) * 0.72, color);
    return;
  }
  if (geometry.kind === 'point') {
    const point = project(geometry.x, geometry.y);
    drawDashedLink(from, point, color);
    drawWorldRing(geometry.x, geometry.y, control.radius || 8, color);
    shapes.rect(point.x - 4, point.y, 9, 1, color);
    shapes.rect(point.x, point.y - 4, 1, 9, color);
    return;
  }
  const first = project(geometry.x1, geometry.y1);
  const second = project(geometry.x2, geometry.y2);
  const midpoint = { x: Math.round((first.x + second.x) * 0.5), y: Math.round((first.y + second.y) * 0.5) };
  drawDashedLink(from, midpoint, color);
  shapes.line(first.x, first.y, second.x, second.y, 2, color);
  shapes.rect(first.x - 2, first.y - 2, 5, 5, COLOR.black);
  shapes.rect(first.x - 1, first.y - 1, 3, 3, color);
  shapes.rect(second.x - 2, second.y - 2, 5, 5, COLOR.black);
  shapes.rect(second.x - 1, second.y - 1, 3, 3, color);
  const width = control.width || control.thickness * 2 || 0;
  if (width > 0) {
    const dx = geometry.x2 - geometry.x1;
    const dy = geometry.y2 - geometry.y1;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length * width * 0.5;
    const ny = dx / length * width * 0.5;
    const edgeA1 = project(geometry.x1 + nx, geometry.y1 + ny);
    const edgeA2 = project(geometry.x2 + nx, geometry.y2 + ny);
    const edgeB1 = project(geometry.x1 - nx, geometry.y1 - ny);
    const edgeB2 = project(geometry.x2 - nx, geometry.y2 - ny);
    shapes.line(edgeA1.x, edgeA1.y, edgeA2.x, edgeA2.y, 1, COLOR.dimMint);
    shapes.line(edgeB1.x, edgeB1.y, edgeB2.x, edgeB2.y, 1, COLOR.dimMint);
  }
}

function drawControlGeometryOverlay(snapshot, tower) {
  const definition = weaponView(snapshot, tower);
  const control = definition?.control;
  if (!control || control.input === 'none') return;
  const range = tower.effectiveRange || definition.range || 0;
  drawWorldRing(tower.x, tower.y, range, COLOR.cyan);
  if (tower.controlGeometry) drawControlGeometryShape(tower, definition, tower.controlGeometry, COLOR.amber);
  if (control.input === 'line') {
    if (controlDrag?.towerId === tower.id) {
      const geometry = {
        kind: 'line',
        x1: controlDrag.start.x,
        y1: controlDrag.start.y,
        x2: controlDrag.current.x,
        y2: controlDrag.current.y
      };
      const length = Math.hypot(geometry.x2 - geometry.x1, geometry.y2 - geometry.y1);
      const valid = length >= 12
        && length <= control.maxLength
        && Math.hypot(geometry.x1 - tower.x, geometry.y1 - tower.y) <= range
        && Math.hypot(geometry.x2 - tower.x, geometry.y2 - tower.y) <= range;
      drawControlGeometryShape(tower, definition, geometry, valid ? COLOR.mint : COLOR.red);
    }
    return;
  }
  if (pointer.y <= HUD_TOP_HEIGHT || pointer.y >= hudBottomY) return;
  const world = unproject(pointer.x, pointer.y);
  const dx = world.x - tower.x;
  const dy = world.y - tower.y;
  const distance = Math.hypot(dx, dy);
  const geometry = control.input === 'point'
    ? { kind: 'point', x: world.x, y: world.y }
    : { kind: 'direction', dx, dy };
  const normalized = normalizeControlGeometry(definition, tower, geometry, currentMap);
  const valid = distance <= range && Boolean(normalized);
  drawControlGeometryShape(tower, definition, normalized || geometry, valid ? COLOR.mint : COLOR.red);
}

function towerRingRange(tower, definition) {
  // A tower-centred passive has an effect radius, not a weapon/placement range.
  if (definition?.control?.input === 'none' && definition.control.radius) return definition.control.radius;
  return tower?.effectiveRange || definition?.range;
}

function drawBuildState(snapshot) {
  const selected = snapshot.towers.find((tower) => tower.id === selectedTowerId);
  if (showAllRanges) {
    for (const tower of snapshot.towers) {
      const definition = snapshot.towerCatalog.find((candidate) => candidate.id === tower.definitionId);
      const range = towerRingRange(tower, definition);
      if (range) drawWorldRing(tower.x, tower.y, range, COLOR.dimMint);
    }
  }
  if (selected) {
    const p = project(selected.x, selected.y);
    const selectedDefinition = snapshot.towerCatalog.find((candidate) => candidate.id === selected.definitionId);
    const selectedRange = towerRingRange(selected, selectedDefinition);
    if (towerMenuMode === 'relay') drawRelayTargetOverlay(snapshot, selected);
    else if (towerMenuMode === 'strike') drawStrikeTargetOverlay(snapshot, selected);
    else if (towerMenuMode === 'control') drawControlGeometryOverlay(snapshot, selected);
    else {
      if (selectedRange && !showAllRanges) drawWorldRing(selected.x, selected.y, selectedRange, COLOR.dimMint);
      if (selected.strikePoint && supportsStrikePoint(selectedDefinition?.attack)) {
        drawStrikePointPattern(selected, selectedDefinition, selected.strikePoint, COLOR.amber);
      }
      if (selected.controlGeometry && selectedDefinition?.control) {
        drawControlGeometryShape(selected, selectedDefinition, selected.controlGeometry, COLOR.amber);
      }
    }
    drawBodyBrackets(shapes, p, towerScreenBounds(selected.definitionId, camera.scale), COLOR.amber);
  }
  if (sessionMode === 'test') {
    for (const tower of snapshot.towers) {
      const p = project(tower.x, tower.y);
      registerHitbox(`tower_drag_${tower.id}`, p.x - 7, p.y - 7, 15, 15, {
        drag: { kind: 'tower', towerId: tower.id }
      });
    }
  }
  if (selected && towerMenuMode && (sessionMode === 'game' || ['arsenal','reactor'].includes(selected.definitionId) || isRelayForm(selected.definitionId) || ['relay', 'strike', 'control'].includes(towerMenuMode))) drawTowerMenu(snapshot, selected);
  if (!placementArmed || pointer.y <= HUD_TOP_HEIGHT || pointer.y >= hudBottomY) return;
  const placementDefinitionId = bulkPlacementDefinitionId || TOWER_DEFINITION_ID;
  const placementDefinition = snapshot.towerCatalog.find((candidate) => candidate.id === placementDefinitionId);
  const quote = towerBuildQuote(snapshot.towerCatalog, placementDefinitionId);
  const world = unproject(pointer.x, pointer.y);
  const economy = snapshot.teamEconomy;
  const socketHost = snapshot.towers.find((tower) => {
    const point = socketPoint(snapshot, currentMap, tower);
    return point && Math.hypot(point.x - world.x, point.y - world.y) <= 10;
  });
  const areaId = socketHost?.areaId || findDefenseAreaAt(currentMap, world.x, world.y);
  const price = quote ? purchaseCost(snapshot, areaId, quote.cost, { placement: true }) : Infinity;
  const snappedPoint = socketHost ? socketPoint(snapshot, currentMap, socketHost) : world;
  const clear = towerPlacementClear(snapshot.towers, snappedPoint.x, snappedPoint.y);
  const canPlace = clear && Boolean(areaId) && (!socketHost || (placementDefinitionId !== 'hardpoint' && !snapshot.towers.some((tower) => tower.socketHostId === socketHost.id))) && (sessionSnapshot.dev?.infiniteMoney ? Number.MAX_SAFE_INTEGER : (economy?.credits || 0)) >= price;
  drawWorldRing(snappedPoint.x, snappedPoint.y, MIN_TOWER_SPACING / 2, clear ? COLOR.dimMint : COLOR.red);
  bitmapText.draw(clear ? `${compactMetric(price)} cr` : 'too close', pointer.x + 12, pointer.y + 12, canPlace ? COLOR.amber : COLOR.red, 1);
  if (placementDefinition) drawWorldRing(world.x, world.y, towerRingRange(null, placementDefinition), canPlace ? COLOR.dimMint : COLOR.red);
  drawTower(
    { ...snappedPoint, definitionId: placementDefinitionId },
    { accent: canPlace ? COLOR.green : COLOR.red, core: canPlace ? COLOR.cyan : COLOR.red }
  );
  drawBodyBrackets(shapes, project(snappedPoint.x, snappedPoint.y),
    towerScreenBounds(placementDefinitionId, camera.scale), canPlace ? COLOR.cyan : COLOR.red);
}

// The threat clock runs at the run's pace; countdowns are shown in real seconds.
function threatSecondsOf(snapshot) {
  return snapshot.swarm?.threatSeconds ?? snapshot.runTick / AUTHORITY_TICK_RATE;
}
function realSecondsUntil(snapshot, threatSeconds) {
  return Math.max(0, threatSeconds - threatSecondsOf(snapshot)) / (snapshot.pace || 1);
}

// Compass label for the hot arc so the HUD can say where a surge is coming from.
function surgeDirectionLabel(riftIds) {
  const sources = currentMap.spawnSources.filter((source) => riftIds.includes(source.id));
  if (!sources.length) return '';
  let dx = 0;
  let dy = 0;
  for (const source of sources) {
    const length = Math.hypot(source.x - currentMap.base.x, source.y - currentMap.base.y) || 1;
    dx += (source.x - currentMap.base.x) / length;
    dy += (source.y - currentMap.base.y) / length;
  }
  const angle = Math.atan2(dy, dx);
  const labels = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
  return labels[Math.round(((angle / (Math.PI * 2)) * 8 + 8) % 8) % 8];
}

// Surge readout for the hud and status line: null while idle.
function surgeStatus(snapshot) {
  const surge = snapshot.swarm?.surge;
  if (!surge || surge.phase === 'idle') return null;
  const direction = surgeDirectionLabel(surge.riftIds);
  if (surge.phase === 'warning') {
    return { phase: 'warning', direction, seconds: Math.ceil(realSecondsUntil(snapshot, surge.activeAtSeconds)), hpMultiplier: surge.hpMultiplier };
  }
  return { phase: 'active', direction, seconds: Math.ceil(realSecondsUntil(snapshot, surge.endsAtSeconds)), hpMultiplier: surge.hpMultiplier };
}

function drawTestFieldWorld(snapshot) {
  const overrides = snapshot.test?.spawnSourceOverrides || {};
  for (const source of currentMap.spawnSources) {
    const appearance = riftAppearance(snapshot, source, reducedNetworkMotion.matches);
    if (!appearance.visible) continue;
    const position = overrides[source.id] || source;
    const p = project(position.x, position.y);
    if (p.x + RIFT_BOUNDS.right < 0 || p.x + RIFT_BOUNDS.left > logicalWidth
        || p.y + RIFT_BOUNDS.bottom < HUD_TOP_HEIGHT || p.y + RIFT_BOUNDS.top > hudBottomY) continue;
    drawRiftSprite(shapes, COLOR, p, appearance);
    if (sessionMode === 'test') {
      const enabled = appearance.state === 'live';
      bitmapText.draw(source.id.replace('test_', ''), p.x + 25, p.y - 3, enabled ? COLOR.red : COLOR.dimMint, 1);
      registerHitbox(`spawn_${source.id}`, p.x + RIFT_BOUNDS.left, p.y + RIFT_BOUNDS.top,
        RIFT_BOUNDS.right - RIFT_BOUNDS.left, RIFT_BOUNDS.bottom - RIFT_BOUNDS.top, {
          drag: { kind: 'spawn-point', sourceId: source.id }
        });
      continue;
    }
    const color = appearance.hot || appearance.remaining > 0 ? COLOR.amber : COLOR.red;
    const status = appearance.hot ? surgeStatus(snapshot) : null;
    const label = status ? (status.phase === 'warning' ? `surge ${status.seconds}s` : 'surge // hot')
      : appearance.remaining > 0 ? `rift ${Math.ceil(appearance.remaining)}s` : 'rift // live';
    bitmapText.draw(label, p.x - label.length * 3, p.y + 25, color, 1);
  }
}

function drawButton(id, label, x, y, width, active, color, action, height = 13) {
  const hovered = pointInside(x, y, width, height);
  shapes.rect(x, y, width, height, hovered ? [0.025, 0.10, 0.10, 1] : COLOR.black);
  shapes.rect(x, y, width, 1, active ? color : COLOR.dimMint);
  shapes.rect(x, y + height - 1, width, 1, active ? color : COLOR.dimMint);
  if (active) shapes.rect(x, y + 1, 2, height - 2, color);
  bitmapText.draw(clippedUiText(label, width - 8), x + 4, y + Math.floor((height - 7) / 2), active || hovered ? color : COLOR.ink, 1);
  registerHitbox(id, x, y, width, height, { action });
}

function pointInside(x, y, width, height) {
  return pointer.x >= x && pointer.x <= x + width && pointer.y >= y && pointer.y <= y + height;
}

function towerAccent(definitionId) {
  if (['assault', 'barrage', 'broadside', 'flechette', 'cyclone'].includes(definitionId)) return COLOR.amber;
  if (['rocket', 'warhead', 'cluster', 'salvo'].includes(definitionId)) return COLOR.amber;
  if (['laser', 'cutter', 'prism', 'sweeper'].includes(definitionId)) return COLOR.cyan;
  if (definitionId === 'tether') return COLOR.cyan;
  if (['anchor', 'stasis', 'recall', 'dragnet'].includes(definitionId)) return COLOR.cyan;
  if (['knot', 'singularity', 'bond', 'braid'].includes(definitionId)) return COLOR.green;
  if (['backwash', 'breaker', 'crosswind', 'breakwater'].includes(definitionId)) return COLOR.amber;
  if (definitionId === 'network') return COLOR.green;
  if (definitionId === 'overclock') return COLOR.amber;
  if (definitionId === 'forge') return COLOR.amber;
  if (definitionId === 'relay') return COLOR.cyan;
  return COLOR.mint;
}

function drawTechPanel(x, y, width, height, accent) {
  shapes.rect(x, y, width, height, COLOR.black);
  shapes.rect(x + 3, y, width - 6, 1, COLOR.dimMint);
  shapes.rect(x + 3, y + height - 1, width - 6, 1, COLOR.dimMint);
  shapes.rect(x, y + 3, 1, height - 6, COLOR.dimMint);
  shapes.rect(x + width - 1, y + 3, 1, height - 6, COLOR.dimMint);
  shapes.rect(x + 3, y, Math.min(34, width - 6), 2, accent);
  for (let i = 0; i < 3; i++) shapes.rect(x + width - 20 + i * 5, y, 3, 2, accent);
  shapes.rect(x, y + 3, 3, 1, accent);
  shapes.rect(x + width - 3, y + height - 1, 3, 1, accent);
  shapes.rect(x + width - 1, y + height - 4, 1, 3, accent);
}

function drawMenuButton(id, label, x, y, width, accent, action, selected = false) {
  const hovered = pointInside(x, y, width, 17);
  shapes.rect(x, y, width, 17, COLOR.black);
  shapes.rect(x, y, width, 1, hovered || selected ? accent : COLOR.dimMint);
  shapes.rect(x, y + 16, width, 1, hovered || selected ? accent : COLOR.dimMint);
  shapes.rect(x, y, hovered || selected ? 3 : 1, 17, hovered || selected ? accent : COLOR.dimMint);
  shapes.rect(x + width - 1, y + 3, 1, 11, hovered ? accent : COLOR.dimMint);
  if (hovered) {
    shapes.rect(x + 6, y + 4, 3, 1, accent);
    shapes.rect(x + 6, y + 12, 3, 1, accent);
  }
  const textWidth = label.length * 6;
  bitmapText.draw(label, Math.round(x + (width - textWidth) * 0.5), y + 5, hovered || selected ? accent : COLOR.ink, 1);
  registerHitbox(id, x, y, width, 17, { action });
}

function drawBuildCatalog(snapshot) {
  if (!buildCatalogOpen) return;
  const page = BUILD_CATALOG_PAGES[buildCatalogPageId];
  if (!page) return;
  const economy = snapshot.teamEconomy || { credits: 0 };
  const width = Math.min(410, logicalWidth - 12);
  const height = 120;
  const x = Math.round((logicalWidth - width) * 0.5);
  const y = Math.max(HUD_TOP_HEIGHT + 5, hudBottomY - height - 6);
  drawTechPanel(x, y, width, height, COLOR.amber);
  shapes.rect(x + 8, y + 6, 2, 11, COLOR.amber);
  bitmapText.draw(sessionMode === 'test' ? 'form catalog' : 'tower catalog', x + 16, y + 7, COLOR.amber, 1);
  drawButton('catalog_page_core', 'core', x + 102, y + 4, 34, buildCatalogPageId === 'core', COLOR.mint, () => { buildCatalogPageId = 'core'; });
  drawButton('catalog_page_assault', 'assault iii', x + 140, y + 4, 70, buildCatalogPageId === 'assault', COLOR.amber, () => { buildCatalogPageId = 'assault'; });
  drawButton('catalog_page_tether', 'tether iii', x + 214, y + 4, 66, buildCatalogPageId === 'tether', COLOR.cyan, () => { buildCatalogPageId = 'tether'; });
  drawButton('catalog_page_network', 'network iii', x + 284, y + 4, 70, buildCatalogPageId === 'network', COLOR.green, () => { buildCatalogPageId = 'network'; });
  drawButton('build_catalog_close', sessionMode === 'test' ? 'u close' : 'b close', x + width - 50, y + 4, 43, false, COLOR.cyan, closeBuildCatalog);

  const innerX = x + 7;
  const innerWidth = width - 14;
  page.rows.forEach((row, rowIndex) => {
    const rowY = y + 22 + rowIndex * 21;
    const gap = 3;
    const buttonWidth = row.length === 1 ? 94 : Math.floor((innerWidth - gap * (row.length - 1)) / row.length);
    row.forEach((entry, columnIndex) => {
      const definition = snapshot.towerCatalog.find((candidate) => candidate.id === entry.definitionId);
      const quote = towerBuildQuote(snapshot.towerCatalog, entry.definitionId);
      if (!definition || !quote) return;
      const price = purchaseCost(snapshot, null, quote.cost, { placement: true });
      const affordable = sessionMode === 'test' || snapshot.dev?.infiniteMoney || economy.credits >= price;
      const pricedLabel = `${entry.key} ${definition.label} ${compactMetric(price)}`;
      const label = sessionMode === 'test'
        ? `${entry.key} ${definition.label}`
        : pricedLabel.length * 6 <= buttonWidth - 8
          ? pricedLabel
          : `${entry.key} ${definition.label}`;
      drawMenuButton(
        `build_catalog_${entry.definitionId}`,
        label,
        innerX + columnIndex * (buttonWidth + gap),
        rowY,
        buttonWidth,
        affordable ? towerAccent(entry.definitionId) : COLOR.red,
        () => selectBulkPlacementDefinition(entry.definitionId),
        false
      );
      if (!affordable) shapes.rect(innerX + columnIndex * (buttonWidth + gap) + buttonWidth - 4, rowY + 3, 2, 2, COLOR.red);
    });
    if (row.length === 1) bitmapText.draw('pick once // place repeatedly', innerX + 104, rowY + 5, COLOR.ink, 1);
  });
  bitmapText.draw(
    sessionMode === 'test'
      ? 'loads selected test tower // tab changes page // n opens network iii'
      : width < 390
        ? 'pick once // click many // right click ends'
        : 'valid nebula clicks keep building // right click cancels',
    x + 8,
    y + 108,
    COLOR.dimMint,
    1
  );
}

function mainMenuRunLabel(snapshot) {
  if (gameRestorePending) return 'checking local save // hold on';
  if (snapshot.phase === 'running') {
    const seconds = Math.floor(snapshot.runTick / AUTHORITY_TICK_RATE);
    return `${snapshot.mapLabel} // ${seconds}s // ${snapshot.base.lives} lives`;
  }
  if (snapshot.phase === 'defeated') return `${snapshot.mapLabel} // base lost`;
  return 'fresh signal // choose a map';
}

function drawMainMenu(snapshot) {
  const width = Math.min(330, logicalWidth - 20);
  const height = Math.min(176, logicalHeight - 12);
  const x = Math.round((logicalWidth - width) * 0.5);
  const y = Math.round((logicalHeight - height) * 0.5);
  drawTechPanel(x, y, width, height, COLOR.mint);
  shapes.rect(x + 8, y + 8, 3, 25, COLOR.mint);
  shapes.rect(x + width - 11, y + 8, 3, 25, COLOR.red);
  shapes.rect(x + 16, y + 40, width - 32, 1, COLOR.dimMint);
  bitmapText.draw('framebound', x + 20, y + 10, COLOR.mint, 2);
  bitmapText.draw('// horde', x + 130, y + 10, COLOR.red, 2);
  bitmapText.draw('wip command deck', x + 20, y + 29, COLOR.ink, 1);
  bitmapText.draw(mainMenuRunLabel(snapshot), x + 17, y + 48, gameRestorePending ? COLOR.amber : COLOR.cyan, 1);
  if (gameHasEnteredGameplay && snapshot.phase === 'running') {
    bitmapText.draw('warning // the horde is still live', x + 17, y + 59, COLOR.red, 1);
  } else {
    bitmapText.draw('solo survival // difficulty climbs', x + 17, y + 59, COLOR.dimMint, 1);
  }

  const buttonX = x + 17;
  const buttonWidth = width - 34;
  const networkBundle = sessions.get('game');
  const networkActive = Boolean(networkBundle?.networkRole);
  const primaryLabel = snapshot.phase === 'running' ? 'continue run' : networkActive ? 'coop // room status' : snapshot.phase === 'defeated' ? 'choose map // retry' : 'solo // choose map';
  drawMenuButton('menu_continue', primaryLabel, buttonX, y + 70, buttonWidth, COLOR.mint, startOrContinueGame, true);
  drawMenuButton('menu_restart', 'new solo run // choose map', buttonX, y + 91, buttonWidth, COLOR.amber, openNewSoloRun);
  const gap = 6;
  const halfWidth = Math.floor((buttonWidth - gap) * 0.5);
  drawMenuButton(
    'menu_coop_host',
    networkActive ? `coop ${multiplayerState.roomCode?.toLowerCase() || 'status'}` : 'h host coop',
    buttonX,
    y + 112,
    halfWidth,
    COLOR.green,
    networkActive ? () => { frontEndScreen = 'coop'; } : beginHostingCoop
  );
  drawMenuButton(
    'menu_coop_join',
    networkActive ? 'leave coop' : 'j join code',
    buttonX + halfWidth + gap,
    y + 112,
    buttonWidth - halfWidth - gap,
    networkActive ? COLOR.red : COLOR.cyan,
    networkActive ? () => cancelMultiplayer(true) : openJoinCoop
  );
  drawMenuButton('menu_test', 'test field // t', buttonX, y + 133, buttonWidth, COLOR.cyan, enterTestField);
  bitmapText.draw(networkActive ? 'p2p session active' : 'coop // 2-4 pilots // p2p beta', x + 17, y + 157, networkActive ? COLOR.green : COLOR.dimMint, 1);
  bitmapText.draw('enter selects', x + width - 85, y + 157, COLOR.ink, 1);
}

function clippedUiText(value, width) {
  return String(value || '').slice(0, Math.max(0, Math.floor(width / 6)));
}

function drawPlayerNameEditor(x, y, width) {
  const label = multiplayerState.editingName
    ? `name ${multiplayerState.playerName}_`
    : `name ${multiplayerState.playerName} // edit`;
  drawButton('coop_player_name', label, x, y, width, multiplayerState.editingName, COLOR.cyan, () => {
    multiplayerState.editingName = true;
  }, 15);
}

function drawCoopRoster(snapshot, x, y, width) {
  const players = (snapshot.players || []).slice(0, 4);
  for (let index = 0; index < Math.min(4, players.length); index += 1) {
    const player = players[index];
    const role = player.id === snapshot.hostPlayerId ? 'host' : player.spectator ? 'spectator' : 'peer';
    const state = player.connectionState === 'reconnecting' ? 'reconnect' : player.connectionState === 'departed' ? 'departed' : player.connected ? 'linked' : 'offline';
    const local = player.id === session.playerId ? ' // you' : '';
    const label = `${index + 1} ${player.label} // ${role} // ${state}${local}`;
    shapes.rect(x, y + index * 10 + 3, 4, 4, playerColor(player));
    bitmapText.draw(clippedUiText(label, width - 8), x + 8, y + index * 10, player.connected ? playerColor(player) : COLOR.red, 1);
  }
}

function retryMultiplayer() {
  if (multiplayerState.role === 'host') beginHostingCoop();
  else beginJoiningCoop();
}

function drawCoopMenu(snapshot) {
  const width = Math.min(390, logicalWidth - 16);
  const height = Math.min(198, logicalHeight - 12);
  const x = Math.round((logicalWidth - width) * 0.5);
  const y = Math.round((logicalHeight - height) * 0.5);
  const accent = multiplayerState.phase === 'error' ? COLOR.red : multiplayerState.role === 'host' ? COLOR.green : COLOR.cyan;
  drawTechPanel(x, y, width, height, accent);
  shapes.rect(x + 9, y + 8, 3, 24, accent);
  shapes.rect(x + width - 12, y + 8, 3, 24, COLOR.red);
  bitmapText.draw('coop // direct peer link', x + 20, y + 10, accent, 2);
  bitmapText.draw('six-character signaling // gameplay stays p2p', x + 20, y + 31, COLOR.dimMint, 1);
  bitmapText.draw(clippedUiText(multiplayerState.status, width - 34), x + 17, y + 45, multiplayerState.phase === 'error' ? COLOR.red : COLOR.ink, 1);

  const buttonX = x + 17;
  const buttonWidth = width - 34;
  if (multiplayerState.phase === 'join_entry') {
    const code = multiplayerState.codeInput.padEnd(6, '_').toLowerCase();
    const boxWidth = 28;
    const totalWidth = boxWidth * 6 + 5 * 4;
    const codeX = Math.round(x + (width - totalWidth) * 0.5);
    for (let index = 0; index < 6; index += 1) {
      const boxX = codeX + index * (boxWidth + 4);
      shapes.rect(boxX, y + 62, boxWidth, 26, COLOR.black);
      shapes.rect(boxX, y + 62, boxWidth, 1, index < multiplayerState.codeInput.length ? COLOR.cyan : COLOR.dimMint);
      shapes.rect(boxX, y + 87, boxWidth, 1, index < multiplayerState.codeInput.length ? COLOR.cyan : COLOR.dimMint);
      bitmapText.draw(code[index], boxX + 8, y + 68, index < multiplayerState.codeInput.length ? COLOR.mint : COLOR.dimMint, 2);
    }
    drawMenuButton('coop_join_submit', 'join room // enter', buttonX, y + 101, buttonWidth, COLOR.mint, beginJoiningCoop, multiplayerState.codeInput.length === 6);
    drawMenuButton('coop_join_back', 'back // esc', buttonX, y + 122, buttonWidth, COLOR.cyan, () => cancelMultiplayer(true));
    bitmapText.draw('type or paste the code your host sends', x + 18, y + 148, COLOR.ink, 1);
    bitmapText.draw('signaling may need a few seconds to wake', x + 18, y + 160, COLOR.dimMint, 1);
    drawPlayerNameEditor(x + width - 160, y + 176, 142);
    return;
  }

  if (multiplayerState.phase === 'connecting') {
    const code = multiplayerState.roomCode || multiplayerState.codeInput;
    if (code) bitmapText.draw(`room ${code.toLowerCase()}`, x + 18, y + 67, COLOR.amber, 2);
    bitmapText.draw('opening encrypted webrtc data channel', x + 18, y + 94, COLOR.ink, 1);
    bitmapText.draw('the relay carries connection metadata only', x + 18, y + 106, COLOR.dimMint, 1);
    drawMenuButton('coop_connect_cancel', 'cancel // esc', buttonX, y + 130, buttonWidth, COLOR.red, () => cancelMultiplayer(true));
    return;
  }

  if (multiplayerState.phase === 'error') {
    bitmapText.draw(clippedUiText(multiplayerState.detail, width - 36), x + 18, y + 65, COLOR.red, 1);
    drawMenuButton('coop_retry', 'retry connection', buttonX, y + 91, buttonWidth, COLOR.amber, retryMultiplayer);
    drawMenuButton('coop_error_back', 'back to main', buttonX, y + 112, buttonWidth, COLOR.cyan, () => cancelMultiplayer(true));
    bitmapText.draw('restrictive nat may require a future turn fallback', x + 18, y + 140, COLOR.dimMint, 1);
    return;
  }

  const roomCode = multiplayerState.roomCode || multiplayerState.codeInput;
  if (roomCode) bitmapText.draw(`room ${roomCode.toLowerCase()}`, x + 18, y + 61, COLOR.amber, 2);
  drawPlayerNameEditor(x + width - 160, y + 66, 142);
  drawCoopRoster(snapshot, x + 18, y + 88, width - 36);
  if (snapshot.phase !== 'lobby') {
    drawMenuButton('coop_resume', snapshot.phase === 'defeated' ? 'view ended run' : 'return to run', buttonX, y + 132, buttonWidth, COLOR.mint, resumeSession, true);
  } else if (multiplayerState.role === 'host') {
    const connected = snapshot.players.filter((player) => player.connected && !player.spectator).length;
    const half = Math.floor((buttonWidth - 6) * 0.5);
    drawMenuButton('coop_copy', 'copy room code', buttonX, y + 132, half, COLOR.cyan, copyRoomCode);
    drawMenuButton('coop_deploy', connected >= 2 ? 'choose map' : 'need 2 pilots', buttonX + half + 6, y + 132, buttonWidth - half - 6, connected >= 2 ? COLOR.mint : COLOR.red, openCoopMapSelection, connected >= 2);
  } else {
    bitmapText.draw('host chooses the map and starts the run', x + 18, y + 136, COLOR.mint, 1);
  }
  drawMenuButton('coop_leave', 'leave coop // esc', buttonX, y + 158, buttonWidth, COLOR.red, () => cancelMultiplayer(true));
  bitmapText.draw(SIGNALING_URL.includes('framebound-signaling') ? 'public signal relay online // direct data after handshake' : 'custom signal relay', x + 18, y + 181, COLOR.dimMint, 1);
}

function drawMapThumbnail(map, x, y, width, height, accent) {
  const bounds = map.cameraBounds;
  const worldWidth = bounds.right - bounds.left;
  const worldHeight = bounds.bottom - bounds.top;
  shapes.rect(x, y, width, height, COLOR.black);
  shapes.rect(x, y, width, 1, COLOR.dimMint);
  shapes.rect(x, y + height - 1, width, 1, COLOR.dimMint);
  for (const area of map.defenseAreas) {
    const shape = area.shape;
    const markerX = Math.round(x + (shape.x - bounds.left) / worldWidth * width);
    const markerY = Math.round(y + (shape.y - bounds.top) / worldHeight * height);
    const markerWidth = Math.max(1, Math.round(shape.radiusX / worldWidth * width * 1.5));
    const markerHeight = Math.max(1, Math.round(shape.radiusY / worldHeight * height * 1.5));
    shapes.rect(markerX - Math.floor(markerWidth * 0.5), markerY - Math.floor(markerHeight * 0.5), markerWidth, markerHeight, accent);
  }
  const baseX = Math.round(x + (map.base.x - bounds.left) / worldWidth * width);
  const baseY = Math.round(y + (map.base.y - bounds.top) / worldHeight * height);
  shapes.rect(baseX - 2, baseY - 1, 5, 3, COLOR.green);
}

function drawMapCard(map, index, x, y, width, height) {
  const selected = map.id === selectedRunMapId;
  const hovered = pointInside(x, y, width, height);
  const accent = selected ? COLOR.mint : hovered ? COLOR.cyan : COLOR.dimMint;
  drawTechPanel(x, y, width, height, accent);
  bitmapText.draw(`${index + 1} ${map.label}`, x + 8, y + 7, selected || hovered ? accent : COLOR.ink, 1);
  drawMapThumbnail(map, x + 8, y + 20, width - 16, 45, selected ? COLOR.mint : COLOR.dimMint);
  bitmapText.draw(map.menuLines[0] || `${map.defenseAreas.length} areas`, x + 8, y + 72, selected ? COLOR.mint : COLOR.ink, 1);
  bitmapText.draw(map.menuLines[1] || 'survival field', x + 8, y + 84, selected ? COLOR.cyan : COLOR.dimMint, 1);
  if (selected) {
    shapes.rect(x + width - 9, y + 5, 3, 3, COLOR.green);
    shapes.rect(x + width - 5, y + 5, 2, 3, COLOR.mint);
  }
  registerHitbox(`map_${map.id}`, x, y, width, height, { action: () => selectRunMap(map.id) });
}

function drawMapSelection(snapshot) {
  const maps = playableMaps();
  const width = Math.min(430, logicalWidth - 12);
  const height = Math.min(172 + maps.length * 23, logicalHeight - 12);
  const x = Math.round((logicalWidth - width) * 0.5);
  const y = Math.round((logicalHeight - height) * 0.5);
  drawTechPanel(x, y, width, height, COLOR.amber);
  bitmapText.draw('select survival field', x + 16, y + 9, COLOR.amber, 2);
  const runIsLive = gameHasEnteredGameplay && snapshot.phase === 'running';
  const warning = runIsLive
    ? 'live run keeps moving // deployment wipes it'
    : snapshot.phase === 'running' ? 'saved run held // deployment wipes it' : 'choose a flow // fresh seed per run';
  bitmapText.draw(warning, x + 16, y + 27, snapshot.phase === 'running' ? COLOR.red : COLOR.dimMint, 1);

  const mapRowHeight=height>=242?23:17, mapRowTop=height>=242?40:35;
  maps.forEach((map,index) => {
    const selected=map.id===selectedRunMapId;
    drawMenuButton(`map_${map.id}`,`${index+1} ${map.label}`,x+16,y+mapRowTop+index*mapRowHeight,width-32,selected?COLOR.mint:COLOR.cyan,()=>selectRunMap(map.id),selected);
  });
  const selected=maps.find((map)=>map.id===selectedRunMapId);
  const descriptionY = mapRowTop + maps.length * mapRowHeight + 4;
  if(descriptionY < height - 78) bitmapText.draw(selected?.menuLines[1] || '',x+16,y+descriptionY,COLOR.ink,1);

  // horde pace row: [-] pace x1.0 [+], with a small tick bar across the allowed range
  const pace = selectedRunPace();
  const paceY = y + height - 66;
  const paceButton = 18;
  drawMenuButton('pace_down', '-', x + 16, paceY, paceButton, pace > PACE_MIN ? COLOR.cyan : COLOR.dimMint, () => adjustRunPace(-1), false);
  drawMenuButton('pace_up', '+', x + 16 + paceButton + 4 + 92 + 4, paceY, paceButton, pace < PACE_MAX ? COLOR.cyan : COLOR.dimMint, () => adjustRunPace(1), false);
  const paceColor = pace === DEFAULT_PACE ? COLOR.mint : pace < DEFAULT_PACE ? COLOR.cyan : COLOR.amber;
  bitmapText.draw(`pace x${pace.toFixed(1)}`, x + 16 + paceButton + 8, paceY + 4, paceColor, 1);
  const barX = x + 16 + paceButton * 2 + 108;
  const barWidth = Math.max(40, width - (barX - x) - 16);
  const steps = Math.round((PACE_MAX - PACE_MIN) / PACE_STEP);
  for (let step = 0; step <= steps; step += 1) {
    const stepPace = normalizePace(PACE_MIN + step * PACE_STEP);
    const tickX = barX + Math.round(step / steps * (barWidth - 3));
    const on = stepPace <= pace + 1e-9;
    shapes.rect(tickX, paceY + (stepPace === DEFAULT_PACE ? 2 : 5), 3, stepPace === DEFAULT_PACE ? 12 : 6, on ? paceColor : COLOR.dimMint);
  }
  bitmapText.draw(pace < DEFAULT_PACE ? 'slower horde' : pace > DEFAULT_PACE ? 'faster horde' : 'designed pace', barX, paceY + 14, COLOR.dimMint, 1);

  const buttonY = y + height - 38;
  const backWidth = 76;
  const deployLabel = menuConfirm === 'map_deploy' ? 'confirm wipe // deploy' : `deploy ${selectedRunMapId.replace('map_', 'map ')}`;
  drawMenuButton('map_back', 'back // esc', x + 16, buttonY, backWidth, COLOR.cyan, closeMapSelection);
  drawMenuButton(
    'map_deploy',
    deployLabel,
    x + 16 + backWidth + 6,
    buttonY,
    width - 38 - backWidth,
    menuConfirm === 'map_deploy' ? COLOR.red : COLOR.mint,
    deploySelectedMap,
    true
  );
  bitmapText.draw(`1-${maps.length} select // [ ] pace // enter deploys`, x + 17, y + height - 16, COLOR.ink, 1);
}

function resetTestFieldFromMenu() {
  session.send(COMMAND.TEST_CLEAR, { resetCounters: true });
  menuConfirm = null;
  frontEndScreen = 'game';
  setStatus('test field reset');
}

function drawDevTools(snapshot) {
  uiHitboxes.length = 0;
  const width = Math.min(300, logicalWidth - 20), height = 212;
  const x = (logicalWidth - width) / 2, y = (logicalHeight - height) / 2;
  const host = session.playerId === snapshot.hostPlayerId;
  drawTechPanel(x, y, width, height, COLOR.amber);
  bitmapText.draw('dev tools // f2', x + 12, y + 10, COLOR.amber, 1);
  bitmapText.draw(host ? 'changes apply to this run' : 'host controls // inspect only', x + 12, y + 25, COLOR.ink, 1);
  const options = [['infiniteMoney', 'infinite money'], ['infiniteHealth', 'infinite base health'], ['paused', 'pause simulation'], ['stopSpawns', 'stop new spawns']];
  options.forEach(([option, label], index) => {
    const enabled = Boolean(snapshot.dev?.[option]);
    drawMenuButton(`dev_${option}`, `${enabled ? '[on]' : '[off]'} ${label}`, x + 12, y + 42 + index * 22, width - 24,
      enabled ? COLOR.amber : COLOR.ink, () => { if (host) session.send(COMMAND.DEV_TOOLS, { option, enabled: !enabled }); }, enabled);
  });
  drawMenuButton('dev_clear', 'clear enemies // no rewards', x + 12, y + 134, width - 24, COLOR.red,
    () => { if (host) session.send(COMMAND.DEV_TOOLS, { action: 'clearEnemies' }); });
  drawMenuButton('dev_heal', 'heal base / revive', x + 12, y + 156, width - 24, COLOR.mint,
    () => { if (host) session.send(COMMAND.DEV_TOOLS, { action: 'healBase' }); });
  drawMenuButton('dev_close', 'close // f2 or esc', x + 12, y + 184, width - 24, COLOR.cyan, () => { devToolsOpen = false; });
}

function drawEscapeMenu(snapshot) {
  const width = Math.min(escapeMenuPage === 'help' ? 288 : 264, logicalWidth - 20);
  const networkActive = Boolean(session.networkRole);
  const height = Math.min(escapeMenuPage === 'help' ? 222 : networkActive ? 200 : 179, logicalHeight - 16);
  const x = Math.round((logicalWidth - width) * 0.5);
  const y = Math.round((logicalHeight - height) * 0.5);
  drawTechPanel(x, y, width, height, COLOR.cyan);
  shapes.rect(x + 8, y + 8, 2, 22, COLOR.cyan);
  shapes.rect(x + width - 10, y + 8, 2, 22, COLOR.red);
  const buttonX = x + 17;
  const buttonWidth = width - 34;

  if (escapeMenuPage === 'help') {
    bitmapText.draw('field guide', x + 18, y + 10, COLOR.cyan, 2);
    const rows = [
      'hp: red 1 / orange 2 / yellow 3',
      'build in nebulae. each hp pays 1 credit.',
      'upgrades replace a tower permanently.',
      sessionMode === 'test' ? 'b place support // drag towers to move' : '1 place frame // click tower to manage',
      sessionMode === 'test' ? 'u catalog // space pause // . step' : 'b build catalog // tab next page',
      'q / e targeting // a aim or control',
      'drag empty space to pan // wheel zoom',
      'right click cancels // g shows ranges',
      'k kill rate // t test field // ? help',
      'solo autosaves on this browser.',
      'menus and test field do not pause solo.'
    ];
    const lineHeight = Math.min(14, Math.floor((height - 69) / rows.length));
    rows.forEach((line, i) => bitmapText.draw(line, x + 18, y + 34 + i * lineHeight, i === 10 ? COLOR.red : COLOR.ink, 1));
    drawMenuButton('help_back', 'back // esc', buttonX, y + height - 29, buttonWidth, COLOR.cyan, closeEscapeOptions, true);
    return;
  }

  if (escapeMenuPage === 'options') {
    bitmapText.draw('gameplay options', x + 18, y + 10, COLOR.cyan, 2);
    bitmapText.draw('local controls // run still live', x + 18, y + 31, COLOR.red, 1);
    bitmapText.draw('placement flow', x + 18, y + 44, COLOR.ink, 1);
    drawMenuButton(
      'option_auto_select_frame',
      `1 auto-select frame // ${gameplayPreferences.autoSelectPlacedFrame ? 'on' : 'off'}`,
      buttonX,
      y + 58,
      buttonWidth,
      gameplayPreferences.autoSelectPlacedFrame ? COLOR.mint : COLOR.amber,
      toggleAutoSelectPlacedFrame,
      gameplayPreferences.autoSelectPlacedFrame
    );
    bitmapText.draw('1 place > selected > 1 > 1 assault', x + 18, y + 82, COLOR.mint, 1);
    bitmapText.draw('off restores click-to-select', x + 18, y + 94, COLOR.dimMint, 1);
    drawMenuButton('options_back', 'back // esc', buttonX, y + 115, buttonWidth, COLOR.cyan, closeEscapeOptions, true);
    bitmapText.draw('saved on this browser', x + 18, y + 139, COLOR.ink, 1);
    return;
  }

  const compact = height < (networkActive ? 200 : 179);
  const rowY = (index) => y + (compact ? 43 : 58) + index * (compact ? 18 : 21);
  bitmapText.draw('command interrupt', x + 18, y + 10, COLOR.cyan, 2);
  bitmapText.draw('simulation is not paused', x + 18, y + 31, COLOR.red, 1);
  const seconds = Math.floor(snapshot.runTick / AUTHORITY_TICK_RATE);
  const runLabel = networkActive ? `coop ${multiplayerState.roomCode?.toLowerCase() || 'link'}` : sessionMode;
  if (!compact) bitmapText.draw(`${runLabel} // ${seconds}s // ${compactMetric(snapshot.swarm.activeEnemies)} hostiles`, x + 18, y + 43, COLOR.ink, 1);
  drawMenuButton('escape_resume', 'resume // esc', buttonX, rowY(0), buttonWidth, COLOR.mint, resumeSession, true);
  if (networkActive) {
    drawMenuButton(
      'escape_coop_status',
      `coop status // ${multiplayerState.roomCode?.toLowerCase() || 'linked'}`,
      buttonX,
      rowY(1),
      buttonWidth,
      COLOR.green,
      () => { frontEndScreen = 'coop'; },
      true
    );
  } else if (sessionMode === 'game') {
    drawMenuButton('escape_restart', 'new run // choose map', buttonX, rowY(1), buttonWidth, COLOR.amber, () => openMapSelection('escape'));
  } else {
    drawMenuButton('escape_test_reset', 'clear test field', buttonX, rowY(1), buttonWidth, COLOR.amber, resetTestFieldFromMenu);
  }
  drawMenuButton('escape_options', 'gameplay options', buttonX, rowY(2), buttonWidth, COLOR.cyan, openEscapeOptions);
  drawMenuButton('escape_help', 'field guide // ?', buttonX, rowY(3), buttonWidth, COLOR.green, () => { escapeMenuPage = 'help'; });
  drawMenuButton('escape_main', 'main menu', buttonX, rowY(4), buttonWidth, COLOR.cyan, returnToMainMenu);
  if (networkActive) {
    drawMenuButton('escape_leave_coop', 'leave coop', buttonX, rowY(5), buttonWidth, COLOR.red, () => cancelMultiplayer(true));
    bitmapText.draw('leaving marks your seat departed', x + 18, y + height - 14, COLOR.dimMint, 1);
  } else {
    bitmapText.draw('no pause means no cheese. sorry.', x + 18, y + height - 14, COLOR.dimMint, 1);
  }
}

function towerPanelPosition(tower, width, height) {
  const towerPoint = project(tower.x, tower.y);
  const edge = 5;
  const minimumY = HUD_TOP_HEIGHT + 4;
  const maximumY = Math.max(minimumY, hudBottomY - height - 4);
  const x = Math.max(edge, Math.min(logicalWidth - width - edge, Math.round(towerPoint.x - width * 0.5)));
  let y = towerPoint.y - height - 14;
  let above = true;
  if (y < minimumY) {
    y = towerPoint.y + 14;
    above = false;
  }
  y = Math.max(minimumY, Math.min(maximumY, Math.round(y)));
  const connectorX = Math.max(x + 7, Math.min(x + width - 8, towerPoint.x));
  if (above) shapes.line(towerPoint.x, towerPoint.y - 8, connectorX, y + height, 1, COLOR.dimMint);
  else shapes.line(towerPoint.x, towerPoint.y + 8, connectorX, y, 1, COLOR.dimMint);
  return { x, y };
}

function openUpgradeMenu(snapshot, tower) {
  const definition = snapshot.towerCatalog.find((candidate) => candidate.id === tower.definitionId);
  if (!definition?.evolutionChoices?.length) {
    setStatus('next branches are not designed yet');
    return;
  }
  towerMenuMode = 'upgrades';
  setStatus('choose one replacement');
}

function relayCandidateAreas(snapshot, tower) {
  if (!tower) return [];
  const definition = snapshot.towerCatalog.find((candidate) => candidate.id === tower.definitionId);
  const linkRange = Math.max(0, definition?.linkRange || 0);
  if (!isRelayForm(definition?.id) || linkRange <= 0) return [];
  return currentMap.defenseAreas.filter((area) => (
    area.id !== tower.areaId && defenseAreaField(area, tower.x, tower.y, linkRange) <= 0
  ));
}

function openRelayTargetMenu(snapshot, tower) {
  if (!isRelayForm(tower?.definitionId)) return;
  towerMenuMode = 'relay';
  const count = relayCandidateAreas(snapshot, tower).length;
  setStatus(count ? 'click a highlighted nebula' : 'no nebulas inside link range');
}

function weaponView(snapshot, tower) {
  return snapshot.towerCatalog.find((candidate) => candidate.id === (tower?.echoWeaponId || tower?.definitionId));
}

function openStrikeTargetMenu(snapshot, tower) {
  const definition = weaponView(snapshot, tower);
  if (!tower || !supportsStrikePoint(definition?.attack)) {
    setStatus('tower cannot aim manually');
    return;
  }
  towerMenuMode = 'strike';
  setStatus('click a strike point inside range');
}

function clearSelectedStrikePoint() {
    const tower = sessionSnapshot.towers.find((candidate) => candidate.id === selectedTowerId);
  const definition = weaponView(sessionSnapshot, tower);
  if (!tower || !supportsStrikePoint(definition?.attack)) {
    setStatus('tower has no strike point');
    return;
  }
  session.send(COMMAND.TOWER_STRIKE_POINT_SET, { towerId: tower.id, x: null, y: null });
  setStatus('automatic impact command sent');
}

function openControlGeometryMenu(snapshot, tower) {
  const definition = weaponView(snapshot, tower);
  const input = definition?.control?.input;
  if (!tower || !input || input === 'none') {
    setStatus('tower has no editable control');
    return;
  }
  towerMenuMode = 'control';
  setStatus(input === 'line' ? 'click-drag inside range' : input === 'point' ? 'click to place the field' : definition.control.type === 'aim' ? 'click to set shotgun facing' : 'choose left or right // no upstream');
}

function resetSelectedControlGeometry() {
  const { tower, control } = selectedControlContext();
  if (!tower || !control || control.input === 'none') {
    setStatus('tower has no editable control');
    return;
  }
  session.send(COMMAND.TOWER_CONTROL_GEOMETRY_SET, { towerId: tower.id, geometry: null });
  setStatus('default geometry sent // reboot 1s');
}

function sellSelectedTower() {
  if (!selectedTowerId) return;
  session.send(COMMAND.TOWER_SELL, { towerId: selectedTowerId });
  towerMenuMode = null;
  setStatus('sell command sent');
}


let researchPage = 0;
let researchSelection = null;
let researchDetailPage = 0;
function openResearchStation(tower) {
  selectedTowerId = tower.id;
  towerMenuMode = 'research';
  researchPage = 0; researchSelection = null; researchDetailPage = 0;
}
function stationItems(snapshot, tower) {
  if (tower.definitionId === 'arsenal') return RESEARCH_NODES.map((node) => ({ ...node,
    owned: hasResearch(snapshot,node.id), locked: node.parent !== null && !hasResearch(snapshot,node.parent),
    cost: hasResearch(snapshot,node.id) ? 0 : node.cost }));
  return REACTOR_CATEGORIES.map((category) => ({ ...category,
    rank: reactorRank(snapshot,category.id), cost: reactorQuote(snapshot,category.id)?.cost ?? null }));
}
function purchaseStationItem(tower, item) {
  if (item.owned) return setStatus('already researched');
  if (item.locked) return setStatus('unlock parent research first');
  if (item.cost === null) return setStatus('upgrade capped');
  session.send(tower.definitionId === 'arsenal' ? COMMAND.RESEARCH_PURCHASE : COMMAND.REACTOR_PURCHASE,
    tower.definitionId === 'arsenal'
      ? { towerId: tower.id, researchId: item.id, expectedCost: item.cost }
      : { towerId: tower.id, categoryId: item.id, expectedRank: item.rank, expectedCost: item.cost });
}
function researchScope(id) {
  if ([13,18,25].includes(id)) return 'affects non-explosive bullets';
  if (id === 15) return 'affects laser-family beams';
  if ([26,31].includes(id)) return 'affects rocket-family weapons';
  if (id === 38) return 'weapons hitting frozen enemies';
  return 'global // existing and future towers';
}
function wrapResearchText(text, columns) {
  const lines = []; let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + word.length + 1 > columns) { lines.push(line); line = ''; }
    line += (line ? ' ' : '') + word;
  }
  if (line) lines.push(line);
  return lines;
}
// Every research node maps to one small thematic icon kind, code-rendered from
// rectangles only (no image assets) so its function reads at a glance.
const RESEARCH_ICON_KIND = Object.freeze({
  1: 'damage', 2: 'cadence', 3: 'range', 4: 'damage', 5: 'damage', 6: 'network', 7: 'magazine',
  8: 'targeting', 9: 'burst', 10: 'range', 11: 'range', 12: 'control', 13: 'chain', 14: 'damage',
  15: 'damage', 16: 'targeting', 17: 'chain', 18: 'blast', 19: 'network', 20: 'network', 21: 'network',
  22: 'magazine', 23: 'magazine', 24: 'magazine', 25: 'chain', 26: 'targeting', 27: 'targeting',
  28: 'burst', 29: 'burst', 30: 'burst', 31: 'blast', 32: 'cadence', 33: 'control', 34: 'targeting',
  35: 'speed', 36: 'network', 37: 'control', 38: 'control', 39: 'control'
});

function drawResearchIcon(kind, x, y, color, scale = 1) {
  const px = (dx, dy, w = 1, h = 1) => shapes.rect(x + dx * scale, y + dy * scale, w * scale, h * scale, color);
  if (kind === 'damage') { px(3, 0); px(0, 3); px(6, 3); px(3, 6); px(2, 2, 3, 3); return; }
  if (kind === 'cadence') { px(2, 0, 3, 1); px(2, 6, 3, 1); px(0, 2, 1, 3); px(6, 2, 1, 3); px(3, 3, 1, 3); px(3, 3, 3, 1); return; }
  if (kind === 'range') { px(3, 0); px(3, 6); px(0, 3); px(6, 3); px(3, 3); return; }
  if (kind === 'network') { px(0, 1, 2, 2); px(5, 4, 2, 2); px(2, 2); px(3, 3); px(4, 4); return; }
  if (kind === 'magazine') { px(1, 1, 5, 1); px(1, 3, 5, 1); px(1, 5, 5, 1); return; }
  if (kind === 'targeting') { px(0, 0, 2, 1); px(0, 0, 1, 2); px(5, 0, 2, 1); px(6, 0, 1, 2); px(0, 5, 1, 2); px(0, 6, 2, 1); px(5, 6, 2, 1); px(6, 5, 1, 2); px(3, 3); return; }
  if (kind === 'burst') { px(1, 4, 1, 3); px(3, 2, 1, 5); px(5, 4, 1, 3); return; }
  if (kind === 'chain') { px(0, 2, 3, 1); px(0, 2, 1, 3); px(0, 4, 3, 1); px(4, 1, 3, 1); px(6, 1, 1, 3); px(4, 3, 3, 1); return; }
  if (kind === 'blast') { px(3, 0); px(1, 1); px(5, 1); px(0, 3); px(6, 3); px(1, 5); px(5, 5); px(3, 6); px(2, 2, 3, 3); return; }
  if (kind === 'control') { px(3, 0, 1, 7); px(0, 3, 7, 1); px(1, 1); px(5, 1); px(1, 5); px(5, 5); return; }
  if (kind === 'speed') { px(0, 3, 2, 1); px(2, 2); px(2, 4); px(3, 1); px(3, 5); px(4, 0); px(4, 6); return; }
}

function drawArsenalTree(snapshot,tower) {
  uiHitboxes.length=0;
  const width=Math.min(620,logicalWidth-16),height=Math.min(330,logicalHeight-16);
  const x=(logicalWidth-width)/2,y=(logicalHeight-height)/2;
  const items=stationItems(snapshot,tower), column=(width-32)/3;
  researchSelection ??= 1;
  const selected=items.find((item)=>item.id===researchSelection)||items[0];
  drawTechPanel(x,y,width,height,COLOR.amber);
  bitmapText.draw('arsenal // upgrade tree',x+12,y+10,COLOR.amber,2);
  bitmapText.draw(`${snapshot.research.unlocked.length}/39 researched // every branch available`,x+12,y+30,COLOR.ink,1);
  for(let root=1;root<=3;root++) {
    const ordered=[];
    const visit=(id)=>{ordered.push(items.find((item)=>item.id===id));for(const child of items.filter((item)=>item.parent===id))visit(child.id);};
    visit(root);
    const positions=new Map(ordered.map((item,row)=>[item.id,{x:x+12+(root-1)*column+(item.tier-1)*7,y:y+48+row*14}]));
    for(const item of ordered){
      const p=positions.get(item.id),parent=positions.get(item.parent);
      if(parent){shapes.line(parent.x+2,parent.y+5,parent.x+2,p.y+5,1,COLOR.dimMint);shapes.line(parent.x+2,p.y+5,p.x,p.y+5,1,COLOR.dimMint);}
      const color=item.id===selected.id?COLOR.amber:item.owned?COLOR.mint:item.locked?COLOR.dimMint:COLOR.cyan;
      const itemWidth=column-18-(item.tier-1)*7;
      drawButton(`tree_${item.id}`,`${item.owned?'+':item.locked?'-':'>'} ${clippedUiText(item.label,column-38)}`,p.x,p.y,itemWidth,true,color,()=>{researchSelection=item.id;researchDetailPage=0;});
      drawResearchIcon(RESEARCH_ICON_KIND[item.id],p.x+itemWidth-9,p.y+3,color);
    }
  }
  const detailY=y+238;
  drawResearchIcon(RESEARCH_ICON_KIND[selected.id],x+12,detailY,COLOR.amber);
  bitmapText.draw(clippedUiText(selected.label,width-38),x+22,detailY,COLOR.amber,1);
  // The tree above already draws a connector line to the prerequisite node; no need to restate it here.
  const lines=wrapResearchText(selected.description,Math.floor((width-24)/6));
  lines.slice(0,3).forEach((line,i)=>bitmapText.draw(line,x+12,detailY+12+i*9,COLOR.ink,1));
  const wallet=snapshot.teamEconomy?.credits||0;
  const available=!selected.owned&&!selected.locked&&(snapshot.dev?.infiniteMoney||wallet>=selected.cost);
  const label=selected.owned?'owned':selected.locked?'unlock parent first':`buy // ${compactMetric(selected.cost)} cr // enter`;
  drawMenuButton('tree_buy',label,x+12,y+height-42,width-24,available?COLOR.mint:COLOR.red,()=>{if(available)purchaseStationItem(tower,selected);},available);
  drawMenuButton('tree_back','back // esc',x+12,y+height-21,width-24,COLOR.cyan,()=>towerMenuMode='actions');
}

function drawReactorTile(id, item, x, y, width, height, color, selected, action) {
  const hovered = pointInside(x, y, width, height);
  const rimColor = selected || hovered ? color : COLOR.dimMint;
  shapes.rect(x, y, width, height, COLOR.black);
  shapes.rect(x, y, width, 1, rimColor);
  shapes.rect(x, y + height - 1, width, 1, rimColor);
  shapes.rect(x, y, selected ? 3 : 1, height, rimColor);
  shapes.rect(x + width - 1, y, 1, height, rimColor);
  bitmapText.draw(clippedUiText(item.label, width - 8), x + 4, y + 4, selected || hovered ? color : COLOR.ink, 1);
  bitmapText.draw(item.maxRank === null ? `rank ${item.rank}` : `${item.rank}/${item.maxRank}`, x + 4, y + height - 11, COLOR.dimMint, 1);
  const meterX = x + 4, meterY = y + height - 6, meterW = width - 8;
  shapes.rect(meterX, meterY, meterW, 3, COLOR.black);
  const ratio = item.maxRank ? Math.min(1, item.rank / item.maxRank) : Math.min(1, item.rank / 20);
  shapes.rect(meterX, meterY, Math.max(0, Math.round(meterW * ratio)), 3, item.cost === null ? COLOR.mint : color);
  registerHitbox(id, x, y, width, height, { action });
}

function drawReactorGrid(snapshot, tower) {
  uiHitboxes.length = 0;
  const width = Math.min(560, logicalWidth - 16), height = Math.min(300, logicalHeight - 16);
  const x = (logicalWidth - width) / 2, y = (logicalHeight - height) / 2;
  const items = stationItems(snapshot, tower);
  if (!items.some((item) => item.id === researchSelection)) researchSelection = items[0]?.id ?? null;
  const selected = items.find((item) => item.id === researchSelection) || items[0];
  const wallet = snapshot.dev?.infiniteMoney ? Number.MAX_SAFE_INTEGER : snapshot.teamEconomy?.credits || 0;
  drawTechPanel(x, y, width, height, COLOR.amber);
  bitmapText.draw('reactor // global ranks', x + 12, y + 10, COLOR.amber, 2);
  bitmapText.draw(`credits ${snapshot.dev?.infiniteMoney ? 'inf' : compactMetric(wallet)}`, x + 12, y + 30, COLOR.ink, 1);
  const cols = 3, rows = Math.ceil(items.length / cols);
  const detailHeight = 66;
  const gridTop = y + 44, gridWidth = width - 24;
  const tileW = (gridWidth - (cols - 1) * 4) / cols;
  const tileH = Math.max(28, (height - 44 - detailHeight - (rows - 1) * 4) / rows);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const col = i % cols, row = Math.floor(i / cols);
    const tx = x + 12 + col * (tileW + 4), ty = gridTop + row * (tileH + 4);
    const capped = item.cost === null;
    const color = item.id === selected.id ? COLOR.amber : capped ? COLOR.mint : COLOR.cyan;
    drawReactorTile(`reactor_tile_${item.id}`, item, tx, ty, tileW, tileH, color, item.id === selected.id, () => { researchSelection = item.id; });
  }
  const detailY = gridTop + rows * (tileH + 4) + 4;
  bitmapText.draw(clippedUiText(selected.label, width - 24), x + 12, detailY, COLOR.amber, 1);
  const lines = wrapResearchText(selected.description, Math.floor((width - 24) / 6));
  lines.slice(0, 1).forEach((line, i) => bitmapText.draw(line, x + 12, detailY + 11 + i * 9, COLOR.ink, 1));
  const available = selected.cost !== null && (snapshot.dev?.infiniteMoney || wallet >= selected.cost);
  const label = selected.cost === null ? 'rank capped' : `rank ${selected.rank} -> ${selected.rank + 1} // ${compactMetric(selected.cost)} cr // enter`;
  drawMenuButton('reactor_buy', label, x + 12, y + height - 42, width - 24, available ? COLOR.mint : COLOR.red, () => { if (available) purchaseStationItem(tower, selected); }, available);
  drawMenuButton('reactor_back', 'back // esc', x + 12, y + height - 21, width - 24, COLOR.cyan, () => towerMenuMode = 'actions');
}

function drawStatsPanel(snapshot) {
  const reactorLines = REACTOR_CATEGORIES
    .map((category) => ({ category, rank: reactorRank(snapshot, category.id) }))
    .filter(({ rank }) => rank > 0)
    .map(({ category, rank }) => `${category.label} // rank ${rank}${category.maxRank !== null ? `/${category.maxRank}` : ''}`);
  const unlocked = snapshot.research?.unlocked || [];
  const scopeCounts = new Map();
  for (const node of RESEARCH_NODES) {
    if (!hasResearch(snapshot, node.id)) continue;
    const scope = researchScope(node.id).replace('affects ', '');
    scopeCounts.set(scope, (scopeCounts.get(scope) || 0) + 1);
  }
  const mints = snapshot.towers.filter((tower) => tower.definitionId === 'mint');
  const forges = snapshot.towers.filter((tower) => tower.definitionId === 'forge');
  const constructionDiscount = Math.round((1 - Math.max(0.5, 0.98 ** reactorRank(snapshot, 'construction'))) * 100);
  const economy = snapshot.teamEconomy;
  const lines = [
    { text: 'reactor ranks', color: COLOR.amber },
    ...(reactorLines.length ? reactorLines : ['no ranks purchased']).map((text) => ({ text, color: COLOR.ink })),
    { text: 'arsenal research', color: COLOR.amber },
    { text: `${unlocked.length}/39 unlocked`, color: COLOR.ink },
    ...[...scopeCounts.entries()].map(([scope, count]) => ({ text: `${scope} // ${count}`, color: COLOR.ink })),
    { text: 'economy', color: COLOR.amber },
    { text: `+${constructionDiscount}% build discount // construction rank ${reactorRank(snapshot, 'construction')}`, color: COLOR.ink },
    { text: `${mints.length} mint-s // ${forges.length} forge-s deployed`, color: COLOR.ink },
    { text: `${compactMetric(snapshot.stats?.bonusCredits || 0)}cr shared economy bonus // ${compactMetric(economy?.totalEarned || 0)}cr earned`, color: COLOR.ink }
  ];
  const width = Math.min(280, logicalWidth - 16);
  const height = Math.min(20 + lines.length * 10 + 6, logicalHeight - HUD_TOP_HEIGHT - 20);
  const x = logicalWidth - width - 8, y = HUD_TOP_HEIGHT + 8;
  drawTechPanel(x, y, width, height, COLOR.cyan);
  bitmapText.draw('modifier summary // i to close', x + 8, y + 6, COLOR.cyan, 1);
  let row = 0;
  for (const line of lines) {
    const lineY = y + 20 + row * 10;
    if (lineY > y + height - 8) break;
    bitmapText.draw(clippedUiText(line.text, width - 16), x + 8, lineY, line.color, 1);
    row += 1;
  }
}

function drawResearchStation(snapshot, tower) {
  if(tower.definitionId==='arsenal' && logicalWidth>=400 && logicalHeight>=346) return drawArsenalTree(snapshot,tower);
  if(tower.definitionId==='reactor' && logicalWidth>=400 && logicalHeight>=300) return drawReactorGrid(snapshot,tower);
  uiHitboxes.length = 0;
  const width = Math.min(420, logicalWidth - 20), height = Math.min(288, logicalHeight - 16);
  const x = (logicalWidth - width) / 2, y = (logicalHeight - height) / 2;
  const perPage = height < 240 ? 1 : 3;
  const items = stationItems(snapshot,tower);
  const pages = Math.max(1,Math.ceil(items.length/perPage));
  researchPage = Math.max(0,Math.min(pages-1,researchPage));
  const visible = items.slice(researchPage*perPage,(researchPage+1)*perPage);
  if (!visible.some((item) => item.id === researchSelection)) researchSelection = visible[0]?.id ?? null;
  const selected = visible.find((item) => item.id === researchSelection);
  drawTechPanel(x,y,width,height,COLOR.amber);
  bitmapText.draw(tower.definitionId, x+12,y+9,COLOR.amber,2);
  bitmapText.draw(`global research ${snapshot.research?.unlocked.length || 0}/39`,x+12,y+30,COLOR.ink,1);
  if (pages > 1) {
    drawButton('research_prev','<',x+width-77,y+9,20,true,COLOR.cyan,() => { researchPage=(researchPage+pages-1)%pages; researchDetailPage=0; });
    drawButton('research_next','>',x+width-27,y+9,20,true,COLOR.cyan,() => { researchPage=(researchPage+1)%pages; researchDetailPage=0; });
    bitmapText.draw(`${researchPage+1}/${pages}`,x+width-53,y+12,COLOR.ink,1);
  }
  for (let i=0;i<visible.length;i++) {
    const item=visible[i];
    const cost=item.cost===null?'capped':item.cost===0?'owned':compactMetric(item.cost);
    drawMenuButton(`research_select_${item.id}`,`${i+1} ${clippedUiText(item.label, width - 120)}`,x+12,y+48+i*20,width-24,COLOR.mint,() => {
      researchSelection=item.id; researchDetailPage=0;
    },selected?.id===item.id);
    if (RESEARCH_ICON_KIND[item.id]) drawResearchIcon(RESEARCH_ICON_KIND[item.id],x+width-108,y+53+i*20,COLOR.mint);
    const wallet = (snapshot.dev?.infiniteMoney ? Number.MAX_SAFE_INTEGER : snapshot.teamEconomy?.credits || 0);
    bitmapText.draw(cost, x + width - 18 - cost.length * 6, y + 53 + i * 20, item.cost !== null && wallet >= item.cost ? COLOR.amber : COLOR.red, 1);
  }
  if (selected) {
    const detailY=y+54+perPage*20;
    const lines=wrapResearchText((selected.parent ? `requires ${researchNode(selected.parent).label}. ` : '')+selected.description,Math.floor((width-24)/6));
    const lineCount=Math.max(1,Math.floor((y+height-66-detailY)/9));
    const detailPages=Math.ceil(lines.length/lineCount);
    researchDetailPage %= Math.max(1,detailPages);
    lines.slice(researchDetailPage*lineCount,(researchDetailPage+1)*lineCount).forEach((line,i)=>bitmapText.draw(line,x+12,detailY+i*9,COLOR.ink,1));
    if(detailPages>1) drawButton('research_more','details >',x+width-76,y+height-64,64,true,COLOR.cyan,()=>researchDetailPage++);
    else bitmapText.draw(tower.definitionId==='arsenal'?researchScope(selected.id):`rank ${selected.rank} -> ${selected.rank+1}`,x+12,y+height-64,COLOR.ink,1);
    const wallet=(snapshot.dev?.infiniteMoney ? Number.MAX_SAFE_INTEGER : snapshot.teamEconomy?.credits || 0);
    bitmapText.draw(`credits ${snapshot.dev?.infiniteMoney ? 'inf' : compactMetric(wallet)} // cost ${selected.cost===null?'capped':selected.cost.toLocaleString('en-US')}`,x+12,y+height-52,COLOR.amber,1);
    const canBuy=!selected.owned && !selected.locked && selected.cost!==null && wallet>=selected.cost;
    drawMenuButton('research_buy',canBuy?(selected.cost===0?'already researched':'buy selected // enter'):selected.owned?'already researched':selected.locked?'unlock parent research first':selected.cost===null?'maximum rank reached':'need more credits',x+12,y+height-41,width-24,canBuy?COLOR.mint:COLOR.red,()=>{
      if(canBuy) purchaseStationItem(tower,selected);
    },canBuy);
  } else bitmapText.draw('all research complete',x+12,y+70,COLOR.mint,1);
  drawMenuButton('research_back','back // esc',x+12,y+height-21,width-24,COLOR.cyan,()=>towerMenuMode='actions');
}

function economyNetworkSummary(snapshot, tower) {
  // The authority only ever credits one representative tower per network for a shared
  // bonus (see recordAttackResult / applyKillIncomeSupport); presenting the summed total
  // across the whole network - not this one tower's own field - is what actually matches
  // the shared mechanic, without touching the underlying accounting.
  const networkTowers = networkSources(snapshot, tower.areaId);
  const mints = networkTowers.filter((candidate) => candidate.definitionId === 'mint');
  const forges = networkTowers.filter((candidate) => candidate.definitionId === 'forge');
  return {
    mintCount: mints.length,
    mintBonusPercent: mints.length ? 20 + mints.length - 1 : 0,
    mintCredits: mints.reduce((total, candidate) => total + (candidate.bonusCredits || 0), 0),
    forgeCount: forges.length,
    forgeCredits: forges.reduce((total, candidate) => total + (candidate.bonusCredits || 0), 0)
  };
}

function towerActionView(snapshot, tower) {
  const definition = snapshot.towerCatalog.find((candidate) => candidate.id === tower.definitionId);
  if (!definition) return null;
  const owner = snapshot.players.find((player) => player.id === tower.ownerId);
  const inspectOnly = false;
  const actions = [];
  const panel = { x: 0, y: 0 };
  const addAction = (id, label, x, y, width, active, color, action) => {
    actions.push({ id, label, x, y, width, active, color, action });
  };
  const station = ['arsenal', 'reactor'].includes(definition.id);
  if (station) {
    addAction('station_open', '1 open upgrades', 5, 20, 170, true, COLOR.mint, () => openResearchStation(tower));
    addAction('station_sell', `2 sell // ${compactMetric(saleRefund(snapshot, tower))}`, 5, 36, 170, true, COLOR.red, sellSelectedTower);
    return { title: definition.label, investment: compactMetric(tower.totalInvestment), metric: 'research is never refunded',
      width: 180, height: 66, accent: COLOR.amber, actions, inspectOnly, owner: owner?.label || 'pilot', station: true };
  }
  const canAim = supportsStrikePoint(weaponView(snapshot, tower)?.attack);
  const effectiveControl = weaponView(snapshot, tower)?.control;
  const canControl = Boolean(effectiveControl?.input && effectiveControl.input !== 'none');
  const relayForm = isRelayForm(definition.id);
  const hasManualControl = canAim || canControl || relayForm;
  const isEconomyNode = ['mint', 'forge'].includes(definition.id);
  const width = 150;
  const height = definition.id === 'echo' && (canAim || canControl) ? 97 : ['echo', 'hardpoint'].includes(definition.id) ? 81 : hasManualControl ? 65 : 49;
  const supportLabel = tower.bonusCredits > 0 ? ` +${compactMetric(tower.bonusCredits)} cr` : '';
  const isPureControl = Boolean(weaponView(snapshot, tower)?.supportOnly);
  const controlLabels = {
    stasis_zone: 'held',
    recall_gate: 'recalled',
    slow_zone: 'slowed', frost_zone: 'chilled', barricade: 'blocked',
    singularity: 'shaped',
    braid: 'shaped',
    breaker_wave: 'pushed',
    crosswind: 'steered',
    splitter: 'split'
  };
  const discreteControl = ['stasis_zone', 'recall_gate', 'breaker_wave'].includes(definition.control?.type);
  const controlValue = discreteControl
    ? tower.controlStats?.affectedUnits || 0
    : Math.floor((tower.controlStats?.affectedUnitTicks || 0) / AUTHORITY_TICK_RATE);
  const economy = isEconomyNode ? economyNetworkSummary(snapshot, tower) : null;
  const metricLabel = isEconomyNode
    ? (definition.id === 'mint'
      ? `+${economy.mintBonusPercent}% income // ${compactMetric(economy.mintCredits)}cr shared // ${economy.mintCount} mint-s`
      : `base income // ${compactMetric(economy.forgeCredits)}cr shared // ${economy.forgeCount} forge-s`)
    : isPureControl && weaponView(snapshot, tower)?.attack
    ? `casts // ${compactMetric(tower.controlStats?.activations || 0)}`
    : isPureControl
    ? `${controlLabels[definition.control?.type] || 'affected'} // ${compactMetric(controlValue)}${discreteControl ? '' : ' unit-s'}`
    : `kills // ${compactMetric(tower.kills || 0)}${supportLabel}`;
  const recentlyActive = isPureControl
    ? tower.controlStats?.lastActiveTick > 0 && snapshot.runTick - tower.controlStats.lastActiveTick <= AUTHORITY_TICK_RATE * 0.45
    : tower.lastKillTick > 0 && snapshot.runTick - tower.lastKillTick <= AUTHORITY_TICK_RATE * 0.45;

  const view = { title: definition.label, investment: compactMetric(tower.totalInvestment), metric: metricLabel,
    width, height, accent: towerAccent(tower.definitionId), actions, inspectOnly, owner: owner?.label || 'pilot', recentlyActive };
  if (inspectOnly) return view;
  const refund = saleRefund(snapshot, tower);
  const hasChoices = definition.evolutionChoices?.length > 0;
  const isRelay = relayForm && !hasChoices;
  addAction(
    `tower_upgrade_${tower.id}`,
    isRelay ? (tower.relayTargetAreaId ? '1 relink' : '1 link') : hasChoices ? '1 upgrade' : '1 upgrade ?',
    panel.x + 5,
    panel.y + 31,
    65,
    hasChoices || isRelay,
    COLOR.mint,
    () => isRelay ? openRelayTargetMenu(snapshot, tower) : openUpgradeMenu(snapshot, tower)
  );
  addAction(
    `tower_sell_${tower.id}`,
    `2 sell ${compactMetric(refund)}`,
    panel.x + 75,
    panel.y + 31,
    70,
    true,
    COLOR.red,
    sellSelectedTower
  );
  if (relayForm) {
    addAction(`network_link_${tower.id}`, '3 link nebula', panel.x + 5, panel.y + 47, 140, true, COLOR.cyan, () => openRelayTargetMenu(snapshot, tower));
    if (['echo', 'hardpoint'].includes(definition.id)) addAction(`network_config_${tower.id}`,
      definition.id === 'echo' ? `copy: ${tower.echoWeaponId || 'select control'}` : 'position build socket',
      panel.x + 5, panel.y + 63, 140, true, COLOR.amber, () => {
        towerMenuMode = definition.id === 'echo' ? 'echo' : 'socket';
        setStatus(definition.id === 'echo' ? 'click a connected control turret' : 'click along the relay line');
      });
    if (definition.id === 'echo' && canControl) {
      addAction(`echo_control_${tower.id}`, 'reshape control', panel.x + 5, panel.y + 79, 140, true, COLOR.cyan, () => openControlGeometryMenu(snapshot, tower));
    } else if (definition.id === 'echo' && canAim) {
      addAction(`echo_aim_${tower.id}`, 'aim point', panel.x + 5, panel.y + 79, 88, true, COLOR.cyan, () => openStrikeTargetMenu(snapshot, tower));
      addAction(`echo_auto_${tower.id}`, 'auto', panel.x + 98, panel.y + 79, 47, true, COLOR.amber, clearSelectedStrikePoint);
    }
  } else if (hasManualControl) {
    addAction(
      `tower_aim_${tower.id}`,
      canControl
        ? (definition.control.input === 'direction' ? '3 redirect' : '3 reshape')
        : (tower.strikePoint ? '3 re-aim' : '3 aim point'),
      panel.x + 5,
      panel.y + 47,
      88,
      true,
      COLOR.cyan,
      () => canControl ? openControlGeometryMenu(snapshot, tower) : openStrikeTargetMenu(snapshot, tower)
    );
    addAction(
      `tower_auto_aim_${tower.id}`,
      canControl ? '0 reset' : '0 auto',
      panel.x + 98,
      panel.y + 47,
      47,
      Boolean(canControl ? tower.controlGeometry : tower.strikePoint),
      COLOR.amber,
      canControl ? resetSelectedControlGeometry : clearSelectedStrikePoint
    );
  }
  return view;
}

function drawTowerActionMenu(snapshot, tower) {
  const view = towerActionView(snapshot, tower);
  if (!view) return;
  if (sessionMode === 'game') return drawPixelTowerActions(tower, view);
  const panel = towerPanelPosition(tower, view.width, view.height);
  drawTechPanel(panel.x, panel.y, view.width, view.height, view.accent);
  bitmapText.draw(view.station ? view.title : `${view.title} // ${view.investment} cr`, panel.x + 7, panel.y + 5, view.accent, 1);
  bitmapText.draw(clippedUiText(view.metric, view.width - 14), panel.x + 7, panel.y + (view.station ? 54 : 16), view.station ? COLOR.dimMint : view.recentlyActive ? COLOR.mint : COLOR.ink, 1);
  if (!view.station) {
    shapes.rect(panel.x + view.width - 16, panel.y + 17, 8, 1, view.recentlyActive ? COLOR.amber : COLOR.dimMint);
    if (view.recentlyActive) {
      shapes.rect(panel.x + view.width - 13, panel.y + 15, 2, 5, COLOR.amber);
      shapes.rect(panel.x + view.width - 9, panel.y + 16, 1, 3, COLOR.mint);
    }
  }
  if (view.inspectOnly) {
    bitmapText.draw(clippedUiText(`owner ${view.owner}`, view.width - 14), panel.x + 7, panel.y + 31, COLOR.cyan, 1);
    bitmapText.draw('inspect only', panel.x + 7, panel.y + 40, COLOR.dimMint, 1);
  }
  for (const button of view.actions) drawButton(button.id, button.label, panel.x + button.x, panel.y + button.y,
    button.width, button.active, view.station && button.id === 'station_sell' ? COLOR.amber : button.color, button.action);
}

function drawPixelTowerActions(tower, view) {
  if (towerActionPageTowerId !== tower.id) {
    towerActionPageTowerId = tower.id;
    towerActionPage = 0;
  }
  const width = Math.min(208, logicalWidth - 10);
  const layout = pixelActionLayout(view.actions, hudBottomY - HUD_TOP_HEIGHT - 8, towerActionPage);
  towerActionPage = layout.page;
  const height = view.inspectOnly ? 64 : layout.height;
  const panel = towerPanelPosition(tower, width, height);
  drawTechPanel(panel.x, panel.y, width, height, view.accent);
  // The panel's empty space must consume clicks too; buttons are registered afterwards.
  registerHitbox(`tower_panel_${tower.id}`, panel.x, panel.y, width, height);
  bitmapText.draw(clippedUiText(view.title, width - 24), panel.x + 8, panel.y + 6, view.accent, 1);
  bitmapText.draw(clippedUiText(view.metric, width - 16), panel.x + 8, panel.y + 17, COLOR.ink, 1);
  bitmapText.draw(`invested ${view.investment} cr`, panel.x + 8, panel.y + 28, COLOR.uiMuted, 1);
  shapes.rect(panel.x + 8, panel.y + 37, width - 16, 1, COLOR.dimMint);
  if (view.inspectOnly) {
    bitmapText.draw(clippedUiText(`owner ${view.owner}`, width - 16), panel.x + 8, panel.y + 43, COLOR.cyan, 1);
    bitmapText.draw('inspect only', panel.x + 8, panel.y + 53, COLOR.uiMuted, 1);
    return;
  }
  for (const [rowIndex, row] of layout.rows.entries()) {
    const buttonWidth = Math.floor((width - 16 - (row.length - 1) * 6) / row.length);
    for (const [index, button] of row.entries()) {
      drawButton(button.id, button.label, panel.x + 8 + index * (buttonWidth + 6), panel.y + 41 + rowIndex * 21,
        buttonWidth, button.active, button.color, button.action, 17);
    }
  }
  if (layout.pages > 1) {
    const y = panel.y + height - 16;
    drawButton('tower_actions_prev', '<', panel.x + 8, y, 22, false, COLOR.cyan,
      () => { towerActionPage = (layout.page + layout.pages - 1) % layout.pages; });
    bitmapText.draw(`actions ${layout.page + 1}/${layout.pages}`, panel.x + 38, y + 3, COLOR.uiMuted, 1);
    drawButton('tower_actions_next', '>', panel.x + width - 30, y, 22, false, COLOR.cyan,
      () => { towerActionPage = (layout.page + 1) % layout.pages; });
  }
}

function wrappedDescription(lines, maximumCharacters, maximumLines) {
  const output = [];
  for (const sourceLine of lines || []) {
    const words = sourceLine.split(' ');
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length <= maximumCharacters) line = candidate;
      else {
        if (line) output.push(line);
        line = word;
      }
    }
    if (line) output.push(line);
    if (output.length >= maximumLines) break;
  }
  return output.slice(0, maximumLines);
}

function drawUpgradeChoice(snapshot, tower, definition, shortcut, x, y, width, height) {
  const economy = snapshot.teamEconomy;
  const cost = purchaseCost(snapshot, tower.areaId, definition.evolutionCost || 0);
  const affordable = (sessionSnapshot.dev?.infiniteMoney ? Number.MAX_SAFE_INTEGER : (economy?.credits || 0)) >= cost;
  const accent = affordable ? towerAccent(definition.id) : COLOR.red;
  const hovered = pointInside(x, y, width, height);
  shapes.rect(x, y, width, height, COLOR.black);
  shapes.rect(x, y, width, 1, hovered ? accent : COLOR.dimMint);
  shapes.rect(x, y + height - 1, width, 1, hovered ? accent : COLOR.dimMint);
  shapes.rect(x, y, 1, height, hovered ? accent : COLOR.dimMint);
  shapes.rect(x + width - 1, y, 1, height, hovered ? accent : COLOR.dimMint);
  shapes.rect(x + 3, y + 3, hovered ? 12 : 5, 2, accent);
  if (hovered) shapes.rect(x + width - 5, y + 3, 2, 5, accent);
  bitmapText.draw(`${shortcut} ${definition.label}`, x + 5, y + 9, accent, 1);
  bitmapText.draw(definition.role || 'branch', x + 5, y + 19, COLOR.ink, 1);
  bitmapText.draw(`${compactMetric(cost)} cr`, x + 5, y + 30, affordable ? COLOR.amber : COLOR.red, 1);
  shapes.rect(x + 5, y + 40, width - 10, 1, COLOR.dimMint);
  const maximumCharacters = Math.max(6, Math.floor((width - 10) / 6));
  const lines = wrappedDescription(definition.description, maximumCharacters, 4);
  for (let index = 0; index < lines.length; index += 1) {
    bitmapText.draw(lines[index], x + 5, y + 46 + index * 10, COLOR.ink, 1);
  }
  registerHitbox(`upgrade_choice_${tower.id}_${definition.id}`, x, y, width, height, {
    action: () => {
      if (!affordable) {
        setStatus(`need ${compactMetric(cost)} credits`);
        return;
      }
      evolveSelectedTower(definition.id);
    }
  });
}

function drawTowerUpgradeMenu(snapshot, tower) {
  const current = snapshot.towerCatalog.find((candidate) => candidate.id === tower.definitionId);
  const choices = (current?.evolutionChoices || [])
    .map((id) => snapshot.towerCatalog.find((candidate) => candidate.id === id))
    .filter(Boolean);
  if (!choices.length) {
    towerMenuMode = 'actions';
    return;
  }
  const width = Math.min(342, logicalWidth - 10);
  const height = 116;
  const panel = towerPanelPosition(tower, width, height);
  drawTechPanel(panel.x, panel.y, width, height, COLOR.mint);
  const cost = purchaseCost(snapshot, tower.areaId, choices[0]?.evolutionCost || 0);
  bitmapText.draw(`upgrade // 1 2 3 choose // ${compactMetric(cost)} cr`, panel.x + 7, panel.y + 5, COLOR.mint, 1);
  drawButton(`upgrade_back_${tower.id}`, 'back', panel.x + width - 39, panel.y + 3, 34, false, COLOR.cyan, () => {
    towerMenuMode = 'actions';
  });
  const gap = 3;
  const cardX = panel.x + 5;
  const cardY = panel.y + 19;
  const cardHeight = height - 24;
  const cardWidth = Math.floor((width - 10 - gap * (choices.length - 1)) / choices.length);
  choices.forEach((definition, index) => {
    drawUpgradeChoice(snapshot, tower, definition, index + 1, cardX + index * (cardWidth + gap), cardY, cardWidth, cardHeight);
  });
}

function drawRelayTargetMenu(snapshot, tower) {
  const definition = snapshot.towerCatalog.find((candidate) => candidate.id === tower.definitionId);
  const candidates = relayCandidateAreas(snapshot, tower);
  const width = 188;
  const height = 43;
  const panel = towerPanelPosition(tower, width, height);
  drawTechPanel(panel.x, panel.y, width, height, COLOR.cyan);
  bitmapText.draw('relay // choose nebula', panel.x + 7, panel.y + 6, COLOR.cyan, 1);
  bitmapText.draw(`${candidates.length} in ${definition?.linkRange || 0}u // click field`, panel.x + 7, panel.y + 18, candidates.length ? COLOR.ink : COLOR.red, 1);
  drawButton(`relay_back_${tower.id}`, 'back', panel.x + width - 39, panel.y + 27, 34, false, COLOR.amber, () => {
    towerMenuMode = 'actions';
  });
}

function drawStrikeTargetMenu(snapshot, tower) {
  const definition = snapshot.towerCatalog.find((candidate) => candidate.id === tower.definitionId);
  const width = 210;
  const height = 43;
  const panel = towerPanelPosition(tower, width, height);
  drawTechPanel(panel.x, panel.y, width, height, COLOR.cyan);
  const shotgun = definition?.attack?.mechanic === 'shotgun';
  const beam = ['hitscan', 'persistent'].includes(definition?.attack?.delivery?.type);
  bitmapText.draw(shotgun ? 'fan aim // click a facing' : beam ? 'beam aim // click a direction' : 'rocket aim // click strike point', panel.x + 7, panel.y + 6, COLOR.cyan, 1);
  bitmapText.draw(`${tower.effectiveRange || definition?.range || 0}u // ${shotgun ? 'fires when the fan has a target' : beam ? 'authority-aimed beam' : 'exact authority airburst'}`, panel.x + 7, panel.y + 18, COLOR.ink, 1);
  drawButton(`strike_auto_${tower.id}`, '0 auto', panel.x + width - 82, panel.y + 27, 40, Boolean(tower.strikePoint), COLOR.amber, clearSelectedStrikePoint);
  drawButton(`strike_back_${tower.id}`, '2 back', panel.x + width - 39, panel.y + 27, 34, false, COLOR.cyan, () => {
    towerMenuMode = sessionMode === 'game' ? 'actions' : null;
  });
}

function drawControlGeometryMenu(snapshot, tower) {
  const definition = weaponView(snapshot, tower);
  const width = 216;
  const height = 43;
  const panel = towerPanelPosition(tower, width, height);
  drawTechPanel(panel.x, panel.y, width, height, COLOR.cyan);
  const input = definition?.control?.input || 'point';
  const verb = input === 'line' ? (definition?.id === 'braid' ? 'drag along flow' : 'drag line') : input === 'direction' ? (definition.control.type === 'aim' ? 'set facing' : 'choose left / right') : 'place field';
  const rebootTicks = Math.max(0, (tower.controlReadyTick || 0) - snapshot.runTick);
  bitmapText.draw(`${definition?.label || 'control'} // ${verb}`, panel.x + 7, panel.y + 6, COLOR.cyan, 1);
  bitmapText.draw(rebootTicks > 0 ? `reboot // ${(rebootTicks / AUTHORITY_TICK_RATE).toFixed(1)}s` : `${tower.effectiveRange || definition?.range || 0}u // authority locked`, panel.x + 7, panel.y + 18, rebootTicks > 0 ? COLOR.amber : COLOR.ink, 1);
  drawButton(`control_reset_${tower.id}`, '0 reset', panel.x + width - 88, panel.y + 27, 46, true, COLOR.amber, resetSelectedControlGeometry);
  drawButton(`control_back_${tower.id}`, '2 back', panel.x + width - 39, panel.y + 27, 34, false, COLOR.cyan, () => {
    towerMenuMode = sessionMode === 'game' ? 'actions' : null;
  });
}

function drawTowerMenu(snapshot, tower) {
  if (towerMenuMode === 'research') return;
  if (towerMenuMode === 'upgrades') drawTowerUpgradeMenu(snapshot, tower);
  else if (towerMenuMode === 'relay') drawRelayTargetMenu(snapshot, tower);
  else if (towerMenuMode === 'strike') drawStrikeTargetMenu(snapshot, tower);
  else if (towerMenuMode === 'control') drawControlGeometryMenu(snapshot, tower);
  else drawTowerActionMenu(snapshot, tower);
}

function killTelemetry(mode, snapshot) {
  const economy = snapshot.teamEconomy || { totalEarned: 0 };
  const totalEarned = Math.max(0, Math.floor(economy.totalEarned || 0));
  let telemetry = telemetryByMode.get(mode);
  if (!telemetry
    || telemetry.playerId !== session.playerId
    || snapshot.runTick < telemetry.lastTick
    || snapshot.stats.kills < telemetry.lastKills
    || totalEarned < telemetry.lastEarned) {
    telemetry = {
      playerId: session.playerId,
      samples: [],
      lastTick: snapshot.runTick,
      lastKills: snapshot.stats.kills,
      lastEarned: totalEarned,
      peak: 0
    };
    telemetryByMode.set(mode, telemetry);
  }
  if (snapshot.runTick !== telemetry.lastTick
    || snapshot.stats.kills !== telemetry.lastKills
    || totalEarned !== telemetry.lastEarned
    || telemetry.samples.length === 0) {
    telemetry.samples.push({ tick: snapshot.runTick, kills: snapshot.stats.kills, earned: totalEarned });
    telemetry.lastTick = snapshot.runTick;
    telemetry.lastKills = snapshot.stats.kills;
    telemetry.lastEarned = totalEarned;
    while (telemetry.samples.length > 1 && telemetry.samples[1].tick < snapshot.runTick - AUTHORITY_TICK_RATE * 10) telemetry.samples.shift();
  }
  const rateFor = (seconds, field, current) => {
    const minimumTick = snapshot.runTick - seconds * AUTHORITY_TICK_RATE;
    let sample = telemetry.samples[0] || { tick: snapshot.runTick, [field]: current };
    for (const candidate of telemetry.samples) {
      if (candidate.tick >= minimumTick) {
        sample = candidate;
        break;
      }
    }
    const ticks = Math.max(1, snapshot.runTick - sample.tick);
    return (current - sample[field]) * AUTHORITY_TICK_RATE / ticks;
  };
  const oneSecond = rateFor(1, 'kills', snapshot.stats.kills);
  const tenSecond = rateFor(10, 'kills', snapshot.stats.kills);
  const goldPerSecond = rateFor(5, 'earned', totalEarned);
  telemetry.peak = Math.max(telemetry.peak, oneSecond);
  return { oneSecond, tenSecond, peak: telemetry.peak, goldPerSecond };
}

function formatRunTimer(runTick) {
  const totalSeconds = Math.max(0, Math.floor(runTick / AUTHORITY_TICK_RATE));
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = String(totalMinutes % 60).padStart(2, '0');
  const hours = Math.floor(totalMinutes / 60);
  return hours > 0 ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
}

function drawTopHud(fps, snapshot, telemetry) {
  if (sessionMode === 'game') return drawGameTopHud(fps, snapshot, telemetry);
  const economy = snapshot.teamEconomy || { credits: snapshot.prototypeBalance.startingCredits };
  shapes.rect(0, 0, logicalWidth, HUD_TOP_HEIGHT, COLOR.black);
  shapes.rect(0, HUD_TOP_HEIGHT - 1, logicalWidth, 1, COLOR.dimMint);
  shapes.rect(0, HUD_TOP_HEIGHT - 1, Math.min(132, logicalWidth), 1, sessionMode === 'test' ? COLOR.amber : COLOR.mint);
  shapes.rect(4, 4, 2, 14, sessionMode === 'test' ? COLOR.amber : COLOR.mint);
  shapes.rect(logicalWidth - 6, 4, 2, 14, COLOR.red);
  bitmapText.draw('framebound', 11, 5, COLOR.mint, 1);
  bitmapText.draw(sessionMode === 'test' ? '//test' : '//horde', 75, 5, sessionMode === 'test' ? COLOR.amber : COLOR.red, 1);
  bitmapText.draw(`lives ${String(snapshot.base.lives).padStart(3, '0')}`, 130, 5, COLOR.ink, 1);
  bitmapText.draw(`credits ${snapshot.dev?.infiniteMoney ? 'inf' : compactMetric(economy.credits)}`, 208, 5, COLOR.amber, 1);
  bitmapText.draw(`horde ${compactMetric(snapshot.swarm.activeEnemies)}`, 322, 5, COLOR.red, 1);
  const fpsX = logicalWidth - 54;
  const timerLabel = `time ${formatRunTimer(snapshot.runTick)}`;
  const timerX = fpsX - timerLabel.length * 6 - 12;
  const spawnLabel = logicalWidth >= 720
    ? `spawn ${Math.round(snapshot.swarm.spawnRatePerSecond)}/s x${snapshot.swarm.activeSpawnPoints}`
    : `spawn ${Math.round(snapshot.swarm.spawnRatePerSecond)}/s`;
  if (416 + spawnLabel.length * 6 < timerX - 6) bitmapText.draw(spawnLabel, 416, 5, COLOR.ink, 1);
  let telemetryX = 532;
  const goldLabel = `gold ${compactMetric(telemetry.goldPerSecond)}/s`;
  if (telemetryX + goldLabel.length * 6 < timerX - 6) {
    bitmapText.draw(goldLabel, telemetryX, 5, COLOR.amber, 1);
    telemetryX += goldLabel.length * 6 + 8;
  }
  if (session.networkRole) {
    const connected = snapshot.players.filter((player) => player.connected && !player.spectator).length;
    const networkLabel = `p2p ${connected}/4`;
    if (telemetryX + networkLabel.length * 6 < timerX - 6) {
      bitmapText.draw(networkLabel, telemetryX, 5, session.networkRole === 'host' ? COLOR.green : COLOR.cyan, 1);
      telemetryX += networkLabel.length * 6 + 8;
    }
  }
  const kpsLabel = `kps ${compactMetric(telemetry.oneSecond)}`;
  if (showKps && telemetryX + kpsLabel.length * 6 < timerX - 6) bitmapText.draw(kpsLabel, telemetryX, 5, COLOR.mint, 1);
  bitmapText.draw(timerLabel, timerX, 5, COLOR.amber, 1);
  bitmapText.draw(`fps ${String(fps).padStart(3, '0')}`, fpsX, 5, COLOR.cyan, 1);
}

function drawGameTopHud(fps, snapshot, telemetry) {
  const layout = pixelHudLayout(logicalWidth);
  const economy = snapshot.teamEconomy || { credits: snapshot.prototypeBalance.startingCredits };
  const elapsed = threatSecondsOf(snapshot);
  const rift = currentMap.spawnSources.find((source) => source.unlockSeconds > elapsed);
  shapes.rect(0, 0, logicalWidth, HUD_TOP_HEIGHT, COLOR.black);
  shapes.rect(0, HUD_TOP_HEIGHT - 1, logicalWidth, 1, COLOR.dimMint);
  shapes.rect(0, HUD_TOP_HEIGHT - 1, layout.brandWidth, 1, COLOR.mint);
  shapes.rect(4, 5, 2, HUD_TOP_HEIGHT - 12, COLOR.mint);
  bitmapText.draw('framebound', 11, 5, COLOR.mint, 1);
  bitmapText.draw('//horde', 11, 17, COLOR.uiMuted, 1);
  let x = layout.brandWidth + 12;
  // minValueChars reserves layout space for each metric's worst-case width (e.g. compactMetric's
  // longest form, "999.9t") so gaining or losing a digit never shifts this or later metrics.
  const metrics = [
    { label: 'lives', value: snapshot.dev?.infiniteHealth ? 'inf' : String(snapshot.base.lives).padStart(3, '0'), color: COLOR.ink, minValueChars: 3 },
    { label: 'credits', value: snapshot.dev?.infiniteMoney ? 'inf' : compactMetric(economy.credits), color: COLOR.amber, minValueChars: 6 },
    { label: rift ? 'next rift' : 'rifts live', value: rift ? `${Math.ceil(realSecondsUntil(snapshot, rift.unlockSeconds))}s` : String(snapshot.swarm.activeSpawnPoints), color: COLOR.cyan, minValueChars: 4 }
  ];
  const surge = surgeStatus(snapshot);
  if (surge) {
    metrics[2] = {
      label: surge.phase === 'warning' ? `surge ${surge.direction}` : `surge ${surge.direction} hot`,
      value: `${surge.seconds}s`,
      color: surge.phase === 'warning' ? COLOR.amber : COLOR.red,
      minValueChars: 4
    };
  }
  for (const metric of metrics) {
    bitmapText.draw(metric.label, x, 4, COLOR.uiMuted, 1);
    bitmapText.draw(metric.value, x, 15, metric.color, layout.valueScale);
    const valueWidth = Math.max(metric.value.length, metric.minValueChars) * 6 * layout.valueScale;
    x += Math.max(metric.label.length * 6, valueWidth) + 16;
  }
  const connected = snapshot.players.filter((player) => player.connected && !player.spectator).length;
  const columns = [
    { lines: [`time ${formatRunTimer(snapshot.runTick)}`, `horde ${compactMetric(snapshot.swarm.activeEnemies)}`], minChars: [13, 12] },
    { lines: [`gold ${compactMetric(telemetry.goldPerSecond)}/s`, `spawn ${Math.round(snapshot.swarm.spawnRatePerSecond)}/s`], minChars: [13, 13] },
    ...(session.networkRole ? [{ lines: [`p2p ${connected}/4`, session.networkRole], minChars: [7, 7] }] : []),
    { lines: [`fps ${fps}`, `rifts ${snapshot.swarm.activeSpawnPoints}`], minChars: [7, 8] },
    ...((snapshot.pace || DEFAULT_PACE) !== DEFAULT_PACE ? [{ lines: [`pace x${snapshot.pace.toFixed(1)}`, snapshot.pace < DEFAULT_PACE ? 'slower' : 'faster'], minChars: [9, 6] }] : [])
  ];
  for (const column of fitPixelTelemetry(columns, x + 4, logicalWidth - 8)) {
    bitmapText.draw(column.lines[0], column.x, 5, COLOR.ink, 1);
    bitmapText.draw(column.lines[1], column.x, 17, COLOR.uiMuted, 1);
  }
}

function drawGameHud(snapshot, telemetry) {
  const y = hudBottomY;
  const layout = pixelHudLayout(logicalWidth);
  const selectedTower = snapshot.towers.find((tower) => tower.id === selectedTowerId);
  const definition = snapshot.towerCatalog.find((item) => item.id === selectedTower?.definitionId);
  const input = definition?.control?.input;
  const bulk = snapshot.towerCatalog.find((item) => item.id === bulkPlacementDefinitionId);
  shapes.rect(0, y, logicalWidth, logicalHeight - y, COLOR.black);
  shapes.rect(0, y, logicalWidth, 1, COLOR.dimMint);
  shapes.rect(0, y, 92, 1, COLOR.cyan);
  const button = (rect, id, label, active, color, action) =>
    drawButton(id, label, rect.x, y + rect.y, rect.width, active, color, action, rect.height);
  button(layout.left[0], 'place_frame', bulk ? `x ${bulk.label}` : placementArmed ? '1 placing one' : '1 frame 100',
    placementArmed, COLOR.mint, () => {
      if (placementArmed) {
        placementArmed = false; bulkPlacementDefinitionId = null; setStatus('placement cancelled');
      } else armFramePlacement();
    });
  const canTarget = Boolean(selectedTower
    && (definition?.targetingModes?.length || (input && input !== 'none')));
  button(layout.left[1], 'target', definition?.control ? input === 'none' ? 'passive' : 'a control' : 'q/e target',
    canTarget, COLOR.cyan, () => {
      if (!canTarget) return;
      if (input && input !== 'none') openControlGeometryMenu(snapshot, selectedTower);
      else cycleSelectedTargeting(1);
    });
  button(layout.left[2], 'build_catalog', buildCatalogOpen ? 'b close' : bulk ? 'b switch' : 'b towers',
    buildCatalogOpen || Boolean(bulk), COLOR.amber, buildCatalogOpen ? closeBuildCatalog : openBuildCatalog);
  button(layout.right[0], 'toggle_kps', showKps ? 'k kps on' : 'k kps off', showKps, COLOR.mint, () => { showKps = !showKps; });
  button(layout.right[1], 'toggle_ranges', showAllRanges ? 'g ranges' : 'g range', showAllRanges, COLOR.cyan, () => { showAllRanges = !showAllRanges; });
  button(layout.right[2], 'toggle_test', session.networkRole ? 'esc menu' : 't test', false, COLOR.amber,
    session.networkRole ? openEscapeMenu : enterTestField);
  bitmapText.draw(clippedUiText(combatStatus(snapshot), logicalWidth - 16), 8, y + layout.statusY,
    performance.now() < statusUntil ? COLOR.amber : COLOR.ink, 1);
  const items = [
    { lines: [`gold ${compactMetric(telemetry.goldPerSecond)}/s`], minChars: [13] },
    { lines: [`kills ${compactMetric(snapshot.stats.kills)}`], minChars: [12] },
    ...(showKps ? [{ lines: [`kps ${compactMetric(telemetry.oneSecond)}`], minChars: [10] }] : []),
    { lines: [`shots ${compactMetric(snapshot.stats.shotsResolved)}/${compactMetric(snapshot.stats.shotsFired)}`], minChars: [19] },
    ...(showKps ? [{ lines: [`10s ${compactMetric(telemetry.tenSecond)} // peak ${compactMetric(telemetry.peak)}`], minChars: [24] }] : [])
  ];
  for (const item of fitPixelTelemetry(items, 8, logicalWidth - 8)) {
    bitmapText.draw(item.lines[0], item.x, y + layout.statsY, COLOR.uiMuted, 1);
  }
}

function drawSpawnSlider(snapshot, x, y, width) {
  const rate = snapshot.test.spawnRatePerSecond;
  const fraction = Math.max(0, Math.min(1, Math.log10(rate + 1) / 5));
  shapes.rect(x, y + 5, width, 3, COLOR.dimMint);
  shapes.rect(x, y + 5, Math.max(1, Math.round(width * fraction)), 3, COLOR.red);
  const knobX = Math.round(x + width * fraction);
  shapes.rect(knobX - 2, y + 2, 5, 9, COLOR.amber);
  registerHitbox('spawn_rate', x, y, width, 13, { drag: { kind: 'spawn-rate' } });
}

function drawTestHud(snapshot, telemetry) {
  const y = hudBottomY;
  shapes.rect(0, y, logicalWidth, logicalHeight - y, COLOR.black);
  shapes.rect(0, y, logicalWidth, 1, COLOR.dimMint);
  shapes.rect(0, y, Math.min(220, logicalWidth), 1, COLOR.amber);

  const first = y + 3;
  bitmapText.draw(`spawn ${Math.round(snapshot.test.spawnRatePerSecond)}/s`, 8, first + 3, COLOR.red, 1);
  const sliderX = 92;
  const sliderWidth = Math.max(90, Math.min(230, logicalWidth - 520));
  drawSpawnSlider(snapshot, sliderX, first, sliderWidth);
  let x = sliderX + sliderWidth + 7;
  for (const rate of [0, 100, 1000, 10000]) {
    const label = rate === 10000 ? '10k' : String(rate);
    drawButton(`preset_${rate}`, label, x, first, rate === 10000 ? 28 : 24, snapshot.test.spawnRatePerSecond === rate, COLOR.red, () => setTestConfig({ spawnRatePerSecond: rate }));
    x += rate === 10000 ? 32 : 28;
  }
  bitmapText.draw('hp', x + 2, first + 3, COLOR.ink, 1); x += 20;
  for (const hp of [1, 2, 5, 10]) {
    drawButton(`hp_${hp}`, String(hp), x, first, hp === 10 ? 22 : 17, snapshot.test.enemyHp === hp, hp === 1 ? COLOR.mint : COLOR.amber, () => setTestConfig({ enemyHp: hp }));
    x += hp === 10 ? 26 : 21;
  }
  if (logicalWidth < 850) {
    drawButton('test_ranges', showAllRanges ? 'ranges on' : 'ranges off', logicalWidth - 126, first, 68, showAllRanges, COLOR.cyan, () => { showAllRanges = !showAllRanges; });
    drawButton('return_game', 't game', logicalWidth - 54, first, 46, false, COLOR.mint, () => activateSession('game'));
  }

  const formRow = y + 18;
  x = 8;
  const selected = snapshot.towers.find((tower) => tower.id === selectedTowerId) || snapshot.towers[0];
  for (const [key, form, color] of [
    ['1', 'frame', COLOR.mint],
    ['2', 'assault', COLOR.amber],
    ['3', 'tether', COLOR.cyan],
    ['4', 'network', COLOR.green],
    ['5', 'barrage', COLOR.amber],
    ['6', 'rocket', COLOR.amber],
    ['7', 'laser', COLOR.cyan]
  ]) {
    const label = `${key} ${form}`;
    const width = Math.max(50, label.length * 6 + 8);
    drawButton(`form_${form}`, label, x, formRow, width, selected?.definitionId === form, color, () => switchTestTowerForm(form));
    x += width + 4;
  }

  const controlFormRow = y + 33;
  x = 8;
  for (const [key, form, color] of [
    ['8', 'anchor', COLOR.cyan],
    ['9', 'knot', COLOR.green],
    ['0', 'backwash', COLOR.amber],
    ['o', 'overclock', COLOR.amber],
    ['f', 'forge', COLOR.amber],
    ['r', 'relay', COLOR.cyan]
  ]) {
    const label = `${key} ${form}`;
    const width = Math.max(50, label.length * 6 + 8);
    drawButton(`form_${form}`, label, x, controlFormRow, width, selected?.definitionId === form, color, () => switchTestTowerForm(form));
    x += width + 4;
  }

  const toolRow = y + 48;
  x = 8;
  drawButton('support', placementArmed ? 'b placing' : 'b support', x, toolRow, 62, placementArmed, COLOR.mint, () => { placementArmed = !placementArmed; }); x += 66;
  drawButton('test_forms', buildCatalogOpen ? 'u close' : 'u forms', x, toolRow, 48, buildCatalogOpen, COLOR.amber, buildCatalogOpen ? closeBuildCatalog : () => openBuildCatalog('assault')); x += 52;
  drawButton('test_network_forms', 'n net iii', x, toolRow, 57, buildCatalogOpen && buildCatalogPageId === 'network', COLOR.green, () => openBuildCatalog('network')); x += 61;
  drawButton('keep_swarm', testKeepSwarm ? 'keep on' : 'keep off', x, toolRow, 52, testKeepSwarm, COLOR.amber, () => {
    testKeepSwarm = !testKeepSwarm;
    saveTestPreferences(snapshot.test);
  }); x += 56;
  drawButton('pause', snapshot.test.paused ? 'resume' : 'pause', x, toolRow, 44, snapshot.test.paused, COLOR.cyan, () => setTestConfig({ paused: !snapshot.test.paused })); x += 48;
  drawButton('step', 'step', x, toolRow, 34, false, COLOR.cyan, () => session.send(COMMAND.TEST_STEP)); x += 38;
  drawButton('clear', 'clear', x, toolRow, 40, false, COLOR.red, () => session.send(COMMAND.TEST_CLEAR, { resetCounters: true })); x += 44;
  drawButton('invincible', snapshot.test.invincibleBase ? 'base safe' : 'base live', x, toolRow, 58, snapshot.test.invincibleBase, COLOR.green, () => setTestConfig({ invincibleBase: !snapshot.test.invincibleBase })); x += 62;
  if (logicalWidth >= 850) {
    for (const scale of [0.25, 1, 2, 4]) {
      const label = scale === 0.25 ? '1/4x' : `${scale}x`;
      drawButton(`speed_${scale}`, label, x, toolRow, 28, snapshot.test.timeScale === scale, COLOR.amber, () => setTestConfig({ timeScale: scale }));
      x += 32;
    }
  } else {
    const scales = [0.25, 1, 2, 4];
    const currentScale = scales.indexOf(snapshot.test.timeScale);
    drawButton('speed_cycle', `speed ${snapshot.test.timeScale}x`, x, toolRow, 58, true, COLOR.amber, () => setTestConfig({ timeScale: scales[(currentScale + 1) % scales.length] }));
  }
  if (logicalWidth >= 850) {
    drawButton('test_ranges', showAllRanges ? 'ranges on' : 'ranges off', logicalWidth - 126, toolRow, 68, showAllRanges, COLOR.cyan, () => { showAllRanges = !showAllRanges; });
    drawButton('return_game', 't game', logicalWidth - 54, toolRow, 46, false, COLOR.mint, () => activateSession('game'));
  }

  const statsRow = y + 65;
  const seconds = snapshot.runTick / AUTHORITY_TICK_RATE;
  bitmapText.draw(`kps 1s ${telemetry.oneSecond.toFixed(1)} // 10s ${telemetry.tenSecond.toFixed(1)} // peak ${telemetry.peak.toFixed(1)}`, 8, statsRow, COLOR.mint, 1);
  if (logicalWidth >= 850) {
    bitmapText.draw(`alive ${compactMetric(snapshot.swarm.activeEnemies)} records ${snapshot.swarm.simulationRecords}/${snapshot.swarm.recordBudget} killed ${compactMetric(snapshot.stats.kills)}`, 246, statsRow, COLOR.ink, 1);
    bitmapText.draw(`gold ${compactMetric(telemetry.goldPerSecond)}/s shots ${compactMetric(snapshot.stats.shotsResolved)}/${compactMetric(snapshot.stats.shotsFired)} fx ${snapshot.stats.controlApplications} bonus ${compactMetric(snapshot.stats.bonusCredits || 0)} time ${seconds.toFixed(1)}s`, Math.max(8, logicalWidth - 338), statsRow, COLOR.cyan, 1);
  } else {
    bitmapText.draw(`alive ${compactMetric(snapshot.swarm.activeEnemies)} rec ${snapshot.swarm.simulationRecords} kill ${compactMetric(snapshot.stats.kills)} gold ${compactMetric(telemetry.goldPerSecond)}/s t${seconds.toFixed(0)}s`, 270, statsRow, COLOR.ink, 1);
  }
  const selectedStats = selected
    ? `${selected.definitionId} // ${Number(selected.effectiveCadence || 0).toFixed(1)}/s r${Math.round(selected.effectiveRange || 0)} // kills ${compactMetric(selected.kills || 0)}${selected.bonusCredits ? ` +${compactMetric(selected.bonusCredits)}cr` : ''} // drag towers and spawns`
    : 'drag spawn markers // drag towers // colour shows remaining hp';
  bitmapText.draw(performance.now() < statusUntil ? statusMessage : selectedStats, 8, y + 77, COLOR.amber, 1);
}

function combatStatus(snapshot) {
  const selectedTower = snapshot.towers.find((tower) => tower.id === selectedTowerId);
  const selectedDefinition = snapshot.towerCatalog.find((definition) => definition.id === selectedTower?.definitionId);
  const bulkDefinition = snapshot.towerCatalog.find((definition) => definition.id === bulkPlacementDefinitionId);
  const targetLabel = selectedTower?.targetingMode?.replaceAll('_', ' ') || 'closest';
  const elapsedSeconds = threatSecondsOf(snapshot);
  const nextRift = currentMap.spawnSources.find((source) => source.unlockSeconds > elapsedSeconds);
  const surge = surgeStatus(snapshot);
  const riftStatus = surge
    ? surge.phase === 'warning'
      ? `surge // ${surge.direction} in ${surge.seconds}s // x${surge.hpMultiplier} hp`
      : `surge // ${surge.direction} hot ${surge.seconds}s // x${surge.hpMultiplier} hp`
    : nextRift
      ? `next rift ${Math.ceil(realSecondsUntil(snapshot, nextRift.unlockSeconds))}s`
      : `${snapshot.swarm.activeSpawnPoints} rifts live`;
  const rebootTicks = Math.max(0, (selectedTower?.controlReadyTick || 0) - snapshot.runTick);
  const countsControlHits = ['stasis_zone', 'recall_gate', 'breaker_wave'].includes(selectedDefinition?.control?.type);
  const controlWork = countsControlHits
    ? `${compactMetric(selectedTower?.controlStats?.affectedUnits || 0)} enemies`
    : `${compactMetric(Math.floor((selectedTower?.controlStats?.affectedUnitTicks || 0) / AUTHORITY_TICK_RATE))} unit-s`;
  const passive = selectedTower
    ? weaponView(snapshot, selectedTower)?.supportOnly && weaponView(snapshot, selectedTower)?.attack
      ? `${selectedTower.definitionId} // control casts ${compactMetric(selectedTower.controlStats?.activations || 0)} // zero damage`
      : selectedDefinition?.control && selectedDefinition.control.type !== 'bond_zone'
      ? `${selectedTower.definitionId} // control ${rebootTicks > 0 ? `reboot ${(rebootTicks / AUTHORITY_TICK_RATE).toFixed(1)}s` : 'online'} // affected ${controlWork} // invested ${compactMetric(selectedTower.totalInvestment)}`
      : selectedDefinition?.control?.type === 'bond_zone'
        ? `bond // kills ${compactMetric(selectedTower.kills || 0)} // pairs ${selectedDefinition.control.durationSeconds}s every ${selectedDefinition.control.periodSeconds}s // no chains`
        : `${selectedTower.definitionId} // kills ${compactMetric(selectedTower.kills || 0)} // target ${targetLabel} // invested ${compactMetric(selectedTower.totalInvestment)}`
    : bulkDefinition
      ? `${bulkDefinition.label} repeat // right click ends // b switches tower`
      : `1 one frame // b tower catalog // ${riftStatus} // drag pan // wheel zoom`;
  return performance.now() < statusUntil ? statusMessage : passive;
}

function updateHudBounds() {
  const layout = pixelHudLayout(logicalWidth, sessionMode);
  const bottom = logicalHeight - layout.bottomHeight;
  if (HUD_TOP_HEIGHT !== layout.topHeight || hudBottomY !== bottom) {
    HUD_TOP_HEIGHT = layout.topHeight;
    hudBottomY = bottom;
    clampCameraToMap();
  }
}

function drawHud(fps, snapshot) {
  const telemetry = killTelemetry(sessionMode, snapshot);
  drawTopHud(fps, snapshot, telemetry);
  if (sessionMode === 'test') drawTestHud(snapshot, telemetry);
  else drawGameHud(snapshot, telemetry);
  drawBuildCatalog(snapshot);

  if (session.networkRole === 'guest' && (!session.connected || !session.synced || session.resyncPending || session.stalled)) {
    const panelWidth = Math.min(236, logicalWidth - 16);
    const panelX = Math.round((logicalWidth - panelWidth) * 0.5);
    const panelY = Math.round(logicalHeight * 0.5 - 30);
    drawTechPanel(panelX, panelY, panelWidth, 60, COLOR.amber);
    bitmapText.draw('recovering link', panelX + 14, panelY + 10, COLOR.amber, 2);
    bitmapText.draw('waiting for the host snapshot', panelX + 14, panelY + 32, COLOR.ink, 1);
    bitmapText.draw('replica held // no fake progress', panelX + 14, panelY + 44, COLOR.dimMint, 1);
  } else if (snapshot.phase === 'defeated') {
    uiHitboxes.length = 0;
    const width = Math.min(264, logicalWidth - 20);
    const height = 132;
    const panelX = Math.round((logicalWidth - width) / 2);
    const panelY = Math.round((logicalHeight - height) / 2);
    drawTechPanel(panelX, panelY, width, height, COLOR.red);
    bitmapText.draw('base lost', panelX + 16, panelY + 10, COLOR.red, 2);
    const seconds = Math.floor(snapshot.runTick / AUTHORITY_TICK_RATE);
    const pace = snapshot.pace || DEFAULT_PACE;
    bitmapText.draw(`survived ${Math.floor(seconds / 60)}m ${seconds % 60}s${pace === DEFAULT_PACE ? '' : ` // pace x${pace.toFixed(1)}`}`, panelX + 16, panelY + 34, COLOR.ink, 1);
    bitmapText.draw(`${compactMetric(snapshot.stats.kills)} kills // ${snapshot.towers.length} towers`, panelX + 16, panelY + 48, COLOR.amber, 1);
    if (session.networkRole) {
      drawMenuButton('defeat_coop', 'room status', panelX + 16, panelY + 68, width - 32, COLOR.cyan, () => { frontEndScreen = 'coop'; });
      bitmapText.draw('new coop run needs a fresh room', panelX + 16, panelY + 92, COLOR.ink, 1);
    } else {
      drawMenuButton('defeat_retry', 'retry same field // r', panelX + 16, panelY + 68, width - 32, COLOR.mint,
        () => { clearTransientUi(); session.send(COMMAND.SESSION_RESTART); }, true);
      drawMenuButton('defeat_map', 'choose another map', panelX + 16, panelY + 89, width - 32, COLOR.cyan, () => openMapSelection('main'));
    }
    drawMenuButton('defeat_menu', 'main menu', panelX + 16, panelY + 110, width - 32, COLOR.cyan, returnToMainMenu);
  }

}

function currentPresencePayload(now) {
  const inWorld = frontEndScreen === 'game' && pointer.y > HUD_TOP_HEIGHT && pointer.y < hudBottomY && document.hasFocus();
  const interacting = placementArmed || Boolean(selectedTowerId) || Boolean(controlDrag);
  if (!session.networkRole || !inWorld || (!interacting && now - lastPointerMotionAt > 300)) return { active: false };
  const world = unproject(pointer.x, pointer.y);
  const definitionId = placementArmed ? (bulkPlacementDefinitionId || 'frame') : null;
  const areaId = definitionId ? findDefenseAreaAt(currentMap, world.x, world.y) : null;
  const clear = definitionId ? towerPlacementClear(sessionSnapshot.towers, world.x, world.y) : false;
  return {
    active: true,
    x: Math.round(world.x),
    y: Math.round(world.y),
    activity: definitionId ? 'placing' : selectedTowerId ? 'inspecting' : 'looking',
    towerId: selectedTowerId,
    definitionId,
    valid: Boolean(areaId && clear)
  };
}

function updatePresence(now) {
  if (!session.networkRole || !session.sendPresence) return;
  const payload = currentPresencePayload(now);
  const signature = JSON.stringify(payload);
  if (!payload.active) {
    if (!multiplayerSocial.idleSent) session.sendPresence(payload);
    multiplayerSocial.idleSent = true;
    multiplayerSocial.lastPresenceSignature = signature;
    return;
  }
  multiplayerSocial.idleSent = false;
  if (now - multiplayerSocial.lastPresenceSentAt < 1000 / 12) return;
  if (signature === multiplayerSocial.lastPresenceSignature && now - multiplayerSocial.lastPresenceSentAt < 1000) return;
  if (session.sendPresence(payload)) {
    multiplayerSocial.lastPresenceSentAt = now;
    multiplayerSocial.lastPresenceSignature = signature;
  }
}

function drawRemotePresence(now) {
  for (const [playerId, presence] of multiplayerSocial.presenceByPlayer) {
    if (playerId === session.playerId || now - presence.receivedAt > 1500) {
      if (now - presence.receivedAt > 1500) multiplayerSocial.presenceByPlayer.delete(playerId);
      continue;
    }
    const player = sessionSnapshot.players.find((candidate) => candidate.id === playerId);
    if (!player || player.connectionState !== 'connected') continue;
    const color = playerColor(player);
    const p = project(presence.x, presence.y);
    if (p.y <= HUD_TOP_HEIGHT || p.y >= hudBottomY) continue;
    if (presence.activity === 'placing' && presence.definitionId) {
      const ghost = { definitionId: presence.definitionId, x: presence.x, y: presence.y };
      const tint = presence.valid ? color : COLOR.red;
      drawTower(ghost, { accent: tint, core: tint });
      drawBodyBrackets(shapes, p, towerScreenBounds(ghost.definitionId, camera.scale), tint);
    }
    if (presence.towerId) {
      const tower = sessionSnapshot.towers.find((candidate) => candidate.id === presence.towerId);
      if (tower) {
        const selected = project(tower.x, tower.y);
        drawBodyBrackets(shapes, selected, towerScreenBounds(tower.definitionId, camera.scale), color);
      }
    }
    shapes.rect(p.x - 4, p.y, 3, 1, color);
    shapes.rect(p.x + 2, p.y, 3, 1, color);
    shapes.rect(p.x, p.y - 4, 1, 3, color);
    shapes.rect(p.x, p.y + 2, 1, 3, color);
    bitmapText.draw(clippedUiText(player.label, 72), p.x + 7, p.y - 4, color, 1);
  }
  multiplayerSocial.pings = multiplayerSocial.pings.filter((ping) => now - ping.receivedAt < 3000);
  for (const ping of multiplayerSocial.pings) {
    const p = project(ping.x, ping.y);
    const color = playerColor(ping.playerId);
    const phase = Math.floor((now - ping.receivedAt) / 150) % 4;
    const radius = 8 + phase * 3;
    shapes.rect(p.x - radius, p.y - radius, radius * 2 + 1, 1, color);
    shapes.rect(p.x - radius, p.y + radius, radius * 2 + 1, 1, color);
    shapes.rect(p.x - radius, p.y - radius + 1, 1, radius * 2 - 1, color);
    shapes.rect(p.x + radius, p.y - radius + 1, 1, radius * 2 - 1, color);
  }
}

function playerActivity(player) {
  if (player.id === session.playerId) return placementArmed ? 'placing' : selectedTowerId ? 'inspecting' : 'active';
  return multiplayerSocial.presenceByPlayer.get(player.id)?.activity || 'idle';
}

function drawGameplayRoster(snapshot) {
  if (!session.networkRole) return;
  const players = snapshot.players.slice(0, 4);
  const width = 132;
  const x = logicalWidth - width - 6;
  const y = HUD_TOP_HEIGHT + 5;
  for (let index = 0; index < players.length; index += 1) {
    const player = players[index];
    const rowY = y + index * 12;
    const color = playerColor(player);
    const state = player.connectionState === 'reconnecting' ? 'reconnect' : player.connectionState === 'departed' ? 'departed' : player.spectator ? 'spectator' : playerActivity(player);
    shapes.rect(x, rowY, width, 10, COLOR.black);
    shapes.rect(x + 2, rowY + 3, 4, 4, color);
    bitmapText.draw(clippedUiText(`${player.label} // ${state}`, width - 12), x + 10, rowY + 1, player.connectionState === 'connected' ? color : COLOR.red, 1);
    registerHitbox(`roster_${player.id}`, x, rowY, width, 10, { action: () => { multiplayerSocial.rosterExpanded = !multiplayerSocial.rosterExpanded; } });
  }
  drawButton('coop_ping', multiplayerSocial.pingArmed ? 'ping // click world' : 'p ping', x + width - 82, y + players.length * 12 + 1, 82,
    multiplayerSocial.pingArmed, COLOR.amber, () => { multiplayerSocial.pingArmed = !multiplayerSocial.pingArmed; }, 13);
  if (!multiplayerSocial.rosterExpanded) return;
  const panelWidth = Math.min(310, logicalWidth - 16);
  const panelHeight = 28 + players.length * 30;
  const panelX = logicalWidth - panelWidth - 8;
  const panelY = y + players.length * 12 + 18;
  drawTechPanel(panelX, panelY, panelWidth, panelHeight, COLOR.cyan);
  bitmapText.draw(`team credits ${compactMetric(snapshot.teamEconomy?.credits || 0)} // tab`, panelX + 8, panelY + 7, COLOR.amber, 1);
  for (let index = 0; index < players.length; index += 1) {
    const player = players[index];
    const contribution = snapshot.contributionByPlayer?.[player.id] || {};
    const rowY = panelY + 23 + index * 30;
    bitmapText.draw(clippedUiText(player.label, 90), panelX + 8, rowY, playerColor(player), 1);
    bitmapText.draw(`hp ${compactMetric(contribution.hpPopped || 0)} // kills ${compactMetric(contribution.kills || 0)} // spent ${compactMetric(contribution.creditsSpent || 0)}`, panelX + 78, rowY, COLOR.ink, 1);
    bitmapText.draw(`towers ${contribution.towersCreated || 0} // support ${compactMetric(contribution.supportCredits || 0)} // control ${compactMetric(contribution.controlApplications || 0)}`, panelX + 78, rowY + 11, COLOR.uiMuted, 1);
  }
}

function drawChat(snapshot, now) {
  if (!session.networkRole) return;
  const visible = multiplayerSocial.chatOpen
    ? multiplayerSocial.messages.slice(-6)
    : multiplayerSocial.messages.filter((message) => now - message.receivedAt < 5000).slice(-2);
  const width = Math.min(320, logicalWidth - 16);
  const x = 8;
  const lineHeight = 11;
  const height = Math.max(0, visible.length * lineHeight) + (multiplayerSocial.chatOpen ? 22 : 0);
  const y = hudBottomY - height - 8;
  if (height) shapes.rect(x - 3, y - 3, width + 6, height + 6, COLOR.black);
  for (let index = 0; index < visible.length; index += 1) {
    const message = visible[index];
    const player = snapshot.players.find((candidate) => candidate.id === message.playerId);
    const prefix = message.kind === 'system' ? '// ' : `${player?.label || 'pilot'}: `;
    bitmapText.draw(clippedUiText(prefix + message.text, width), x, y + index * lineHeight, message.kind === 'system' ? COLOR.uiMuted : playerColor(player), 1);
  }
  if (multiplayerSocial.chatOpen) {
    const inputY = y + visible.length * lineHeight + 5;
    bitmapText.draw(clippedUiText(`> ${multiplayerSocial.chatInput}_`, width), x, inputY, COLOR.ink, 1);
  }
}

function drawCursor() {
  const color = frontEndScreen === 'main' ? COLOR.mint : ['escape', 'map_select'].includes(frontEndScreen) ? COLOR.amber : frontEndScreen === 'coop' ? COLOR.green : COLOR.cyan;
  shapes.rect(pointer.x - 4, pointer.y, 3, 1, color);
  shapes.rect(pointer.x + 2, pointer.y, 3, 1, color);
  shapes.rect(pointer.x, pointer.y - 4, 1, 3, color);
  shapes.rect(pointer.x, pointer.y + 2, 1, 3, color);
}

let previousTime = performance.now();
let fps = 0;
let frameCounter = 0;
let fpsWindow = previousTime;
let lastGpuCheck = previousTime;

function captureLosslessFramebuffer() {
  const source = new Uint8Array(logicalWidth * logicalHeight * 4);
  const upright = new Uint8ClampedArray(source.length);
  gl.readPixels(0, 0, logicalWidth, logicalHeight, gl.RGBA, gl.UNSIGNED_BYTE, source);
  const rowBytes = logicalWidth * 4;
  for (let row = 0; row < logicalHeight; row += 1) {
    const sourceOffset = (logicalHeight - row - 1) * rowBytes;
    upright.set(source.subarray(sourceOffset, sourceOffset + rowBytes), row * rowBytes);
  }
  const encoder = document.createElement('canvas');
  encoder.width = logicalWidth;
  encoder.height = logicalHeight;
  const context = encoder.getContext('2d', { alpha: false });
  context.imageSmoothingEnabled = false;
  context.putImageData(new ImageData(upright, logicalWidth, logicalHeight), 0, 0);
  let capture = document.querySelector('#lossless-capture');
  if (!capture) {
    capture = document.createElement('a');
    capture.id = 'lossless-capture';
    capture.hidden = true;
    capture.setAttribute('aria-hidden', 'true');
    document.body.append(capture);
  }
  capture.href = encoder.toDataURL('image/png');
  capture.dataset.ready = 'true';
}

window.__captureHordeFramebuffer = captureLosslessFramebuffer;

function syncDiagnostics(snapshot = sessionSnapshot) {
  const towerForms = {};
  for (const tower of snapshot.towers) towerForms[tower.definitionId] = (towerForms[tower.definitionId] || 0) + 1;
  const telemetry = killTelemetry(sessionMode, snapshot);
  const network = session.networkInfo?.() || { role: 'solo', connected: true };
  const diagnostics = {
    backend: 'webgl2 authoritative packed points',
    gpuError: null,
    contextAntialias: gl.getContextAttributes()?.antialias,
    enemyCapacity: snapshot.swarm.allocatedCapacity,
    activeEnemies: snapshot.swarm.activeEnemies,
    simulationRecords: snapshot.swarm.simulationRecords,
    compressedEnemies: snapshot.swarm.compressedEnemies,
    recordBudget: snapshot.swarm.recordBudget,
    slowedEnemies: snapshot.swarm.slowedEnemies || 0,
    spawnRatePerSecond: snapshot.swarm.spawnRatePerSecond,
    fps,
    frameMs: { ...frameTiming },
    rings: { drawnPerFrame: shapes.ringsDrawn, culledPerFrame: shapes.ringsCulled, shapeFloatsPerFrame: shapes.lastFlushFloats },
    logicalResolution: `${logicalWidth}x${logicalHeight}`,
    nativeRenderScale: renderScale,
    textureMinFilter: 'nearest',
    textureMagFilter: 'nearest',
    multisampling: false,
    shaderEdgeSmoothing: false,
    camera: { ...camera },
    availableZoomLevels: allowedZoomLevels(),
    maximumZoom: allowedZoomLevels().at(-1),
    mapId: snapshot.mapId,
    mapLabel: snapshot.mapLabel,
    defenseAreaCount: currentMap.defenseAreas.length,
    runNumber: snapshot.runNumber,
    runTick: snapshot.runTick,
    elapsedSeconds: snapshot.runTick / AUTHORITY_TICK_RATE,
    goldPerSecond: telemetry.goldPerSecond,
    swarmChecksum: snapshot.swarm.checksum,
    shotsFired: snapshot.stats.shotsFired,
    shotsResolved: snapshot.stats.shotsResolved,
    supportTriggers: snapshot.stats.supportTriggers || 0,
    bonusCredits: snapshot.stats.bonusCredits || 0,
    relayLinks: snapshot.towers
      .filter((tower) => tower.relayTargetAreaId)
      .map((tower) => ({ towerId: tower.id, from: tower.areaId, to: tower.relayTargetAreaId })),
    shotInvariant: snapshot.stats.shotsFired === snapshot.stats.shotsResolved
      + snapshot.projectiles.length
      + snapshot.attackFields.filter((field) => field.countsAsShot !== false).length,
    collisionMode: 'swept physical geometry',
    autoSelectPlacedFrame: gameplayPreferences.autoSelectPlacedFrame,
    bulkPlacementDefinitionId,
    buildCatalogOpen,
    buildCatalogPageId,
    network,
    towerForms
  };
  window.__hordeDiagnostics = diagnostics;
  canvas.dataset.gpuBackend = diagnostics.backend;
  canvas.dataset.gpuError = 'none';
  canvas.dataset.contextAntialias = String(diagnostics.contextAntialias);
  canvas.dataset.enemyCapacity = String(diagnostics.enemyCapacity);
  canvas.dataset.fps = String(diagnostics.fps);
  canvas.dataset.logicalResolution = diagnostics.logicalResolution;
  canvas.dataset.cssIntegerScale = String(diagnostics.cssIntegerScale);
  canvas.dataset.textureFilter = 'nearest';
  canvas.dataset.multisampling = 'false';
  canvas.dataset.shaderEdgeSmoothing = 'false';
  canvas.dataset.camera = `${camera.x},${camera.y},${camera.scale}`;
  canvas.dataset.maximumZoom = String(diagnostics.maximumZoom);
  canvas.dataset.mapId = snapshot.mapId;
  canvas.dataset.defenseAreaCount = String(currentMap.defenseAreas.length);
  canvas.dataset.authority = network.role === 'guest' ? 'p2p-replica' : network.role === 'host' ? 'p2p-host' : 'embedded-host';
  canvas.dataset.networkRole = network.role;
  canvas.dataset.networkConnected = String(network.connected);
  canvas.dataset.networkRoom = network.roomCode || 'none';
  canvas.dataset.protocolVersion = String(PROTOCOL_VERSION);
  canvas.dataset.authorityTick = String(snapshot.tick);
  canvas.dataset.runNumber = String(snapshot.runNumber);
  canvas.dataset.runTick = String(snapshot.runTick);
  canvas.dataset.elapsedSeconds = String(diagnostics.elapsedSeconds);
  canvas.dataset.goldPerSecond = diagnostics.goldPerSecond.toFixed(3);
  canvas.dataset.playerCount = String(snapshot.players.length);
  canvas.dataset.towerCount = String(snapshot.towers.length);
  canvas.dataset.sessionId = snapshot.sessionId;
  canvas.dataset.phase = snapshot.phase;
  canvas.dataset.lives = String(snapshot.base.lives);
  canvas.dataset.kills = String(snapshot.stats.kills);
  canvas.dataset.activeEnemies = String(snapshot.swarm.activeEnemies);
  canvas.dataset.simulationRecords = String(snapshot.swarm.simulationRecords);
  canvas.dataset.compressedEnemies = String(snapshot.swarm.compressedEnemies);
  canvas.dataset.swarmRecordBudget = String(snapshot.swarm.recordBudget);
  canvas.dataset.slowedEnemies = String(snapshot.swarm.slowedEnemies || 0);
  canvas.dataset.spawnRatePerSecond = String(snapshot.swarm.spawnRatePerSecond);
  canvas.dataset.swarmChecksum = snapshot.swarm.checksum;
  canvas.dataset.projectileCount = String(snapshot.projectiles.length);
  canvas.dataset.shotsFired = String(snapshot.stats.shotsFired);
  canvas.dataset.shotsResolved = String(snapshot.stats.shotsResolved);
  canvas.dataset.supportTriggers = String(snapshot.stats.supportTriggers || 0);
  canvas.dataset.bonusCredits = String(snapshot.stats.bonusCredits || 0);
  canvas.dataset.shotInvariant = String(diagnostics.shotInvariant);
  canvas.dataset.collisionMode = diagnostics.collisionMode;
  canvas.dataset.towerForms = JSON.stringify(towerForms);
  canvas.dataset.credits = String(snapshot.teamEconomy?.credits ?? snapshot.prototypeBalance.startingCredits);
  canvas.dataset.autoSelectPlacedFrame = String(gameplayPreferences.autoSelectPlacedFrame);
  canvas.dataset.bulkPlacementDefinitionId = bulkPlacementDefinitionId || 'none';
  canvas.dataset.buildCatalogOpen = String(buildCatalogOpen);
}

syncDiagnostics();

function frame(now) {
  const elapsedMs = Math.min(133, Math.max(1, now - previousTime));
  const dt = Math.min(0.033, elapsedMs / 1000);
  previousTime = now;
  const time = now / 1000;
  if (sessionMode === 'test' && gameHasEnteredGameplay) sessions.get('game')?.session.advance(elapsedMs);
  const timeScale = sessionMode === 'test' ? (sessionSnapshot.test?.timeScale || 1) : 1;
  const shouldAdvance = Boolean(session.networkRole) || sessionMode !== 'game' || gameHasEnteredGameplay;
  const sessionFrame = session.advance(shouldAdvance ? elapsedMs * timeScale : 0);
  sessionSnapshot = sessionFrame.snapshot;
  for (const event of sessionFrame.events) {
    if ([EVENT.RESEARCH_PURCHASED, EVENT.REACTOR_PURCHASED].includes(event.type)) {
      setStatus(event.type===EVENT.RESEARCH_PURCHASED ? `${event.payload.label} unlocked` : `${event.payload.categoryId} rank ${event.payload.rank}`);
      researchDetailPage=0;
      const station = sessionSnapshot.towers.find((tower) => tower.id === event.payload.towerId);
      if (station && (event.payload.cost || 0) > 0) researchWave = {
        x: station.x, y: station.y, mapId: currentMap.id, startedTick: sessionSnapshot.runTick
      };
      void saveGameBundle();
    } else if (event.type === EVENT.TOWER_PLACED && event.payload.tower.ownerId === session.playerId) {
      const keepBulkPlacement = sessionMode === 'game'
        && bulkPlacementDefinitionId === event.payload.tower.definitionId;
      placementArmed = keepBulkPlacement;
      const autoSelect = !keepBulkPlacement && (sessionMode === 'test' || gameplayPreferences.autoSelectPlacedFrame);
      selectedTowerId = autoSelect ? event.payload.tower.id : null;
      towerMenuMode = autoSelect && sessionMode === 'game' ? 'actions' : null;
      if (['arsenal','reactor'].includes(event.payload.tower.definitionId)) openResearchStation(event.payload.tower);
      setStatus(keepBulkPlacement
        ? `${event.payload.tower.definitionId} placed // click next // right click ends`
        : autoSelect ? 'frame selected // 1 upgrade // 2 sell' : 'frame placed // press 1 for another');
    } else if (event.type === EVENT.TOWER_EVOLVED && (event.payload.actorPlayerId || event.payload.tower.ownerId) === session.playerId) {
      selectedTowerId = event.payload.tower.id;
      const evolved = sessionSnapshot.towerCatalog.find((definition) => definition.id === event.payload.tower.definitionId);
      towerMenuMode = sessionMode === 'test'
        ? isRelayForm(evolved?.id) ? 'actions' : evolved?.control?.input !== 'none' && evolved?.control?.input ? 'control' : null
        : evolved?.evolutionChoices?.length
          ? 'upgrades'
          : evolved?.id === 'relay'
            ? 'relay'
            : evolved?.control?.input !== 'none' && evolved?.control?.input
              ? 'control'
              : 'actions';
      if (['arsenal','reactor'].includes(event.payload.tower.definitionId)) openResearchStation(event.payload.tower);
      setStatus(`${event.payload.tower.definitionId} online`);
    } else if (event.type === EVENT.TOWER_SOLD) {
      if (selectedTowerId === event.payload.towerId) {
        selectedTowerId = null;
        towerMenuMode = null;
      }
      setStatus(`sold // refund ${compactMetric(event.payload.refund)}`);
    } else if (event.type === EVENT.TOWER_TARGETING_CHANGED && event.payload.towerId === selectedTowerId) {
      setStatus(`target ${event.payload.mode.replace('_', ' ')}`);
    } else if (event.type === EVENT.TOWER_STRIKE_POINT_CHANGED && event.payload.towerId === selectedTowerId) {
      towerMenuMode = sessionMode === 'game' ? 'actions' : null;
      setStatus(event.payload.strikePoint ? 'manual strike point locked' : 'automatic impact restored');
    } else if (event.type === EVENT.TOWER_FORCE_DIRECTION_CHANGED && event.payload.towerId === selectedTowerId) {
      towerMenuMode = sessionMode === 'game' ? 'actions' : null;
      setStatus(event.payload.forceDirection ? 'crosswind direction locked' : 'automatic crosswind restored');
    } else if (event.type === EVENT.TOWER_CONTROL_GEOMETRY_CHANGED && event.payload.towerId === selectedTowerId) {
      towerMenuMode = sessionMode === 'game' ? 'actions' : null;
      controlDrag = null;
      setStatus('control locked // rebooting 1s');
    } else if (event.type === EVENT.BASE_BREACHED) {
      baseDamage.breach(event.payload, sessionSnapshot.runTick);
    } else if (event.type === EVENT.RELAY_NETWORK_COMPLETED) {
      if (!['main', 'map_select', 'coop'].includes(frontEndScreen)) startRelayCollapse(event);
      if (event.payload.retired.some((record) => record.towerId === selectedTowerId)) { selectedTowerId = null; towerMenuMode = null; }
      const refund = event.payload.retired.reduce((sum, record) => sum + (record.refund || 0), 0);
      setStatus(`relay network complete // ${event.payload.retired.length} connector-s uploaded${refund > 0 ? ` // +${compactMetric(refund)} cr` : ''}`);
      void saveGameBundle();
    } else if (event.type === EVENT.TOWER_RELAY_TARGET_CHANGED && event.payload.towerId === selectedTowerId) {
      towerMenuMode = 'actions';
      setStatus(`relay linked // ${event.payload.targetAreaId}`);
    } else if (event.type === EVENT.SESSION_RESTARTED) {
      adoptActiveMap(event.payload.mapId);
      projectilePresentation.clear();
      impactBursts.length = 0;
      attackFlashes.length = 0;
      relayCollapse = null;
      selectedTowerId = null;
      towerMenuMode = null;
      placementArmed = false;
      bulkPlacementDefinitionId = null;
      buildCatalogOpen = false;
      menuConfirm = null;
      setStatus(`${currentMap.label} // run ${event.payload.runNumber}`);
      void saveGameBundle();
    } else if (event.type === EVENT.RUN_STARTED) {
      adoptActiveMap(event.payload.mapId);
      if (session.networkRole) {
        gameHasEnteredGameplay = true;
        frontEndScreen = 'game';
        multiplayerState.phase = 'running';
        multiplayerState.status = 'coop run live';
      }
      setStatus(`${currentMap.label} // good luck`);
      void saveGameBundle();
    } else if (event.type === EVENT.PLAYER_JOINED) {
      addSystemMessage(`${event.payload.player.label} joined`);
    } else if (event.type === EVENT.PLAYER_DISCONNECTED) {
      const player = sessionSnapshot.players.find((candidate) => candidate.id === event.payload.playerId);
      addSystemMessage(`${player?.label || 'pilot'} disconnected`);
      multiplayerSocial.presenceByPlayer.delete(event.payload.playerId);
      setStatus('pilot disconnected // run continues');
    } else if (event.type === EVENT.PLAYER_RECONNECTED) {
      addSystemMessage(`${event.payload.player.label} reconnected`);
      setStatus(`${event.payload.player.label} reconnected`);
    } else if (event.type === EVENT.PLAYER_DEPARTED) {
      const player = sessionSnapshot.players.find((candidate) => candidate.id === event.payload.playerId);
      addSystemMessage(`${player?.label || 'pilot'} departed`);
      setStatus('pilot departed // towers remain shared');
    } else if (event.type === EVENT.ATTACK_RESOLVED) {
      if (!['main', 'map_select', 'coop'].includes(frontEndScreen)) addAttackFlash(event);
    } else if (event.type === EVENT.KILLS_RECORDED) {
      if (!['main', 'map_select', 'coop'].includes(frontEndScreen)) addImpactBurst(event);
    } else if (event.type === EVENT.SUPPORT_TRIGGERED) {
      if (!['main', 'map_select', 'coop'].includes(frontEndScreen)) addSupportFlash(event);
      if (event.payload.sourceTowerId === selectedTowerId) setStatus(`forge +${compactMetric(event.payload.credits)} credits`);
    } else if (event.type === EVENT.TEST_CONFIG_CHANGED) {
      saveTestPreferences(event.payload.test);
    } else if (event.type === EVENT.COMMAND_REJECTED && event.payload.clientId === session.clientId) {
      setStatus(event.payload.reason);
    }
  }
  updatePresence(now);
  frameCounter += 1;
  if (now - fpsWindow >= 500) {
    fps = Math.round(frameCounter * 1000 / (now - fpsWindow));
    frameCounter = 0;
    fpsWindow = now;
  }
  if (now - lastAutosaveAt >= 15000) {
    lastAutosaveAt = now;
    void saveGameBundle();
  }

  updateHudBounds();
  const enemyFrame = session.presentation();
  uiHitboxes.length = 0;
  networkPresentation = relayNetworkPresentation(sessionSnapshot);
  drawBackground();
  if (!['main', 'map_select', 'coop'].includes(frontEndScreen)) {
    // Background technology stays underneath enemies, including at intersections.
    drawNetworkLinks(sessionSnapshot);
    shapes.flush();
    enemyRenderer.draw(camera, enemyFrame);
    if (currentMap.sideWalls) for (const wallX of [currentMap.bounds.left,currentMap.bounds.right]) {
      const a=project(wallX,currentMap.bounds.top),b=project(wallX,currentMap.bounds.bottom);
      shapes.line(a.x,a.y,b.x,b.y,4,COLOR.dimMint);
      shapes.line(a.x,a.y,b.x,b.y,1,COLOR.amber);
    }
    drawTestFieldWorld(sessionSnapshot);
    drawPerimeterIntel(sessionSnapshot,enemyFrame);
    drawProjectiles(presentProjectiles(sessionSnapshot.projectiles, dt));
    drawClusterPayloads(sessionSnapshot.attackFields, sessionSnapshot.runTick);
    drawControlFields(sessionSnapshot);
    drawReworkedCombat(sessionSnapshot);
    drawSelectedBondLinks(sessionSnapshot, enemyFrame);
    shapes.flush();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    for (const field of sessionSnapshot.attackFields) {
      if (field.kind === 'sweep_line') drawSweep(shapes, COLOR, project, camera.scale, field, sessionSnapshot.runTick, enemyFrame.alpha);
    }
    drawAttackFlashes(dt);
    shapes.flush();
    gl.disable(gl.BLEND);
    drawImpactBursts(dt);
    for (const tower of sessionSnapshot.towers) drawTower(tower);
    drawRelayCollapse(sessionSnapshot);
    drawBase(sessionSnapshot);
    if (currentMap.arena) drawArenaFrame(currentMap);
    else {
      const wall = project(0, currentMap.bounds.bottom);
      shapes.rect(0, wall.y - 3, logicalWidth, 3, COLOR.dimMint);
      for (let x = 0; x < logicalWidth; x += 24) shapes.rect(x, wall.y - 3, 12, 1, COLOR.amber);
    }
    drawBuildState(sessionSnapshot);
    drawRemotePresence(now);
    drawHud(fps, sessionSnapshot);
  } else {
    projectilePresentation.clear();
    impactBursts.length = 0;
    attackFlashes.length = 0;
    if (frontEndScreen === 'main') drawMainMenu(sessionSnapshot);
    else if (frontEndScreen === 'map_select') drawMapSelection(sessionSnapshot);
    else drawCoopMenu(sessionSnapshot);
  }
  if (frontEndScreen === 'game' && towerMenuMode === 'research') {
    const tower=sessionSnapshot.towers.find((item)=>item.id===selectedTowerId);
    if(tower) drawResearchStation(sessionSnapshot,tower);
  }
  if (frontEndScreen === 'escape') {
    uiHitboxes.length = 0;
    drawEscapeMenu(sessionSnapshot);
  }
  if (frontEndScreen === 'game') {
    const enabled = Object.entries(sessionSnapshot.dev || {}).filter(([, value]) => value).map(([key]) =>
      ({ infiniteMoney: 'money', infiniteHealth: 'health', paused: 'paused', stopSpawns: 'no spawns' })[key]).filter(Boolean);
    bitmapText.draw(enabled.length ? `dev // ${enabled.join(' / ')} // f2` : 'f2 dev tools', 8, HUD_TOP_HEIGHT + 5, enabled.length ? COLOR.amber : COLOR.dimMint, 1);
    if (devToolsOpen) drawDevTools(sessionSnapshot);
    if (showStatsPanel) drawStatsPanel(sessionSnapshot);
    drawGameplayRoster(sessionSnapshot);
    drawChat(sessionSnapshot, now);
  }
  drawCursor();
  shapes.flush();
  bitmapText.flush();
  const frameCost = performance.now() - now;
  frameTiming.last = frameCost;
  frameTiming.average += (frameCost - frameTiming.average) * 0.05;
  frameTiming.worst = Math.max(frameCost, frameTiming.worst * 0.98);
  if (now - lastGpuCheck > 1000) {
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      showFatal(`webgl error 0x${error.toString(16)}`);
      return;
    }
    lastGpuCheck = now;
    syncDiagnostics();
  }
  shapes.endFrame();

  requestAnimationFrame(frame);
}

try {
  requestAnimationFrame(frame);
} catch (error) {
  showFatal(error?.stack || error);
  throw error;
}
