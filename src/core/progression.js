// The original exponential curve is retained as the economic HP budget.
export function healthBudgetAt(map, runTick, tickRate = 60) {
  const minutes = Math.max(0, runTick) / tickRate / 60;
  const curve = map.spawnCurve;
  return (curve.basePerSecond + curve.linearPerMinute * minutes) * curve.growthPerMinute ** minutes;
}

export function spawnProfileAt(map, runTick, tickRate = 60) {
  const minutes = Math.max(0, runTick) / tickRate / 60;
  const hpPerSecond = healthBudgetAt(map, runTick, tickRate);
  // A few oranges after two minutes; the red/orange mixture reaches all-orange at 20.
  const openingHp = 1 + Math.max(0, Math.min(1, (minutes - 2) / 18));
  const bodyCap = healthBudgetAt(map, 20 * 60 * tickRate, tickRate) / 2;
  const meanHp = Math.max(openingHp, bodyCap > 0 ? hpPerSecond / bodyCap : 1);
  return { rate: hpPerSecond / meanHp, meanHp, hpPerSecond, bodyCap };
}
