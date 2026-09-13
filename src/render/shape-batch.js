import { VertexStore } from './vertex-store.js';
import { createProgram } from './webgl.js';

// Shape vertices carry an optional ring descriptor (centre, integer pixel radius, flag).
// Plain rectangles leave the flag at zero. Ring quads/annuli cover the pixel ring's
// footprint and the fragment shader keeps exactly the midpoint-circle pixels, so one
// ring costs a handful of vertices instead of one rectangle per pixel.

export const SHAPE_VERTEX = `#version 300 es
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

export const SHAPE_FRAGMENT = `#version 300 es
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

export const SHAPE_FLOATS = 10;

// Unit-circle tables per segment count, built once and reused by every ring.

export const ringPolygonCache = new Map();

export function ringPolygon(segments) {
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

export class ShapeBatch {
  constructor(gl, viewport) {
    this.gl = gl;
    this.viewport = viewport;
    this.program = createProgram(this.gl, SHAPE_VERTEX, SHAPE_FRAGMENT);
    this.buffer = this.gl.createBuffer();
    this.vao = this.gl.createVertexArray();
    this.store = new VertexStore(SHAPE_FLOATS, 8192);
    this.uniforms = {
      resolution: this.gl.getUniformLocation(this.program, 'u_resolution'),
      renderScale: this.gl.getUniformLocation(this.program, 'u_renderScale')
    };
    this.bufferCapacity = 0;
    this.ringsDrawn = 0;
    this.ringsCulled = 0;
    this.lastFlushFloats = 0;
    this.frameFloats = 0;
    this.gl.bindVertexArray(this.vao);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
    this.gl.enableVertexAttribArray(0);
    this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, SHAPE_FLOATS * 4, 0);
    this.gl.enableVertexAttribArray(1);
    this.gl.vertexAttribPointer(1, 4, this.gl.FLOAT, false, SHAPE_FLOATS * 4, 8);
    this.gl.enableVertexAttribArray(2);
    this.gl.vertexAttribPointer(2, 4, this.gl.FLOAT, false, SHAPE_FLOATS * 4, 24);
    this.gl.bindVertexArray(null);
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
    if (centerX + reach < 0 || centerX - reach > this.viewport.logicalWidth || centerY + reach < 0 || centerY - reach > this.viewport.logicalHeight) {
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
    this.gl.useProgram(this.program);
    this.gl.uniform2f(this.uniforms.resolution, this.viewport.logicalWidth, this.viewport.logicalHeight);
    this.gl.uniform1f(this.uniforms.renderScale, this.viewport.renderScale);
    this.gl.bindVertexArray(this.vao);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
    // Grow the GPU buffer geometrically and stream into it; no per-flush reallocation.
    if (this.store.data.byteLength > this.bufferCapacity) {
      this.bufferCapacity = this.store.data.byteLength;
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.bufferCapacity, this.gl.DYNAMIC_DRAW);
    }
    this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, vertices);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, this.store.vertexCount);
    this.gl.bindVertexArray(null);
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
