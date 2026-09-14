import { parseSignalForgePack } from '../audio/signal-forge-pack.js';
import { setTowerRasterOverride, validateTowerRaster } from '../render/tower-raster.js';

// One promoted pack carries visual overrides, the saved sound library, and its
// bindings. In `vite dev` "save all" writes public/part-lab/pack.json through
// the dev middleware; production builds download it for a manual commit.
export const PART_LAB_PACK_VERSION = 1;
export const PART_LAB_PACK_PATH = 'part-lab/pack.json';
export const PART_LAB_PROMOTE_ENDPOINT = '/__part-lab/promote';

export function buildPartLabPack({ forge, visuals = {}, modifiedAt = new Date().toISOString() }) {
  const soundPack = forge?.exportPack?.() || { sounds: [], bindings: [], modifiedAt };
  const orderedVisuals = Object.fromEntries(Object.entries(visuals).filter(([, raster]) => raster).sort(([a], [b]) => a.localeCompare(b)));
  return { version: PART_LAB_PACK_VERSION, modifiedAt, visuals: orderedVisuals, sounds: soundPack.sounds, bindings: soundPack.bindings };
}

export function serializePartLabPack(pack) {
  return JSON.stringify(pack, null, 1);
}

export function parsePartLabPack(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('invalid part lab pack');
  if (payload.version !== PART_LAB_PACK_VERSION) throw new Error('unsupported part lab pack version');
  if (!Number.isFinite(Date.parse(payload.modifiedAt))) throw new Error('invalid part lab pack timestamp');
  const visuals = {};
  for (const [formId, raster] of Object.entries(payload.visuals || {})) {
    try { visuals[formId] = validateTowerRaster({ ...raster, formId }); } catch (error) { console.warn(`[part lab] ignoring promoted visual ${formId}:`, error); }
  }
  const soundPack = parseSignalForgePack({ version: 1, modifiedAt: payload.modifiedAt, sounds: payload.sounds || [], bindings: payload.bindings || [] });
  return { modifiedAt: payload.modifiedAt, visuals, soundPack };
}

export async function loadPromotedPartLabPack(fetchImpl = globalThis.fetch, url = `./${PART_LAB_PACK_PATH}`) {
  if (typeof fetchImpl !== 'function') return null;
  let response;
  try {
    response = await fetchImpl(url, { cache: 'no-cache' });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  if ((response.headers?.get?.('content-type') || '').toLowerCase().includes('text/html')) return null;
  try {
    return parsePartLabPack(await response.json());
  } catch (error) {
    console.warn('[part lab] promoted pack is invalid:', error);
    return null;
  }
}

export function applyPromotedVisuals(visuals) {
  for (const [formId, raster] of Object.entries(visuals || {})) setTowerRasterOverride(formId, raster);
}

// Live sound overrides for staged drafts: bind at the audio manager only, so
// nothing persists until the part lab commits through the forge.
export function applyPartLabSoundDrafts(state, audio, forge) {
  if (!audio) return;
  for (const entry of Object.values(state?.parts || {})) {
    for (const slot of entry.sound?.slots || []) {
      if (!slot.eventKey) continue;
      const assignment = slot.assignment;
      if (assignment?.source === 'signal-forge' && forge?.sounds?.has?.(assignment.soundId)) audio.bindEvent(slot.eventKey, forge.audioName(assignment.soundId));
      else if (assignment?.source === 'runtime') audio.bindEvent(slot.eventKey, assignment.eventId);
      else audio.unbindEvent(slot.eventKey);
    }
  }
}

export function restoreForgeBindings(eventKeys, audio, forge) {
  for (const eventKey of eventKeys) {
    const soundId = forge?.getBinding?.(eventKey);
    if (soundId && audio.bindEvent(eventKey, forge.audioName(soundId))) continue;
    audio.unbindEvent(eventKey);
  }
}

export async function promotePartLabPack(pack, { fetchImpl = globalThis.fetch, documentRef = globalThis.document, devServer = Boolean(import.meta.env?.DEV) } = {}) {
  const raw = serializePartLabPack(pack);
  if (devServer && typeof fetchImpl === 'function') {
    try {
      const response = await fetchImpl(PART_LAB_PROMOTE_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw });
      if (response.ok) return { promoted: true, downloaded: false, path: (await response.json().catch(() => ({})))?.path || PART_LAB_PACK_PATH };
      console.warn('[part lab] dev promotion failed:', response.status);
    } catch (error) {
      console.warn('[part lab] dev promotion unavailable:', error);
    }
  }
  if (!documentRef || typeof globalThis.URL?.createObjectURL !== 'function') throw new Error('promotion is unavailable in this environment');
  const link = documentRef.createElement('a');
  const url = globalThis.URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  link.href = url;
  link.download = 'pack.json';
  link.click();
  globalThis.URL.revokeObjectURL(url);
  return { promoted: false, downloaded: true, path: PART_LAB_PACK_PATH };
}
