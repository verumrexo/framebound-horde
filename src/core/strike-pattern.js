export function supportsStrikePoint(attack) {
  return attack?.delivery?.manualStrikePoint === true;
}

export function strikeImpactPoints(tower, attack, point) {
  if (!supportsStrikePoint(attack)
    || ![tower?.x, tower?.y, point?.x, point?.y].every(Number.isFinite)) return [];
  const range = Math.max(0, attack.range || tower.effectiveRange || 0);
  const centerX = point.x - tower.x;
  const centerY = point.y - tower.y;
  const centerDistance = Math.hypot(centerX, centerY);
  if (range <= 0 || centerDistance > range + 0.001) return [];

  const directionLength = centerDistance || 1;
  const perpendicularX = centerDistance > 0 ? -centerY / directionLength : 1;
  const perpendicularY = centerDistance > 0 ? centerX / directionLength : 0;
  const count = Math.max(1, Math.round(attack.volley?.count || 1));
  const spacing = Math.max(0, attack.delivery.strikeSpacing || 0);
  const impacts = [];
  for (let index = 0; index < count; index += 1) {
    const offset = (index - (count - 1) * 0.5) * spacing;
    let x = point.x + perpendicularX * offset;
    let y = point.y + perpendicularY * offset;
    const dx = x - tower.x;
    const dy = y - tower.y;
    const distance = Math.hypot(dx, dy);
    if (distance > range) {
      x = tower.x + dx / distance * range;
      y = tower.y + dy / distance * range;
    }
    impacts.push({ x, y });
  }
  return impacts;
}
