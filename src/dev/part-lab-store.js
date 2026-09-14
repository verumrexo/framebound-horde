import { validateTowerRaster } from '../render/tower-raster.js';
import { serializePartSoundDraft } from './part-sound-bindings.js';

// Local autosaved part lab drafts. Drafts stage visual rasters and sound slot
// assignments per form until "save all" promotes them into the shared pack.
export const PART_LAB_DRAFT_SCHEMA_VERSION = 1;
export const PART_LAB_DRAFT_STORAGE_KEY = 'framebound-horde.part-lab.drafts.v1';

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeVisual(value, formId) {
  if (!isRecord(value)) return null;
  try { return validateTowerRaster({ ...value, formId }); } catch { return null; }
}

function normalizeSound(value, target) {
  if (!isRecord(value) || !target) return null;
  try { return serializePartSoundDraft(target, value); } catch { return null; }
}

export function normalizePartLabDraftState(value, targets = null) {
  const parts = {};
  const source = isRecord(value?.parts) ? value.parts : {};
  for (const [formId, rawEntry] of Object.entries(source)) {
    if (!/^[a-z0-9_-]{1,40}$/.test(formId)) continue;
    const target = targets?.get?.(formId) || null;
    if (targets && !target) continue;
    const entry = isRecord(rawEntry) ? rawEntry : {};
    const normalized = {
      visual: normalizeVisual(entry.visual, formId),
      sound: normalizeSound(entry.sound, target),
      savedAt: typeof entry.savedAt === 'string' ? entry.savedAt : null,
      done: entry.done === true
    };
    if (normalized.visual || normalized.sound || normalized.savedAt || normalized.done) parts[formId] = normalized;
  }
  return {
    schemaVersion: PART_LAB_DRAFT_SCHEMA_VERSION,
    updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : null,
    promotedAt: typeof value?.promotedAt === 'string' ? value.promotedAt : null,
    parts
  };
}

export function getPartLabDraftState(entry) {
  if (!entry) return 'untouched';
  if (entry.savedAt) return 'saved';
  if (entry.visual || entry.sound) return 'edited';
  return 'untouched';
}

export class PartLabDraftStore {
  constructor({ storage = globalThis.localStorage, key = PART_LAB_DRAFT_STORAGE_KEY, targets = null, now = () => new Date().toISOString() } = {}) {
    this.storage = storage;
    this.key = key;
    this.targets = targets;
    this.now = now;
    this.listeners = new Set();
    this.state = this.read();
  }

  read() {
    let raw = null;
    try { raw = this.storage?.getItem?.(this.key); } catch { /* storage is optional */ }
    if (!raw) return normalizePartLabDraftState({}, this.targets);
    try { return normalizePartLabDraftState(JSON.parse(raw), this.targets); } catch { return normalizePartLabDraftState({}, this.targets); }
  }

  persist() {
    this.state.updatedAt = this.now();
    try { this.storage?.setItem?.(this.key, JSON.stringify(this.state)); } catch { /* in-memory only */ }
    for (const listener of this.listeners) listener(this.state);
    return this.state;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get(formId) {
    return this.state.parts[formId] || null;
  }

  upsert(formId) {
    if (!this.state.parts[formId]) this.state.parts[formId] = { visual: null, sound: null, savedAt: null, done: false };
    return this.state.parts[formId];
  }

  saveVisual(formId, raster) {
    const entry = this.upsert(formId);
    entry.visual = normalizeVisual(raster, formId);
    if (!entry.visual) throw new Error('invalid part lab visual draft');
    entry.savedAt = null;
    this.persist();
    return clone(entry.visual);
  }

  clearVisual(formId) {
    const entry = this.state.parts[formId];
    if (!entry) return;
    entry.visual = null;
    entry.savedAt = null;
    if (!entry.sound && !entry.done) delete this.state.parts[formId];
    this.persist();
  }

  saveSound(formId, soundDraft) {
    const target = this.targets?.get?.(formId);
    if (!target) throw new Error(`unknown part lab form: ${formId}`);
    const entry = this.upsert(formId);
    entry.sound = normalizeSound(soundDraft, target);
    if (!entry.sound) throw new Error('invalid part lab sound draft');
    entry.savedAt = null;
    this.persist();
    return clone(entry.sound);
  }

  setDone(formId, done) {
    const entry = this.upsert(formId);
    entry.done = Boolean(done);
    this.persist();
    return entry.done;
  }

  markPromoted(formIds, timestamp = this.now()) {
    for (const formId of formIds) if (this.state.parts[formId]) this.state.parts[formId].savedAt = timestamp;
    this.state.promotedAt = timestamp;
    this.persist();
  }

  discard(formId) {
    const entry = this.state.parts[formId];
    if (!entry) return false;
    delete this.state.parts[formId];
    if (entry.done) this.state.parts[formId] = { visual: null, sound: null, savedAt: null, done: true };
    this.persist();
    return true;
  }

  reset() {
    this.state = normalizePartLabDraftState({}, this.targets);
    try { this.storage?.removeItem?.(this.key); } catch { /* optional */ }
    for (const listener of this.listeners) listener(this.state);
    return this.state;
  }
}
