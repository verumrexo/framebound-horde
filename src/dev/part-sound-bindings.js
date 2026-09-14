import { SOUND_EVENTS, getPartSoundSlots, getSoundEvent, globalSoundEventKey, partSoundEventKey } from '../audio/sound-events.js';

// Serializable sound drafts for the part lab. A target is either one tower form
// ({ id, name, type: 'form', definition }) or the shared global hook set.
export const PART_SOUND_DRAFT_SCHEMA_VERSION = 1;
export const GLOBAL_SOUND_TARGET_ID = 'global-sounds';
export const GLOBAL_SOUND_TARGET = Object.freeze({ id: GLOBAL_SOUND_TARGET_ID, name: 'global sounds', type: 'global', description: 'shared game sound hooks' });

function hasAudioSound(audio, name) {
  return Boolean(audio && name && audio.hasSound?.(name));
}

function savedAudioName(signalForge, soundId) {
  return signalForge?.audioName ? signalForge.audioName(soundId) : `forge:${soundId}`;
}

function freezeSlots(slots) {
  return Object.freeze(slots.map((slot) => Object.freeze({ ...slot, label: slot.label || slot.id, eventSlot: slot.id })));
}

export function getPartLabSoundSlots(target) {
  if (target?.type === 'global') {
    return freezeSlots(SOUND_EVENTS.map((event) => ({ id: event.id, label: event.label, fallback: event.id, category: event.category })));
  }
  return freezeSlots(getPartSoundSlots(target?.definition || target));
}

export function soundEventKeyForTarget(target, slot) {
  return target?.type === 'global' ? globalSoundEventKey(slot.eventSlot || slot.id) : partSoundEventKey(target.id, slot.eventSlot || slot.id);
}

function normalizeAssignment(assignment) {
  if (!assignment || typeof assignment !== 'object') return null;
  if (assignment.source === 'runtime' && typeof assignment.eventId === 'string') return { source: 'runtime', eventId: assignment.eventId };
  if ((assignment.source === 'signal-forge' || assignment.source === 'saved') && typeof assignment.soundId === 'string') {
    return { source: 'signal-forge', soundId: assignment.soundId };
  }
  return null;
}

function readDraftAssignment(draft, slotId) {
  if (!draft) return null;
  if (Array.isArray(draft.slots)) return draft.slots.find((slot) => slot.id === slotId)?.assignment || null;
  if (draft.slots) return draft.slots[slotId]?.assignment ?? draft.slots[slotId] ?? null;
  return draft[slotId] ?? null;
}

export function serializePartSoundDraft(target, assignments = {}) {
  const slots = getPartLabSoundSlots(target);
  return {
    schemaVersion: PART_SOUND_DRAFT_SCHEMA_VERSION,
    partId: target.id,
    partName: target.name || target.id,
    slots: slots.map((slot) => ({
      id: slot.id,
      label: slot.label,
      eventKey: soundEventKeyForTarget(target, slot),
      fallback: slot.fallback,
      assignment: normalizeAssignment(assignments instanceof Map ? assignments.get(slot.id) : readDraftAssignment(assignments, slot.id))
    }))
  };
}

// Read the live Signal Forge bindings into a draft. Broken bindings stay
// visible as missing instead of being hidden.
export function createPartSoundDraft(target, signalForge) {
  const assignments = {};
  for (const slot of getPartLabSoundSlots(target)) {
    const soundId = signalForge?.getBinding?.(soundEventKeyForTarget(target, slot));
    if (soundId) assignments[slot.id] = { source: 'signal-forge', soundId };
  }
  return serializePartSoundDraft(target, assignments);
}

export function withPartSoundAssignment(draft, slotId, assignment) {
  if (!draft?.slots?.some((entry) => entry.id === slotId)) throw new Error(`unknown part sound slot: ${slotId}`);
  return {
    ...draft,
    slots: draft.slots.map((entry) => ({ ...entry, assignment: normalizeAssignment(entry.id === slotId ? assignment : entry.assignment) }))
  };
}

// Inspect a staged slot without touching the audio manager or Signal Forge.
export function inspectPartSoundSlot(slot, assignment, { audio, signalForge } = {}) {
  const normalized = normalizeAssignment(assignment);
  if (normalized?.source === 'runtime') {
    const available = hasAudioSound(audio, normalized.eventId);
    return { status: available ? 'custom' : 'missing', source: 'runtime', soundName: available ? normalized.eventId : null,
      label: getSoundEvent(normalized.eventId)?.label || normalized.eventId, detail: available ? 'built-in runtime sound' : 'runtime sound is missing' };
  }
  if (normalized?.source === 'signal-forge') {
    const record = signalForge?.sounds?.get?.(normalized.soundId);
    const available = Boolean(record) && hasAudioSound(audio, savedAudioName(signalForge, normalized.soundId));
    return { status: available ? 'custom' : 'missing', source: 'signal-forge', soundName: available ? savedAudioName(signalForge, normalized.soundId) : null,
      label: record?.name || normalized.soundId, detail: available ? 'saved signal forge sound' : 'saved sound is missing' };
  }
  const globalName = audio?.getEventBinding?.(globalSoundEventKey(slot.fallback)) || null;
  if (globalName && hasAudioSound(audio, globalName)) {
    const globalId = signalForge?.getBinding?.(globalSoundEventKey(slot.fallback));
    const record = globalId ? signalForge?.sounds?.get?.(globalId) : null;
    return { status: 'default', source: 'global', soundName: globalName, label: record?.name || globalName,
      detail: `inherited from the global hook (${getSoundEvent(slot.fallback)?.label || slot.fallback})` };
  }
  const available = hasAudioSound(audio, slot.fallback);
  return { status: available ? 'default' : 'missing', source: 'default', soundName: available ? slot.fallback : null,
    label: getSoundEvent(slot.fallback)?.label || slot.fallback, detail: available ? 'built-in default' : 'default sound is missing' };
}

export function getAssignmentForSlot(draft, slotId) {
  return normalizeAssignment(readDraftAssignment(draft, slotId));
}

export function sortSoundRecordsNewestFirst(records) {
  const stamp = (sound) => {
    for (const key of ['modifiedAt', 'createdAt']) {
      const value = Date.parse(sound?.[key] || '');
      if (Number.isFinite(value)) return value;
    }
    return Number.NEGATIVE_INFINITY;
  };
  return [...(records || [])].sort((a, b) => (stamp(b) - stamp(a)) || String(a?.name || a?.id || '').localeCompare(String(b?.name || b?.id || '')));
}
