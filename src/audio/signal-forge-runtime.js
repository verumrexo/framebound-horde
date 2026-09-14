import { DEFAULT_SOUND_RECIPES } from './default-sounds.js';
import { JfxrAdapter } from './jfxr-adapter.js';
import { newestSignalForgePack, serializeSignalForgePack } from './signal-forge-pack.js';
import { SIGNAL_FORGE_SCHEMA_VERSION, SignalForgeStore } from './signal-forge-store.js';

function slugify(value) {
  return String(value || 'sound').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'sound';
}

function randomSuffix() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}

function cloneRecipe(recipe) {
  return globalThis.structuredClone ? structuredClone(recipe) : JSON.parse(JSON.stringify(recipe));
}

function nextCopyName(sounds, sourceName) {
  const base = `${String(sourceName || 'sound').trim().toLowerCase()} copy`;
  const names = new Set([...sounds.values()].map((sound) => String(sound.name || '').toLowerCase()));
  if (!names.has(base)) return base;
  let index = 2;
  while (names.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

// Owns the saved sound library (IndexedDB), its event bindings, and the baked
// defaults. Everything audible in the game resolves through the audio manager's
// event bindings, so unbinding a hook always falls back to its default.
export class SignalForgeRuntime {
  constructor(audio, { store = new SignalForgeStore(), adapter = new JfxrAdapter() } = {}) {
    this.audio = audio;
    this.store = store;
    this.adapter = adapter;
    this.sounds = new Map();
    this.bindings = new Map();
    this.ready = false;
    this.error = null;
    this.modifiedAt = null;
    this.defaultsReady = null;
  }

  async initialize({ promotedPack = null } = {}) {
    this.defaultsReady = this.renderDefaults();
    try {
      await this.defaultsReady;
      let browserPack = { sounds: [], bindings: [], modifiedAt: null };
      try {
        browserPack = await this.store.loadPack();
      } catch (error) {
        console.warn('[signal forge] local library is unavailable:', error);
      }
      const pack = newestSignalForgePack([browserPack, promotedPack].filter(Boolean)) || browserPack;
      if (pack !== browserPack) {
        try { await this.store.replacePack(pack); } catch { /* keep running from memory */ }
      }
      this.modifiedAt = pack.modifiedAt;
      for (const record of pack.sounds) {
        try {
          this.audio.replace(this.audioName(record.id), await this.audio.decodeAudioBytes(record.wavBytes));
          this.sounds.set(record.id, record);
        } catch (error) {
          console.warn(`[signal forge] could not decode ${record.id}:`, error);
        }
      }
      for (const binding of pack.bindings) {
        if (this.audio.bindEvent(binding.eventKey, this.audioName(binding.soundId))) this.bindings.set(binding.eventKey, binding.soundId);
      }
    } catch (error) {
      this.error = error;
      console.warn('[signal forge] persistent sound pack is unavailable:', error);
    } finally {
      this.ready = true;
    }
    return this;
  }

  async renderDefaults() {
    if (!this.audio.available) return;
    await Promise.all(Object.entries(DEFAULT_SOUND_RECIPES).map(async ([id, recipe]) => {
      try {
        const rendered = await this.adapter.render(recipe);
        this.audio.replace(id, this.audio.createBuffer(rendered), { asDefault: true });
      } catch (error) {
        console.warn(`[signal forge] default sound ${id} failed to render:`, error);
      }
    }));
  }

  audioName(soundId) {
    return `forge:${soundId}`;
  }

  createAudioBuffer(rendered) {
    return this.audio.createBuffer(rendered);
  }

  async saveRendered({ name, recipe, rendered, id = null }) {
    const now = new Date().toISOString();
    const soundId = id || `${slugify(name)}-${randomSuffix()}`;
    const previous = this.sounds.get(soundId);
    const record = {
      id: soundId,
      schemaVersion: SIGNAL_FORGE_SCHEMA_VERSION,
      jfxrVersion: rendered.jfxrVersion,
      name: String(name || 'untitled').toLowerCase().slice(0, 64),
      recipe: cloneRecipe(recipe),
      wavBytes: new Uint8Array(rendered.wavBytes),
      sampleRate: rendered.sampleRate,
      channels: 1,
      duration: rendered.duration,
      peak: rendered.peak,
      createdAt: previous?.createdAt || now,
      modifiedAt: now
    };
    await this.store.putSound(record);
    this.audio.replace(this.audioName(soundId), this.createAudioBuffer(rendered));
    this.sounds.set(soundId, record);
    this.modifiedAt = record.modifiedAt;
    return record;
  }

  async duplicateSound(soundId, { name = null } = {}) {
    const source = this.sounds.get(soundId);
    if (!source) throw new Error(`unknown forged sound: ${soundId}`);
    const copyName = String(name || nextCopyName(this.sounds, source.name)).toLowerCase().slice(0, 64);
    let copyId = `${slugify(copyName)}-${randomSuffix()}`;
    while (this.sounds.has(copyId)) copyId = `${slugify(copyName)}-${randomSuffix()}`;
    const now = new Date().toISOString();
    const record = { ...source, id: copyId, name: copyName, recipe: cloneRecipe(source.recipe), wavBytes: new Uint8Array(source.wavBytes), createdAt: now, modifiedAt: now };
    await this.store.putSound(record);
    this.audio.replace(this.audioName(record.id), await this.audio.decodeAudioBytes(record.wavBytes));
    this.sounds.set(record.id, record);
    this.modifiedAt = record.modifiedAt;
    return record;
  }

  async bind(eventKey, soundId) {
    if (!this.sounds.has(soundId)) throw new Error(`unknown forged sound: ${soundId}`);
    const binding = { eventKey, soundId, modifiedAt: new Date().toISOString() };
    await this.store.putBinding(binding);
    if (!this.audio.bindEvent(eventKey, this.audioName(soundId))) throw new Error(`failed to bind ${eventKey}`);
    this.bindings.set(eventKey, soundId);
    this.modifiedAt = binding.modifiedAt;
    return binding;
  }

  async unbind(eventKey) {
    await this.store.deleteBinding(eventKey);
    this.audio.unbindEvent(eventKey);
    this.bindings.delete(eventKey);
    this.modifiedAt = new Date().toISOString();
  }

  async deleteSound(soundId) {
    if (!this.sounds.has(soundId)) return false;
    for (const [eventKey, bound] of [...this.bindings]) if (bound === soundId) await this.unbind(eventKey);
    await this.store.deleteSound(soundId);
    this.audio.remove(this.audioName(soundId));
    this.sounds.delete(soundId);
    this.modifiedAt = new Date().toISOString();
    return true;
  }

  getBinding(eventKey) {
    return this.bindings.get(eventKey) || null;
  }

  previewSaved(soundId, options = {}) {
    if (!this.sounds.has(soundId)) return false;
    return Boolean(this.audio.previewSound(this.audioName(soundId), options));
  }

  exportPack() {
    return serializeSignalForgePack({
      sounds: this.sounds.values(),
      bindings: [...this.bindings].map(([eventKey, soundId]) => ({ eventKey, soundId })),
      modifiedAt: this.modifiedAt || new Date().toISOString()
    });
  }
}
