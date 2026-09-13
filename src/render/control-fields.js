import { project } from '../app/camera.js';
import { drawDashedLink, drawWorldRing } from './world-geometry.js';
import { COLOR } from '../ui/palette.js';

export function drawControlFields(app, snapshot) {
  for (const field of snapshot.forceFields || []) {
    const fieldSelected = app.ui.selectedTowerId === field.sourceTowerId;
    if (field.kind === 'barricade') {
      const a=project(app, field.x1,field.y1), b=project(app, field.x2,field.y2);
      app.renderer.shapes.line(a.x,a.y,b.x,b.y,Math.max(2,field.thickness*2/app.viewport.camera.scale),fieldSelected?COLOR.cyan:COLOR.dimMint);
      app.renderer.shapes.line(a.x,a.y,b.x,b.y,1,COLOR.black);
      continue;
    }
    const persistent = field.persistentControl === true;
    const durationTicks = Math.max(1, field.expiresTick - field.createdTick);
    const phase = persistent
      ? (snapshot.runTick % Math.max(1, field.periodTicks || 120)) / Math.max(1, field.periodTicks || 120)
      : Math.max(0, Math.min(1, (snapshot.runTick - field.createdTick) / durationTicks));
    if (!persistent && phase >= 1) continue;
    const center = project(app, field.x, field.y);
    // Ambient battlefield rendering stays subdued; the selected tower gets the brighter preview.
    const activeColor = !fieldSelected && persistent ? COLOR.dimMint : persistent || phase < 0.72 ? COLOR.cyan : COLOR.dimMint;
    const ringColor = fieldSelected ? COLOR.cyan : COLOR.dimMint;

    if (field.kind === 'stasis_zone') {
      const pulsePhase = (snapshot.runTick % field.periodTicks) / field.periodTicks;
      const freezing = snapshot.runTick % field.periodTicks < field.durationTicks
        && snapshot.runTick - snapshot.runTick % field.periodTicks >= field.activeFromTick;
      drawWorldRing(app, field.x, field.y, field.radius, ringColor);
      drawWorldRing(app, field.x, field.y, field.radius * (0.22 + pulsePhase * 0.72), freezing ? COLOR.mint : COLOR.dimMint);
      const radiusPixels = Math.max(4, Math.round(field.radius / app.viewport.camera.scale));
      for (const angle of [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5]) {
        const outerX = center.x + Math.round(Math.cos(angle) * radiusPixels);
        const outerY = center.y + Math.round(Math.sin(angle) * radiusPixels);
        const innerX = center.x + Math.round(Math.cos(angle) * (radiusPixels - 7));
        const innerY = center.y + Math.round(Math.sin(angle) * (radiusPixels - 7));
        app.renderer.shapes.line(outerX, outerY, innerX, innerY, freezing ? 2 : 1, freezing ? COLOR.amber : COLOR.dimMint);
      }
      app.renderer.shapes.rect(center.x - 1, center.y - 1, 3, 3, COLOR.amber);
      continue;
    }

    if (field.kind === 'recall_gate') {
      const first = project(app, field.x1, field.y1);
      const second = project(app, field.x2, field.y2);
      app.renderer.shapes.line(first.x, first.y, second.x, second.y, 3, COLOR.amber);
      app.renderer.shapes.line(first.x, first.y, second.x, second.y, 1, COLOR.cyan);
      for (let index = 0; index < 7; index += 1) {
        const travel = ((index / 7) + phase) % 1;
        const marker = project(app, field.x1 + (field.x2 - field.x1) * travel, field.y1 + (field.y2 - field.y1) * travel);
        app.renderer.shapes.rect(marker.x - 1, marker.y - 1, 3, 3, index % 2 ? COLOR.mint : COLOR.amber);
      }
      continue;
    }

    if (field.kind === 'slow_field') {
      drawWorldRing(app, field.x, field.y, field.radius, ringColor);
      // Ambient net stays a faint centre mark; the full crosshatch net only shows for the selected tower.
      const radiusPixels = Math.max(3, Math.round(field.radius / app.viewport.camera.scale));
      const offsets = fieldSelected ? [-0.5, 0, 0.5] : [0];
      for (const offsetFraction of offsets) {
        const offset = Math.round(radiusPixels * offsetFraction);
        const span = Math.round(Math.sqrt(Math.max(0, radiusPixels * radiusPixels - offset * offset)) * 0.82);
        const lineColor = offset === 0 && fieldSelected ? COLOR.mint : COLOR.dimMint;
        app.renderer.shapes.line(center.x + offset, center.y - span, center.x + offset, center.y + span, 1, lineColor);
        app.renderer.shapes.line(center.x - span, center.y + offset, center.x + span, center.y + offset, 1, lineColor);
      }
      continue;
    }

    if (field.kind === 'radial_force') {
      const singularity = field.sourceFormId === 'singularity';
      const pulse = singularity ? 1 - phase * 0.45 : 1 - phase * 0.25;
      drawWorldRing(app, field.x, field.y, field.radius * pulse, fieldSelected ? (singularity ? COLOR.green : activeColor) : COLOR.dimMint);
      drawWorldRing(app, field.x, field.y, Math.max(6, field.radius * pulse * 0.48), fieldSelected ? (singularity ? COLOR.cyan : COLOR.green) : COLOR.dimMint);
      const reach = Math.max(3, Math.round(field.radius * pulse / app.viewport.camera.scale));
      const inset = singularity ? Math.max(2, Math.round(reach * 0.18)) : 2;
      const spokeColor = fieldSelected ? COLOR.mint : COLOR.dimMint;
      app.renderer.shapes.line(center.x - reach, center.y, center.x - inset, center.y, singularity && fieldSelected ? 2 : 1, spokeColor);
      app.renderer.shapes.line(center.x + reach, center.y, center.x + inset, center.y, singularity && fieldSelected ? 2 : 1, spokeColor);
      app.renderer.shapes.line(center.x, center.y - reach, center.x, center.y - inset, singularity && fieldSelected ? 2 : 1, spokeColor);
      app.renderer.shapes.line(center.x, center.y + reach, center.x, center.y + inset, singularity && fieldSelected ? 2 : 1, spokeColor);
      app.renderer.shapes.rect(center.x - 1, center.y - 1, 3, 3, singularity ? COLOR.amber : COLOR.cyan);
      continue;
    }

    if (field.kind === 'singularity_force') {
      const pulseTick = snapshot.runTick % field.periodTicks;
      const active = pulseTick < field.activeTicks;
      const pulse = active ? 1 - pulseTick / Math.max(1, field.activeTicks) * 0.62 : 1;
      drawWorldRing(app, field.x, field.y, field.radius, active ? COLOR.green : COLOR.dimMint);
      drawWorldRing(app, field.x, field.y, field.radius * (active ? pulse : 0.22), active ? COLOR.cyan : COLOR.dimMint);
      const reach = Math.max(4, Math.round(field.radius * (active ? pulse : 0.35) / app.viewport.camera.scale));
      for (const axis of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        app.renderer.shapes.line(center.x + axis[0] * reach, center.y + axis[1] * reach, center.x + axis[0] * 3, center.y + axis[1] * 3, active ? 2 : 1, active ? COLOR.mint : COLOR.dimMint);
      }
      app.renderer.shapes.rect(center.x - 2, center.y - 2, 5, 5, COLOR.black);
      app.renderer.shapes.rect(center.x - 1, center.y - 1, 3, 3, active ? COLOR.amber : COLOR.green);
      continue;
    }

    if (field.kind === 'bond_zone') {
      const active = snapshot.runTick % field.periodTicks < field.durationTicks
        && snapshot.runTick - snapshot.runTick % field.periodTicks >= field.activeFromTick;
      const selected = app.ui.selectedTowerId === field.sourceTowerId;
      if (selected || app.ui.showAllRanges) drawWorldRing(app, field.x, field.y, field.radius, active ? COLOR.green : COLOR.dimMint);
      // Sparse paired pips, not a web of thousands of opaque connections.
      if (active) {
        const pulseRadius = field.radius * (0.85 + phase * 0.3);
        for (const side of [-1, 1]) {
          const pip = project(app, field.x + side * pulseRadius * 0.65, field.y - pulseRadius * 0.55);
          app.renderer.shapes.rect(pip.x - 2, pip.y, 2, 2, COLOR.green);
          app.renderer.shapes.rect(pip.x + 1, pip.y, 2, 2, COLOR.mint);
        }
      }
      continue;
    }

    if (field.kind === 'vortex_force') {
      drawWorldRing(app, field.x, field.y, field.radius, fieldSelected && phase < 0.75 ? COLOR.green : COLOR.dimMint);
      drawWorldRing(app, field.x, field.y, field.radius * 0.45, ringColor);
      const orbitRadius = field.radius * (0.68 - phase * 0.12);
      const spin = field.spin || 1;
      for (let index = 0; index < 6; index += 1) {
        const angle = spin * phase * Math.PI * 4 + index * Math.PI / 3;
        const satellite = project(app, field.x + Math.cos(angle) * orbitRadius, field.y + Math.sin(angle) * orbitRadius);
        app.renderer.shapes.rect(satellite.x - 1, satellite.y - 1, 3, 3, index % 2 ? COLOR.dimMint : (fieldSelected ? COLOR.mint : COLOR.dimMint));
      }
      app.renderer.shapes.rect(center.x - 1, center.y - 1, 3, 3, COLOR.amber);
      continue;
    }

    if (field.kind === 'pinch_force') {
      drawWorldRing(app, field.x, field.y, field.radius, fieldSelected && phase < 0.75 ? COLOR.green : COLOR.dimMint);
      const perpendicularX = -field.axisY;
      const perpendicularY = field.axisX;
      const axisFrom = project(app, field.x - field.axisX * field.radius, field.y - field.axisY * field.radius);
      const axisTo = project(app, field.x + field.axisX * field.radius, field.y + field.axisY * field.radius);
      drawDashedLink(app, axisFrom, axisTo, COLOR.dimMint);
      for (const side of [-1, 1]) {
        const outside = project(app,
          field.x + perpendicularX * field.radius * 0.72 * side,
          field.y + perpendicularY * field.radius * 0.72 * side
        );
        const inside = project(app,
          field.x + perpendicularX * field.radius * 0.12 * side,
          field.y + perpendicularY * field.radius * 0.12 * side
        );
        app.renderer.shapes.line(outside.x, outside.y, inside.x, inside.y, fieldSelected ? 2 : 1, fieldSelected ? (side < 0 ? COLOR.cyan : COLOR.mint) : COLOR.dimMint);
        app.renderer.shapes.rect(outside.x - 2, outside.y - 2, 5, 5, COLOR.amber);
      }
      continue;
    }

    if (field.kind === 'braid_force') {
      const first = project(app, field.x1, field.y1);
      const second = project(app, field.x2, field.y2);
      const nx = field.normalX * field.width * 0.5;
      const ny = field.normalY * field.width * 0.5;
      const edgeA1 = project(app, field.x1 + nx, field.y1 + ny);
      const edgeA2 = project(app, field.x2 + nx, field.y2 + ny);
      const edgeB1 = project(app, field.x1 - nx, field.y1 - ny);
      const edgeB2 = project(app, field.x2 - nx, field.y2 - ny);
      app.renderer.shapes.line(edgeA1.x, edgeA1.y, edgeA2.x, edgeA2.y, fieldSelected ? 2 : 1, fieldSelected ? COLOR.green : COLOR.dimMint);
      app.renderer.shapes.line(edgeB1.x, edgeB1.y, edgeB2.x, edgeB2.y, fieldSelected ? 2 : 1, fieldSelected ? COLOR.cyan : COLOR.dimMint);
      drawDashedLink(app, first, second, fieldSelected ? COLOR.mint : COLOR.dimMint);
      for (const travel of [0.18, 0.5, 0.82]) {
        const midX = field.x1 + (field.x2 - field.x1) * travel;
        const midY = field.y1 + (field.y2 - field.y1) * travel;
        const outsideA = project(app, midX + nx * 0.85, midY + ny * 0.85);
        const outsideB = project(app, midX - nx * 0.85, midY - ny * 0.85);
        const middle = project(app, midX, midY);
        app.renderer.shapes.line(outsideA.x, outsideA.y, middle.x, middle.y, 1, COLOR.amber);
        app.renderer.shapes.line(outsideB.x, outsideB.y, middle.x, middle.y, 1, COLOR.amber);
      }
      continue;
    }

    if (field.kind === 'splitter_force') {
      const first = project(app, field.x1, field.y1);
      const second = project(app, field.x2, field.y2);
      drawDashedLink(app, first, second, COLOR.dimMint);
      const normalX = -field.axisY;
      const normalY = field.axisX;
      for (const side of [-1, 1]) {
        const start = project(app, field.x + field.axisX * side * 8, field.y + field.axisY * side * 8);
        const endX = field.x + field.axisX * field.halfLength * side;
        const endY = field.y + field.axisY * field.halfLength * side;
        const end = project(app, endX, endY);
        app.renderer.shapes.line(start.x, start.y, end.x, end.y, 1, fieldSelected ? COLOR.amber : COLOR.dimMint);
        for (const wing of [-1, 1]) {
          const tip = project(app, endX - field.axisX * side * 13 + normalX * wing * 9, endY - field.axisY * side * 13 + normalY * wing * 9);
          app.renderer.shapes.line(end.x, end.y, tip.x, tip.y, 1, fieldSelected ? COLOR.mint : COLOR.dimMint);
          const edgeStart = project(app, field.x1 + normalX * field.thickness * wing, field.y1 + normalY * field.thickness * wing);
          const edgeEnd = project(app, field.x2 + normalX * field.thickness * wing, field.y2 + normalY * field.thickness * wing);
          if (side === 1) drawDashedLink(app, edgeStart, edgeEnd, COLOR.dimMint);
        }
      }
      app.renderer.shapes.rect(center.x - 1, center.y - 2, 3, 5, COLOR.cyan);
      continue;
    }

    if (field.kind === 'force_wall') {
      const wallFrom = project(app,
        field.x - field.wallAxisX * field.halfLength,
        field.y - field.wallAxisY * field.halfLength
      );
      const wallTo = project(app,
        field.x + field.wallAxisX * field.halfLength,
        field.y + field.wallAxisY * field.halfLength
      );
      const screenOffsetX = Math.round((field.wallNormalX ?? field.pushX) * field.thickness / app.viewport.camera.scale);
      const screenOffsetY = Math.round((field.wallNormalY ?? field.pushY) * field.thickness / app.viewport.camera.scale);
      app.renderer.shapes.line(wallFrom.x - screenOffsetX, wallFrom.y - screenOffsetY, wallTo.x - screenOffsetX, wallTo.y - screenOffsetY, fieldSelected ? 2 : 1, fieldSelected ? COLOR.amber : COLOR.dimMint);
      app.renderer.shapes.line(wallFrom.x + screenOffsetX, wallFrom.y + screenOffsetY, wallTo.x + screenOffsetX, wallTo.y + screenOffsetY, fieldSelected ? 2 : 1, fieldSelected ? activeColor : COLOR.dimMint);
      drawDashedLink(app, wallFrom, wallTo, fieldSelected ? COLOR.mint : COLOR.dimMint);
      for (const along of [-0.55, 0, 0.55]) {
        const arrowStart = project(app,
          field.x + field.wallAxisX * field.halfLength * along - field.pushX * field.thickness,
          field.y + field.wallAxisY * field.halfLength * along - field.pushY * field.thickness
        );
        const arrowEnd = project(app,
          field.x + field.wallAxisX * field.halfLength * along + field.pushX * field.thickness * 1.8,
          field.y + field.wallAxisY * field.halfLength * along + field.pushY * field.thickness * 1.8
        );
        app.renderer.shapes.line(arrowStart.x, arrowStart.y, arrowEnd.x, arrowEnd.y, 1, fieldSelected ? COLOR.cyan : COLOR.dimMint);
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
      const first = project(app, waveX - perpendicularX * field.halfWidth, waveY - perpendicularY * field.halfWidth);
      const second = project(app, waveX + perpendicularX * field.halfWidth, waveY + perpendicularY * field.halfWidth);
      app.renderer.shapes.line(first.x, first.y, second.x, second.y, 4, COLOR.amber);
      app.renderer.shapes.line(first.x, first.y, second.x, second.y, 2, COLOR.mint);
      const rear = project(app, waveX - field.directionX * field.waveThickness, waveY - field.directionY * field.waveThickness);
      const front = project(app, waveX + field.directionX * field.waveThickness, waveY + field.directionY * field.waveThickness);
      app.renderer.shapes.line(rear.x, rear.y, front.x, front.y, 2, COLOR.cyan);
      continue;
    }

    if (field.kind === 'crosswind_force') {
      drawWorldRing(app, field.x, field.y, field.radius, ringColor);
      const perpendicularX = -field.directionY;
      const perpendicularY = field.directionX;
      for (const offset of fieldSelected ? [-0.48, 0, 0.48] : [0]) {
        const start = project(app,
          field.x + perpendicularX * field.radius * offset - field.directionX * field.radius * 0.48,
          field.y + perpendicularY * field.radius * offset - field.directionY * field.radius * 0.48
        );
        const end = project(app,
          field.x + perpendicularX * field.radius * offset + field.directionX * field.radius * 0.48,
          field.y + perpendicularY * field.radius * offset + field.directionY * field.radius * 0.48
        );
        app.renderer.shapes.line(start.x, start.y, end.x, end.y, offset === 0 && fieldSelected ? 2 : 1, offset === 0 ? (fieldSelected ? COLOR.mint : COLOR.dimMint) : COLOR.amber);
      }
      continue;
    }

    if (field.kind === 'directional_force') {
      const breaker = field.sourceFormId === 'breaker';
      drawWorldRing(app, field.x, field.y, field.radius, fieldSelected ? (breaker ? COLOR.amber : activeColor) : COLOR.dimMint);
      const perpendicularX = -field.directionY;
      const perpendicularY = field.directionX;
      const lineCount = breaker ? 5 : 3;
      for (let index = 0; index < lineCount; index += 1) {
        const offset = (index - (lineCount - 1) * 0.5) * (breaker ? 10 : 7);
        const start = project(app,
          field.x + perpendicularX * offset - field.directionX * field.radius * 0.18,
          field.y + perpendicularY * offset - field.directionY * field.radius * 0.18
        );
        const end = project(app,
          field.x + perpendicularX * offset + field.directionX * field.radius * (0.45 + phase * 0.38),
          field.y + perpendicularY * offset + field.directionY * field.radius * (0.45 + phase * 0.38)
        );
        app.renderer.shapes.line(start.x, start.y, end.x, end.y, breaker && index === 2 && fieldSelected ? 2 : 1, !fieldSelected ? COLOR.dimMint : index % 2 ? COLOR.amber : COLOR.mint);
      }
    }
  }
}

export function drawSelectedBondLinks(app, snapshot, frame) {
  if (!app.ui.selectedTowerId || !frame.bondPartnerById) return;
  const field = snapshot.forceFields?.find((candidate) => candidate.kind === 'bond_zone' && candidate.sourceTowerId === app.ui.selectedTowerId);
  if (!field || snapshot.runTick % field.periodTicks >= field.durationTicks) return;
  const source = frame.bondSourceIds.indexOf(app.ui.selectedTowerId);
  if (source < 1) return;
  let drawn = 0;
  // A small visual sample only. Every valid pair still participates in combat.
  for (let index = 0; index < frame.count && drawn < 24; index += 1) {
    const id = frame.idByIndex[index];
    const partner = frame.bondPartnerById[id];
    if (partner <= id || frame.bondSourceById[id] !== source || frame.bondUntilById[id] <= frame.tick) continue;
    const partnerIndex = frame.indexById[partner];
    if (partnerIndex < 0) continue;
    const a = project(app, frame.state[index * 4], frame.state[index * 4 + 1]);
    const b = project(app, frame.state[partnerIndex * 4], frame.state[partnerIndex * 4 + 1]);
    if ((a.x < 0 && b.x < 0) || (a.x >= app.viewport.logicalWidth && b.x >= app.viewport.logicalWidth)
      || (a.y < app.viewport.HUD_TOP_HEIGHT && b.y < app.viewport.HUD_TOP_HEIGHT) || (a.y >= app.viewport.hudBottomY && b.y >= app.viewport.hudBottomY)) continue;
    app.renderer.shapes.line(a.x, a.y, b.x, b.y, 1, COLOR.dimMint);
    app.renderer.shapes.rect(a.x, a.y, 1, 1, COLOR.green);
    app.renderer.shapes.rect(b.x, b.y, 1, 1, COLOR.green);
    drawn += 1;
  }
}
