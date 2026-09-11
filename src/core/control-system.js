import { AUTHORITY_TICK_RATE } from './protocol.js';

const MINIMUM_LINE_LENGTH = 12;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function pointInsideBounds(point, map) {
  return point.x >= map.bounds.left
    && point.x <= map.bounds.right
    && point.y >= map.bounds.top
    && point.y <= map.bounds.bottom;
}

function stableSign(value) {
  let hash = 2166136261;
  const text = String(value || 'control');
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0) & 1 ? 1 : -1;
}

function towerRange(definition, tower) {
  return Math.max(1, tower.effectiveRange || definition.range || 1);
}

function baseDirection(tower, map, away = false) {
  let dx = map.base.x - tower.x;
  let dy = map.base.y - tower.y;
  const length = Math.hypot(dx, dy) || 1;
  dx /= length;
  dy /= length;
  return away ? { x: -dx, y: -dy } : { x: dx, y: dy };
}

function clampDefaultPoint(point, map) {
  return {
    x: Math.round(clamp(point.x, map.bounds.left + 2, map.bounds.right - 2)),
    y: Math.round(clamp(point.y, map.bounds.top + 2, map.bounds.bottom - 2))
  };
}

export function supportsControlGeometry(definition) {
  return Boolean(definition?.control && definition.control.input !== 'none');
}

export function defaultControlGeometry(definition, tower, map) {
  const control = definition?.control;
  if (!control || control.input === 'none') return null;
  const range = towerRange(definition, tower);
  const downstream = baseDirection(tower, map);
  if (control.input === 'point') {
    const distance = Math.min(range * 0.58, Math.max(24, range - (control.radius || 0) * 0.35));
    const point = clampDefaultPoint({
      x: tower.x + downstream.x * distance,
      y: tower.y + downstream.y * distance
    }, map);
    return { kind: 'point', ...point };
  }
  if (control.input === 'direction') {
    if (control.type === 'aim') return { kind: 'direction', dx: downstream.x, dy: downstream.y };
    const sign = stableSign(tower.id);
    return { kind: 'direction', dx: -downstream.y * sign, dy: downstream.x * sign };
  }
  const midpointDistance = Math.min(range * 0.52, Math.max(20, range - (control.maxLength || 0) * 0.28));
  const midpoint = clampDefaultPoint({
    x: tower.x + downstream.x * midpointDistance,
    y: tower.y + downstream.y * midpointDistance
  }, map);
  const axisX = control.type === 'braid' ? downstream.x : -downstream.y;
  const axisY = control.type === 'braid' ? downstream.y : downstream.x;
  const halfLength = Math.min((control.maxLength || range) * 0.5, range * 0.36);
  const first = clampDefaultPoint({ x: midpoint.x - axisX * halfLength, y: midpoint.y - axisY * halfLength }, map);
  const second = clampDefaultPoint({ x: midpoint.x + axisX * halfLength, y: midpoint.y + axisY * halfLength }, map);
  return { kind: 'line', x1: first.x, y1: first.y, x2: second.x, y2: second.y };
}

export function normalizeControlGeometry(definition, tower, geometry, map) {
  const control = definition?.control;
  if (!control) return null;
  if (control.input === 'none') return null;
  if (geometry === null || geometry === undefined) return defaultControlGeometry(definition, tower, map);
  const range = towerRange(definition, tower);
  if (control.input === 'point') {
    const point = { x: Number(geometry.x), y: Number(geometry.y) };
    if (geometry.kind !== 'point' || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    if (!pointInsideBounds(point, map) || Math.hypot(point.x - tower.x, point.y - tower.y) > range + 0.001) return null;
    return { kind: 'point', x: Math.round(point.x), y: Math.round(point.y) };
  }
  if (control.input === 'direction') {
    let dx = Number(geometry.dx);
    let dy = Number(geometry.dy);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
      if (geometry.kind !== 'direction' || !Number.isFinite(geometry.x) || !Number.isFinite(geometry.y)) return null;
      dx = Number(geometry.x) - tower.x;
      dy = Number(geometry.y) - tower.y;
      if (Math.hypot(dx, dy) > range + 0.001) return null;
    }
    const length = Math.hypot(dx, dy);
    if (length <= 0.001) return null;
    if (control.type === 'crosswind') {
      const downstream = baseDirection(tower, map);
      const side = (-downstream.y * dx + downstream.x * dy) / length;
      if (Math.abs(side) < 0.05) return null;
      const sign = side < 0 ? -1 : 1;
      return { kind: 'direction', dx: -downstream.y * sign, dy: downstream.x * sign };
    }
    return { kind: 'direction', dx: dx / length, dy: dy / length };
  }
  if (geometry.kind !== 'line') return null;
  const first = { x: Number(geometry.x1), y: Number(geometry.y1) };
  const second = { x: Number(geometry.x2), y: Number(geometry.y2) };
  if (!Number.isFinite(first.x) || !Number.isFinite(first.y) || !Number.isFinite(second.x) || !Number.isFinite(second.y)) return null;
  if (!pointInsideBounds(first, map) || !pointInsideBounds(second, map)) return null;
  if (Math.hypot(first.x - tower.x, first.y - tower.y) > range + 0.001
    || Math.hypot(second.x - tower.x, second.y - tower.y) > range + 0.001) return null;
  const length = Math.hypot(second.x - first.x, second.y - first.y);
  if (length < MINIMUM_LINE_LENGTH || length > control.maxLength + 0.001) return null;
  return {
    kind: 'line',
    x1: Math.round(first.x),
    y1: Math.round(first.y),
    x2: Math.round(second.x),
    y2: Math.round(second.y)
  };
}

export function controlRebootTicks(definition) {
  return Math.max(0, Math.round((definition?.control?.rebootSeconds || 0) * AUTHORITY_TICK_RATE));
}

function lineGeometry(geometry) {
  const x = (geometry.x1 + geometry.x2) * 0.5;
  const y = (geometry.y1 + geometry.y2) * 0.5;
  const segmentX = geometry.x2 - geometry.x1;
  const segmentY = geometry.y2 - geometry.y1;
  const length = Math.hypot(segmentX, segmentY) || 1;
  return {
    x,
    y,
    x1: geometry.x1,
    y1: geometry.y1,
    x2: geometry.x2,
    y2: geometry.y2,
    axisX: segmentX / length,
    axisY: segmentY / length,
    halfLength: length * 0.5
  };
}

function persistentField(tower, runTick) {
  return {
    id: `control_${tower.id}`,
    sourceTowerId: tower.id,
    sourceFormId: tower.definitionId,
    persistentControl: true,
    activeFromTick: tower.controlReadyTick || 0,
    createdTick: tower.controlReadyTick || 0,
    expiresTick: runTick + 2,
    affectedUnitsTick: 0,
    triggeredUnitsTick: 0
  };
}

export function buildControlField(definition, tower, map, runTick) {
  const control = definition?.control;
  if (!control || runTick < (tower.controlReadyTick || 0)) return null;
  const geometry = normalizeControlGeometry(definition, tower, tower.controlGeometry, map);
  if (control.input !== 'none' && !geometry) return null;
  const common = persistentField(tower, runTick);
  if (control.type === 'stasis_zone') {
    return {
      ...common,
      kind: 'stasis_zone',
      x: geometry.x,
      y: geometry.y,
      radius: control.radius,
      periodTicks: Math.max(1, Math.round(control.periodSeconds * AUTHORITY_TICK_RATE)),
      durationTicks: Math.max(1, Math.round(control.durationSeconds * AUTHORITY_TICK_RATE))
    };
  }
  if (control.type === 'recall_gate') {
    const line = lineGeometry(geometry);
    return {
      ...common,
      ...line,
      kind: 'recall_gate',
      radius: line.halfLength + control.thickness,
      thickness: control.thickness,
      normalX: -line.axisY,
      normalY: line.axisX,
      delayTicks: Math.max(1, Math.round(control.delaySeconds * AUTHORITY_TICK_RATE))
    };
  }
  if (control.type === 'slow_zone' || control.type === 'frost_zone') {
    return { ...common, kind: 'slow_field', x: geometry.x, y: geometry.y, radius: control.radius, speedFactor: 1 - control.magnitude };
  }
  if (control.type === 'singularity') {
    return {
      ...common,
      kind: 'singularity_force',
      x: geometry.x,
      y: geometry.y,
      radius: control.radius,
      strength: control.strength,
      periodTicks: Math.max(1, Math.round(control.periodSeconds * AUTHORITY_TICK_RATE)),
      activeTicks: Math.max(1, Math.round(control.activeSeconds * AUTHORITY_TICK_RATE))
    };
  }
  if (control.type === 'bond_zone') {
    return {
      ...common,
      kind: 'bond_zone',
      x: tower.x,
      y: tower.y,
      radius: control.radius,
      periodTicks: Math.max(1, Math.round(control.periodSeconds * AUTHORITY_TICK_RATE)),
      durationTicks: Math.max(1, Math.round(control.durationSeconds * AUTHORITY_TICK_RATE))
    };
  }
  if (control.type === 'braid') {
    const line = lineGeometry(geometry);
    return {
      ...common,
      ...line,
      kind: 'braid_force',
      radius: Math.hypot(line.halfLength, control.width * 0.5),
      width: control.width,
      strength: control.strength,
      normalX: -line.axisY,
      normalY: line.axisX
    };
  }
  if (control.type === 'breaker_wave') {
    const direction = baseDirection(tower, map, true);
    return {
      ...common,
      kind: 'breaker_wave',
      x: tower.x,
      y: tower.y,
      radius: control.range + control.width * 0.5,
      directionX: direction.x,
      directionY: direction.y,
      range: control.range,
      halfWidth: control.width * 0.5,
      waveThickness: control.waveThickness,
      shoveDistance: control.shoveDistance,
      periodTicks: Math.max(1, Math.round(control.periodSeconds * AUTHORITY_TICK_RATE)),
      travelTicks: Math.max(1, Math.round(control.travelSeconds * AUTHORITY_TICK_RATE))
    };
  }
  if (control.type === 'crosswind') {
    const phase = (runTick - (tower.controlReadyTick || 0)) % Math.round(control.periodSeconds * AUTHORITY_TICK_RATE);
    if (phase >= Math.round(control.activeSeconds * AUTHORITY_TICK_RATE)) return null;
    return {
      ...common,
      kind: 'crosswind_force',
      x: tower.x,
      y: tower.y,
      radius: control.radius,
      directionX: geometry.dx,
      directionY: geometry.dy,
      strength: control.strength
    };
  }
  if (control.type === 'barricade') {
    const phase = (runTick - (tower.controlReadyTick || 0)) % Math.round(control.periodSeconds * AUTHORITY_TICK_RATE);
    if (phase >= Math.round(control.durationSeconds * AUTHORITY_TICK_RATE)) return null;
    const line = lineGeometry(geometry);
    return { ...common, ...line, kind: 'barricade', radius: line.halfLength + control.thickness,
      thickness: control.thickness, normalX: -line.axisY, normalY: line.axisX };
  }
  if (control.type === 'splitter') {
    const line = lineGeometry(geometry);
    return {
      ...common,
      ...line,
      kind: 'splitter_force',
      radius: Math.hypot(line.halfLength, control.thickness),
      wallAxisX: line.axisX,
      wallAxisY: line.axisY,
      wallNormalX: -line.axisY,
      wallNormalY: line.axisX,
      thickness: control.thickness,
      strength: control.strength
    };
  }
  return null;
}
