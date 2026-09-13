import { VertexStore } from './vertex-store.js';
import { createProgram } from './webgl.js';

export const TEXT_VERTEX = `#version 300 es
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

export const TEXT_FRAGMENT = `#version 300 es
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

export const glyph = (...rows) => rows.join('');

export const GLYPHS = Object.freeze({
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

export class BitmapText {
  constructor(gl, viewport) {
    this.gl = gl;
    this.viewport = viewport;
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
    this.texture = this.gl.createTexture();
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, atlas);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.program = createProgram(this.gl, TEXT_VERTEX, TEXT_FRAGMENT);
    this.buffer = this.gl.createBuffer();
    this.vao = this.gl.createVertexArray();
    this.store = new VertexStore(8, 4096);
    this.bufferCapacity = 0;
    this.uniforms = {
      resolution: this.gl.getUniformLocation(this.program, 'u_resolution'),
      renderScale: this.gl.getUniformLocation(this.program, 'u_renderScale'),
      atlas: this.gl.getUniformLocation(this.program, 'u_atlas')
    };
    this.gl.bindVertexArray(this.vao);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
    this.gl.enableVertexAttribArray(0);
    this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 32, 0);
    this.gl.enableVertexAttribArray(1);
    this.gl.vertexAttribPointer(1, 2, this.gl.FLOAT, false, 32, 8);
    this.gl.enableVertexAttribArray(2);
    this.gl.vertexAttribPointer(2, 4, this.gl.FLOAT, false, 32, 16);
    this.gl.bindVertexArray(null);
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
    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
    this.gl.useProgram(this.program);
    this.gl.uniform2f(this.uniforms.resolution, this.viewport.logicalWidth, this.viewport.logicalHeight);
    this.gl.uniform1f(this.uniforms.renderScale, this.viewport.renderScale);
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.uniform1i(this.uniforms.atlas, 0);
    this.gl.bindVertexArray(this.vao);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
    if (this.store.data.byteLength > this.bufferCapacity) {
      this.bufferCapacity = this.store.data.byteLength;
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.bufferCapacity, this.gl.DYNAMIC_DRAW);
    }
    this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, vertices);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, this.store.vertexCount);
    this.gl.bindVertexArray(null);
    this.gl.disable(this.gl.BLEND);
    this.store.clear();
  }
}
