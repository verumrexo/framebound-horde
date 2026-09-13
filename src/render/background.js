import { COLOR } from '../ui/palette.js';

export const FULLSCREEN_VERTEX = `#version 300 es
precision highp float;
const vec2 positions[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
void main() { gl_Position = vec4(positions[gl_VertexID], 0.0, 1.0); }
`;

export const BACKGROUND_FRAGMENT = `#version 300 es
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

export function drawBackground(app) {
  app.renderer.gl.useProgram(app.renderer.backgroundProgram);
  app.renderer.gl.uniform2f(app.renderer.gl.getUniformLocation(app.renderer.backgroundProgram, 'u_resolution'), app.viewport.logicalWidth, app.viewport.logicalHeight);
  app.renderer.gl.uniform1f(app.renderer.gl.getUniformLocation(app.renderer.backgroundProgram, 'u_renderScale'), app.viewport.renderScale);
  app.renderer.gl.uniform2f(app.renderer.gl.getUniformLocation(app.renderer.backgroundProgram, 'u_camera'), app.viewport.camera.x, app.viewport.camera.y);
  app.renderer.gl.uniform1f(app.renderer.gl.getUniformLocation(app.renderer.backgroundProgram, 'u_viewScale'), app.viewport.camera.scale);
  app.renderer.gl.drawArrays(app.renderer.gl.TRIANGLES, 0, 3);
  app.renderer.nebulaRenderer.draw(app.game.currentMap, app.viewport.camera, app.effects, app.game.sessionSnapshot);
}
