// Presentation follows the persistent sweep's clock, never its damage events.
// Fractional ticks interpolate between authority updates; a paused clock stays put.
export function sweepPose(field, tick, alpha = 0) {
  if (field.kind !== 'sweep_line' || tick < field.createdTick || tick >= field.expiresTick) return null;
  const phase = Math.max(0, Math.min(1, (tick + alpha - field.createdTick) / Math.max(1, field.durationTicks)));
  const angle = field.baseAngle + (field.sweepDirection || 1) * field.sweepRadians * phase;
  return { phase, angle, x: field.x + Math.cos(angle) * field.range, y: field.y + Math.sin(angle) * field.range };
}

const fade = (color, opacity) => [color[0], color[1], color[2], color[3] * opacity];
function crossbar(shapes, p, nx, ny, length, color) {
  shapes.line(p.x - nx * length, p.y - ny * length, p.x + nx * length, p.y + ny * length, 1, color);
}

export function drawSweep(shapes, colors, project, scale, field, tick, alpha = 0) {
  const pose = sweepPose(field, tick, alpha);
  if (!pose) return;
  const from = project(field.x, field.y);
  const to = project(pose.x, pose.y);
  const direction = field.sweepDirection || 1;
  const width = Math.max(1, (field.attack.geometry.width || 12) / scale);
  // A short continuous wake makes direction readable without drawing a second
  // bright beam or filling the whole swept sector as if it were an AOE attack.
  const wakeAngle = Math.min(.2, field.sweepRadians * pose.phase);
  for (let i = 5; i > 0; i--) {
    const angle = pose.angle - direction * wakeAngle * i / 5;
    const end = project(field.x + Math.cos(angle) * field.range, field.y + Math.sin(angle) * field.range);
    shapes.line(from.x, from.y, end.x, end.y, Math.max(1, width * .45), fade(colors.cyan, .035 + (5-i)*.02));
  }
  shapes.line(from.x, from.y, to.x, to.y, width, fade(colors.cyan, .45));
  shapes.line(from.x, from.y, to.x, to.y, Math.max(1, width * .32), colors.ink);
  const nx = -Math.sin(pose.angle), ny = Math.cos(pose.angle);
  crossbar(shapes, to, nx, ny, Math.max(2, width), colors.mint);
  // Short arc at the tip reads as a scanner's moving leading edge.
  let previous = to;
  for (let i = 1; i <= 7; i++) {
    const angle = pose.angle - direction * wakeAngle * i / 7;
    const next = project(field.x + Math.cos(angle)*field.range, field.y + Math.sin(angle)*field.range);
    shapes.line(previous.x, previous.y, next.x, next.y, 1, fade(colors.cyan, (1-i/8)*.6));
    previous = next;
  }
  shapes.rect(from.x-2, from.y-2, 4, 4, colors.ink);
}

export function drawLaserPulse(shapes, colors, project, scale, flash) {
  const lifetime = flash.formId === 'cutter' ? .26 : flash.formId === 'prism' ? .2 : .18;
  if (flash.age >= lifetime) return false;
  const phase = Math.max(0, flash.age / lifetime);
  const opacity = (1-phase) ** .7;
  const from = project(flash.x1, flash.y1), to = project(flash.x2, flash.y2);
  const dx = to.x-from.x, dy = to.y-from.y, length = Math.hypot(dx,dy) || 1;
  const nx = -dy/length, ny = dx/length;
  const width = Math.max(1, flash.width/scale);
  const line = (offset, thickness, color, strength=1) => shapes.line(
    from.x+nx*offset, from.y+ny*offset, to.x+nx*offset, to.y+ny*offset,
    Math.max(.6,thickness), fade(color, opacity*strength));
  if (flash.formId === 'cutter') {
    // Heavy thermal blade: broad hot slab, crisp cutting edges, lateral sparks.
    const edge = width * .45 * (1-phase*.35);
    line(0, edge*2, colors.red, .35);
    line(0, edge*1.4, colors.amber, .8);
    line(0, Math.max(1,edge*.35), colors.ink);
    line(-edge, 1, colors.amber);
    line(edge, 1, colors.amber);
    for (let i=1;i<=5;i++) {
      const t=i/6, side=i%2 ? 1 : -1;
      const p={x:from.x+dx*t,y:from.y+dy*t};
      const reach=(3+phase*12)*side;
      shapes.line(p.x+nx*edge*side,p.y+ny*edge*side,p.x+nx*(edge*side+reach),p.y+ny*(edge*side+reach),1,fade(colors.amber,opacity*.7));
    }
    crossbar(shapes,from,nx,ny,edge+2,fade(colors.ink,opacity));
  } else if (flash.formId === 'prism') {
    // Three differently coloured optical channels; small lens diamonds rather
    // than a second thick beam enclosing the actual attack geometry.
    const tint=[colors.cyan,colors.mint,colors.amber][(flash.beamIndex || 0)%3];
    line(0,width,tint,.25);
    line(0,Math.max(1,width*.25),tint);
    line(0,.7,colors.ink,.85);
    for (const t of [.12,.88]) {
      const p={x:from.x+dx*t,y:from.y+dy*t}, r=2+phase*2;
      const a={x:p.x+dx/length*r,y:p.y+dy/length*r};
      const b={x:p.x+nx*r,y:p.y+ny*r};
      const c={x:p.x-dx/length*r,y:p.y-dy/length*r};
      const d={x:p.x-nx*r,y:p.y-ny*r};
      for(const [u,v] of [[a,b],[b,c],[c,d],[d,a]]) shapes.line(u.x,u.y,v.x,v.y,1,fade(tint,opacity));
    }
  } else {
    // Precision lance: tight white spine, cyan edge, clean pointed termination.
    line(0,width,colors.cyan,.2);
    line(0,Math.max(1,width*.36),colors.cyan);
    line(0,1,colors.ink);
    crossbar(shapes,from,nx,ny,3,fade(colors.cyan,opacity));
    shapes.triangle({x:to.x,y:to.y},
      {x:to.x-dx/length*7+nx*2,y:to.y-dy/length*7+ny*2},
      {x:to.x-dx/length*7-nx*2,y:to.y-dy/length*7-ny*2},fade(colors.ink,opacity));
  }
  return true;
}
