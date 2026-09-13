import { AUTHORITY_TICK_RATE } from '../core/protocol.js';
import { createProgram } from './webgl.js';
import { enemyPointSize } from './world-appearance.js';
import { COLOR } from '../ui/palette.js';

export const SWARM_RENDER_VERTEX = `#version 300 es
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

export const SWARM_RENDER_FRAGMENT = `#version 300 es
precision highp float;
flat in float v_status;
flat in float v_units;
flat in float v_hp;
flat in float v_pointSize;
uniform float u_renderScale;
uniform float u_hostilePalette;
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
    bool alt = u_hostilePalette > 0.5;
    if (v_hp < 1.5) outColor = alt ? vec4(1.0, 0.30, 0.90, 1.0) : vec4(${COLOR.red.join(',')});
    else if (v_hp < 2.5) outColor = alt ? vec4(1.0, 0.62, 0.86, 1.0) : vec4(1.0, 0.48, 0.12, 1.0);
    else if (v_hp < 3.5) outColor = alt ? vec4(1.0, 0.96, 0.90, 1.0) : vec4(1.0, 0.86, 0.18, 1.0);
    else if (v_hp < 4.5) outColor = alt ? vec4(0.62, 0.50, 1.0, 1.0) : vec4(0.64, 0.40, 1.0, 1.0);
    else if (v_hp < 5.5) outColor = alt ? vec4(0.42, 0.30, 0.86, 1.0) : vec4(1.0, 0.30, 0.75, 1.0);
    else {
      float tier = mod(floor(log2(v_hp)), 3.0);
      vec3 shell = alt
        ? (tier < 0.5 ? vec3(1.0, 0.40, 0.92) : tier < 1.5 ? vec3(0.62, 0.50, 1.0) : vec3(1.0, 0.80, 0.95))
        : (tier < 0.5 ? vec3(1.0, 0.58, 0.18) : tier < 1.5 ? vec3(0.74, 0.48, 1.0) : vec3(1.0, 0.38, 0.70));
      bool stripe = abs(point.y - 0.5) < 0.10;
      outColor = vec4(stripe ? vec3(1.0) : shell, 1.0);
    }
  }
}
`;

export class EnemyRenderer {
  constructor(gl, viewport, capacity = 4096) {
    this.gl = gl;
    this.viewport = viewport;
    this.capacity = Math.max(64, capacity);
    this.lastTick = -1;
    this.lastCount = -1;
    this.lastState = null;
    this.program = createProgram(this.gl, SWARM_RENDER_VERTEX, SWARM_RENDER_FRAGMENT);
    this.stateBuffer = this.gl.createBuffer();
    this.statusBuffer = this.gl.createBuffer();
    this.unitsBuffer = this.gl.createBuffer();
    this.hpBuffer = this.gl.createBuffer();
    this.hpData = new Float32Array(this.capacity);
    this.vao = this.gl.createVertexArray();
    this.gl.bindVertexArray(this.vao);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.stateBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.capacity * 16, this.gl.DYNAMIC_DRAW);
    this.gl.enableVertexAttribArray(0);
    this.gl.vertexAttribPointer(0, 4, this.gl.FLOAT, false, 16, 0);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.statusBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.capacity * 4, this.gl.DYNAMIC_DRAW);
    this.gl.enableVertexAttribArray(1);
    this.gl.vertexAttribPointer(1, 1, this.gl.FLOAT, false, 4, 0);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.unitsBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.capacity * 4, this.gl.DYNAMIC_DRAW);
    this.gl.enableVertexAttribArray(2);
    this.gl.vertexAttribPointer(2, 1, this.gl.FLOAT, false, 4, 0);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.hpBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.capacity * 4, this.gl.DYNAMIC_DRAW);
    this.gl.enableVertexAttribArray(3);
    this.gl.vertexAttribPointer(3, 1, this.gl.FLOAT, false, 4, 0);
    this.gl.bindVertexArray(null);
  }

  ensureCapacity(required) {
    if (required <= this.capacity) return;
    while (this.capacity < required) this.capacity *= 2;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.stateBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.capacity * 16, this.gl.DYNAMIC_DRAW);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.statusBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.capacity * 4, this.gl.DYNAMIC_DRAW);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.unitsBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.capacity * 4, this.gl.DYNAMIC_DRAW);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.hpBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.capacity * 4, this.gl.DYNAMIC_DRAW);
    this.hpData = new Float32Array(this.capacity);
    this.lastTick = -1;
  }

  upload(frame) {
    if (frame.tick === this.lastTick && frame.count === this.lastCount && frame.state === this.lastState) return;
    this.ensureCapacity(frame.capacity || frame.count);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.stateBuffer);
    this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, frame.state.subarray(0, frame.count * 4));
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.statusBuffer);
    this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, frame.status.subarray(0, frame.count));
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.unitsBuffer);
    this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, frame.units.subarray(0, frame.count));
    for (let i = 0; i < frame.count; i++) this.hpData[i] = Math.ceil(frame.hpById[frame.idByIndex[i]]);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.hpBuffer);
    this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, this.hpData.subarray(0, frame.count));
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
    this.lastTick = frame.tick;
    this.lastCount = frame.count;
    this.lastState = frame.state;
  }

  draw(camera, frame, preferences) {
    this.upload(frame);
    this.gl.useProgram(this.program);
    this.gl.uniform2f(this.gl.getUniformLocation(this.program, 'u_resolution'), this.viewport.logicalWidth, this.viewport.logicalHeight);
    this.gl.uniform1f(this.gl.getUniformLocation(this.program, 'u_renderScale'), this.viewport.renderScale);
    this.gl.uniform2f(this.gl.getUniformLocation(this.program, 'u_camera'), camera.x, camera.y);
    this.gl.uniform1f(this.gl.getUniformLocation(this.program, 'u_viewScale'), camera.scale);
    this.gl.uniform1f(this.gl.getUniformLocation(this.program, 'u_tickAlpha'), frame.alpha);
    this.gl.uniform2f(this.gl.getUniformLocation(this.program, 'u_pointSizes'), enemyPointSize(camera.scale), enemyPointSize(camera.scale, 2));
    this.gl.uniform1f(this.gl.getUniformLocation(this.program, 'u_hostilePalette'), preferences.hostilePalette === 'magenta' ? 1 : 0);
    this.gl.bindVertexArray(this.vao);
    this.gl.drawArrays(this.gl.POINTS, 0, frame.count);
    this.gl.bindVertexArray(null);
  }
}
