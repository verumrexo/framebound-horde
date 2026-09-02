import { EmbeddedAuthority, EmbeddedClient } from './core/embedded-session.js';
import { AUTHORITY_TICK_RATE, COMMAND, EVENT, PROTOCOL_VERSION } from './core/protocol.js';
import { PROTOTYPE_SESSION_CONFIG, TEST_FIELD_SESSION_CONFIG } from './core/session-config.js';
import { strikeImpactPoints, supportsStrikePoint } from './core/strike-pattern.js';
import { towerBuildQuote } from './core/tower-catalog.js';
import { defenseAreaBounds, defenseAreaField, findDefenseAreaAt, getMapDefinition, playableMaps } from './core/world-config.js';
import { loadSoloRun, saveSoloRun } from './core/persistence.js';
import { P2PGuestSession, P2PHostSession } from './core/p2p-session.js';
import { PeerConnectionCoordinator, SIGNALING_URL, sanitizeRoomCode } from './core/p2p-transport.js';

let logicalWidth = 640;
let logicalHeight = 360;
let displayPixelScale = 1;
const HUD_TOP_HEIGHT = 23;
let hudBottomY = logicalHeight - 31;
const TOWER_DEFINITION_ID = 'frame';
const BUILD_CATALOG_PAGES = Object.freeze({
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
        Object.freeze({ key: '5', definitionId: 'orbit' }),
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
  ink: [189 / 255, 233 / 255, 223 / 255, 1]
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
  hudBottomY = logicalHeight - (sessionMode === 'test' ? 91 : 31);
  canvas.width = logicalWidth;
  canvas.height = logicalHeight;
  canvas.style.width = `${logicalWidth * displayPixelScale}px`;
  canvas.style.height = `${logicalHeight * displayPixelScale}px`;
  if (gl) gl.viewport(0, 0, logicalWidth, logicalHeight);
  window.__hordeDiagnostics = { ...(window.__hordeDiagnostics || {}), cssIntegerScale: displayPixelScale };
}

fitCanvas();
addEventListener('resize', () => {
  fitCanvas();
  if (sessionSnapshot) clampCameraToMap();
}, { passive: true });

gl = canvas.getContext('webgl2', {
  alpha: false,
  antialias: false,
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
gl.viewport(0, 0, logicalWidth, logicalHeight);

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
uniform vec2 u_camera;
uniform float u_viewScale;
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 screen = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
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
  vec2 screen = round((world - u_camera) / u_viewScale + u_resolution * 0.5);
  vec2 clip = vec2(screen.x / u_resolution.x * 2.0 - 1.0, 1.0 - screen.y / u_resolution.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  v_shape0 = a_shape0;
  v_shape1 = a_shape1;
  v_shape2 = a_shape2;
  v_style = a_style;
}
`;

const NEBULA_FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 u_resolution;
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

void main() {
  vec2 screen = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
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
  vec3 color = vec3(0.012, 0.047, 0.031);

  vec2 localPixel = floor(local / u_viewScale + vec2(v_style.x * 113.0, v_style.x * 67.0));
  vec2 scratchCell = floor(localPixel / vec2(10.0, 8.0));
  vec2 scratchPixel = mod(localPixel, vec2(10.0, 8.0));
  float scratch = hash21(scratchCell + vec2(v_style.x * 31.0, v_style.y * 19.0));
  if (edgeDepth > u_viewScale * 2.0 && scratch > 0.79 && scratchPixel.y < 1.0 && scratchPixel.x < 3.0) {
    color = vec3(0.025, 0.125, 0.072);
  }

  vec2 edgeCell = floor(world / (u_viewScale * 5.0));
  float edgeScar = hash21(edgeCell + vec2(v_style.x * 97.0, v_style.x * 53.0));
  if (edgeDepth <= u_viewScale * 1.35) {
    color = vec3(0.055, 0.255, 0.145);
    if (edgeScar > 0.68) color = vec3(0.20, 0.62, 0.36);
    if (edgeScar > 0.955) color = vec3(0.333, 1.0, 0.761);
  }
  outColor = vec4(color, 1.0);
}
`;

const SWARM_RENDER_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec4 a_state;
layout(location=1) in float a_status;
layout(location=2) in float a_units;
uniform vec2 u_resolution;
uniform vec2 u_camera;
uniform float u_viewScale;
uniform float u_tickAlpha;
flat out float v_status;
flat out float v_units;
void main() {
  vec2 world = a_state.xy + a_state.zw * (u_tickAlpha / ${AUTHORITY_TICK_RATE.toFixed(1)});
  vec2 screen = round((world - u_camera) / u_viewScale + u_resolution * 0.5);
  vec2 clip = vec2(screen.x / u_resolution.x * 2.0 - 1.0, 1.0 - screen.y / u_resolution.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  float baseSize = floor(clamp(13.0 / u_viewScale, 3.0, 6.0) + 0.5);
  gl_PointSize = baseSize + (a_units > 1.5 ? 3.0 : 0.0);
  v_status = a_status;
  v_units = a_units;
}
`;

const SWARM_RENDER_FRAGMENT = `#version 300 es
precision highp float;
flat in float v_status;
flat in float v_units;
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
  bool statusPixel = v_status > 0.5 && center.x < 0.15 && center.y < 0.15;
  if (!body && !statusPixel) discard;
  if (statusPixel) {
    if (v_status > 3.5) outColor = vec4(${COLOR.mint.join(',')});
    else if (v_status > 2.5) outColor = vec4(${COLOR.amber.join(',')});
    else outColor = vec4(${COLOR.cyan.join(',')});
  } else {
    outColor = vec4(${COLOR.red.join(',')});
  }
}
`;

const SHAPE_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_position;
layout(location=1) in vec4 a_color;
uniform vec2 u_resolution;
out vec4 v_color;
void main() {
  vec2 snapped = floor(a_position + 0.5);
  gl_Position = vec4(snapped.x / u_resolution.x * 2.0 - 1.0, 1.0 - snapped.y / u_resolution.y * 2.0, 0.0, 1.0);
  v_color = a_color;
}
`;

const SHAPE_FRAGMENT = `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 outColor;
void main() { outColor = v_color; }
`;

const TEXT_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_position;
layout(location=1) in vec2 a_uv;
layout(location=2) in vec4 a_color;
uniform vec2 u_resolution;
out vec2 v_uv;
out vec4 v_color;
void main() {
  vec2 snapped = floor(a_position + 0.5);
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
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.lastTick = frame.tick;
    this.lastCount = frame.count;
    this.lastState = frame.state;
  }

  draw(camera, frame) {
    this.upload(frame);
    gl.useProgram(this.program);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_resolution'), logicalWidth, logicalHeight);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_camera'), camera.x, camera.y);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_viewScale'), camera.scale);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_tickAlpha'), frame.alpha);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, frame.count);
    gl.bindVertexArray(null);
  }
}

class ShapeBatch {
  constructor() {
    this.program = createProgram(SHAPE_VERTEX, SHAPE_FRAGMENT);
    this.buffer = gl.createBuffer();
    this.vao = gl.createVertexArray();
    this.data = [];
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);
    gl.bindVertexArray(null);
  }

  vertex(x, y, color) {
    this.data.push(x, y, ...color);
  }

  triangle(a, b, c, color) {
    this.vertex(a.x, a.y, color);
    this.vertex(b.x, b.y, color);
    this.vertex(c.x, c.y, color);
  }

  rect(x, y, width, height, color) {
    const a = { x, y };
    const b = { x: x + width, y };
    const c = { x: x + width, y: y + height };
    const d = { x, y: y + height };
    this.triangle(a, b, c, color);
    this.triangle(a, c, d, color);
  }

  line(x1, y1, x2, y2, width, color) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length * width * 0.5;
    const ny = dx / length * width * 0.5;
    this.triangle({ x: x1 + nx, y: y1 + ny }, { x: x2 + nx, y: y2 + ny }, { x: x2 - nx, y: y2 - ny }, color);
    this.triangle({ x: x1 + nx, y: y1 + ny }, { x: x2 - nx, y: y2 - ny }, { x: x1 - nx, y: y1 - ny }, color);
  }

  flush() {
    if (!this.data.length) return;
    const vertices = new Float32Array(this.data);
    gl.useProgram(this.program);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_resolution'), logicalWidth, logicalHeight);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 6);
    gl.bindVertexArray(null);
    this.data.length = 0;
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
  '%':glyph('11001','11010','00100','01000','10110','00110','00000'),
  '?':glyph('01110','10001','00001','00110','00100','00000','00100'),
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
    this.data = [];
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
    this.data.push(x, y, u, v, ...color);
  }

  draw(text, x, y, color, scale = 1) {
    let cursor = Math.round(x);
    for (const rawCharacter of String(text).toLowerCase()) {
      const character = this.index.has(rawCharacter) ? rawCharacter : '?';
      const index = this.index.get(character);
      const column = index % this.columns;
      const row = Math.floor(index / this.columns);
      const u0 = column * this.cellWidth / (this.columns * this.cellWidth);
      const v0 = row * this.cellHeight / (this.rows * this.cellHeight);
      const u1 = (column * this.cellWidth + 5) / (this.columns * this.cellWidth);
      const v1 = (row * this.cellHeight + 7) / (this.rows * this.cellHeight);
      const width = 5 * scale;
      const height = 7 * scale;
      const a = [cursor, y, u0, v0];
      const b = [cursor + width, y, u1, v0];
      const c = [cursor + width, y + height, u1, v1];
      const d = [cursor, y + height, u0, v1];
      for (const point of [a, b, c, a, c, d]) this.glyphVertex(point[0], point[1], point[2], point[3], color);
      cursor += this.cellWidth * scale;
    }
    return cursor;
  }

  flush() {
    if (!this.data.length) return;
    const vertices = new Float32Array(this.data);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_resolution'), logicalWidth, logicalHeight);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_atlas'), 0);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 8);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    this.data.length = 0;
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

  setMap(map) {
    if (this.mapId === map.id) return;
    const data = [];
    for (const area of map.defenseAreas) {
      const bounds = defenseAreaBounds(area, 12);
      const shape = area.shape;
      data.push(bounds.left, bounds.top, bounds.right, bounds.bottom);
      data.push(shape.x, shape.y, shape.radiusX, shape.radiusY);
      data.push(shape.cosRotation, shape.sinRotation, shape.amplitude2, shape.amplitude3);
      data.push(shape.amplitude5, shape.notchDepth, shape.notchX, shape.notchY);
      data.push(shape.styleSeed, shape.family, 0, 0);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    this.mapId = map.id;
    this.count = map.defenseAreas.length;
  }

  draw(map, viewCamera) {
    this.setMap(map);
    if (!this.count) return;
    gl.useProgram(this.program);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_resolution'), logicalWidth, logicalHeight);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_camera'), viewCamera.x, viewCamera.y);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_viewScale'), viewCamera.scale);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    gl.bindVertexArray(null);
  }
}

const backgroundProgram = createProgram(FULLSCREEN_VERTEX, BACKGROUND_FRAGMENT);
const nebulaRenderer = new NebulaRenderer();
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
  expiresAt: 0
};
let dragging = false;
let pointer = { x: logicalWidth * 0.5, y: logicalHeight * 0.5 };
let pointerDown = null;
let dragDistance = 0;
let placementArmed = false;
let bulkPlacementDefinitionId = null;
let buildCatalogOpen = false;
let buildCatalogPageId = 'core';
let selectedTowerId = null;
let towerMenuMode = null;
let statusMessage = 'build live // no pause';
let statusUntil = 0;
const projectilePresentation = new Map();
const impactBursts = [];
const attackFlashes = [];
const uiHitboxes = [];
const telemetryByMode = new Map();
const gameplayPreferences = loadGameplayPreferences();
let uiDrag = null;
let controlDrag = null;
let showAllRanges = false;
let showKps = true;
let testKeepSwarm = false;
let lastAutosaveAt = performance.now();
let saveInFlight = false;
let saveQueued = false;

function allowedZoomLevels() {
  if (sessionMode === 'test') return zoomLevels;
  const bounds = currentMap.cameraBounds || currentMap.bounds;
  const maximumSafeScale = Math.max(1, Math.floor(Math.min(
    (bounds.right - bounds.left) / Math.max(1, logicalWidth),
    (bounds.bottom - bounds.top) / Math.max(1, logicalHeight)
  )));
  return [...new Set([
    ...zoomLevels.filter((scale) => scale <= maximumSafeScale),
    maximumSafeScale
  ])].sort((left, right) => left - right);
}

function clampCameraToMap() {
  if (sessionMode === 'test') {
    const allowed = allowedZoomLevels();
    camera.scale = allowed.reduce((closest, scale) => Math.abs(scale - camera.scale) < Math.abs(closest - camera.scale) ? scale : closest, allowed[0]);
    camera.x = Math.round(Math.max(currentMap.bounds.left, Math.min(currentMap.bounds.right, camera.x)) / camera.scale) * camera.scale;
    camera.y = Math.round(Math.max(currentMap.bounds.top, Math.min(currentMap.bounds.bottom, camera.y)) / camera.scale) * camera.scale;
    return;
  }
  const allowed = allowedZoomLevels();
  if (!allowed.includes(camera.scale)) camera.scale = allowed.at(-1);
  const bounds = currentMap.cameraBounds || currentMap.bounds;
  const halfWidth = logicalWidth * camera.scale * 0.5;
  const halfHeight = logicalHeight * camera.scale * 0.5;
  const minimumX = bounds.left + halfWidth;
  const maximumX = bounds.right - halfWidth;
  const minimumY = bounds.top + halfHeight;
  const maximumY = bounds.bottom - halfHeight;
  camera.x = minimumX <= maximumX ? Math.max(minimumX, Math.min(maximumX, camera.x)) : (bounds.left + bounds.right) * 0.5;
  camera.y = minimumY <= maximumY ? Math.max(minimumY, Math.min(maximumY, camera.y)) : (bounds.top + bounds.bottom) * 0.5;
  camera.x = Math.round(camera.x / camera.scale) * camera.scale;
  camera.y = Math.round(camera.y / camera.scale) * camera.scale;
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
      autoSelectPlacedFrame: saved?.autoSelectPlacedFrame !== false
    };
  } catch {
    return { autoSelectPlacedFrame: true };
  }
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
    label: 'host'
  });
  bundleSession.connect();
  bundleSession.advance(20);
  return {
    mode: 'game',
    authority: bundleAuthority,
    session: bundleSession,
    map: getMapDefinition(bundleAuthority.state.mapId),
    networkRole: 'host'
  };
}

function createGuestNetworkBundle(code) {
  const bundleAuthority = createNetworkAuthority('guest');
  const clientId = localPeerClientId();
  const bundleSession = new P2PGuestSession(bundleAuthority, {
    clientId,
    label: `pilot ${clientId.slice(-3)}`,
    resumeToken: loadResumeToken(code)
  });
  bundleSession.roomCode = code;
  bundleSession.onResumeToken = (token) => saveResumeToken(code, token);
  return {
    mode: 'game',
    authority: bundleAuthority,
    session: bundleSession,
    map: getMapDefinition(bundleAuthority.state.mapId),
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

function bindPeerCoordinator(bundle, role, code = null) {
  const coordinator = new PeerConnectionCoordinator();
  peerCoordinator = coordinator;
  bundle.coordinator = coordinator;
  const networkSession = bundle.session;

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
      bundle.map = getMapDefinition(snapshot.mapId);
      if (session === networkSession) {
        sessionSnapshot = snapshot;
        if (firstSync || currentMap.id !== snapshot.mapId) adoptActiveMap(snapshot.mapId);
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
      connected: 'direct p2p link open',
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
    expiresAt: 0
  });
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
  const bundleAuthority = new EmbeddedAuthority(config);
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
    bundle.map = getMapDefinition(bundle.authority.state.mapId);
    if (sessionMode === 'game' && session === bundle.session) {
      sessionSnapshot = bundle.session.latestSnapshot;
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

function activateSession(mode) {
  cameraByMode.set(sessionMode, { ...camera, mapId: currentMap.id });
  const bundle = sessions.get(mode) || createSessionBundle(mode);
  sessionMode = mode;
  authority = bundle.authority;
  session = bundle.session;
  sessionSnapshot = session.snapshot();
  currentMap = getMapDefinition(sessionSnapshot.mapId);
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
  if (event.button !== 0) return;
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
  if (buildCatalogOpen) return;
  if (frontEndScreen !== 'game') return;
  if (towerMenuMode === 'control' && selectedTowerId) {
    const tower = sessionSnapshot.towers.find((candidate) => candidate.id === selectedTowerId);
    const definition = sessionSnapshot.towerCatalog.find((candidate) => candidate.id === tower?.definitionId);
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
  const previous = pointer;
  pointer = canvasPoint(event);
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
  dragging = false;
  canvas.releasePointerCapture(event.pointerId);
  if (dragDistance <= 2 && pointerDown && pointer.y > HUD_TOP_HEIGHT && pointer.y < hudBottomY) handleWorldClick(pointer);
  pointerDown = null;
});

canvas.addEventListener('contextmenu', (event) => {
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
  if (frontEndScreen !== 'game') return;
  const levels = allowedZoomLevels();
  const current = levels.reduce((closestIndex, scale, index) => (
    Math.abs(scale - camera.scale) < Math.abs(levels[closestIndex] - camera.scale) ? index : closestIndex
  ), 0);
  const nextIndex = Math.max(0, Math.min(levels.length - 1, current + Math.sign(event.deltaY)));
  camera.scale = levels[nextIndex];
  camera.x = Math.round(camera.x / camera.scale) * camera.scale;
  camera.y = Math.round(camera.y / camera.scale) * camera.scale;
  clampCameraToMap();
}, { passive: false });

addEventListener('keydown', (event) => {
  if (event.repeat) return;
  const key = event.key.toLowerCase();
  if (event.key === 'Escape') {
    if (frontEndScreen === 'game' && towerMenuMode === 'control') {
      towerMenuMode = sessionMode === 'game' ? 'actions' : null;
      controlDrag = null;
      setStatus('control edit cancelled');
    } else if (frontEndScreen === 'game' && buildCatalogOpen) closeBuildCatalog();
    else if (frontEndScreen === 'game') openEscapeMenu();
    else if (frontEndScreen === 'escape' && escapeMenuPage === 'options') closeEscapeOptions();
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
    if (['1', '2', '3'].includes(event.key)) {
      const map = playableMaps()[Number(event.key) - 1];
      if (map) selectRunMap(map.id);
    } else if (event.key === 'Enter') {
      deploySelectedMap();
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
  const inspectedTower = session.networkRole && selectedTowerId
    ? sessionSnapshot.towers.find((tower) => tower.id === selectedTowerId && tower.ownerId !== session.playerId)
    : null;
  if (inspectedTower && ['1', '2', '3', '0', 'q', 'e', 'a'].includes(key)) {
    const owner = sessionSnapshot.players.find((player) => player.id === inspectedTower.ownerId);
    setStatus(`owned by ${owner?.label || 'another pilot'} // inspect only`);
    return;
  }
  if (selectedTowerId && towerMenuMode && (sessionMode === 'game' || ['relay', 'strike', 'control'].includes(towerMenuMode))) {
    const tower = sessionSnapshot.towers.find((candidate) => candidate.id === selectedTowerId);
    const towerDefinition = sessionSnapshot.towerCatalog.find((candidate) => candidate.id === tower?.definitionId);
    if (towerMenuMode === 'actions' && event.key === '1') {
      event.preventDefault();
      if (tower?.definitionId === 'relay') openRelayTargetMenu(sessionSnapshot, tower);
      else if (tower) openUpgradeMenu(sessionSnapshot, tower);
      return;
    }
    if (towerMenuMode === 'actions' && event.key === '2') {
      event.preventDefault();
      sellSelectedTower();
      return;
    }
    if (towerMenuMode === 'actions' && event.key === '3') {
      event.preventDefault();
      if (towerDefinition?.control?.input && towerDefinition.control.input !== 'none') openControlGeometryMenu(sessionSnapshot, tower);
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
  if (key === 't') {
    if (sessionMode === 'test') activateSession('game');
    else enterTestField();
  } else if (key === 'k') {
    showKps = !showKps;
    setStatus(`kps ${showKps ? 'shown' : 'hidden'}`);
  } else if (key === 'g') {
    showAllRanges = !showAllRanges;
    setStatus(`all ranges ${showAllRanges ? 'shown' : 'hidden'}`);
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
    const definition = sessionSnapshot.towerCatalog.find((candidate) => candidate.id === tower?.definitionId);
    if (definition?.control?.input && definition.control.input !== 'none') openControlGeometryMenu(sessionSnapshot, tower);
    else openStrikeTargetMenu(sessionSnapshot, tower);
  } else if (key === 'r' && sessionSnapshot.phase === 'defeated' && !session.networkRole) {
    session.send(COMMAND.SESSION_RESTART);
  }
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
  const map = getMapDefinition(mapId);
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
  if (sessionSnapshot.phase === 'lobby') session.send(COMMAND.SESSION_START, { mapId: map.id });
  else session.send(COMMAND.SESSION_RESTART, { mapId: map.id });
  gameHasEnteredGameplay = true;
  frontEndScreen = 'game';
  menuConfirm = null;
  clearTransientUi();
  setStatus(`${map.label} // deploying`);
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
  const economy = sessionSnapshot.economyByPlayer[session.playerId];
  if ((economy?.credits || 0) < (definition?.cost ?? Infinity)) {
    placementArmed = false;
    bulkPlacementDefinitionId = null;
    setStatus(`need ${definition?.cost || 100} credits`);
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
  const economy = sessionSnapshot.economyByPlayer[session.playerId];
  if (!definition || !quote) {
    setStatus('tower build path is unavailable');
    return;
  }
  if ((economy?.credits || 0) < quote.cost) {
    setStatus(`need ${quote.cost} credits for ${definition.label}`);
    return;
  }
  bulkPlacementDefinitionId = definitionId;
  placementArmed = true;
  buildCatalogOpen = false;
  selectedTowerId = null;
  towerMenuMode = null;
  setStatus(`${definition.label} ${quote.cost} // place many // right click ends`);
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
  const current = Math.max(0, definition.targetingModes.indexOf(tower.targetingMode));
  const next = (current + direction + definition.targetingModes.length) % definition.targetingModes.length;
  session.send(COMMAND.TOWER_TARGETING_SET, { towerId: tower.id, mode: definition.targetingModes[next] });
}

function project(x, y) {
  return {
    x: Math.round((x - camera.x) / camera.scale + logicalWidth * 0.5),
    y: Math.round((y - camera.y) / camera.scale + logicalHeight * 0.5)
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
  const definition = sessionSnapshot.towerCatalog.find((candidate) => candidate.id === tower?.definitionId);
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
  session.send(COMMAND.TOWER_CONTROL_GEOMETRY_SET, { towerId: tower.id, geometry });
  setStatus('control geometry sent // reboot 1s');
}

function handleWorldClick(screenPoint) {
  const world = unproject(screenPoint.x, screenPoint.y);
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
    const definition = sessionSnapshot.towerCatalog.find((candidate) => candidate.id === tower?.definitionId);
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
    if (!findDefenseAreaAt(currentMap, world.x, world.y)) {
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
      setStatus(`${definition?.label || definitionId} ${quote?.cost || 0} // click next // right click ends`);
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
  towerMenuMode = nearest && sessionMode === 'game' ? 'actions' : null;
  setStatus(nearest ? `${nearest.definitionId} selected` : 'selection cleared');
}

function drawBackground() {
  gl.useProgram(backgroundProgram);
  gl.uniform2f(gl.getUniformLocation(backgroundProgram, 'u_resolution'), logicalWidth, logicalHeight);
  gl.uniform2f(gl.getUniformLocation(backgroundProgram, 'u_camera'), camera.x, camera.y);
  gl.uniform1f(gl.getUniformLocation(backgroundProgram, 'u_viewScale'), camera.scale);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  nebulaRenderer.draw(currentMap, camera);
}

function drawTower(tower, override = null) {
  const p = project(tower.x, tower.y);
  const accent = override?.accent || COLOR.mint;
  const core = override?.core || COLOR.cyan;
  if (!['prism', 'sweeper'].includes(tower.definitionId)) shapes.rect(p.x - 4, p.y - 4, 9, 9, COLOR.black);

  if (tower.definitionId === 'assault') {
    shapes.rect(p.x - 4, p.y - 3, 9, 7, COLOR.black);
    shapes.rect(p.x - 3, p.y - 3, 7, 1, override?.accent || COLOR.amber);
    shapes.rect(p.x - 3, p.y + 3, 7, 1, override?.accent || COLOR.amber);
    shapes.rect(p.x - 3, p.y - 2, 1, 5, accent);
    shapes.rect(p.x + 3, p.y - 2, 1, 5, accent);
    shapes.rect(p.x - 3, p.y - 7, 2, 5, override?.core || COLOR.mint);
    shapes.rect(p.x + 2, p.y - 7, 2, 5, override?.core || COLOR.mint);
    shapes.rect(p.x - 2, p.y - 1, 1, 3, core);
    shapes.rect(p.x + 2, p.y - 1, 1, 3, core);
    return;
  }

  if (tower.definitionId === 'barrage') {
    shapes.rect(p.x - 6, p.y - 4, 13, 9, COLOR.black);
    shapes.rect(p.x - 5, p.y - 3, 11, 1, COLOR.amber);
    shapes.rect(p.x - 5, p.y + 3, 11, 1, COLOR.amber);
    shapes.rect(p.x - 5, p.y - 2, 1, 5, COLOR.mint);
    shapes.rect(p.x + 5, p.y - 2, 1, 5, COLOR.mint);
    for (const barrelX of [-5, -2, 1, 4]) shapes.rect(p.x + barrelX, p.y - 8, 1, 5, COLOR.amber);
    shapes.rect(p.x - 3, p.y - 1, 7, 3, COLOR.cyan);
    shapes.rect(p.x - 1, p.y, 3, 1, COLOR.mint);
    return;
  }

  if (tower.definitionId === 'broadside') {
    const familyAccent = override?.accent || COLOR.amber;
    const familyCore = override?.core || COLOR.mint;
    shapes.rect(p.x - 9, p.y - 5, 19, 11, COLOR.black);
    shapes.rect(p.x - 8, p.y - 4, 17, 1, familyAccent);
    shapes.rect(p.x - 8, p.y + 4, 17, 1, familyAccent);
    shapes.rect(p.x - 8, p.y - 3, 2, 7, familyCore);
    shapes.rect(p.x + 7, p.y - 3, 2, 7, familyCore);
    for (const barrelX of [-7, -5, -3, -1, 1, 3, 5, 7]) {
      shapes.rect(p.x + barrelX, p.y - 11, 1, 7, familyAccent);
      shapes.rect(p.x + barrelX, p.y - 12, 1, 1, familyCore);
    }
    shapes.rect(p.x - 5, p.y - 2, 11, 5, COLOR.black);
    shapes.rect(p.x - 4, p.y - 1, 9, 3, override?.core || COLOR.cyan);
    shapes.rect(p.x - 1, p.y, 3, 1, familyCore);
    return;
  }

  if (tower.definitionId === 'flechette') {
    const familyAccent = override?.accent || COLOR.amber;
    const familyCore = override?.core || COLOR.cyan;
    shapes.rect(p.x - 6, p.y - 5, 13, 11, COLOR.black);
    shapes.rect(p.x - 5, p.y - 4, 11, 1, familyAccent);
    shapes.rect(p.x - 5, p.y + 4, 11, 1, familyAccent);
    for (const needleX of [-5, -2, 2, 5]) {
      const tipOffset = needleX < 0 ? -1 : 1;
      shapes.line(p.x + needleX, p.y - 3, p.x + needleX + tipOffset, p.y - 12, 1, familyCore);
      shapes.rect(p.x + needleX + tipOffset, p.y - 13, 1, 2, override?.core || COLOR.mint);
    }
    shapes.rect(p.x - 3, p.y - 2, 7, 5, COLOR.black);
    shapes.rect(p.x - 2, p.y - 1, 5, 3, familyAccent);
    shapes.rect(p.x, p.y, 1, 1, familyCore);
    shapes.rect(p.x - 7, p.y + 2, 2, 4, familyCore);
    shapes.rect(p.x + 6, p.y + 2, 2, 4, familyCore);
    return;
  }

  if (tower.definitionId === 'cyclone') {
    const familyAccent = override?.accent || COLOR.amber;
    const familyCore = override?.core || COLOR.mint;
    shapes.rect(p.x - 6, p.y - 6, 13, 13, COLOR.black);
    shapes.line(p.x, p.y - 9, p.x + 7, p.y - 2, 2, familyAccent);
    shapes.line(p.x + 7, p.y - 2, p.x, p.y + 8, 2, familyCore);
    shapes.line(p.x, p.y + 8, p.x - 7, p.y + 1, 2, familyAccent);
    shapes.line(p.x - 7, p.y + 1, p.x, p.y - 9, 2, familyCore);
    shapes.rect(p.x - 4, p.y - 4, 9, 9, COLOR.black);
    shapes.rect(p.x - 3, p.y - 3, 7, 1, familyAccent);
    shapes.rect(p.x - 3, p.y + 3, 7, 1, familyAccent);
    shapes.rect(p.x - 1, p.y - 11, 1, 7, familyCore);
    shapes.rect(p.x + 2, p.y - 11, 1, 7, familyCore);
    shapes.rect(p.x - 1, p.y - 1, 3, 3, override?.core || COLOR.cyan);
    return;
  }

  if (tower.definitionId === 'rocket') {
    shapes.rect(p.x - 5, p.y - 7, 11, 13, COLOR.black);
    shapes.rect(p.x - 4, p.y - 3, 9, 7, COLOR.amber);
    shapes.rect(p.x - 3, p.y - 2, 7, 5, COLOR.black);
    shapes.rect(p.x - 1, p.y - 8, 3, 9, COLOR.amber);
    shapes.rect(p.x, p.y - 10, 1, 2, COLOR.mint);
    shapes.rect(p.x - 4, p.y + 4, 3, 2, COLOR.amber);
    shapes.rect(p.x + 2, p.y + 4, 3, 2, COLOR.amber);
    shapes.rect(p.x, p.y + 1, 1, 3, COLOR.red);
    return;
  }

  if (tower.definitionId === 'warhead') {
    const familyAccent = override?.accent || COLOR.amber;
    const familyCore = override?.core || COLOR.mint;
    shapes.rect(p.x - 7, p.y - 10, 15, 18, COLOR.black);
    shapes.rect(p.x - 3, p.y - 12, 7, 17, familyAccent);
    shapes.rect(p.x - 2, p.y - 14, 5, 3, override?.accent || COLOR.red);
    shapes.rect(p.x - 1, p.y - 15, 3, 2, familyCore);
    shapes.rect(p.x - 5, p.y - 4, 3, 9, familyAccent);
    shapes.rect(p.x + 3, p.y - 4, 3, 9, familyAccent);
    shapes.rect(p.x - 7, p.y + 3, 3, 5, override?.accent || COLOR.red);
    shapes.rect(p.x + 5, p.y + 3, 3, 5, override?.accent || COLOR.red);
    shapes.rect(p.x - 2, p.y - 6, 5, 7, COLOR.black);
    shapes.rect(p.x - 1, p.y - 5, 3, 5, override?.core || COLOR.red);
    shapes.rect(p.x, p.y - 4, 1, 3, familyCore);
    return;
  }

  if (tower.definitionId === 'cluster') {
    const familyAccent = override?.accent || COLOR.amber;
    const familyCore = override?.core || COLOR.mint;
    shapes.rect(p.x - 7, p.y - 7, 15, 15, COLOR.black);
    for (const [nodeX, nodeY] of [[0, -9], [7, -5], [7, 4], [0, 8], [-7, 4], [-7, -5]]) {
      shapes.rect(p.x + nodeX - 2, p.y + nodeY - 2, 5, 5, COLOR.black);
      shapes.rect(p.x + nodeX - 1, p.y + nodeY - 1, 3, 3, familyAccent);
      shapes.rect(p.x + nodeX, p.y + nodeY, 1, 1, familyCore);
    }
    shapes.rect(p.x - 5, p.y - 5, 11, 11, familyAccent);
    shapes.rect(p.x - 4, p.y - 4, 9, 9, COLOR.black);
    shapes.rect(p.x - 2, p.y - 2, 5, 5, override?.core || COLOR.red);
    shapes.rect(p.x, p.y - 1, 1, 3, familyCore);
    return;
  }

  if (tower.definitionId === 'salvo') {
    const familyAccent = override?.accent || COLOR.amber;
    const familyCore = override?.core || COLOR.mint;
    shapes.rect(p.x - 8, p.y - 8, 17, 15, COLOR.black);
    for (const missileX of [-6, 0, 6]) {
      shapes.rect(p.x + missileX - 2, p.y - 9, 5, 13, COLOR.black);
      shapes.rect(p.x + missileX - 1, p.y - 10, 3, 11, familyAccent);
      shapes.rect(p.x + missileX, p.y - 12, 1, 2, familyCore);
      shapes.rect(p.x + missileX - 2, p.y + 1, 2, 4, override?.accent || COLOR.red);
      shapes.rect(p.x + missileX + 1, p.y + 1, 2, 4, override?.accent || COLOR.red);
    }
    shapes.rect(p.x - 7, p.y + 5, 15, 2, familyAccent);
    shapes.rect(p.x - 2, p.y + 3, 5, 3, COLOR.black);
    shapes.rect(p.x - 1, p.y + 3, 3, 2, override?.core || COLOR.cyan);
    return;
  }

  if (tower.definitionId === 'laser') {
    shapes.rect(p.x - 4, p.y - 8, 9, 15, COLOR.black);
    shapes.rect(p.x - 3, p.y - 3, 7, 7, COLOR.cyan);
    shapes.rect(p.x - 2, p.y - 2, 5, 5, COLOR.black);
    shapes.rect(p.x, p.y - 10, 1, 9, COLOR.mint);
    shapes.rect(p.x - 1, p.y - 7, 3, 2, COLOR.cyan);
    shapes.rect(p.x - 1, p.y - 1, 3, 3, COLOR.amber);
    shapes.rect(p.x - 5, p.y + 4, 3, 2, COLOR.cyan);
    shapes.rect(p.x + 3, p.y + 4, 3, 2, COLOR.cyan);
    return;
  }

  if (tower.definitionId === 'cutter') {
    const familyAccent = override?.accent || COLOR.cyan;
    const familyCore = override?.core || COLOR.mint;
    shapes.rect(p.x - 10, p.y - 7, 21, 15, COLOR.black);
    shapes.rect(p.x - 9, p.y - 6, 5, 12, familyAccent);
    shapes.rect(p.x + 5, p.y - 6, 5, 12, familyAccent);
    shapes.rect(p.x - 8, p.y - 4, 3, 8, COLOR.black);
    shapes.rect(p.x + 6, p.y - 4, 3, 8, COLOR.black);
    shapes.rect(p.x - 5, p.y - 2, 11, 5, familyCore);
    shapes.rect(p.x - 4, p.y - 1, 9, 3, COLOR.black);
    shapes.rect(p.x - 2, p.y, 5, 1, override?.accent || COLOR.amber);
    shapes.rect(p.x - 4, p.y - 11, 9, 9, COLOR.black);
    shapes.rect(p.x - 3, p.y - 10, 7, 7, familyAccent);
    shapes.rect(p.x - 1, p.y - 10, 3, 8, familyCore);
    return;
  }

  if (tower.definitionId === 'prism') {
    const familyAccent = override?.accent || COLOR.cyan;
    const familyCore = override?.core || COLOR.mint;
    const hotCore = override?.core || COLOR.amber;
    shapes.triangle(
      { x: p.x, y: p.y - 11 },
      { x: p.x + 7, y: p.y + 2 },
      { x: p.x, y: p.y + 5 },
      familyAccent
    );
    shapes.triangle(
      { x: p.x, y: p.y - 11 },
      { x: p.x, y: p.y + 5 },
      { x: p.x - 7, y: p.y + 2 },
      familyCore
    );
    shapes.line(p.x, p.y - 7, p.x - 9, p.y - 10, 2, familyAccent);
    shapes.line(p.x, p.y - 8, p.x, p.y - 13, 2, familyCore);
    shapes.line(p.x, p.y - 7, p.x + 9, p.y - 10, 2, familyAccent);
    for (const emitterX of [-9, 0, 9]) shapes.rect(p.x + emitterX - 1, p.y - (emitterX === 0 ? 15 : 12), 3, 3, hotCore);
    shapes.triangle(
      { x: p.x, y: p.y - 7 },
      { x: p.x + 3, y: p.y },
      { x: p.x, y: p.y + 3 },
      hotCore
    );
    shapes.triangle(
      { x: p.x, y: p.y - 7 },
      { x: p.x, y: p.y + 3 },
      { x: p.x - 3, y: p.y },
      override?.accent || COLOR.mint
    );
    shapes.rect(p.x - 8, p.y + 5, 17, 2, familyAccent);
    shapes.rect(p.x - 5, p.y + 7, 11, 1, familyCore);
    shapes.rect(p.x - 1, p.y + 4, 3, 4, hotCore);
    return;
  }

  if (tower.definitionId === 'sweeper') {
    const familyAccent = override?.accent || COLOR.cyan;
    const familyCore = override?.core || COLOR.mint;
    const hotCore = override?.core || COLOR.amber;
    shapes.triangle(
      { x: p.x - 8, y: p.y + 2 },
      { x: p.x, y: p.y - 8 },
      { x: p.x, y: p.y + 3 },
      familyAccent
    );
    shapes.triangle(
      { x: p.x, y: p.y - 8 },
      { x: p.x + 8, y: p.y + 2 },
      { x: p.x, y: p.y + 3 },
      familyCore
    );
    shapes.line(p.x - 7, p.y + 2, p.x + 7, p.y + 2, 2, hotCore);
    shapes.line(p.x, p.y - 5, p.x + 10, p.y - 11, 2, familyCore);
    shapes.rect(p.x + 9, p.y - 13, 3, 3, hotCore);
    shapes.rect(p.x - 3, p.y + 3, 7, 3, familyAccent);
    shapes.rect(p.x - 1, p.y + 3, 3, 3, hotCore);
    shapes.rect(p.x - 8, p.y + 6, 17, 2, familyAccent);
    shapes.rect(p.x - 5, p.y + 8, 11, 1, familyCore);
    return;
  }

  if (tower.definitionId === 'anchor') {
    shapes.rect(p.x - 5, p.y - 5, 11, 11, COLOR.black);
    shapes.rect(p.x - 4, p.y - 4, 9, 1, COLOR.cyan);
    shapes.rect(p.x - 4, p.y + 4, 9, 1, COLOR.cyan);
    shapes.rect(p.x - 4, p.y - 3, 1, 7, COLOR.cyan);
    shapes.rect(p.x + 4, p.y - 3, 1, 7, COLOR.cyan);
    shapes.rect(p.x - 1, p.y - 8, 3, 5, COLOR.mint);
    shapes.rect(p.x - 1, p.y + 4, 3, 4, COLOR.mint);
    shapes.rect(p.x - 7, p.y - 1, 4, 3, COLOR.mint);
    shapes.rect(p.x + 4, p.y - 1, 4, 3, COLOR.mint);
    shapes.rect(p.x - 1, p.y - 1, 3, 3, COLOR.cyan);
    return;
  }

  if (tower.definitionId === 'knot') {
    shapes.rect(p.x - 5, p.y - 5, 11, 11, COLOR.black);
    shapes.line(p.x, p.y - 7, p.x + 7, p.y, 1, COLOR.green);
    shapes.line(p.x + 7, p.y, p.x, p.y + 7, 1, COLOR.green);
    shapes.line(p.x, p.y + 7, p.x - 7, p.y, 1, COLOR.cyan);
    shapes.line(p.x - 7, p.y, p.x, p.y - 7, 1, COLOR.cyan);
    shapes.rect(p.x - 3, p.y - 3, 7, 7, COLOR.black);
    shapes.rect(p.x - 2, p.y - 2, 5, 1, COLOR.mint);
    shapes.rect(p.x - 2, p.y + 2, 5, 1, COLOR.mint);
    shapes.rect(p.x - 2, p.y - 1, 1, 3, COLOR.mint);
    shapes.rect(p.x + 2, p.y - 1, 1, 3, COLOR.mint);
    shapes.rect(p.x, p.y, 1, 1, COLOR.cyan);
    return;
  }

  if (tower.definitionId === 'backwash') {
    shapes.rect(p.x - 5, p.y - 5, 11, 11, COLOR.black);
    shapes.rect(p.x - 4, p.y + 3, 9, 2, COLOR.amber);
    shapes.rect(p.x - 3, p.y, 7, 2, COLOR.cyan);
    shapes.rect(p.x - 2, p.y - 3, 5, 2, COLOR.mint);
    shapes.rect(p.x - 1, p.y - 7, 3, 4, COLOR.amber);
    shapes.rect(p.x - 6, p.y + 1, 2, 5, COLOR.cyan);
    shapes.rect(p.x + 5, p.y + 1, 2, 5, COLOR.cyan);
    shapes.rect(p.x, p.y, 1, 1, COLOR.black);
    return;
  }

  if (tower.definitionId === 'stasis') {
    shapes.rect(p.x - 7, p.y - 7, 15, 15, COLOR.black);
    shapes.rect(p.x - 6, p.y - 6, 5, 2, COLOR.cyan);
    shapes.rect(p.x + 2, p.y - 6, 5, 2, COLOR.cyan);
    shapes.rect(p.x - 6, p.y + 5, 5, 2, COLOR.cyan);
    shapes.rect(p.x + 2, p.y + 5, 5, 2, COLOR.cyan);
    shapes.rect(p.x - 6, p.y - 4, 2, 9, COLOR.mint);
    shapes.rect(p.x + 5, p.y - 4, 2, 9, COLOR.mint);
    shapes.rect(p.x - 2, p.y - 4, 2, 9, COLOR.amber);
    shapes.rect(p.x + 1, p.y - 4, 2, 9, COLOR.amber);
    shapes.rect(p.x, p.y - 9, 1, 3, COLOR.mint);
    return;
  }

  if (tower.definitionId === 'recall') {
    shapes.rect(p.x - 6, p.y - 6, 13, 13, COLOR.black);
    shapes.line(p.x - 6, p.y - 1, p.x - 2, p.y - 7, 2, COLOR.amber);
    shapes.line(p.x - 2, p.y - 7, p.x + 5, p.y - 5, 2, COLOR.cyan);
    shapes.line(p.x + 5, p.y - 5, p.x + 7, p.y + 2, 2, COLOR.cyan);
    shapes.line(p.x + 7, p.y + 2, p.x + 2, p.y + 7, 2, COLOR.mint);
    shapes.line(p.x + 2, p.y + 7, p.x - 5, p.y + 4, 2, COLOR.mint);
    shapes.rect(p.x - 8, p.y - 3, 4, 5, COLOR.amber);
    shapes.rect(p.x - 1, p.y - 2, 3, 5, COLOR.black);
    shapes.rect(p.x, p.y - 1, 1, 3, COLOR.amber);
    return;
  }

  if (tower.definitionId === 'dragnet') {
    shapes.rect(p.x - 7, p.y - 7, 15, 15, COLOR.black);
    for (const offset of [-5, 0, 5]) {
      shapes.line(p.x + offset, p.y - 6, p.x + offset, p.y + 6, 1, offset === 0 ? COLOR.mint : COLOR.cyan);
      shapes.line(p.x - 6, p.y + offset, p.x + 6, p.y + offset, 1, offset === 0 ? COLOR.mint : COLOR.cyan);
    }
    shapes.rect(p.x - 8, p.y - 8, 4, 3, COLOR.green);
    shapes.rect(p.x + 5, p.y - 8, 4, 3, COLOR.green);
    shapes.rect(p.x - 8, p.y + 6, 4, 3, COLOR.green);
    shapes.rect(p.x + 5, p.y + 6, 4, 3, COLOR.green);
    shapes.rect(p.x - 1, p.y - 1, 3, 3, COLOR.amber);
    return;
  }

  if (tower.definitionId === 'singularity') {
    shapes.rect(p.x - 7, p.y - 7, 15, 15, COLOR.black);
    shapes.line(p.x, p.y - 10, p.x + 9, p.y, 2, COLOR.green);
    shapes.line(p.x + 9, p.y, p.x, p.y + 9, 2, COLOR.cyan);
    shapes.line(p.x, p.y + 9, p.x - 9, p.y, 2, COLOR.green);
    shapes.line(p.x - 9, p.y, p.x, p.y - 10, 2, COLOR.cyan);
    shapes.line(p.x, p.y - 6, p.x + 5, p.y, 1, COLOR.mint);
    shapes.line(p.x + 5, p.y, p.x, p.y + 5, 1, COLOR.mint);
    shapes.line(p.x, p.y + 5, p.x - 5, p.y, 1, COLOR.mint);
    shapes.line(p.x - 5, p.y, p.x, p.y - 6, 1, COLOR.mint);
    shapes.rect(p.x - 2, p.y - 2, 5, 5, COLOR.black);
    shapes.rect(p.x, p.y, 1, 1, COLOR.amber);
    return;
  }

  if (tower.definitionId === 'orbit') {
    shapes.rect(p.x - 6, p.y - 6, 13, 13, COLOR.black);
    shapes.line(p.x, p.y - 8, p.x + 8, p.y, 1, COLOR.cyan);
    shapes.line(p.x + 8, p.y, p.x, p.y + 8, 1, COLOR.green);
    shapes.line(p.x, p.y + 8, p.x - 8, p.y, 1, COLOR.cyan);
    shapes.line(p.x - 8, p.y, p.x, p.y - 8, 1, COLOR.green);
    shapes.rect(p.x - 2, p.y - 2, 5, 5, COLOR.mint);
    shapes.rect(p.x - 1, p.y - 1, 3, 3, COLOR.black);
    shapes.rect(p.x + 6, p.y - 3, 4, 4, COLOR.amber);
    shapes.rect(p.x - 9, p.y + 3, 3, 3, COLOR.cyan);
    shapes.rect(p.x + 7, p.y - 2, 1, 1, COLOR.mint);
    return;
  }

  if (tower.definitionId === 'braid') {
    shapes.rect(p.x - 7, p.y - 8, 15, 17, COLOR.black);
    shapes.line(p.x - 7, p.y - 8, p.x + 4, p.y + 8, 2, COLOR.cyan);
    shapes.line(p.x + 7, p.y - 8, p.x - 4, p.y + 8, 2, COLOR.green);
    shapes.line(p.x - 4, p.y - 8, p.x + 7, p.y + 8, 1, COLOR.mint);
    shapes.line(p.x + 4, p.y - 8, p.x - 7, p.y + 8, 1, COLOR.mint);
    shapes.rect(p.x - 8, p.y - 9, 5, 3, COLOR.amber);
    shapes.rect(p.x + 4, p.y - 9, 5, 3, COLOR.amber);
    shapes.rect(p.x - 8, p.y + 7, 5, 3, COLOR.amber);
    shapes.rect(p.x + 4, p.y + 7, 5, 3, COLOR.amber);
    shapes.rect(p.x - 1, p.y - 1, 3, 3, COLOR.black);
    return;
  }

  if (tower.definitionId === 'breaker') {
    shapes.rect(p.x - 8, p.y - 7, 17, 15, COLOR.black);
    for (const offset of [-5, 0, 5]) {
      shapes.line(p.x - 8 + Math.abs(offset), p.y + 7 + offset, p.x, p.y - 8 + offset, 2, offset === 0 ? COLOR.mint : COLOR.amber);
      shapes.line(p.x, p.y - 8 + offset, p.x + 8 - Math.abs(offset), p.y + 7 + offset, 2, offset === 0 ? COLOR.mint : COLOR.amber);
    }
    shapes.rect(p.x - 2, p.y - 1, 5, 5, COLOR.cyan);
    shapes.rect(p.x - 1, p.y, 3, 3, COLOR.black);
    shapes.rect(p.x, p.y - 11, 1, 4, COLOR.red);
    return;
  }

  if (tower.definitionId === 'crosswind') {
    const wind = tower.controlGeometry || { dx: 1, dy: 0 };
    const windLength = Math.hypot(wind.dx, wind.dy) || 1;
    const dx = wind.dx / windLength;
    const dy = wind.dy / windLength;
    const px = -dy;
    const py = dx;
    shapes.rect(p.x - 6, p.y - 6, 13, 13, COLOR.black);
    shapes.line(p.x - dx * 8, p.y - dy * 8, p.x + dx * 9, p.y + dy * 9, 2, COLOR.cyan);
    shapes.line(p.x - px * 6, p.y - py * 6, p.x + px * 6, p.y + py * 6, 1, COLOR.green);
    shapes.line(p.x + dx * 9, p.y + dy * 9, p.x + dx * 4 + px * 4, p.y + dy * 4 + py * 4, 2, COLOR.amber);
    shapes.line(p.x + dx * 9, p.y + dy * 9, p.x + dx * 4 - px * 4, p.y + dy * 4 - py * 4, 2, COLOR.amber);
    shapes.rect(p.x - 2, p.y - 2, 5, 5, COLOR.mint);
    shapes.rect(p.x - 1, p.y - 1, 3, 3, COLOR.black);
    return;
  }

  if (tower.definitionId === 'breakwater') {
    shapes.rect(p.x - 9, p.y - 7, 19, 15, COLOR.black);
    shapes.rect(p.x - 9, p.y - 6, 19, 3, COLOR.amber);
    shapes.rect(p.x - 7, p.y - 2, 15, 3, COLOR.cyan);
    shapes.rect(p.x - 9, p.y + 2, 19, 3, COLOR.amber);
    for (const postX of [-8, -2, 4, 9]) shapes.rect(p.x + postX, p.y - 8, 2, 17, COLOR.mint);
    shapes.rect(p.x - 4, p.y - 1, 9, 3, COLOR.black);
    shapes.rect(p.x - 1, p.y, 3, 1, COLOR.green);
    shapes.rect(p.x - 7, p.y + 6, 15, 2, COLOR.cyan);
    return;
  }

  if (tower.definitionId === 'tether') {
    shapes.rect(p.x - 3, p.y - 3, 7, 1, override?.accent || COLOR.cyan);
    shapes.rect(p.x - 3, p.y + 3, 7, 1, override?.accent || COLOR.cyan);
    shapes.rect(p.x - 3, p.y - 2, 1, 5, accent);
    shapes.rect(p.x + 3, p.y - 2, 1, 5, accent);
    shapes.rect(p.x - 1, p.y - 1, 3, 3, override?.core || COLOR.mint);
    shapes.rect(p.x, p.y - 7, 1, 4, core);
    shapes.rect(p.x, p.y + 4, 1, 3, core);
    shapes.rect(p.x - 6, p.y, 3, 1, core);
    shapes.rect(p.x + 4, p.y, 3, 1, core);
    return;
  }

  if (tower.definitionId === 'overclock') {
    shapes.rect(p.x - 5, p.y - 5, 11, 11, COLOR.black);
    shapes.rect(p.x, p.y - 7, 1, 15, COLOR.green);
    shapes.rect(p.x - 7, p.y, 15, 1, COLOR.green);
    shapes.rect(p.x - 4, p.y - 5, 2, 4, COLOR.amber);
    shapes.rect(p.x + 3, p.y - 5, 2, 4, COLOR.amber);
    shapes.rect(p.x - 4, p.y + 2, 2, 4, COLOR.amber);
    shapes.rect(p.x + 3, p.y + 2, 2, 4, COLOR.amber);
    shapes.rect(p.x - 2, p.y - 2, 5, 5, COLOR.black);
    shapes.rect(p.x - 1, p.y - 1, 3, 3, COLOR.mint);
    shapes.rect(p.x, p.y - 1, 1, 1, COLOR.amber);
    return;
  }

  if (tower.definitionId === 'forge') {
    shapes.rect(p.x - 6, p.y - 5, 13, 11, COLOR.black);
    shapes.rect(p.x - 5, p.y - 3, 11, 3, COLOR.amber);
    shapes.rect(p.x - 3, p.y, 7, 3, COLOR.amber);
    shapes.rect(p.x - 1, p.y + 3, 3, 4, COLOR.green);
    shapes.rect(p.x - 4, p.y + 6, 9, 1, COLOR.green);
    shapes.rect(p.x - 2, p.y - 7, 5, 4, COLOR.cyan);
    shapes.rect(p.x - 1, p.y - 6, 3, 2, COLOR.black);
    shapes.rect(p.x, p.y - 6, 1, 1, COLOR.mint);
    return;
  }

  if (tower.definitionId === 'relay') {
    shapes.rect(p.x - 5, p.y - 5, 11, 11, COLOR.black);
    shapes.rect(p.x, p.y - 8, 1, 15, COLOR.cyan);
    shapes.rect(p.x - 5, p.y + 4, 11, 2, COLOR.green);
    shapes.rect(p.x - 3, p.y + 2, 7, 2, COLOR.green);
    shapes.rect(p.x - 1, p.y, 3, 2, COLOR.mint);
    shapes.rect(p.x - 5, p.y - 6, 2, 2, COLOR.green);
    shapes.rect(p.x + 4, p.y - 6, 2, 2, COLOR.green);
    shapes.rect(p.x - 7, p.y - 3, 2, 2, COLOR.dimMint);
    shapes.rect(p.x + 6, p.y - 3, 2, 2, COLOR.dimMint);
    shapes.rect(p.x, p.y - 9, 1, 1, COLOR.amber);
    return;
  }

  if (tower.definitionId === 'network') {
    shapes.rect(p.x - 3, p.y - 3, 7, 7, COLOR.black);
    shapes.rect(p.x, p.y - 5, 1, 11, override?.accent || COLOR.green);
    shapes.rect(p.x - 5, p.y, 11, 1, override?.accent || COLOR.green);
    shapes.rect(p.x - 3, p.y - 3, 2, 2, core);
    shapes.rect(p.x + 2, p.y - 3, 2, 2, core);
    shapes.rect(p.x - 3, p.y + 2, 2, 2, core);
    shapes.rect(p.x + 2, p.y + 2, 2, 2, core);
    shapes.rect(p.x - 1, p.y - 1, 3, 3, override?.core || COLOR.mint);
    return;
  }

  shapes.rect(p.x - 3, p.y - 3, 7, 1, accent);
  shapes.rect(p.x - 3, p.y + 3, 7, 1, accent);
  shapes.rect(p.x - 3, p.y - 2, 1, 5, accent);
  shapes.rect(p.x + 3, p.y - 2, 1, 5, accent);
  shapes.rect(p.x - 1, p.y - 1, 3, 3, core);
  shapes.rect(p.x, p.y - 6, 1, 3, COLOR.amber);
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

function drawNetworkLinks(snapshot) {
  const definitions = new Map(snapshot.towerCatalog.map((definition) => [definition.id, definition]));
  const relayPairs = new Set();
  for (const source of snapshot.towers) {
    if (source.definitionId !== 'relay' || !source.relayTargetAreaId) continue;
    const pair = [source.areaId, source.relayTargetAreaId].sort().join(':');
    if (relayPairs.has(pair)) continue;
    relayPairs.add(pair);
    const targetCenter = defenseAreaCenterById(source.relayTargetAreaId);
    if (!targetCenter) continue;
    const from = project(source.x, source.y);
    const to = project(targetCenter.x, targetCenter.y);
    drawDashedLink(from, to, COLOR.dimMint);
    shapes.rect(from.x - 1, from.y - 1, 3, 3, COLOR.green);
    shapes.rect(to.x - 2, to.y - 2, 5, 5, COLOR.black);
    shapes.rect(to.x - 1, to.y - 1, 3, 3, COLOR.cyan);
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
  for (const target of targets) {
    const to = project(target.x, target.y);
    shapes.line(from.x, from.y, to.x, to.y, 1, COLOR.dimMint);
    shapes.rect(to.x, to.y, 1, 1, COLOR.green);
  }
}

function drawBase(time, base) {
  const p = project(base.x, base.y);
  const pulse = Math.floor(time * 4) % 2;
  shapes.rect(p.x - 13, p.y - 6, 27, 13, COLOR.black);
  shapes.rect(p.x - 11, p.y - 5, 23, 1, COLOR.cyan);
  shapes.rect(p.x - 11, p.y + 5, 23, 1, COLOR.cyan);
  shapes.rect(p.x - 11, p.y - 4, 1, 9, COLOR.cyan);
  shapes.rect(p.x + 11, p.y - 4, 1, 9, COLOR.cyan);
  shapes.rect(p.x - 4, p.y - 9, 9, 3, COLOR.mint);
  shapes.rect(p.x - 5, p.y + 7, 11, 2, COLOR.mint);
  shapes.rect(p.x - 2, p.y - 2, 5, 5, pulse ? COLOR.green : COLOR.mint);
  shapes.rect(p.x - 15, p.y - 1, 3, 3, COLOR.amber);
  shapes.rect(p.x + 13, p.y - 1, 3, 3, COLOR.amber);
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
      : ['knot', 'singularity', 'orbit', 'braid'].includes(projectile.formId)
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

function drawControlFields(snapshot) {
  for (const field of snapshot.forceFields || []) {
    const persistent = field.persistentControl === true;
    const durationTicks = Math.max(1, field.expiresTick - field.createdTick);
    const phase = persistent
      ? (snapshot.runTick % Math.max(1, field.periodTicks || 120)) / Math.max(1, field.periodTicks || 120)
      : Math.max(0, Math.min(1, (snapshot.runTick - field.createdTick) / durationTicks));
    if (!persistent && phase >= 1) continue;
    const center = project(field.x, field.y);
    const activeColor = persistent || phase < 0.72 ? COLOR.cyan : COLOR.dimMint;

    if (field.kind === 'stasis_zone') {
      const pulsePhase = (snapshot.runTick % field.periodTicks) / field.periodTicks;
      drawWorldRing(field.x, field.y, field.radius, COLOR.cyan);
      drawWorldRing(field.x, field.y, field.radius * (0.22 + pulsePhase * 0.72), pulsePhase < 0.14 ? COLOR.mint : COLOR.dimMint);
      const radiusPixels = Math.max(4, Math.round(field.radius / camera.scale));
      for (const angle of [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5]) {
        const outerX = center.x + Math.round(Math.cos(angle) * radiusPixels);
        const outerY = center.y + Math.round(Math.sin(angle) * radiusPixels);
        const innerX = center.x + Math.round(Math.cos(angle) * (radiusPixels - 7));
        const innerY = center.y + Math.round(Math.sin(angle) * (radiusPixels - 7));
        shapes.line(outerX, outerY, innerX, innerY, 2, pulsePhase < 0.14 ? COLOR.amber : COLOR.mint);
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
      drawWorldRing(field.x, field.y, field.radius, activeColor);
      const radiusPixels = Math.max(3, Math.round(field.radius / camera.scale));
      for (const offsetFraction of [-0.5, 0, 0.5]) {
        const offset = Math.round(radiusPixels * offsetFraction);
        const span = Math.round(Math.sqrt(Math.max(0, radiusPixels * radiusPixels - offset * offset)) * 0.82);
        shapes.line(center.x + offset, center.y - span, center.x + offset, center.y + span, 1, offset === 0 ? COLOR.mint : COLOR.dimMint);
        shapes.line(center.x - span, center.y + offset, center.x + span, center.y + offset, 1, offset === 0 ? COLOR.mint : COLOR.dimMint);
      }
      continue;
    }

    if (field.kind === 'radial_force') {
      const singularity = field.sourceFormId === 'singularity';
      const pulse = singularity ? 1 - phase * 0.45 : 1 - phase * 0.25;
      drawWorldRing(field.x, field.y, field.radius * pulse, singularity ? COLOR.green : activeColor);
      drawWorldRing(field.x, field.y, Math.max(6, field.radius * pulse * 0.48), singularity ? COLOR.cyan : COLOR.green);
      const reach = Math.max(3, Math.round(field.radius * pulse / camera.scale));
      const inset = singularity ? Math.max(2, Math.round(reach * 0.18)) : 2;
      shapes.line(center.x - reach, center.y, center.x - inset, center.y, singularity ? 2 : 1, COLOR.mint);
      shapes.line(center.x + reach, center.y, center.x + inset, center.y, singularity ? 2 : 1, COLOR.mint);
      shapes.line(center.x, center.y - reach, center.x, center.y - inset, singularity ? 2 : 1, COLOR.mint);
      shapes.line(center.x, center.y + reach, center.x, center.y + inset, singularity ? 2 : 1, COLOR.mint);
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

    if (field.kind === 'vortex_force') {
      drawWorldRing(field.x, field.y, field.radius, phase < 0.75 ? COLOR.green : COLOR.dimMint);
      drawWorldRing(field.x, field.y, field.radius * 0.45, COLOR.cyan);
      const orbitRadius = field.radius * (0.68 - phase * 0.12);
      const spin = field.spin || 1;
      for (let index = 0; index < 6; index += 1) {
        const angle = spin * phase * Math.PI * 4 + index * Math.PI / 3;
        const satellite = project(field.x + Math.cos(angle) * orbitRadius, field.y + Math.sin(angle) * orbitRadius);
        shapes.rect(satellite.x - 1, satellite.y - 1, 3, 3, index % 2 ? COLOR.cyan : COLOR.mint);
      }
      shapes.rect(center.x - 1, center.y - 1, 3, 3, COLOR.amber);
      continue;
    }

    if (field.kind === 'pinch_force') {
      drawWorldRing(field.x, field.y, field.radius, phase < 0.75 ? COLOR.green : COLOR.dimMint);
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
        shapes.line(outside.x, outside.y, inside.x, inside.y, 2, side < 0 ? COLOR.cyan : COLOR.mint);
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
      shapes.line(edgeA1.x, edgeA1.y, edgeA2.x, edgeA2.y, 2, COLOR.green);
      shapes.line(edgeB1.x, edgeB1.y, edgeB2.x, edgeB2.y, 2, COLOR.cyan);
      drawDashedLink(first, second, COLOR.mint);
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
      shapes.line(wallFrom.x - screenOffsetX, wallFrom.y - screenOffsetY, wallTo.x - screenOffsetX, wallTo.y - screenOffsetY, 2, COLOR.amber);
      shapes.line(wallFrom.x + screenOffsetX, wallFrom.y + screenOffsetY, wallTo.x + screenOffsetX, wallTo.y + screenOffsetY, 2, activeColor);
      drawDashedLink(wallFrom, wallTo, COLOR.mint);
      for (const along of [-0.55, 0, 0.55]) {
        const arrowStart = project(
          field.x + field.wallAxisX * field.halfLength * along - field.pushX * field.thickness,
          field.y + field.wallAxisY * field.halfLength * along - field.pushY * field.thickness
        );
        const arrowEnd = project(
          field.x + field.wallAxisX * field.halfLength * along + field.pushX * field.thickness * 1.8,
          field.y + field.wallAxisY * field.halfLength * along + field.pushY * field.thickness * 1.8
        );
        shapes.line(arrowStart.x, arrowStart.y, arrowEnd.x, arrowEnd.y, 1, COLOR.cyan);
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
      drawWorldRing(field.x, field.y, field.radius, COLOR.cyan);
      const perpendicularX = -field.directionY;
      const perpendicularY = field.directionX;
      for (const offset of [-0.48, 0, 0.48]) {
        const start = project(
          field.x + perpendicularX * field.radius * offset - field.directionX * field.radius * 0.48,
          field.y + perpendicularY * field.radius * offset - field.directionY * field.radius * 0.48
        );
        const end = project(
          field.x + perpendicularX * field.radius * offset + field.directionX * field.radius * 0.48,
          field.y + perpendicularY * field.radius * offset + field.directionY * field.radius * 0.48
        );
        shapes.line(start.x, start.y, end.x, end.y, offset === 0 ? 2 : 1, offset === 0 ? COLOR.mint : COLOR.amber);
      }
      continue;
    }

    if (field.kind === 'directional_force') {
      const breaker = field.sourceFormId === 'breaker';
      drawWorldRing(field.x, field.y, field.radius, breaker ? COLOR.amber : activeColor);
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
        shapes.line(start.x, start.y, end.x, end.y, breaker && index === 2 ? 2 : 1, index % 2 ? COLOR.amber : COLOR.mint);
      }
    }
  }
}

function addAttackFlash(event) {
  const payload = event.payload;
  const geometry = payload.geometry;
  if (payload.sourceFormId === 'sweeper' && geometry?.type === 'line'
    && Number.isFinite(geometry.sweepPhase)
    && [geometry.x1, geometry.y1, geometry.x2, geometry.y2].every(Number.isFinite)) {
    const existingIndex = attackFlashes.findIndex((candidate) => (
      candidate.kind === 'sweep' && candidate.sourceTowerId === payload.sourceTowerId
    ));
    const existing = existingIndex >= 0 ? attackFlashes[existingIndex] : null;
    const continuesSweep = existing && geometry.sweepPhase > existing.phase;
    const flash = {
      kind: 'sweep',
      age: 0,
      sourceTowerId: payload.sourceTowerId,
      phase: geometry.sweepPhase,
      x1: geometry.x1,
      y1: geometry.y1,
      x2: geometry.x2,
      y2: geometry.y2,
      previousX2: continuesSweep ? existing.x2 : null,
      previousY2: continuesSweep ? existing.y2 : null,
      width: geometry.width || 10
    };
    if (existingIndex >= 0) attackFlashes[existingIndex] = flash;
    else attackFlashes.push(flash);
  } else if (['laser', 'cutter', 'prism'].includes(payload.sourceFormId) && geometry?.type === 'line'
    && [geometry.x1, geometry.y1, geometry.x2, geometry.y2].every(Number.isFinite)) {
    attackFlashes.push({
      kind: 'laser',
      age: 0,
      formId: payload.sourceFormId,
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
    if (flash.kind === 'sweep') {
      if (flash.age >= 0.12) continue;
      const from = project(flash.x1, flash.y1);
      const to = project(flash.x2, flash.y2);
      const previous = Number.isFinite(flash.previousX2) && Number.isFinite(flash.previousY2)
        ? project(flash.previousX2, flash.previousY2)
        : null;
      const baseWidth = Math.max(2, Math.round(flash.width / camera.scale));
      const hot = flash.age < 0.055;
      if (previous) {
        shapes.triangle(from, previous, to, hot ? COLOR.cyan : COLOR.dimMint);
        shapes.line(previous.x, previous.y, to.x, to.y, 1, hot ? COLOR.mint : COLOR.cyan);
      }
      shapes.line(from.x, from.y, to.x, to.y, baseWidth + 2, hot ? COLOR.mint : COLOR.cyan);
      shapes.line(from.x, from.y, to.x, to.y, Math.max(2, baseWidth - 5), hot ? COLOR.amber : COLOR.mint);
      shapes.rect(from.x - 2, from.y - 2, 5, 5, hot ? COLOR.amber : COLOR.mint);
      shapes.rect(to.x - 1, to.y - 1, 3, 3, hot ? COLOR.mint : COLOR.cyan);
    } else if (flash.kind === 'laser') {
      if (flash.age >= 0.16) continue;
      const from = project(flash.x1, flash.y1);
      const to = project(flash.x2, flash.y2);
      const baseWidth = Math.max(1, Math.round(flash.width / camera.scale));
      const hot = flash.age < 0.065;
      if (flash.formId === 'prism') {
        shapes.line(from.x, from.y, to.x, to.y, baseWidth + 1, hot ? COLOR.cyan : COLOR.mint);
        shapes.line(from.x, from.y, to.x, to.y, Math.max(2, baseWidth - 5), hot ? COLOR.amber : COLOR.cyan);
      } else {
        shapes.line(from.x, from.y, to.x, to.y, baseWidth + (hot ? 6 : 3), hot ? COLOR.cyan : COLOR.dimMint);
        shapes.line(from.x, from.y, to.x, to.y, baseWidth + 1, hot ? COLOR.mint : COLOR.cyan);
        shapes.line(from.x, from.y, to.x, to.y, Math.max(2, baseWidth - 4), hot ? COLOR.amber : COLOR.mint);
      }
      shapes.rect(from.x - 3, from.y - 3, 7, 7, COLOR.amber);
      shapes.rect(to.x - 2, to.y - 2, 5, 5, hot ? COLOR.mint : COLOR.cyan);
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
      bitmapText.draw(`+${flash.credits}`, center.x + 7, center.y - 10 - Math.round(phase * 5), COLOR.amber, 1);
    }
    attackFlashes[write++] = flash;
  }
  attackFlashes.length = write;
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
    const knotFamily = ['knot', 'singularity', 'orbit', 'braid'].includes(burst.sourceFormId);
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

function drawWorldRing(x, y, radius, color) {
  const center = project(x, y);
  let pixelX = Math.max(1, Math.round(radius / camera.scale));
  let pixelY = 0;
  let error = 1 - pixelX;
  while (pixelX >= pixelY) {
    shapes.rect(center.x + pixelX, center.y + pixelY, 1, 1, color);
    shapes.rect(center.x + pixelY, center.y + pixelX, 1, 1, color);
    shapes.rect(center.x - pixelY, center.y + pixelX, 1, 1, color);
    shapes.rect(center.x - pixelX, center.y + pixelY, 1, 1, color);
    shapes.rect(center.x - pixelX, center.y - pixelY, 1, 1, color);
    shapes.rect(center.x - pixelY, center.y - pixelX, 1, 1, color);
    shapes.rect(center.x + pixelY, center.y - pixelX, 1, 1, color);
    shapes.rect(center.x + pixelX, center.y - pixelY, 1, 1, color);
    pixelY += 1;
    if (error < 0) error += pixelY * 2 + 1;
    else {
      pixelX -= 1;
      error += (pixelY - pixelX) * 2 + 1;
    }
  }
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
    const color = hovered ? COLOR.mint : selected ? COLOR.amber : COLOR.green;
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
  const definition = snapshot.towerCatalog.find((candidate) => candidate.id === tower.definitionId);
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
  const control = definition?.control;
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
  const definition = snapshot.towerCatalog.find((candidate) => candidate.id === tower.definitionId);
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
  const valid = distance <= range && (control.input !== 'direction' || distance > 0.001);
  const geometry = control.input === 'point'
    ? { kind: 'point', x: world.x, y: world.y }
    : { kind: 'direction', dx, dy };
  drawControlGeometryShape(tower, definition, geometry, valid ? COLOR.mint : COLOR.red);
}

function drawBuildState(snapshot) {
  const selected = snapshot.towers.find((tower) => tower.id === selectedTowerId);
  if (showAllRanges) {
    for (const tower of snapshot.towers) {
      const definition = snapshot.towerCatalog.find((candidate) => candidate.id === tower.definitionId);
      const range = tower.effectiveRange || definition?.range;
      if (range) drawWorldRing(tower.x, tower.y, range, COLOR.dimMint);
    }
  }
  if (selected) {
    const p = project(selected.x, selected.y);
    const selectedDefinition = snapshot.towerCatalog.find((candidate) => candidate.id === selected.definitionId);
    const selectedRange = selected.effectiveRange || selectedDefinition?.range;
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
    shapes.rect(p.x - 7, p.y - 7, 4, 1, COLOR.amber);
    shapes.rect(p.x + 4, p.y - 7, 4, 1, COLOR.amber);
    shapes.rect(p.x - 7, p.y + 7, 4, 1, COLOR.amber);
    shapes.rect(p.x + 4, p.y + 7, 4, 1, COLOR.amber);
  }
  if (sessionMode === 'test') {
    for (const tower of snapshot.towers) {
      const p = project(tower.x, tower.y);
      registerHitbox(`tower_drag_${tower.id}`, p.x - 7, p.y - 7, 15, 15, {
        drag: { kind: 'tower', towerId: tower.id }
      });
    }
  }
  if (selected && towerMenuMode && (sessionMode === 'game' || ['relay', 'strike', 'control'].includes(towerMenuMode))) drawTowerMenu(snapshot, selected);
  if (!placementArmed || pointer.y <= HUD_TOP_HEIGHT || pointer.y >= hudBottomY) return;
  const placementDefinitionId = bulkPlacementDefinitionId || TOWER_DEFINITION_ID;
  const placementDefinition = snapshot.towerCatalog.find((candidate) => candidate.id === placementDefinitionId);
  const quote = towerBuildQuote(snapshot.towerCatalog, placementDefinitionId);
  const world = unproject(pointer.x, pointer.y);
  const economy = snapshot.economyByPlayer[session.playerId];
  const canPlace = Boolean(findDefenseAreaAt(currentMap, world.x, world.y)) && (economy?.credits || 0) >= (quote?.cost ?? Infinity);
  if (placementDefinition) drawWorldRing(world.x, world.y, placementDefinition.range, canPlace ? COLOR.dimMint : COLOR.red);
  drawTower(
    { ...world, definitionId: placementDefinitionId },
    { accent: canPlace ? COLOR.green : COLOR.red, core: canPlace ? COLOR.cyan : COLOR.red }
  );
}

function drawTestFieldWorld(snapshot) {
  if (sessionMode !== 'test') return;
  const active = new Set(snapshot.test.activeSpawnSourceIds || []);
  const overrides = snapshot.test.spawnSourceOverrides || {};
  for (const source of currentMap.spawnSources) {
    const position = overrides[source.id] || source;
    const p = project(position.x, position.y);
    const enabled = active.has(source.id);
    shapes.rect(p.x - 5, p.y - 5, 11, 11, COLOR.black);
    shapes.rect(p.x - 4, p.y - 4, 9, 1, enabled ? COLOR.red : COLOR.dimMint);
    shapes.rect(p.x - 4, p.y + 4, 9, 1, enabled ? COLOR.red : COLOR.dimMint);
    shapes.rect(p.x - 4, p.y - 3, 1, 7, enabled ? COLOR.red : COLOR.dimMint);
    shapes.rect(p.x + 4, p.y - 3, 1, 7, enabled ? COLOR.red : COLOR.dimMint);
    shapes.rect(p.x - 1, p.y - 1, 3, 3, enabled ? COLOR.amber : COLOR.ink);
    bitmapText.draw(source.id.replace('test_', ''), p.x + 8, p.y - 3, enabled ? COLOR.red : COLOR.dimMint, 1);
    registerHitbox(`spawn_${source.id}`, p.x - 7, p.y - 7, 15, 15, {
      drag: { kind: 'spawn-point', sourceId: source.id }
    });
  }
}

function drawButton(id, label, x, y, width, active, color, action) {
  shapes.rect(x, y, width, 13, COLOR.black);
  shapes.rect(x, y, width, 1, active ? color : COLOR.dimMint);
  shapes.rect(x, y + 12, width, 1, active ? color : COLOR.dimMint);
  if (active) shapes.rect(x, y + 1, 2, 11, color);
  bitmapText.draw(label, x + 4, y + 3, active ? color : COLOR.ink, 1);
  registerHitbox(id, x, y, width, 13, { action });
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
  if (['knot', 'singularity', 'orbit', 'braid'].includes(definitionId)) return COLOR.green;
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
  shapes.rect(x + 3, y, Math.min(34, width - 6), 1, accent);
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
  const economy = snapshot.economyByPlayer[session.playerId] || { credits: 0 };
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
      const affordable = sessionMode === 'test' || economy.credits >= quote.cost;
      const pricedLabel = `${entry.key} ${definition.label} ${quote.cost}`;
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
      ? 'loads selected test tower // tab changes page'
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

function drawCoopRoster(snapshot, x, y, width) {
  const players = (snapshot.players || []).filter((player) => player.connected || !player.eliminated);
  for (let index = 0; index < Math.min(4, players.length); index += 1) {
    const player = players[index];
    const role = player.id === snapshot.hostPlayerId ? 'host' : player.spectator ? 'spectator' : 'peer';
    const state = player.connected ? 'linked' : 'reconnect';
    const local = player.id === session.playerId ? ' // you' : '';
    const label = `${index + 1} ${player.label} // ${role} // ${state}${local}`;
    bitmapText.draw(clippedUiText(label, width), x, y + index * 10, player.connected ? COLOR.ink : COLOR.red, 1);
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
  const wide = logicalWidth >= 500 && logicalHeight >= 202;
  const width = Math.min(wide ? 570 : 300, logicalWidth - 12);
  const height = Math.min(wide ? 190 : 176, logicalHeight - 12);
  const x = Math.round((logicalWidth - width) * 0.5);
  const y = Math.round((logicalHeight - height) * 0.5);
  drawTechPanel(x, y, width, height, COLOR.amber);
  bitmapText.draw('select survival field', x + 16, y + 9, COLOR.amber, 2);
  const runIsLive = gameHasEnteredGameplay && snapshot.phase === 'running';
  const warning = runIsLive
    ? 'live run keeps moving // deployment wipes it'
    : snapshot.phase === 'running' ? 'saved run held // deployment wipes it' : 'one ruleset // three different flows';
  bitmapText.draw(warning, x + 16, y + 27, snapshot.phase === 'running' ? COLOR.red : COLOR.dimMint, 1);

  if (wide) {
    const gap = 6;
    const cardWidth = Math.floor((width - 32 - gap * 2) / 3);
    maps.forEach((map, index) => drawMapCard(map, index, x + 16 + index * (cardWidth + gap), y + 39, cardWidth, 104));
  } else {
    maps.forEach((map, index) => {
      const selected = map.id === selectedRunMapId;
      const label = `${index + 1} ${map.label} // ${map.defenseAreas.length}`;
      drawMenuButton(`map_${map.id}`, label, x + 16, y + 39 + index * 21, width - 32, selected ? COLOR.mint : COLOR.cyan, () => selectRunMap(map.id), selected);
    });
    const selected = maps.find((map) => map.id === selectedRunMapId) || maps[0];
    bitmapText.draw(selected?.menuLines[0] || '', x + 18, y + 105, COLOR.mint, 1);
    bitmapText.draw(selected?.menuLines[1] || '', x + 18, y + 117, COLOR.dimMint, 1);
  }

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
  bitmapText.draw('1/2/3 select // enter deploys', x + 17, y + height - 16, COLOR.ink, 1);
}

function resetTestFieldFromMenu() {
  session.send(COMMAND.TEST_CLEAR, { resetCounters: true });
  menuConfirm = null;
  frontEndScreen = 'game';
  setStatus('test field reset');
}

function drawEscapeMenu(snapshot) {
  const width = Math.min(264, logicalWidth - 20);
  const networkActive = Boolean(session.networkRole);
  const height = Math.min(networkActive ? 179 : 158, logicalHeight - 16);
  const x = Math.round((logicalWidth - width) * 0.5);
  const y = Math.round((logicalHeight - height) * 0.5);
  drawTechPanel(x, y, width, height, COLOR.cyan);
  shapes.rect(x + 8, y + 8, 2, 22, COLOR.cyan);
  shapes.rect(x + width - 10, y + 8, 2, 22, COLOR.red);
  const buttonX = x + 17;
  const buttonWidth = width - 34;

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

  bitmapText.draw('command interrupt', x + 18, y + 10, COLOR.cyan, 2);
  bitmapText.draw('simulation is not paused', x + 18, y + 31, COLOR.red, 1);
  const seconds = Math.floor(snapshot.runTick / AUTHORITY_TICK_RATE);
  const runLabel = networkActive ? `coop ${multiplayerState.roomCode?.toLowerCase() || 'link'}` : sessionMode;
  bitmapText.draw(`${runLabel} // ${seconds}s // ${snapshot.swarm.activeEnemies} hostiles`, x + 18, y + 43, COLOR.ink, 1);
  drawMenuButton('escape_resume', 'resume // esc', buttonX, y + 58, buttonWidth, COLOR.mint, resumeSession, true);
  if (networkActive) {
    const canContinue = snapshot.phase === 'reconnect_wait' && snapshot.hostPlayerId === session.playerId;
    drawMenuButton(
      'escape_coop_status',
      canContinue ? 'continue without pilot' : `coop status // ${multiplayerState.roomCode?.toLowerCase() || 'linked'}`,
      buttonX,
      y + 79,
      buttonWidth,
      canContinue ? COLOR.amber : COLOR.green,
      canContinue
        ? () => session.send(COMMAND.SESSION_CONTINUE_WITHOUT_PLAYER)
        : () => { frontEndScreen = 'coop'; },
      canContinue
    );
  } else if (sessionMode === 'game') {
    drawMenuButton('escape_restart', 'new run // choose map', buttonX, y + 79, buttonWidth, COLOR.amber, () => openMapSelection('escape'));
  } else {
    drawMenuButton('escape_test_reset', 'clear test field', buttonX, y + 79, buttonWidth, COLOR.amber, resetTestFieldFromMenu);
  }
  drawMenuButton('escape_options', 'gameplay options', buttonX, y + 100, buttonWidth, COLOR.cyan, openEscapeOptions);
  drawMenuButton('escape_main', 'main menu', buttonX, y + 121, buttonWidth, COLOR.cyan, returnToMainMenu);
  if (networkActive) {
    drawMenuButton('escape_leave_coop', 'leave coop', buttonX, y + 142, buttonWidth, COLOR.red, () => cancelMultiplayer(true));
    bitmapText.draw('leave // reconnect or split holdings', x + 18, y + 165, COLOR.dimMint, 1);
  } else {
    bitmapText.draw('no pause means no cheese. sorry.', x + 18, y + 143, COLOR.dimMint, 1);
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
  if (definition?.id !== 'relay' || linkRange <= 0) return [];
  return currentMap.defenseAreas.filter((area) => (
    area.id !== tower.areaId && defenseAreaField(area, tower.x, tower.y, linkRange) <= 0
  ));
}

function openRelayTargetMenu(snapshot, tower) {
  if (tower?.definitionId !== 'relay') return;
  towerMenuMode = 'relay';
  const count = relayCandidateAreas(snapshot, tower).length;
  setStatus(count ? 'click a highlighted nebula' : 'no nebulas inside link range');
}

function openStrikeTargetMenu(snapshot, tower) {
  const definition = snapshot.towerCatalog.find((candidate) => candidate.id === tower?.definitionId);
  if (!tower || !supportsStrikePoint(definition?.attack)) {
    setStatus('only rocket towers can set aim');
    return;
  }
  towerMenuMode = 'strike';
  setStatus('click a strike point inside range');
}

function clearSelectedStrikePoint() {
  const tower = sessionSnapshot.towers.find((candidate) => candidate.id === selectedTowerId);
  const definition = sessionSnapshot.towerCatalog.find((candidate) => candidate.id === tower?.definitionId);
  if (!tower || !supportsStrikePoint(definition?.attack)) {
    setStatus('tower has no strike point');
    return;
  }
  session.send(COMMAND.TOWER_STRIKE_POINT_SET, { towerId: tower.id, x: null, y: null });
  setStatus('automatic impact command sent');
}

function openControlGeometryMenu(snapshot, tower) {
  const definition = snapshot.towerCatalog.find((candidate) => candidate.id === tower?.definitionId);
  const input = definition?.control?.input;
  if (!tower || !input || input === 'none') {
    setStatus('tower has no editable control');
    return;
  }
  towerMenuMode = 'control';
  setStatus(input === 'line' ? 'click-drag inside range' : input === 'point' ? 'click to place the field' : 'click to choose direction');
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

function compactMetric(value) {
  const amount = Math.max(0, Math.floor(value || 0));
  if (amount >= 1000000) return `${Math.floor(amount / 100000) / 10}m`;
  if (amount >= 1000) return `${Math.floor(amount / 100) / 10}k`;
  return String(amount);
}

function drawTowerActionMenu(snapshot, tower) {
  const definition = snapshot.towerCatalog.find((candidate) => candidate.id === tower.definitionId);
  if (!definition) return;
  const canAim = supportsStrikePoint(definition.attack);
  const canControl = Boolean(definition.control?.input && definition.control.input !== 'none');
  const hasManualControl = canAim || canControl;
  const width = 150;
  const height = hasManualControl ? 65 : 49;
  const panel = towerPanelPosition(tower, width, height);
  const accent = towerAccent(tower.definitionId);
  drawTechPanel(panel.x, panel.y, width, height, accent);
  bitmapText.draw(`${definition.label} // ${tower.totalInvestment} cr`, panel.x + 7, panel.y + 5, accent, 1);
  const supportLabel = tower.bonusCredits > 0 ? ` +${compactMetric(tower.bonusCredits)} cr` : '';
  const isPureControl = Boolean(definition.control && !definition.attack);
  const controlLabels = {
    stasis_zone: 'held',
    recall_gate: 'recalled',
    slow_zone: 'slowed',
    singularity: 'shaped',
    vortex: 'shaped',
    braid: 'shaped',
    breaker_wave: 'pushed',
    crosswind: 'pushed',
    force_wall: 'pushed'
  };
  const controlValue = ['stasis_zone', 'recall_gate'].includes(definition.control?.type)
    ? tower.controlStats?.affectedUnits || 0
    : Math.floor((tower.controlStats?.affectedUnitTicks || 0) / AUTHORITY_TICK_RATE);
  const metricLabel = isPureControl
    ? `${controlLabels[definition.control.type] || 'affected'} // ${compactMetric(controlValue)}${['stasis_zone', 'recall_gate'].includes(definition.control.type) ? '' : ' unit-s'}`
    : `kills // ${String(tower.kills || 0).padStart(6, '0')}${supportLabel}`;
  const recentlyActive = isPureControl
    ? tower.controlStats?.lastActiveTick > 0 && snapshot.runTick - tower.controlStats.lastActiveTick <= AUTHORITY_TICK_RATE * 0.45
    : tower.lastKillTick > 0 && snapshot.runTick - tower.lastKillTick <= AUTHORITY_TICK_RATE * 0.45;
  bitmapText.draw(metricLabel, panel.x + 7, panel.y + 16, recentlyActive ? COLOR.mint : COLOR.ink, 1);
  shapes.rect(panel.x + width - 16, panel.y + 17, 8, 1, recentlyActive ? COLOR.amber : COLOR.dimMint);
  if (recentlyActive) {
    shapes.rect(panel.x + width - 13, panel.y + 15, 2, 5, COLOR.amber);
    shapes.rect(panel.x + width - 9, panel.y + 16, 1, 3, COLOR.mint);
  }
  if (session.networkRole && tower.ownerId !== session.playerId) {
    const owner = snapshot.players.find((player) => player.id === tower.ownerId);
    bitmapText.draw(clippedUiText(`owner ${owner?.label || 'pilot'}`, width - 14), panel.x + 7, panel.y + 31, COLOR.cyan, 1);
    bitmapText.draw('inspect only', panel.x + 7, panel.y + 40, COLOR.dimMint, 1);
    return;
  }
  const refund = Math.floor(tower.totalInvestment * 0.5);
  const hasChoices = definition.evolutionChoices?.length > 0;
  const isRelay = definition.id === 'relay';
  drawButton(
    `tower_upgrade_${tower.id}`,
    isRelay ? (tower.relayTargetAreaId ? '1 relink' : '1 link') : hasChoices ? '1 upgrade' : '1 upgrade ?',
    panel.x + 5,
    panel.y + 31,
    65,
    hasChoices || isRelay,
    COLOR.mint,
    () => isRelay ? openRelayTargetMenu(snapshot, tower) : openUpgradeMenu(snapshot, tower)
  );
  drawButton(
    `tower_sell_${tower.id}`,
    `2 sell ${refund}`,
    panel.x + 75,
    panel.y + 31,
    70,
    true,
    COLOR.red,
    sellSelectedTower
  );
  if (hasManualControl) {
    drawButton(
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
    drawButton(
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
  const economy = snapshot.economyByPlayer[session.playerId];
  const cost = definition.evolutionCost || 0;
  const affordable = (economy?.credits || 0) >= cost;
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
  bitmapText.draw(`${cost} cr`, x + 5, y + 30, affordable ? COLOR.amber : COLOR.red, 1);
  shapes.rect(x + 5, y + 40, width - 10, 1, COLOR.dimMint);
  const maximumCharacters = Math.max(6, Math.floor((width - 10) / 6));
  const lines = wrappedDescription(definition.description, maximumCharacters, 4);
  for (let index = 0; index < lines.length; index += 1) {
    bitmapText.draw(lines[index], x + 5, y + 46 + index * 10, COLOR.ink, 1);
  }
  registerHitbox(`upgrade_choice_${tower.id}_${definition.id}`, x, y, width, height, {
    action: () => {
      if (!affordable) {
        setStatus(`need ${cost} credits`);
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
  const cost = choices[0]?.evolutionCost || 0;
  bitmapText.draw(`upgrade // 1 2 3 choose // ${cost} cr`, panel.x + 7, panel.y + 5, COLOR.mint, 1);
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
  bitmapText.draw('rocket aim // click strike point', panel.x + 7, panel.y + 6, COLOR.cyan, 1);
  bitmapText.draw(`${tower.effectiveRange || definition?.range || 0}u // exact authority airburst`, panel.x + 7, panel.y + 18, COLOR.ink, 1);
  drawButton(`strike_auto_${tower.id}`, '0 auto', panel.x + width - 82, panel.y + 27, 40, Boolean(tower.strikePoint), COLOR.amber, clearSelectedStrikePoint);
  drawButton(`strike_back_${tower.id}`, '2 back', panel.x + width - 39, panel.y + 27, 34, false, COLOR.cyan, () => {
    towerMenuMode = sessionMode === 'game' ? 'actions' : null;
  });
}

function drawControlGeometryMenu(snapshot, tower) {
  const definition = snapshot.towerCatalog.find((candidate) => candidate.id === tower.definitionId);
  const width = 216;
  const height = 43;
  const panel = towerPanelPosition(tower, width, height);
  drawTechPanel(panel.x, panel.y, width, height, COLOR.cyan);
  const input = definition?.control?.input || 'point';
  const verb = input === 'line' ? 'drag line' : input === 'direction' ? 'choose direction' : 'place field';
  const rebootTicks = Math.max(0, (tower.controlReadyTick || 0) - snapshot.runTick);
  bitmapText.draw(`${definition?.label || 'control'} // ${verb}`, panel.x + 7, panel.y + 6, COLOR.cyan, 1);
  bitmapText.draw(rebootTicks > 0 ? `reboot // ${(rebootTicks / AUTHORITY_TICK_RATE).toFixed(1)}s` : `${tower.effectiveRange || definition?.range || 0}u // authority locked`, panel.x + 7, panel.y + 18, rebootTicks > 0 ? COLOR.amber : COLOR.ink, 1);
  drawButton(`control_reset_${tower.id}`, '0 reset', panel.x + width - 88, panel.y + 27, 46, true, COLOR.amber, resetSelectedControlGeometry);
  drawButton(`control_back_${tower.id}`, '2 back', panel.x + width - 39, panel.y + 27, 34, false, COLOR.cyan, () => {
    towerMenuMode = sessionMode === 'game' ? 'actions' : null;
  });
}

function drawTowerMenu(snapshot, tower) {
  if (towerMenuMode === 'upgrades') drawTowerUpgradeMenu(snapshot, tower);
  else if (towerMenuMode === 'relay') drawRelayTargetMenu(snapshot, tower);
  else if (towerMenuMode === 'strike') drawStrikeTargetMenu(snapshot, tower);
  else if (towerMenuMode === 'control') drawControlGeometryMenu(snapshot, tower);
  else drawTowerActionMenu(snapshot, tower);
}

function killTelemetry(mode, snapshot) {
  const economy = snapshot.economyByPlayer[session.playerId] || { totalEarned: 0 };
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
  const economy = snapshot.economyByPlayer[session.playerId] || { credits: snapshot.prototypeBalance.startingCredits };
  shapes.rect(0, 0, logicalWidth, HUD_TOP_HEIGHT, COLOR.black);
  shapes.rect(0, HUD_TOP_HEIGHT - 1, logicalWidth, 1, COLOR.dimMint);
  shapes.rect(0, HUD_TOP_HEIGHT - 1, Math.min(132, logicalWidth), 1, sessionMode === 'test' ? COLOR.amber : COLOR.mint);
  shapes.rect(4, 4, 2, 14, sessionMode === 'test' ? COLOR.amber : COLOR.mint);
  shapes.rect(logicalWidth - 6, 4, 2, 14, COLOR.red);
  bitmapText.draw('framebound', 11, 5, COLOR.mint, 1);
  bitmapText.draw(sessionMode === 'test' ? '//test' : '//horde', 75, 5, sessionMode === 'test' ? COLOR.amber : COLOR.red, 1);
  bitmapText.draw(`lives ${String(snapshot.base.lives).padStart(3, '0')}`, 130, 5, COLOR.ink, 1);
  bitmapText.draw(`credits ${String(economy.credits).padStart(5, '0')}`, 208, 5, COLOR.amber, 1);
  bitmapText.draw(`horde ${snapshot.swarm.activeEnemies}`, 322, 5, COLOR.red, 1);
  const fpsX = logicalWidth - 54;
  const timerLabel = `time ${formatRunTimer(snapshot.runTick)}`;
  const timerX = fpsX - timerLabel.length * 6 - 12;
  const spawnLabel = logicalWidth >= 720
    ? `spawn ${Math.round(snapshot.swarm.spawnRatePerSecond)}/s x${snapshot.swarm.activeSpawnPoints}`
    : `spawn ${Math.round(snapshot.swarm.spawnRatePerSecond)}/s`;
  if (416 + spawnLabel.length * 6 < timerX - 6) bitmapText.draw(spawnLabel, 416, 5, COLOR.ink, 1);
  let telemetryX = 532;
  const goldLabel = `gold ${telemetry.goldPerSecond.toFixed(1)}/s`;
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
  const kpsLabel = `kps ${telemetry.oneSecond.toFixed(0)}`;
  if (showKps && telemetryX + kpsLabel.length * 6 < timerX - 6) bitmapText.draw(kpsLabel, telemetryX, 5, COLOR.mint, 1);
  bitmapText.draw(timerLabel, timerX, 5, COLOR.amber, 1);
  bitmapText.draw(`fps ${String(fps).padStart(3, '0')}`, fpsX, 5, COLOR.cyan, 1);
}

function drawGameHud(snapshot, telemetry) {
  const y = hudBottomY;
  const selectedTower = snapshot.towers.find((tower) => tower.id === selectedTowerId);
  const selectedDefinition = snapshot.towerCatalog.find((definition) => definition.id === selectedTower?.definitionId);
  const selectedControlInput = selectedDefinition?.control?.input;
  shapes.rect(0, y, logicalWidth, logicalHeight - y, COLOR.black);
  shapes.rect(0, y, logicalWidth, 1, COLOR.dimMint);
  shapes.rect(0, y, Math.min(184, logicalWidth), 1, COLOR.cyan);
  const row = y + 3;
  let x = 8;
  const bulkDefinition = snapshot.towerCatalog.find((definition) => definition.id === bulkPlacementDefinitionId);
  const placeLabel = bulkDefinition ? `x ${bulkDefinition.label}` : placementArmed ? '1 placing one' : '1 frame 100';
  drawButton('place_frame', placeLabel, x, row, 80, placementArmed, COLOR.mint, () => {
    if (placementArmed) {
      placementArmed = false;
      bulkPlacementDefinitionId = null;
      setStatus('placement cancelled');
    } else armFramePlacement();
  });
  x += 84;
  const selectorLabel = selectedDefinition?.control
    ? selectedControlInput === 'none' ? 'passive' : 'a control'
    : 'q/e target';
  const selectorEnabled = Boolean(selectedTower && (selectedDefinition?.targetingModes?.length || selectedControlInput !== 'none'));
  drawButton('target', selectorLabel, x, row, 68, selectorEnabled, COLOR.cyan, () => {
    if (selectedControlInput && selectedControlInput !== 'none') openControlGeometryMenu(snapshot, selectedTower);
    else cycleSelectedTargeting(1);
  }); x += 72;
  drawButton('build_catalog', buildCatalogOpen ? 'b close' : bulkDefinition ? 'b switch' : 'b towers', x, row, 55, buildCatalogOpen || Boolean(bulkDefinition), COLOR.amber, buildCatalogOpen ? closeBuildCatalog : openBuildCatalog); x += 59;
  if (selectedTower) bitmapText.draw('click tower for actions', x + 4, row + 3, COLOR.ink, 1);

  drawButton('toggle_kps', showKps ? 'k kps on' : 'k kps off', logicalWidth - 178, row, 58, showKps, COLOR.mint, () => { showKps = !showKps; });
  drawButton('toggle_ranges', showAllRanges ? 'g ranges' : 'g range', logicalWidth - 116, row, 56, showAllRanges, COLOR.cyan, () => { showAllRanges = !showAllRanges; });
  drawButton('toggle_test', session.networkRole ? 'esc menu' : 't test', logicalWidth - 56, row, 48, false, COLOR.amber, session.networkRole ? openEscapeMenu : enterTestField);

  const statusY = y + 19;
  const targetLabel = selectedTower?.targetingMode?.replaceAll('_', ' ') || 'closest';
  const elapsedSeconds = snapshot.runTick / AUTHORITY_TICK_RATE;
  const nextRift = currentMap.spawnSources.find((source) => source.unlockSeconds > elapsedSeconds);
  const riftStatus = nextRift
    ? `next rift ${Math.ceil(nextRift.unlockSeconds - elapsedSeconds)}s`
    : `${snapshot.swarm.activeSpawnPoints} rifts live`;
  const rebootTicks = Math.max(0, (selectedTower?.controlReadyTick || 0) - snapshot.runTick);
  const passive = selectedTower
    ? selectedDefinition?.control
      ? `${selectedTower.definitionId} // control ${rebootTicks > 0 ? `reboot ${(rebootTicks / AUTHORITY_TICK_RATE).toFixed(1)}s` : 'online'} // affected ${compactMetric(Math.floor((selectedTower.controlStats?.affectedUnitTicks || 0) / AUTHORITY_TICK_RATE))} unit-s // invested ${selectedTower.totalInvestment}`
      : `${selectedTower.definitionId} // kills ${selectedTower.kills || 0} // target ${targetLabel} // invested ${selectedTower.totalInvestment}`
    : bulkDefinition
      ? `${bulkDefinition.label} repeat // right click ends // b switches tower`
      : `1 one frame // b tower catalog // ${riftStatus} // drag pan // wheel zoom`;
  bitmapText.draw(performance.now() < statusUntil ? statusMessage : passive, 10, statusY, COLOR.amber, 1);
  const stats = `kills ${snapshot.stats.kills} // gold ${telemetry.goldPerSecond.toFixed(1)}/s // shots ${snapshot.stats.shotsResolved}/${snapshot.stats.shotsFired}`;
  bitmapText.draw(stats, Math.max(10, logicalWidth - stats.length * 6 - 10), statusY, COLOR.mint, 1);
  if (showKps && logicalWidth >= 900) {
    const kps = `1s ${telemetry.oneSecond.toFixed(0)} 10s ${telemetry.tenSecond.toFixed(0)} peak ${telemetry.peak.toFixed(0)}`;
    bitmapText.draw(kps, Math.max(10, logicalWidth * 0.5 - kps.length * 3), statusY, COLOR.dimMint, 1);
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
    bitmapText.draw(`alive ${snapshot.swarm.activeEnemies} records ${snapshot.swarm.simulationRecords}/${snapshot.swarm.recordBudget} killed ${snapshot.stats.kills}`, 246, statsRow, COLOR.ink, 1);
    bitmapText.draw(`gold ${telemetry.goldPerSecond.toFixed(1)}/s shots ${snapshot.stats.shotsResolved}/${snapshot.stats.shotsFired} fx ${snapshot.stats.controlApplications} bonus ${snapshot.stats.bonusCredits || 0} time ${seconds.toFixed(1)}s`, Math.max(8, logicalWidth - 338), statsRow, COLOR.cyan, 1);
  } else {
    bitmapText.draw(`alive ${snapshot.swarm.activeEnemies} rec ${snapshot.swarm.simulationRecords} kill ${snapshot.stats.kills} gold ${telemetry.goldPerSecond.toFixed(1)}/s t${seconds.toFixed(0)}s`, 270, statsRow, COLOR.ink, 1);
  }
  const selectedStats = selected
    ? `${selected.definitionId} // ${Number(selected.effectiveCadence || 0).toFixed(1)}/s r${Math.round(selected.effectiveRange || 0)} // kills ${selected.kills || 0}${selected.bonusCredits ? ` +${selected.bonusCredits}cr` : ''} // drag towers and spawns`
    : 'drag spawn markers // drag towers // production enemies stay 1 hp';
  bitmapText.draw(performance.now() < statusUntil ? statusMessage : selectedStats, 8, y + 77, COLOR.amber, 1);
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
    const panelX = Math.round(logicalWidth * 0.5 - 71);
    const panelY = Math.round(logicalHeight * 0.5 - 24);
    shapes.rect(panelX, panelY, 142, 47, COLOR.black);
    shapes.rect(panelX, panelY, 142, 2, COLOR.red);
    shapes.rect(panelX, panelY + 45, 142, 2, COLOR.red);
    bitmapText.draw('base lost', panelX + 25, panelY + 9, COLOR.red, 2);
    bitmapText.draw(session.networkRole ? 'coop run ended' : 'r restart same seed', panelX + 16, panelY + 34, COLOR.ink, 1);
  } else if (snapshot.phase === 'reconnect_wait' && snapshot.disconnectWait) {
    const panelWidth = Math.min(236, logicalWidth - 16);
    const panelHeight = 70;
    const panelX = Math.round((logicalWidth - panelWidth) * 0.5);
    const panelY = Math.round((logicalHeight - panelHeight) * 0.5);
    const seconds = Math.max(0, Math.ceil((snapshot.disconnectWait.deadlineTick - snapshot.tick) / AUTHORITY_TICK_RATE));
    const departed = snapshot.players.find((player) => player.id === snapshot.disconnectWait.playerId);
    const canContinue = session.networkRole === 'host' && snapshot.hostPlayerId === session.playerId;
    drawTechPanel(panelX, panelY, panelWidth, panelHeight, COLOR.amber);
    bitmapText.draw('pilot link lost', panelX + 14, panelY + 9, COLOR.amber, 2);
    bitmapText.draw(`${departed?.label || 'pilot'} // ${seconds}s remaining`, panelX + 14, panelY + 31, COLOR.ink, 1);
    if (canContinue) {
      drawMenuButton(
        'reconnect_continue',
        'continue // split holdings',
        panelX + 14,
        panelY + 45,
        panelWidth - 28,
        COLOR.red,
        () => session.send(COMMAND.SESSION_CONTINUE_WITHOUT_PLAYER)
      );
    } else {
      bitmapText.draw('host decides // simulation held', panelX + 14, panelY + 49, COLOR.dimMint, 1);
    }
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
    logicalResolution: `${logicalWidth}x${logicalHeight}`,
    cssIntegerScale: displayPixelScale,
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
  canvas.dataset.credits = String(snapshot.economyByPlayer[session.playerId]?.credits ?? snapshot.prototypeBalance.startingCredits);
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
    if (event.type === EVENT.TOWER_PLACED && event.payload.tower.ownerId === session.playerId) {
      const keepBulkPlacement = sessionMode === 'game'
        && bulkPlacementDefinitionId === event.payload.tower.definitionId;
      placementArmed = keepBulkPlacement;
      const autoSelect = !keepBulkPlacement && (sessionMode === 'test' || gameplayPreferences.autoSelectPlacedFrame);
      selectedTowerId = autoSelect ? event.payload.tower.id : null;
      towerMenuMode = autoSelect && sessionMode === 'game' ? 'actions' : null;
      setStatus(keepBulkPlacement
        ? `${event.payload.tower.definitionId} placed // click next // right click ends`
        : autoSelect ? 'frame selected // 1 upgrade // 2 sell' : 'frame placed // press 1 for another');
    } else if (event.type === EVENT.TOWER_EVOLVED && event.payload.tower.ownerId === session.playerId) {
      selectedTowerId = event.payload.tower.id;
      const evolved = sessionSnapshot.towerCatalog.find((definition) => definition.id === event.payload.tower.definitionId);
      towerMenuMode = sessionMode === 'test'
        ? evolved?.id === 'relay' ? 'relay' : evolved?.control?.input !== 'none' && evolved?.control?.input ? 'control' : null
        : evolved?.evolutionChoices?.length
          ? 'upgrades'
          : evolved?.id === 'relay'
            ? 'relay'
            : evolved?.control?.input !== 'none' && evolved?.control?.input
              ? 'control'
              : 'actions';
      setStatus(`${event.payload.tower.definitionId} online`);
    } else if (event.type === EVENT.TOWER_SOLD && event.payload.ownerId === session.playerId) {
      selectedTowerId = null;
      towerMenuMode = null;
      setStatus(`sold // refund ${event.payload.refund}`);
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
    } else if (event.type === EVENT.TOWER_RELAY_TARGET_CHANGED && event.payload.towerId === selectedTowerId) {
      towerMenuMode = 'actions';
      setStatus(`relay linked // ${event.payload.targetAreaId}`);
    } else if (event.type === EVENT.SESSION_RESTARTED) {
      adoptActiveMap(event.payload.mapId);
      projectilePresentation.clear();
      impactBursts.length = 0;
      attackFlashes.length = 0;
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
    } else if (event.type === EVENT.PLAYER_RECONNECT_WAIT_STARTED) {
      setStatus('pilot disconnected // run held for reconnect');
    } else if (event.type === EVENT.PLAYER_RECONNECTED) {
      setStatus(`${event.payload.player.label} reconnected`);
    } else if (event.type === EVENT.BALANCED_INHERITANCE_COMPLETED) {
      setStatus('departed pilot holdings redistributed');
    } else if (event.type === EVENT.ATTACK_RESOLVED) {
      if (!['main', 'map_select', 'coop'].includes(frontEndScreen)) addAttackFlash(event);
    } else if (event.type === EVENT.KILLS_RECORDED) {
      if (!['main', 'map_select', 'coop'].includes(frontEndScreen)) addImpactBurst(event);
    } else if (event.type === EVENT.SUPPORT_TRIGGERED) {
      if (!['main', 'map_select', 'coop'].includes(frontEndScreen)) addSupportFlash(event);
      if (event.payload.sourceTowerId === selectedTowerId) setStatus(`forge +${event.payload.credits} credits`);
    } else if (event.type === EVENT.TEST_CONFIG_CHANGED) {
      saveTestPreferences(event.payload.test);
    } else if (event.type === EVENT.COMMAND_REJECTED && event.payload.clientId === session.clientId) {
      setStatus(event.payload.reason);
    }
  }
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

  const enemyFrame = session.presentation();
  uiHitboxes.length = 0;
  drawBackground();
  if (!['main', 'map_select', 'coop'].includes(frontEndScreen)) {
    enemyRenderer.draw(camera, enemyFrame);
    drawTestFieldWorld(sessionSnapshot);
    drawNetworkLinks(sessionSnapshot);
    drawProjectiles(presentProjectiles(sessionSnapshot.projectiles, dt));
    drawClusterPayloads(sessionSnapshot.attackFields, sessionSnapshot.runTick);
    drawControlFields(sessionSnapshot);
    drawAttackFlashes(dt);
    drawImpactBursts(dt);
    for (const tower of sessionSnapshot.towers) drawTower(tower);
    drawBase(time, sessionSnapshot.base);
    drawBuildState(sessionSnapshot);
    drawHud(fps, sessionSnapshot);
  } else {
    projectilePresentation.clear();
    impactBursts.length = 0;
    attackFlashes.length = 0;
    if (frontEndScreen === 'main') drawMainMenu(sessionSnapshot);
    else if (frontEndScreen === 'map_select') drawMapSelection(sessionSnapshot);
    else drawCoopMenu(sessionSnapshot);
  }
  if (frontEndScreen === 'escape') drawEscapeMenu(sessionSnapshot);
  drawCursor();
  shapes.flush();
  bitmapText.flush();

  if (now - lastGpuCheck > 1000) {
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      showFatal(`webgl error 0x${error.toString(16)}`);
      return;
    }
    lastGpuCheck = now;
    syncDiagnostics();
  }

  requestAnimationFrame(frame);
}

try {
  requestAnimationFrame(frame);
} catch (error) {
  showFatal(error?.stack || error);
  throw error;
}
