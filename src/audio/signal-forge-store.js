// IndexedDB persistence for the saved Signal Forge library and its bindings.
export const SIGNAL_FORGE_DB_NAME = 'framebound-horde-signal-forge';
export const SIGNAL_FORGE_SCHEMA_VERSION = 1;
export const SIGNAL_FORGE_DB_VERSION = 1;
export const MAX_FORGE_SOUND_BYTES = 2 * 1024 * 1024;
export const MAX_FORGE_PACK_BYTES = 32 * 1024 * 1024;
export const MAX_FORGE_DURATION_SECONDS = 5;

const SOUND_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const EVENT_KEY = /^(global|part):[a-zA-Z0-9_-]+(?::[a-z0-9_-]+)?$/;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexeddb request failed'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('indexeddb transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('indexeddb transaction aborted'));
  });
}

export function validateForgeSound(record) {
  if (!record || typeof record !== 'object') throw new Error('sound record must be an object');
  if (!SOUND_ID.test(record.id || '')) throw new Error('invalid sound id');
  if (record.schemaVersion !== SIGNAL_FORGE_SCHEMA_VERSION) throw new Error('unsupported sound schema');
  if (record.jfxrVersion !== '0.13.0') throw new Error('unsupported jfxr version');
  if (!record.recipe || typeof record.recipe !== 'object') throw new Error('missing jfxr recipe');
  const byteLength = record.wavBytes?.byteLength;
  if (!Number.isInteger(byteLength) || byteLength <= 44 || byteLength > MAX_FORGE_SOUND_BYTES) throw new Error('invalid wav size');
  if (!Number.isFinite(record.duration) || record.duration <= 0 || record.duration > MAX_FORGE_DURATION_SECONDS) throw new Error('invalid sound duration');
  if (!Number.isFinite(record.peak) || record.peak < 0 || record.peak > 2) throw new Error('invalid sound peak');
  return record;
}

export function validateForgeBinding(binding) {
  if (!binding || typeof binding !== 'object') throw new Error('binding must be an object');
  if (!EVENT_KEY.test(binding.eventKey || '')) throw new Error('invalid event key');
  if (!SOUND_ID.test(binding.soundId || '')) throw new Error('invalid binding sound id');
  return binding;
}

export class SignalForgeStore {
  constructor(indexedDb = globalThis.indexedDB) {
    this.indexedDb = indexedDb;
    this.dbPromise = null;
  }

  open() {
    if (!this.indexedDb) return Promise.reject(new Error('indexeddb is unavailable'));
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const request = this.indexedDb.open(SIGNAL_FORGE_DB_NAME, SIGNAL_FORGE_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('sounds')) db.createObjectStore('sounds', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('bindings')) db.createObjectStore('bindings', { keyPath: 'eventKey' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('failed to open signal forge storage'));
    });
    return this.dbPromise;
  }

  async getAll(storeName) {
    const db = await this.open();
    return requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
  }

  async loadPack() {
    const [sounds, bindings, metadata] = await Promise.all([this.getAll('sounds'), this.getAll('bindings'), this.getAll('meta')]);
    let totalBytes = 0;
    const validSounds = [];
    for (const sound of sounds) {
      try {
        validateForgeSound(sound);
        totalBytes += sound.wavBytes.byteLength;
        if (totalBytes > MAX_FORGE_PACK_BYTES) throw new Error('sound pack is too large');
        validSounds.push(sound);
      } catch (error) {
        console.warn(`[signal forge] ignoring corrupt sound ${sound?.id || '<unknown>'}:`, error);
      }
    }
    const soundIds = new Set(validSounds.map((sound) => sound.id));
    const validBindings = bindings.filter((binding) => {
      try {
        validateForgeBinding(binding);
        return soundIds.has(binding.soundId);
      } catch {
        return false;
      }
    });
    return { sounds: validSounds, bindings: validBindings, modifiedAt: metadata.find((entry) => entry.id === 'pack')?.modifiedAt || null };
  }

  touch(transaction, modifiedAt = new Date().toISOString()) {
    transaction.objectStore('meta').put({ id: 'pack', modifiedAt });
    return modifiedAt;
  }

  async putSound(record) {
    validateForgeSound(record);
    const existing = await this.getAll('sounds');
    const totalBytes = existing.reduce((sum, sound) => (sound.id === record.id ? sum : sum + (sound.wavBytes?.byteLength || 0)), record.wavBytes.byteLength);
    if (totalBytes > MAX_FORGE_PACK_BYTES) throw new Error('sound pack is too large');
    const db = await this.open();
    const transaction = db.transaction(['sounds', 'meta'], 'readwrite');
    transaction.objectStore('sounds').put(record);
    this.touch(transaction, record.modifiedAt);
    await transactionDone(transaction);
    return record;
  }

  async putBinding(binding) {
    validateForgeBinding(binding);
    const db = await this.open();
    const transaction = db.transaction(['bindings', 'meta'], 'readwrite');
    transaction.objectStore('bindings').put(binding);
    this.touch(transaction, binding.modifiedAt);
    await transactionDone(transaction);
    return binding;
  }

  async deleteBinding(eventKey) {
    const db = await this.open();
    const transaction = db.transaction(['bindings', 'meta'], 'readwrite');
    transaction.objectStore('bindings').delete(eventKey);
    this.touch(transaction);
    await transactionDone(transaction);
  }

  async deleteSound(soundId) {
    const db = await this.open();
    const transaction = db.transaction(['sounds', 'meta'], 'readwrite');
    transaction.objectStore('sounds').delete(soundId);
    this.touch(transaction);
    await transactionDone(transaction);
  }

  async replacePack(pack) {
    const sounds = pack.sounds.map(validateForgeSound);
    const soundIds = new Set(sounds.map((sound) => sound.id));
    const bindings = pack.bindings.map(validateForgeBinding);
    if (bindings.some((binding) => !soundIds.has(binding.soundId))) throw new Error('sound pack contains a dangling binding');
    const db = await this.open();
    const transaction = db.transaction(['sounds', 'bindings', 'meta'], 'readwrite');
    transaction.objectStore('sounds').clear();
    transaction.objectStore('bindings').clear();
    for (const sound of sounds) transaction.objectStore('sounds').put(sound);
    for (const binding of bindings) transaction.objectStore('bindings').put(binding);
    this.touch(transaction, pack.modifiedAt);
    await transactionDone(transaction);
  }
}
