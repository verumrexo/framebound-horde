import { CONTROL_FORMS } from '../core/tower-catalog.js';

// Every runtime sound hook. Global hooks are shared game moments; part slots are
// derived per tower form from its catalog attack. Defaults render from
// default-sounds.js, so an unbound hook always has an audible fallback.
const event = (id, category, label, policy = {}) => Object.freeze({ id, category, label, policy: Object.freeze({ ...policy }) });

export const SOUND_EVENTS = Object.freeze([
  event('fire', 'weapons', 'projectile fire', { isSpammy: true }),
  event('rocket_launch', 'weapons', 'rocket launch'),
  event('laser', 'weapons', 'beam fire', { isSpammy: true }),
  event('hit', 'combat', 'projectile hit', { isSpammy: true }),
  event('explosion', 'combat', 'blast impact'),
  event('control_apply', 'combat', 'control applied', { isSpammy: true }),
  event('enemy_death', 'combat', 'enemy death', { isSpammy: true }),
  event('tower_placed', 'towers', 'tower placed'),
  event('tower_evolved', 'towers', 'tower replaced / upgraded'),
  event('tower_sold', 'towers', 'tower sold'),
  event('base_breached', 'base', 'base breached'),
  event('run_started', 'run', 'run started / restarted'),
  event('defeat', 'run', 'base destroyed'),
  event('research_purchased', 'stations', 'research or reactor purchase'),
  event('relay_completed', 'network', 'relay network completed'),
  event('forge_income', 'network', 'forge credit payout', { isSpammy: true }),
  event('ui_click', 'ui', 'menu click'),
  event('ui_reject', 'ui', 'command rejected')
]);

export const SOUND_EVENT_BY_ID = new Map(SOUND_EVENTS.map((entry) => [entry.id, entry]));

export function getSoundEvent(eventId) {
  return SOUND_EVENT_BY_ID.get(eventId) || null;
}

export function partSoundEventKey(formId, slot = 'fire') {
  return `part:${formId}:${slot}`;
}

export function globalSoundEventKey(eventId) {
  return `global:${eventId}`;
}

const ROCKET_FORMS = new Set(['rocket', 'warhead', 'cluster', 'salvo']);

// Slots the runtime actually triggers for one tower form. Order matters: the
// editor shows them in this order and the first slot is selected by default.
export function getPartSoundSlots(definition) {
  if (!definition?.id) return [];
  const slots = [];
  const attack = definition.attack;
  const delivery = attack?.delivery?.type;
  const control = CONTROL_FORMS.includes(definition.id);
  if (delivery === 'projectile') {
    slots.push({ id: 'fire', label: control ? 'launch' : 'fire', fallback: ROCKET_FORMS.has(definition.id) ? 'rocket_launch' : 'fire' });
    if (control) slots.push({ id: 'apply', label: 'control applied', fallback: 'control_apply' });
    else if (attack.geometry?.type === 'circle') slots.push({ id: 'impact', label: 'blast impact', fallback: 'explosion' });
    else slots.push({ id: 'hit', label: 'hit', fallback: 'hit' });
  } else if (delivery === 'hitscan') {
    slots.push({ id: 'beam', label: 'beam', fallback: 'laser' });
  } else if (delivery === 'persistent') {
    slots.push({ id: 'sweep', label: 'sweep start', fallback: 'laser' });
  }
  slots.push({ id: 'deploy', label: 'deploy / replace', fallback: 'tower_placed' });
  return slots;
}
