import { project } from '../app/camera.js';
import { AUTHORITY_TICK_RATE } from '../core/protocol.js';
import { combatMetrics } from './combat-marks.js';
import { drawDashedLink, drawWorldRing } from './world-geometry.js';
import { COLOR } from '../ui/palette.js';

export function presentProjectiles(app, projectiles, dt) {
  const liveIds = new Set();
  const presented = [];
  for (const projectile of projectiles) {
    liveIds.add(projectile.id);
    let visual = app.effects.projectilePresentation.get(projectile.id);
    if (!visual) {
      visual = { sourceX: projectile.x, sourceY: projectile.y, age: 0 };
      app.effects.projectilePresentation.set(projectile.id, visual);
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
  for (const projectileId of app.effects.projectilePresentation.keys()) {
    if (!liveIds.has(projectileId)) app.effects.projectilePresentation.delete(projectileId);
  }
  return presented;
}

export function drawProjectiles(app, projectiles) {
  const marks = combatMetrics(app.viewport.camera.scale);
  for (const projectile of projectiles) {
    if (['rocket', 'warhead', 'cluster', 'salvo'].includes(projectile.formId)) {
      const speed = Math.hypot(projectile.vx, projectile.vy) || 1;
      const trailLength = projectile.formId === 'warhead' ? 42 : projectile.formId === 'salvo' ? 27 : 34;
      const tail = project(app, projectile.x - projectile.vx / speed * trailLength, projectile.y - projectile.vy / speed * trailLength);
      const ember = project(app, projectile.x - projectile.vx / speed * 13, projectile.y - projectile.vy / speed * 13);
      const head = project(app, projectile.x, projectile.y);
      app.renderer.shapes.line(tail.x, tail.y, ember.x, ember.y, 1, COLOR.red);
      app.renderer.shapes.line(ember.x, ember.y, head.x, head.y, marks.rail, COLOR.amber);
      // Heads follow the turret footprint through the zoom instead of a fixed screen slab.
      const headWidth = projectile.formId === 'warhead' ? marks.heavy + 2 : projectile.formId === 'salvo' ? Math.max(3, marks.heavy - 2) : marks.heavy;
      const headHeight = headWidth >= 7 ? 3 : 2;
      const halfWidth = Math.floor(headWidth / 2);
      const halfHeight = Math.floor(headHeight / 2);
      app.renderer.shapes.rect(head.x - halfWidth - 1, head.y - halfHeight - 1, headWidth + 2, headHeight + 2, COLOR.black);
      app.renderer.shapes.rect(head.x - halfWidth, head.y - halfHeight, headWidth, headHeight, projectile.formId === 'cluster' ? COLOR.amber : COLOR.red);
      if (projectile.formId === 'cluster' && headWidth >= 7) {
        app.renderer.shapes.rect(head.x - halfWidth, head.y - halfHeight - 1, 2, 1, COLOR.red);
        app.renderer.shapes.rect(head.x + halfWidth - 1, head.y + halfHeight, 2, 1, COLOR.red);
      }
      app.renderer.shapes.rect(head.x, head.y, Math.min(2, headWidth - 1), 1, COLOR.mint);
      continue;
    }
    if (projectile.formId === 'flechette') {
      const speed = Math.hypot(projectile.vx, projectile.vy) || 1;
      const tail = project(app, projectile.x - projectile.vx / speed * 34, projectile.y - projectile.vy / speed * 34);
      const head = project(app, projectile.x, projectile.y);
      app.renderer.shapes.line(tail.x, tail.y, head.x, head.y, 1, COLOR.amber);
      app.renderer.shapes.rect(head.x - Math.floor(marks.shot / 2), head.y - Math.floor(marks.shot / 2), marks.shot, marks.shot, COLOR.mint);
      app.renderer.shapes.rect(tail.x, tail.y, 1, 1, COLOR.cyan);
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
    const tail = project(app, projectile.x - projectile.vx / speed * 22, projectile.y - projectile.vy / speed * 22);
    const head = project(app, projectile.x, projectile.y);
    app.renderer.shapes.line(tail.x, tail.y, head.x, head.y, 1, palette.trail);
    app.renderer.shapes.rect(head.x - Math.floor(marks.shot / 2), head.y - Math.floor(marks.shot / 2), marks.shot, marks.shot, palette.head);
  }
}

export function drawClusterPayloads(app, fields, runTick) {
  for (const field of fields || []) {
    if (field.kind !== 'delayed_blast' || field.attack?.sourceFormId !== 'cluster') continue;
    if (![field.originX, field.originY, field.x, field.y].every(Number.isFinite)) continue;
    const durationTicks = Math.max(1, field.durationTicks || 1);
    const progress = Math.max(0, Math.min(1, (runTick - field.createdTick) / durationTicks));
    const previousProgress = Math.max(0, progress - 0.16);
    const head = project(app,
      field.originX + (field.x - field.originX) * progress,
      field.originY + (field.y - field.originY) * progress
    );
    const tail = project(app,
      field.originX + (field.x - field.originX) * previousProgress,
      field.originY + (field.y - field.originY) * previousProgress
    );
    app.renderer.shapes.line(tail.x, tail.y, head.x, head.y, 1, COLOR.amber);
    const shot = combatMetrics(app.viewport.camera.scale).shot;
    app.renderer.shapes.rect(head.x - Math.floor(shot / 2), head.y - Math.floor(shot / 2), shot, shot, COLOR.red);
    if (shot >= 3) app.renderer.shapes.rect(head.x, head.y, 1, 1, COLOR.mint);
  }
}

// Reworked-weapon shots (pellets, nails, orbits, seeds, shells) live in state.turretRework,
// which turret-rework.js recreates every tick; the reset only clears it between runs.

export function drawReworkedCombat(app, snapshot) {
  const state = snapshot.turretRework;
  if (!state) return;
  const marks = combatMetrics(app.viewport.camera.scale);
  const heavyHalf = Math.floor(marks.heavy / 2);
  for (const shot of state.shots) {
    const p = project(app, shot.x, shot.y);
    const damage = ['pellet','nail','embedded','splinter','orbit'].includes(shot.type);
    const color = damage ? COLOR.amber : shot.type === 'gravity_seed' ? COLOR.mint : COLOR.cyan;
    const size = ['freeze_shell','gravity_seed','embedded'].includes(shot.type) ? Math.max(marks.shot, heavyHalf + 1) : marks.shot;
    app.renderer.shapes.rect(p.x - Math.floor(size / 2), p.y - Math.floor(size / 2), size, size, color);
    if (shot.type === 'nail' || shot.type === 'splinter') app.renderer.shapes.line(p.x, p.y, p.x - shot.dx * marks.tower * 0.5, p.y - shot.dy * marks.tower * 0.5, 1, color);
    if (shot.type === 'chain') drawWorldRing(app, shot.x, shot.y, marks.burst * 2, COLOR.cyan);
  }
  for (const v of state.visuals) {
    if (v.x2 !== undefined) {
      const p = project(app, v.x, v.y), q = project(app, v.x2, v.y2);
      app.renderer.shapes.line(p.x, p.y, q.x, q.y, v.type === 'ray' ? marks.rail : 1, COLOR.cyan);
      if (v.type === 'ray') app.renderer.shapes.rect(q.x - Math.floor(marks.shot / 2), q.y - Math.floor(marks.shot / 2), marks.shot, marks.shot, COLOR.mint);
    } else {
      drawWorldRing(app, v.x, v.y, v.radius, v.type === 'gravity' ? COLOR.dimMint : COLOR.cyan);
      if (v.type === 'gravity') drawWorldRing(app, v.x, v.y, v.radius * ((snapshot.runTick % 30) / 30), COLOR.cyan);
    }
  }
  // Enemy positions come from the already received swarm presentation.
  if (!state.chains.length) return;
  const presentation = app.game.session.presentation();
  const positions = new Map();
  for (let i = 0; i < presentation.count; i++) {
    const id = presentation.ids?.[i] ?? presentation.idByIndex?.[i];
    if (id !== undefined) positions.set(id, { x: presentation.state[i * 4], y: presentation.state[i * 4 + 1] });
  }
  for (const chain of state.chains) for (let i = 1; i < chain.members.length; i++) {
    const a = positions.get(chain.members[i - 1].id), b = positions.get(chain.members[i].id);
    if (a && b) drawDashedLink(app, project(app, a.x, a.y), project(app, b.x, b.y), COLOR.cyan);
  }
}
