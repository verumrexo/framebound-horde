// Shared display formatting; authority prices always remain exact integers.
export function compactMetric(value) {
  const amount = Math.max(0, Number(value) || 0);
  for (const [threshold, suffix] of [[1e12, 't'], [1e9, 'b'], [1e6, 'm'], [1e3, 'k']]) {
    if (amount >= threshold) return `${(Math.floor(amount / threshold * 10) / 10).toFixed(1)}${suffix}`;
  }
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(1);
}
