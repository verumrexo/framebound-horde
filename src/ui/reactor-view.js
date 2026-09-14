import { REACTOR_DAMAGE_GROWTH } from '../core/research.js';
import { compactMetric } from '../core/format.js';

const EFFECTS = Object.freeze({
  cadence: ['cadence', 2, 'normal weapon firing'],
  range: ['range', 2, 'tower targeting // blast size unchanged'],
  velocity: ['speed', 5, 'travelling projectiles'],
  blast: ['blast radius', 1, 'explosive weapons'],
  beam: ['beam width', 1, 'laser-family beams'],
  recovery: ['recharge', 2, 'control towers // downtime preserved'],
  coverage: ['control size', 1, 'control fields // gate length unchanged'],
  guidance: ['turn strength', 2, 'homing projectiles'],
  sustain: ['slow duration', 2, 'ordinary slows']
});

// These values describe this reactor category's contribution. Conditional
// arsenal/network bonuses remain separate rather than implying one universal DPS.
export function reactorEffectView(id, rank) {
  if (id === 'damage') {
    const factor = REACTOR_DAMAGE_GROWTH ** rank;
    return { label: 'damage', value: `x${factor < 1000 ? factor.toFixed(2) : compactMetric(factor)}`, scope: 'primary weapons // compounds each rank' };
  }
  if (id === 'construction') return {
    label: 'discount', value: `+${Number(((1 - Math.max(0.5, 0.98 ** rank)) * 100).toFixed(1))}%`, scope: 'new builds and replacements'
  };
  if (id === 'lives') return { label: 'reserve', value: `+${rank * 5}`, scope: 'maximum base lives // also heals' };
  const [label, step, scope] = EFFECTS[id];
  return { label, value: `+${rank * step}%`, scope };
}

export function reactorPanelLayout(logicalWidth, logicalHeight) {
  const grid = logicalWidth >= 400 && logicalHeight >= 300;
  const width = Math.min(grid ? 560 : 420, logicalWidth - 16);
  const height = Math.min(300, logicalHeight - 16);
  const x = Math.floor((logicalWidth - width) / 2), y = Math.floor((logicalHeight - height) / 2);
  return { x, y, width, height, grid, perPage: height < 240 ? 1 : 3, footerY: y + height - 112 };
}
