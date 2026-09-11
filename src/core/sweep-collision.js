const TAU = Math.PI * 2;
const positiveAngle = (angle) => ((angle % TAU) + TAU) % TAU;

function distanceToRaySegmentSquared(x, y, angle, range) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const along = Math.max(0, Math.min(range, x * dx + y * dy));
  return (x - dx * along) ** 2 + (y - dy * along) ** 2;
}

// Exact union of the finite beam's capsules as it rotates over this interval.
// Includes its rounded tips and edges, without filling unswept parts of the fan.
export function insideSweptBeam(x, y, range, width, fromAngle, toAngle) {
  const radius = Math.max(0, width * .5);
  const distance = Math.hypot(x, y);
  if (distance > range + radius) return false;
  const delta = toAngle - fromAngle;
  const offset = positiveAngle((Math.atan2(y, x) - fromAngle) * (delta < 0 ? -1 : 1));
  if (Math.abs(delta) >= TAU || offset <= Math.abs(delta) + 1e-12) return true;
  return Math.min(
    distanceToRaySegmentSquared(x, y, fromAngle, range),
    distanceToRaySegmentSquared(x, y, toAngle, range)
  ) <= radius * radius;
}
