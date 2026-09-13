import { project } from '../app/camera.js';
import { compactMetric } from '../core/format.js';
import { BURST_SECONDS, MAX_CONTROL_LINKS, admitBurst, combatMetrics, drawImpactMark, impactColors, impactFamily } from './combat-marks.js';
import { drawLaserPulse } from './laser-effects.js';
import { drawWorldRing } from './world-geometry.js';
import { COLOR } from '../ui/palette.js';

export function addAttackFlash(app, event) {
  const payload = event.payload;
  const geometry = payload.geometry;
  if (payload.sourceFormId === 'sweeper') return;
  if (['laser', 'cutter', 'prism'].includes(payload.sourceFormId) && geometry?.type === 'line'
    && [geometry.x1, geometry.y1, geometry.x2, geometry.y2].every(Number.isFinite)) {
    app.effects.attackFlashes.push({
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
    app.effects.attackFlashes.push({
      kind: 'rocket',
      age: 0,
      x: payload.x,
      y: payload.y,
      radius: geometry.radius || 64
    });
  }
}

export function addSupportFlash(app, event) {
  if (event.payload.type !== 'kill_income' || !Number.isFinite(event.payload.x) || !Number.isFinite(event.payload.y)) return;
  const flash = {
    kind: 'forge',
    age: 0,
    sourceTowerId: event.payload.sourceTowerId,
    x: event.payload.x,
    y: event.payload.y,
    credits: event.payload.credits || 1
  };
  const existing = app.effects.attackFlashes.findIndex((candidate) => candidate.kind === 'forge' && candidate.sourceTowerId === flash.sourceTowerId);
  if (existing >= 0) app.effects.attackFlashes[existing] = flash;
  else app.effects.attackFlashes.push(flash);
}

export function drawAttackFlashes(app, dt) {
  let write = 0;
  for (const flash of app.effects.attackFlashes) {
    flash.age += dt;
    if (flash.kind === 'laser') {
      if (!drawLaserPulse(app.renderer.shapes, COLOR, project.bind(null, app), app.viewport.camera.scale, flash)) continue;
    } else if (flash.kind === 'rocket') {
      if (flash.age >= 0.3) continue;
      const progress = Math.min(1, flash.age / 0.16);
      const radius = flash.radius * progress;
      drawWorldRing(app, flash.x, flash.y, radius, flash.age < 0.12 ? COLOR.amber : COLOR.red);
      if (radius > 14) drawWorldRing(app, flash.x, flash.y, Math.max(4, radius - 12), flash.age < 0.08 ? COLOR.mint : COLOR.amber);
      const center = project(app, flash.x, flash.y);
      const heavy = combatMetrics(app.viewport.camera.scale).heavy;
      const cross = flash.age < 0.1 ? Math.ceil(heavy / 2) : Math.max(1, Math.floor(heavy / 3));
      app.renderer.shapes.rect(center.x - cross, center.y, cross * 2 + 1, 1, COLOR.red);
      app.renderer.shapes.rect(center.x, center.y - cross, 1, cross * 2 + 1, COLOR.red);
    } else if (flash.kind === 'forge') {
      if (flash.age >= 0.5) continue;
      const phase = Math.min(1, flash.age / 0.5);
      const radius = 8 + phase * 30;
      drawWorldRing(app, flash.x, flash.y, radius, phase < 0.55 ? COLOR.amber : COLOR.dimMint);
      const center = project(app, flash.x, flash.y);
      const reach = combatMetrics(app.viewport.camera.scale).burst;
      app.renderer.shapes.rect(center.x - reach, center.y, reach * 2 + 1, 1, COLOR.green);
      app.renderer.shapes.rect(center.x, center.y - reach, 1, reach * 2 + 1, COLOR.green);
      app.renderer.bitmapText.draw(`+${compactMetric(flash.credits)}`, center.x + reach + 3, center.y - 10 - Math.round(phase * 5), COLOR.amber, 1);
    }
    app.effects.attackFlashes[write++] = flash;
  }
  app.effects.attackFlashes.length = write;
}

export function addImpactBurst(app, event) {
  if (!Number.isFinite(event.payload.x) || !Number.isFinite(event.payload.y)) return;
  admitBurst(app.effects.impactBursts, {
    x: event.payload.x,
    y: event.payload.y,
    age: 0,
    seed: event.payload.enemyId || 1,
    sourceFormId: event.payload.sourceFormId,
    family: impactFamily(event.payload.sourceFormId),
    controlTargets: event.payload.controlTargets || []
  }, combatMetrics(app.viewport.camera.scale).burst * app.viewport.camera.scale);
}

export function drawImpactBursts(app, dt) {
  const marks = combatMetrics(app.viewport.camera.scale);
  let write = 0;
  for (const burst of app.effects.impactBursts) {
    burst.age += dt;
    if (burst.age >= BURST_SECONDS) continue;
    const p = project(app, burst.x, burst.y);
    const progress = burst.age / BURST_SECONDS;
    const colors = impactColors(burst.sourceFormId, COLOR);
    const color = progress < 0.4 ? colors.early : colors.late;
    const half = Math.floor(marks.shot / 2);
    for (const target of burst.controlTargets.slice(0, MAX_CONTROL_LINKS)) {
      const endpoint = project(app, target.x, target.y);
      app.renderer.shapes.line(p.x, p.y, endpoint.x, endpoint.y, 1, colors.control);
      app.renderer.shapes.rect(endpoint.x - half, endpoint.y - half, marks.shot, marks.shot, colors.control);
    }
    drawImpactMark(app.renderer.shapes, burst.family, p, progress, marks.burst, burst.seed & 1, color);
    app.effects.impactBursts[write++] = burst;
  }
  app.effects.impactBursts.length = write;
}
