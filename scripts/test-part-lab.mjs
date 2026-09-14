import assert from 'node:assert/strict';
import { TOWER_DEFINITIONS } from '../src/core/tower-catalog.js';
import { DEFAULT_SOUND_RECIPES } from '../src/audio/default-sounds.js';
import { SOUND_EVENTS, getPartSoundSlots } from '../src/audio/sound-events.js';
import { parseSignalForgePack, serializeSignalForgePack } from '../src/audio/signal-forge-pack.js';
import { validateForgeSound } from '../src/audio/signal-forge-store.js';
import { RASTER_EMPTY, TOWER_RASTER_SIZE, emptyRaster, getTowerRasterOverride, rasterToRects, setTowerRasterOverride, validateTowerRaster } from '../src/render/tower-raster.js';
import { drawTowerSprite, towerSpriteMetrics } from '../src/render/tower-sprites.js';
import { flipRasterHorizontal, floodFillRaster, rasterBounds, rasterizeTowerSprite, shiftRaster, withRasterCell } from '../src/dev/tower-raster-tools.js';
import { createPartLabTargets, getPartLabCatalogRows } from '../src/dev/part-lab-window.js';
import { GLOBAL_SOUND_TARGET, createPartSoundDraft, getPartLabSoundSlots, inspectPartSoundSlot, serializePartSoundDraft, withPartSoundAssignment } from '../src/dev/part-sound-bindings.js';
import { PartLabDraftStore, getPartLabDraftState } from '../src/dev/part-lab-store.js';
import { applyPartLabSoundDrafts, buildPartLabPack, parsePartLabPack } from '../src/dev/part-lab-pack.js';

// Every built-in hook has a baked default and every form exposes only hooks the runtime fires.
const eventIds = new Set(SOUND_EVENTS.map((event) => event.id));
for (const id of eventIds) assert.ok(DEFAULT_SOUND_RECIPES[id], `${id}: missing default recipe`);
for (const definition of Object.values(TOWER_DEFINITIONS)) {
  const slots = getPartSoundSlots(definition);
  assert.ok(slots.length >= 1, `${definition.id}: no sound slots`);
  assert.equal(slots.at(-1).id, 'deploy');
  for (const slot of slots) assert.ok(eventIds.has(slot.fallback), `${definition.id}/${slot.id}: unknown fallback ${slot.fallback}`);
  const delivery = definition.attack?.delivery?.type;
  if (delivery === 'projectile') assert.ok(slots.some((slot) => slot.id === 'fire'), `${definition.id}: projectile form without fire slot`);
  if (delivery === 'hitscan') assert.ok(slots.some((slot) => slot.id === 'beam'), `${definition.id}: beam form without beam slot`);
}
assert.equal(getPartLabSoundSlots(GLOBAL_SOUND_TARGET).length, SOUND_EVENTS.length);

// Sound drafts: keys, staging, inspection and forge-first resolution.
const targets = createPartLabTargets();
const rocket = targets.get('rocket');
const draft = serializePartSoundDraft(rocket);
assert.deepEqual(draft.slots.map((slot) => slot.eventKey), ['part:rocket:fire', 'part:rocket:impact', 'part:rocket:deploy']);
assert.equal(draft.slots[0].fallback, 'rocket_launch');
const staged = withPartSoundAssignment(draft, 'impact', { source: 'saved', soundId: 'boom-1' });
assert.deepEqual(staged.slots[1].assignment, { source: 'signal-forge', soundId: 'boom-1' });
assert.equal(staged.slots[0].assignment, null);
assert.throws(() => withPartSoundAssignment(draft, 'nope', null), /unknown part sound slot/);
const audio = { sounds: new Set(['explosion', 'forge:boom-1']), bindings: new Map(),
  hasSound(name) { return this.sounds.has(name); },
  bindEvent(key, name) { if (!this.sounds.has(name)) return false; this.bindings.set(key, name); return true; },
  unbindEvent(key) { return this.bindings.delete(key); } };
const forge = { sounds: new Map([['boom-1', { id: 'boom-1', name: 'boom' }]]), bindings: new Map([['part:rocket:fire', 'boom-1']]),
  audioName: (id) => `forge:${id}`, getBinding(key) { return this.bindings.get(key) || null; } };
assert.equal(inspectPartSoundSlot(draft.slots[1], null, { audio, signalForge: forge }).status, 'default');
// Global hook bindings are inherited by every tower slot that falls back to them.
const { AudioManager } = await import('../src/audio/audio-manager.js');
const manager = new AudioManager({ context: null, storage: null });
Object.assign(manager, { available: true, sounds: new Map([['explosion', {}], ['forge:boom-1', {}]]) });
manager.bindEvent('global:explosion', 'forge:boom-1');
assert.equal(manager.resolveSoundName('part:rocket:impact', 'explosion'), 'forge:boom-1');
manager.bindEvent('part:rocket:impact', 'explosion');
assert.equal(manager.resolveSoundName('part:rocket:impact', 'explosion'), 'explosion', 'a tower slot binding wins over the global hook');
assert.equal(manager.resolveSoundName('global:explosion', 'explosion'), 'forge:boom-1');
manager.unbindEvent('global:explosion');
assert.equal(manager.resolveSoundName('part:rocket:fire', 'rocket_launch'), 'rocket_launch');
audio.getEventBinding = (key) => audio.bindings.get(key) || null;
audio.bindings.set('global:explosion', 'forge:boom-1');
const inherited = inspectPartSoundSlot(draft.slots[1], null, { audio, signalForge: forge });
assert.equal(inherited.source, 'global');
assert.equal(inherited.soundName, 'forge:boom-1');
audio.bindings.delete('global:explosion');
assert.equal(inspectPartSoundSlot(draft.slots[1], staged.slots[1].assignment, { audio, signalForge: forge }).status, 'custom');
assert.equal(inspectPartSoundSlot(draft.slots[1], { source: 'signal-forge', soundId: 'missing' }, { audio, signalForge: forge }).status, 'missing');
assert.deepEqual(createPartSoundDraft(rocket, forge).slots[0].assignment, { source: 'signal-forge', soundId: 'boom-1' });

// Draft store: normalization, persistence, discard, and live audio overrides.
const storage = new Map();
const storeApi = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
const store = new PartLabDraftStore({ storage: storeApi, targets });
store.saveSound('rocket', staged);
assert.equal(getPartLabDraftState(store.get('rocket')), 'edited');
const reloaded = new PartLabDraftStore({ storage: storeApi, targets });
assert.deepEqual(reloaded.get('rocket').sound.slots[1].assignment, { source: 'signal-forge', soundId: 'boom-1' });
applyPartLabSoundDrafts(reloaded.state, audio, forge);
assert.equal(audio.bindings.get('part:rocket:impact'), 'forge:boom-1');
assert.equal(audio.bindings.has('part:rocket:fire'), false, 'staged default must override the forge binding at runtime');
assert.throws(() => store.saveSound('unknown', staged), /unknown part lab form/);
store.markPromoted(['rocket']);
assert.equal(getPartLabDraftState(store.get('rocket')), 'saved');
store.setDone('rocket', true);
store.discard('rocket');
assert.equal(store.get('rocket').sound, null);
assert.equal(store.get('rocket').done, true);
assert.deepEqual(getPartLabCatalogRows(targets, { query: 'rocket', family: 'projectile', store }).map((row) => row.id), ['cluster', 'rocket', 'salvo', 'warhead']);
assert.equal(getPartLabCatalogRows(targets, { family: 'control' }).length, 13);

// Rasters: sampling the procedural art, editing, and the sprite override contract.
const colors = Object.fromEntries(['black', 'amber', 'mint', 'cyan', 'green', 'red', 'ink', 'dimMint', 'uiMuted'].map((key) => [key, key]));
for (const id of Object.keys(TOWER_DEFINITIONS)) {
  const raster = validateTowerRaster(rasterizeTowerSprite(id));
  const bounds = rasterBounds(raster);
  assert.ok(bounds && bounds.count >= 5, `${id}: raster missing body`);
  assert.ok(bounds.left >= -16 && bounds.top >= -16 && bounds.right <= 17 && bounds.bottom <= 17, `${id}: raster outside the sprite frame`);
  const rects = rasterToRects(raster);
  assert.ok(rects.every((rect) => Number.isInteger(rect.x) && rect.width > 0 && rect.height === 1 && rect.key), `${id}: invalid raster rects`);
  const flipped = flipRasterHorizontal(raster);
  assert.equal(rasterBounds(flipped).count, bounds.count, `${id}: mirror lost pixels`);
}
const frameRaster = rasterizeTowerSprite('frame');
const edited = withRasterCell(frameRaster, 0, 0, 'r');
assert.equal(edited.cells[0], 'r');
assert.equal(frameRaster.cells[0], RASTER_EMPTY, 'raster edits must be immutable');
assert.equal(rasterBounds(shiftRaster(frameRaster, 2, -1)).left, rasterBounds(frameRaster).left + 2);
assert.equal(rasterBounds(floodFillRaster(emptyRaster('frame'), 0, 0, 'k')).count, TOWER_RASTER_SIZE * TOWER_RASTER_SIZE);
const outsideFilled = floodFillRaster(frameRaster, 0, 0, 'k');
assert.ok(rasterBounds(outsideFilled).count > rasterBounds(frameRaster).count && rasterBounds(outsideFilled).count < TOWER_RASTER_SIZE * TOWER_RASTER_SIZE, 'fill must stop at the body');
assert.throws(() => validateTowerRaster({ ...frameRaster, cells: frameRaster.cells.slice(1) }), /invalid raster cells/);

const beforeMetrics = towerSpriteMetrics('frame');
const original = [];
drawTowerSprite({ rect: (...args) => original.push(args) }, colors, { x: 0, y: 0 }, { definitionId: 'frame' }, null, { runTick: 0 });
setTowerRasterOverride('frame', rasterizeTowerSprite('barrage'));
assert.ok(getTowerRasterOverride('frame'));
const overridden = [];
drawTowerSprite({ rect: (...args) => overridden.push(args) }, colors, { x: 0, y: 0 }, { definitionId: 'frame' }, null, { runTick: 0 });
assert.notDeepEqual(overridden, original);
assert.ok(overridden.every(([x, y, w, h]) => [x, y, w, h].every(Number.isInteger) && x >= -16 && y >= -16 && x + w <= 17 && y + h <= 17));
const tinted = [];
drawTowerSprite({ rect: (...args) => tinted.push(args) }, colors, { x: 0, y: 0 }, { definitionId: 'frame' }, { accent: 'preview', core: 'preview-core' }, { runTick: 0 });
assert.ok(tinted.every(([, , , , color]) => ['black', 'preview'].includes(color)), 'placement tint must apply to raster overrides');
assert.notEqual(towerSpriteMetrics('frame').radius, beforeMetrics.radius, 'override must invalidate cached metrics');
setTowerRasterOverride('frame', null);
const restored = [];
drawTowerSprite({ rect: (...args) => restored.push(args) }, colors, { x: 0, y: 0 }, { definitionId: 'frame' }, null, { runTick: 0 });
assert.deepEqual(restored, original, 'clearing the override must restore the procedural art');
assert.equal(towerSpriteMetrics('frame').radius, beforeMetrics.radius);

// Packs: sounds round-trip through base64 and visuals stay validated.
globalThis.btoa ??= (binary) => Buffer.from(binary, 'binary').toString('base64');
globalThis.atob ??= (encoded) => Buffer.from(encoded, 'base64').toString('binary');
const wavBytes = new Uint8Array(64).map((_, index) => index * 3 % 251);
const sound = validateForgeSound({ id: 'boom-1', schemaVersion: 1, jfxrVersion: '0.13.0', name: 'boom', recipe: { frequency: 1 }, wavBytes, sampleRate: 44100, channels: 1, duration: 0.2, peak: 0.9, createdAt: 't', modifiedAt: 't' });
const forgeRuntime = { exportPack: () => serializeSignalForgePack({ sounds: [sound], bindings: [{ eventKey: 'part:rocket:fire', soundId: 'boom-1' }], modifiedAt: '2026-01-01T00:00:00.000Z' }) };
const pack = buildPartLabPack({ forge: forgeRuntime, visuals: { frame: frameRaster, rocket: null }, modifiedAt: '2026-01-01T00:00:00.000Z' });
const parsed = parsePartLabPack(JSON.parse(JSON.stringify(pack)));
assert.deepEqual(Object.keys(parsed.visuals), ['frame']);
assert.deepEqual([...parsed.soundPack.sounds[0].wavBytes], [...wavBytes]);
assert.equal(parsed.soundPack.bindings[0].eventKey, 'part:rocket:fire');
assert.throws(() => parseSignalForgePack({ version: 1, modifiedAt: 't', sounds: [], bindings: [{ eventKey: 'part:rocket:fire', soundId: 'ghost' }] }), /invalid sound pack timestamp|dangling/);
assert.throws(() => parsePartLabPack({ version: 1, modifiedAt: '2026-01-01T00:00:00.000Z', visuals: {}, sounds: [], bindings: [{ eventKey: 'part:rocket:fire', soundId: 'ghost' }] }), /dangling binding/);

console.log('part lab: sound hooks and defaults, slot drafts, draft store overrides, raster editing and sprite override contract, and pack round-trips passed');

// Combat density curve: quiet play is untouched, a dense late game ducks along the power curve and stretches spacing.
const { COMBAT_DENSITY, combatDensityGain, combatSpacingFactor, createSoundPresentation, presentSounds } = await import('../src/app/sound-presentation.js');
assert.equal(combatDensityGain(0), 1);
assert.equal(combatDensityGain(COMBAT_DENSITY.comfortablePlaysPerSecond), 1);
assert.ok(combatDensityGain(40) < 0.5 && combatDensityGain(40) > COMBAT_DENSITY.floorGain);
assert.equal(combatDensityGain(10000), COMBAT_DENSITY.floorGain);
assert.equal(combatSpacingFactor(5), 1);
assert.equal(combatSpacingFactor(10000), COMBAT_DENSITY.maxSpacingFactor);
{
  // Steady 60 kills/second: the meter converges on ~60 plays/s and the gain ducks accordingly.
  const played = [];
  const app = {
    audio: { ready: true, manager: { available: true, playEvent: (key, fallback, options) => { played.push(options.volume); return {}; } }, presentation: createSoundPresentation() },
    ui: { frontEndScreen: 'game' },
    viewport: { logicalWidth: 640, logicalHeight: 360, camera: { x: 0, y: 0, scale: 1 } },
    game: { session: { clientId: 'me' } }
  };
  const snapshot = { phase: 'running', projectiles: [], attackFields: [], towers: [] };
  let clock = 0;
  const realNow = performance.now;
  performance.now = () => clock;
  try {
    for (let frame = 0; frame < 600; frame += 1) {
      clock += 1000 / 60;
      presentSounds(app, [{ type: 'combat.kills.recorded', payload: { x: 0, y: 0 } }], snapshot);
    }
  } finally {
    performance.now = realNow;
  }
  const load = app.audio.presentation.combatLoad;
  assert.ok(load > 45 && load < 75, `metered load ${load} should approximate 60 plays/s`);
  assert.ok(played.at(-1) < played[0], 'late plays must be quieter than the first');
  assert.ok(Math.abs(played.at(-1) - combatDensityGain(load)) < 0.05, 'volume follows the density curve');
}
console.log('combat density: comfortable play stays full, dense late game ducks and spaces spammy hooks passed');
