import { AUTHORITY_TICK_RATE } from '../core/protocol.js';
import { defenseAreaBounds } from '../core/world-config.js';
import { NEBULA_FRAGMENT } from './nebula-shader.js';
import { createProgram } from './webgl.js';

export const NEBULA_VERTEX = `#version 300 es
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

export class NebulaRenderer {
  constructor(gl, viewport) {
    this.gl = gl;
    this.viewport = viewport;
    this.program = createProgram(this.gl, NEBULA_VERTEX, NEBULA_FRAGMENT);
    this.buffer = this.gl.createBuffer();
    this.vao = this.gl.createVertexArray();
    this.mapId = null;
    this.count = 0;
    this.gl.bindVertexArray(this.vao);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
    const stride = 20 * Float32Array.BYTES_PER_ELEMENT;
    for (let location = 0; location < 5; location += 1) {
      this.gl.enableVertexAttribArray(location);
      this.gl.vertexAttribPointer(location, 4, this.gl.FLOAT, false, stride, location * 4 * Float32Array.BYTES_PER_ELEMENT);
      this.gl.vertexAttribDivisor(location, 1);
    }
    this.gl.bindVertexArray(null);
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
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(data), this.gl.STATIC_DRAW);
    this.mapId = key;
    this.count = map.defenseAreas.length;
  }

  draw(map, viewCamera, { networkPresentation, researchWave, reducedNetworkMotion }, sessionSnapshot) {
    this.setMap(map, networkPresentation);
    if (!this.count) return;
    this.gl.useProgram(this.program);
    this.gl.uniform2f(this.gl.getUniformLocation(this.program, 'u_resolution'), this.viewport.logicalWidth, this.viewport.logicalHeight);
    this.gl.uniform1f(this.gl.getUniformLocation(this.program, 'u_renderScale'), this.viewport.renderScale);
    this.gl.uniform2f(this.gl.getUniformLocation(this.program, 'u_camera'), viewCamera.x, viewCamera.y);
    this.gl.uniform1f(this.gl.getUniformLocation(this.program, 'u_viewScale'), viewCamera.scale);
    const waveAge = researchWave && researchWave.mapId === map.id && !reducedNetworkMotion.matches
      ? (sessionSnapshot.runTick - researchWave.startedTick) / AUTHORITY_TICK_RATE : -1;
    this.gl.uniform3f(this.gl.getUniformLocation(this.program, 'u_researchWave'),
      researchWave?.x || 0, researchWave?.y || 0, waveAge >= 0 && waveAge < 4 ? waveAge : -1);
    this.gl.bindVertexArray(this.vao);
    this.gl.drawArraysInstanced(this.gl.TRIANGLES, 0, 6, this.count);
    this.gl.bindVertexArray(null);
  }
}
