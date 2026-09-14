import { MAX_FORGE_PACK_BYTES, validateForgeBinding, validateForgeSound } from './signal-forge-store.js';

// Portable JSON form of the saved library: wav bytes travel as base64 so one
// pack file can be promoted into public/part-lab and loaded on every machine.
export const SIGNAL_FORGE_PACK_VERSION = 1;

export function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(encoded) {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function serializeSignalForgePack({ sounds, bindings, modifiedAt }) {
  return {
    version: SIGNAL_FORGE_PACK_VERSION,
    modifiedAt,
    sounds: [...sounds]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(({ wavBytes, samples, ...sound }) => ({ ...sound, wavBase64: bytesToBase64(wavBytes) })),
    bindings: [...bindings].sort((a, b) => a.eventKey.localeCompare(b.eventKey)).map(({ eventKey, soundId }) => ({ eventKey, soundId }))
  };
}

export function parseSignalForgePack(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('invalid sound pack');
  if (payload.version !== SIGNAL_FORGE_PACK_VERSION) throw new Error('unsupported sound pack version');
  if (!Number.isFinite(Date.parse(payload.modifiedAt))) throw new Error('invalid sound pack timestamp');
  if (!Array.isArray(payload.sounds) || !Array.isArray(payload.bindings)) throw new Error('invalid sound pack collections');
  let totalBytes = 0;
  const sounds = payload.sounds.map((entry) => {
    const { wavBase64, ...record } = entry;
    if (typeof wavBase64 !== 'string') throw new Error('missing sound data');
    record.wavBytes = base64ToBytes(wavBase64);
    totalBytes += record.wavBytes.byteLength;
    return validateForgeSound(record);
  });
  if (totalBytes > MAX_FORGE_PACK_BYTES) throw new Error('sound pack is too large');
  const soundIds = new Set(sounds.map((sound) => sound.id));
  const bindings = payload.bindings.map(validateForgeBinding);
  if (bindings.some((binding) => !soundIds.has(binding.soundId))) throw new Error('sound pack contains a dangling binding');
  return { sounds, bindings, modifiedAt: payload.modifiedAt };
}

export function newestSignalForgePack(packs) {
  return [...packs].filter((pack) => Number.isFinite(Date.parse(pack?.modifiedAt))).sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt))[0] || null;
}
