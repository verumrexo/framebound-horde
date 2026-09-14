import { JfxrAdapter } from '../audio/jfxr-adapter.js';
import {
  createPartSoundDraft, getAssignmentForSlot, getPartLabSoundSlots, inspectPartSoundSlot,
  serializePartSoundDraft, sortSoundRecordsNewestFirst, withPartSoundAssignment
} from './part-sound-bindings.js';
import { cancelPointerGesture } from '../app/ui-state.js';

// The Sound Lab: one focused Signal Forge per tower form (or the global hook
// set). Scratch sounds live only in this window; saving to library persists
// them; assigning a saved sound stages a slot binding for the part lab.
const CONTROL_KEYS = new Set([
  'waveform', 'attack', 'sustain', 'sustainPunch', 'decay',
  'frequency', 'frequencySweep', 'frequencyDeltaSweep',
  'repeatFrequency', 'frequencyJump1Onset', 'frequencyJump1Amount',
  'harmonics', 'harmonicsFalloff', 'vibratoDepth', 'vibratoFrequency', 'tremoloDepth', 'tremoloFrequency',
  'squareDuty', 'squareDutySweep', 'flangerOffset', 'flangerOffsetSweep',
  'bitCrush', 'bitCrushSweep', 'lowPassCutoff', 'lowPassCutoffSweep',
  'highPassCutoff', 'highPassCutoffSweep', 'compression',
  'normalization', 'amplification'
]);

const SOUND_CARD_DEFINITIONS = Object.freeze([
  { id: 'envelope', label: 'envelope', help: 'how the sound starts, holds, and fades away.',
    fields: Object.freeze(['attack', 'sustain', 'sustainPunch', 'decay']) },
  { id: 'pitch', label: 'pitch', help: 'what note the sound starts on and how that note moves.',
    fields: Object.freeze(['waveform', 'frequency', 'frequencySweep', 'frequencyDeltaSweep', 'repeatFrequency', 'frequencyJump1Onset', 'frequencyJump1Amount']) },
  { id: 'texture', label: 'texture + modulation', help: 'the wobble, grit, and little moving details in the sound.',
    fields: Object.freeze(['harmonics', 'harmonicsFalloff', 'vibratoDepth', 'vibratoFrequency', 'tremoloDepth', 'tremoloFrequency', 'squareDuty', 'squareDutySweep', 'flangerOffset', 'flangerOffsetSweep', 'bitCrush', 'bitCrushSweep']) },
  { id: 'output', label: 'filters + output', help: 'which frequencies stay, and how loud the final sound is.',
    fields: Object.freeze(['lowPassCutoff', 'lowPassCutoffSweep', 'highPassCutoff', 'highPassCutoffSweep', 'compression', 'normalization', 'amplification']) }
]);

export const PART_SOUND_CARD_FIELD_OWNERSHIP = Object.freeze(Object.fromEntries(SOUND_CARD_DEFINITIONS.map((group) => [group.id, group.fields])));
const PARAMETER_GROUPS = SOUND_CARD_DEFINITIONS.map((group) => ({ ...group, keys: new Set(group.fields) }));

export const PART_SOUND_PARAMETER_HELP = Object.freeze({
  waveform: 'the basic voice: sine is smooth, square is sharp, and noise is messy.',
  attack: 'how quickly the sound fades in. bigger means a softer start.',
  sustain: 'how long the main body of the sound hangs around.',
  sustainPunch: 'a quick extra thump at the start of the body.',
  decay: 'how long the sound takes to fade out.',
  frequency: 'the starting pitch. bigger numbers sound higher.',
  frequencySweep: 'how far the pitch slides while the sound plays.',
  frequencyDeltaSweep: 'how quickly the pitch slide changes direction.',
  repeatFrequency: 'how often the sound repeats a tiny pulse.',
  frequencyJump1Onset: 'when the sudden pitch jump happens.',
  frequencyJump1Amount: 'how big that sudden pitch jump is.',
  harmonics: 'extra higher notes layered on top of the main note.',
  harmonicsFalloff: 'how quickly those extra higher notes disappear.',
  vibratoDepth: 'how much the pitch wobbles up and down.',
  vibratoFrequency: 'how fast the pitch wobble wiggles.',
  tremoloDepth: 'how much the volume pulses on and off. 100 makes separate ticks.',
  tremoloFrequency: 'how fast the volume pulses. around 25 gives a double tick.',
  squareDuty: 'how much of each square-wave beat is switched on.',
  squareDutySweep: 'how that square-wave shape changes over time.',
  flangerOffset: 'a tiny delayed copy that makes a hollow swirl.',
  flangerOffsetSweep: 'how the hollow swirl moves while playing.',
  bitCrush: 'how many rough digital steps the sound uses.',
  bitCrushSweep: 'how that digital roughness changes over time.',
  lowPassCutoff: 'removes high, sparkly frequencies above this point.',
  lowPassCutoffSweep: 'moves that high-frequency ceiling while playing.',
  highPassCutoff: 'removes low, boomy frequencies below this point.',
  highPassCutoffSweep: 'moves that low-frequency floor while playing.',
  compression: 'squashes loud bits so the volume feels steadier.',
  normalization: 'raises the whole sound to a safer full volume.',
  amplification: 'turns the final sound up or down.'
});

export const PART_SOUND_EDITOR_INTRO = 'only this form\'s sound slots are shown. the generated library is temporary scratch space for this window; the saved library survives restarts. create or edit in scratch, then explicitly save to library before assigning a sound. save form commits slot assignments, and save all promotes those staged assignments.';
export const GLOBAL_SOUND_EDITOR_INTRO = 'these are shared game sound hooks, not tower slots. the generated library is temporary scratch space for this window; the saved library survives restarts. create or edit in scratch, then explicitly save to library before assigning a global hook. defaults remain active when a hook has no saved assignment.';

let sessionScratchSequence = 0;

function cloneRecipe(recipe) {
  return globalThis.structuredClone ? structuredClone(recipe) : JSON.parse(JSON.stringify(recipe));
}

function roundParameterValue(value, param) {
  if (param.type === 'int') return Math.round(value);
  if (!Number.isFinite(param.step) || param.step <= 0) return value;
  const decimals = Math.max(0, String(param.step).split('.')[1]?.length || 0);
  return Number((Math.round(value / param.step) * param.step).toFixed(decimals));
}

function randomParameterValue(param) {
  if (param.type === 'boolean') return Math.random() >= 0.5;
  if (param.type === 'enum') {
    const values = Object.keys(param.values || {});
    if (values.length < 2) return values[0] ?? param.value;
    const choices = values.filter((value) => value !== param.value);
    return choices[Math.floor(Math.random() * choices.length)];
  }
  if (!Number.isFinite(param.min) || !Number.isFinite(param.max)) return param.value;
  const candidate = roundParameterValue(param.min + Math.random() * (param.max - param.min), param);
  if (candidate !== param.value || param.min === param.max) return candidate;
  return roundParameterValue(param.value === param.min ? param.max : param.min, param);
}

function mutateParameterValue(param) {
  if (param.type === 'boolean') return !param.value;
  if (param.type === 'enum') {
    const values = Object.keys(param.values || {});
    if (values.length < 2) return param.value;
    return values[(values.indexOf(param.value) + 1) % values.length];
  }
  if (!Number.isFinite(param.min) || !Number.isFinite(param.max)) return param.value;
  const step = Number.isFinite(param.step) && param.step > 0 ? param.step : (param.max - param.min) * 0.05;
  const direction = Math.random() >= 0.5 ? 1 : -1;
  const current = Number(param.value);
  const candidate = Math.min(param.max, Math.max(param.min, current + direction * Math.max(step, (param.max - param.min) * 0.05)));
  if (candidate !== current) return roundParameterValue(candidate, param);
  return roundParameterValue(current === param.min ? current + step : current - step, param);
}

function cloneBytes(bytes) {
  return bytes == null ? null : new Uint8Array(bytes);
}

function scratchId(name) {
  sessionScratchSequence += 1;
  const label = String(name || 'sound').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'sound';
  const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 10);
  return `generated-${label}-${Date.now().toString(36)}-${sessionScratchSequence}-${random}`;
}

function generatedRecord({ id = null, name, recipe, rendered, sourceId = null, createdAt = new Date().toISOString() }) {
  return {
    id: id || scratchId(name),
    schemaVersion: 1,
    jfxrVersion: rendered.jfxrVersion || '0.13.0',
    name: String(name || 'untitled').toLowerCase().slice(0, 64),
    recipe: cloneRecipe(recipe),
    wavBytes: cloneBytes(rendered.wavBytes),
    samples: rendered.samples ? new Float32Array(rendered.samples) : null,
    sampleRate: rendered.sampleRate,
    channels: 1,
    duration: rendered.duration,
    peak: rendered.peak,
    sourceId,
    createdAt,
    modifiedAt: new Date().toISOString()
  };
}

function recordRendered(sound) {
  return {
    jfxrVersion: sound.jfxrVersion,
    samples: sound.samples ? new Float32Array(sound.samples) : null,
    wavBytes: cloneBytes(sound.wavBytes),
    sampleRate: sound.sampleRate,
    duration: sound.duration,
    peak: sound.peak
  };
}

function cloneDraft(draft) {
  return { ...draft, slots: draft.slots.map((slot) => ({ ...slot, assignment: slot.assignment ? { ...slot.assignment } : null })) };
}

// Space must keep typing spaces in text fields; everywhere else (buttons,
// sliders, checkboxes) it previews the draft instead of activating the control.
function isTextEntry(target) {
  if (target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT') return true;
  return target?.tagName === 'INPUT' && ['text', 'search', 'number'].includes(target.type);
}

function option(documentRef, value, label = value) {
  const entry = documentRef.createElement('option');
  entry.value = value;
  entry.textContent = label;
  return entry;
}

function button(documentRef, label, action, className = '') {
  const element = documentRef.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.className = `part-sound-button ${className}`.trim();
  element.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  };
  return element;
}

export class PartSoundEditorWindow {
  constructor(app, {
    signalForge = app?.audio?.forge,
    audio = app?.audio?.manager,
    onSave = () => {},
    onCancel = () => {},
    onChange = () => {},
    onClose = () => {},
    onNext = null,
    documentRef = globalThis.document,
    adapter = new JfxrAdapter()
  } = {}) {
    this.app = app;
    this.signalForge = signalForge;
    this.audio = audio;
    this.onSave = onSave;
    this.onCancel = onCancel;
    this.onChange = onChange;
    this.onClose = onClose;
    this.onNext = onNext;
    this.document = documentRef;
    this.adapter = adapter;
    this.overlay = null;
    this.part = null;
    this.draft = null;
    this.opened = false;
    this.busy = false;
    this.activeSlotId = null;
    this.recipe = null;
    this.rendered = null;
    this.currentSound = null;
    this.currentSoundKind = null;
    this.generatedSounds = new Map();
    this.composerOwnsSound = false;
    this.composerDirty = false;
    this.renderGeneration = 0;
    this.renderTimer = null;
    this.previewAfterRender = false;
    this.live = false;
    this.liveBinding = null;
    this.docked = false;
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
  }

  open(part, options = {}) {
    if (!part?.id) throw new Error('part sound editor needs a valid target');
    if (!this.document) throw new Error('part sound editor needs a document');
    const samePart = this.part?.id === part.id;
    const restoreComposer = samePart && Boolean(this.recipe);
    const previousSlotId = samePart ? this.activeSlotId : null;

    for (const key of ['onSave', 'onChange', 'onCancel', 'onClose', 'onNext']) {
      if (typeof options[key] === 'function') this[key] = options[key];
    }
    this.part = part;
    const initial = options.draft || createPartSoundDraft(part, this.signalForge);
    this.draft = serializePartSoundDraft(part, initial);
    this.activeSlotId = this.draft.slots.some((slot) => slot.id === previousSlotId) ? previousSlotId : (this.draft.slots[0]?.id || null);
    this.busy = false;
    if (!samePart) {
      this.recipe = null;
      this.rendered = null;
      this.currentSound = null;
      this.currentSoundKind = null;
      this.composerOwnsSound = false;
      this.composerDirty = false;
    }
    this.opened = true;
    if (this.app) {
      this.app.ui.partLabOpen = true;
      cancelPointerGesture(this.app);
    }
    if (!this.overlay) this.build();
    this.overlay.classList.add('is-open');
    this.overlay.classList.toggle('has-no-slots', this.draft.slots.length === 0);
    this.overlay.setAttribute('aria-label', `${part.name || part.id} focused signal forge`);
    this.overlay.addEventListener('keydown', this.handleKeyDown);
    this.overlay.addEventListener('keyup', this.handleKeyUp);
    this.render();
    if (this.activeSlotId) this.prepareComposer({ reset: !restoreComposer });
    else this.setStatus('this form has no custom sound hooks.');
    this.overlay.focus();
    return this;
  }

  close({ cancelled = false } = {}) {
    if (!this.opened) return;
    this.restoreLive();
    this.live = false;
    if (this.docked) this.setDocked(false);
    this.audio?.stopPreview?.();
    clearTimeout(this.renderTimer);
    this.previewAfterRender = false;
    this.opened = false;
    this.overlay.classList.remove('is-open');
    this.overlay.removeEventListener('keydown', this.handleKeyDown);
    this.overlay.removeEventListener('keyup', this.handleKeyUp);
    if (cancelled) this.onCancel?.(this.part);
    this.onClose?.(this.part, { cancelled });
  }

  handleKeyDown(event) {
    event.stopPropagation();
    if (event.key === 'Escape' || event.code === 'Escape') {
      event.preventDefault();
      this.close({ cancelled: true });
    } else if ((event.key === ' ' || event.code === 'Space') && !isTextEntry(event.target)) {
      event.preventDefault();
      this.previewDraft();
    }
  }

  // Buttons activate on the space keyup; swallow it so space never clicks anything.
  handleKeyUp(event) {
    event.stopPropagation();
    if ((event.key === ' ' || event.code === 'Space') && !isTextEntry(event.target)) event.preventDefault();
  }

  build() {
    const overlay = this.document.createElement('div');
    overlay.id = 'part-sound-editor';
    overlay.tabIndex = -1;
    overlay.innerHTML = `
      <section class="part-sound-dialog" role="dialog" aria-modal="true">
        <header class="part-sound-header">
          <div class="part-sound-title"><strong></strong><small></small></div>
          <button class="part-sound-close" type="button" aria-label="close">×</button>
        </header>
        <div class="part-sound-body">
          <p class="part-sound-intro"></p>
          <div class="part-sound-slots"></div>
          <div class="part-sound-forge-layout">
            <section class="part-sound-panel part-sound-composer">
              <h3>sound composer</h3>
              <p class="part-sound-panel-help">make a temporary sound here. changing sliders edits scratch only; nothing persistent changes until you press “save to library”.</p>
              <div class="part-sound-fields"></div>
              <div class="part-sound-actions"></div>
              <div class="part-sound-editor-state"></div>
              <canvas class="part-sound-wave" width="640" height="100"></canvas>
              <div class="part-sound-meter"></div>
            </section>
            <section class="part-sound-panel part-sound-assignment">
              <h3 class="part-sound-assignment-title">use a sound for this slot</h3>
              <p class="part-sound-panel-help part-sound-assignment-help"></p>
              <div class="part-sound-assignment-body"></div>
            </section>
            <details class="part-sound-panel part-sound-parameters">
              <summary>advanced sound shaping</summary>
              <p class="part-sound-panel-help">each card below explains its controls in plain language. sliders update the current scratch copy.</p>
              <div class="part-sound-params"></div>
            </details>
            <div class="part-sound-libraries">
              <section class="part-sound-panel part-sound-generated">
                <h3>generated sound library</h3>
                <p class="part-sound-panel-help">temporary scratch sounds for this app session. they disappear on reload and cannot be assigned until saved.</p>
                <div class="part-sound-library part-sound-generated-library"></div>
              </section>
              <section class="part-sound-panel part-sound-saved">
                <h3>saved sound library</h3>
                <p class="part-sound-panel-help">persistent signal forge sounds. listen, use one now, or make a scratch copy with “duplicate + edit”.</p>
                <div class="part-sound-library part-sound-saved-library"></div>
              </section>
            </div>
          </div>
        </div>
        <footer class="part-sound-footer">
          <span class="part-sound-status" role="status"></span>
          <button type="button" data-action="cancel">cancel</button>
          <button type="button" data-action="save-next">save form + next</button>
          <button type="button" data-action="save">save form</button>
        </footer>
      </section>
    `;
    this.title = overlay.querySelector('.part-sound-title strong');
    this.subtitle = overlay.querySelector('.part-sound-title small');
    this.intro = overlay.querySelector('.part-sound-intro');
    this.assignmentTitle = overlay.querySelector('.part-sound-assignment-title');
    this.assignmentHelp = overlay.querySelector('.part-sound-assignment-help');
    this.slotsElement = overlay.querySelector('.part-sound-slots');
    this.fields = overlay.querySelector('.part-sound-fields');
    this.actions = overlay.querySelector('.part-sound-actions');
    this.editorState = overlay.querySelector('.part-sound-editor-state');
    this.parameterGrid = overlay.querySelector('.part-sound-params');
    this.generatedLibrary = overlay.querySelector('.part-sound-generated-library');
    this.savedLibrary = overlay.querySelector('.part-sound-saved-library');
    this.assignmentBody = overlay.querySelector('.part-sound-assignment-body');
    this.waveCanvas = overlay.querySelector('.part-sound-wave');
    this.meter = overlay.querySelector('.part-sound-meter');
    this.status = overlay.querySelector('.part-sound-status');
    this.closeButton = overlay.querySelector('.part-sound-close');
    this.cancelButton = overlay.querySelector('[data-action="cancel"]');
    this.saveNextButton = overlay.querySelector('[data-action="save-next"]');
    this.saveButton = overlay.querySelector('[data-action="save"]');
    this.closeButton.onclick = () => this.close({ cancelled: true });
    this.cancelButton.onclick = () => this.close({ cancelled: true });
    this.saveButton.onclick = () => this.commit(false);
    this.saveNextButton.onclick = () => this.commit(true);

    this.nameInput = this.document.createElement('input');
    this.nameInput.type = 'text';
    this.nameInput.maxLength = 64;
    this.nameInput.placeholder = 'sound name';
    this.nameInput.oninput = () => {
      this.ensureGeneratedComposer();
      if (this.currentSoundKind === 'generated' && this.currentSound) {
        this.currentSound.name = this.nameInput.value.trim().toLowerCase().slice(0, 64) || 'untitled';
        this.generatedSounds.set(this.currentSound.id, this.currentSound);
        this.renderGeneratedSounds();
      }
      this.composerDirty = true;
      this.updateComposerState(true);
    };
    this.presetSelect = this.document.createElement('select');
    this.fields.append(
      this.makeField('name', this.nameInput, 'a short label so you can find this sound later.'),
      this.makeField('starting preset', this.presetSelect, 'a starting shape only. changing it does not save anything.')
    );
    this.actions.append(
      button(this.document, 'new from preset', () => this.newFromPreset()),
      button(this.document, 'mutate into new sound', () => this.mutate(), 'is-amber'),
      button(this.document, 'listen to draft [space]', () => this.previewDraft(), 'is-cyan'),
      button(this.document, 'stop listening', () => this.audio?.stopPreview?.(), 'is-muted'),
      button(this.document, 'save to library', () => this.saveGenerated(), 'is-pink')
    );
    this.liveButton = button(this.document, 'live audition: off', () => this.toggleLive(), 'is-amber');
    this.liveButton.title = 'bind the current draft to this hook in the running game; re-applies on every change; nothing is saved';
    this.dockButton = button(this.document, 'dock beside game', () => this.setDocked(!this.docked), 'is-cyan');
    this.dockButton.title = 'shrink this window so the game behind it is visible and playable';
    const liveRow = this.document.createElement('div');
    liveRow.className = 'part-sound-actions part-sound-live-actions';
    liveRow.append(this.liveButton, this.dockButton);
    this.actions.after(liveRow);
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'contextmenu', 'wheel']) {
      overlay.addEventListener(type, (event) => event.stopPropagation());
    }
    this.document.body.appendChild(overlay);
    this.overlay = overlay;
  }

  makeField(labelText, control, helpText = '') {
    const label = this.document.createElement('label');
    label.className = 'part-sound-field';
    const text = this.document.createElement('span');
    text.textContent = labelText;
    label.append(text);
    if (helpText) {
      const help = this.document.createElement('small');
      help.className = 'part-sound-field-help';
      help.textContent = helpText;
      label.appendChild(help);
    }
    label.appendChild(control);
    return label;
  }

  async prepareComposer({ reset = true } = {}) {
    if (!this.opened) return;
    this.setStatus('loading jfxr...');
    try {
      const presets = await this.adapter.listPresets();
      this.presetSelect.replaceChildren(...presets.map((name) => option(this.document, name)));
      this.presetSelect.value = presets.includes('laser/shoot') ? 'laser/shoot' : presets[0];
      if (reset || !this.recipe) this.recipe = await this.adapter.create(this.presetSelect.value);
      if (reset || !this.nameInput.value) {
        this.nameInput.value = this.currentSound?.name || `${this.part.id} ${this.activeSlotId || 'sound'}`.toLowerCase();
      }
      await this.refreshRecipe(false);
      this.setStatus(this.part.type === 'global'
        ? 'ready. make a scratch sound, save it, then assign it to a global hook.'
        : 'ready. make a scratch sound, save it, then assign it to this form slot.');
    } catch (error) {
      this.setStatus(`forge failed: ${error.message}`);
    }
  }

  render() {
    if (!this.draft || !this.overlay) return;
    const global = this.part.type === 'global';
    const target = global ? 'hook' : 'slot';
    this.title.textContent = `${this.part.name || this.part.id} // ${this.part.id}`;
    const count = this.draft.slots.length;
    this.subtitle.textContent = global
      ? `focused global sound hooks // ${count} runtime event${count === 1 ? '' : 's'}`
      : `focused signal forge // ${count} sound slot${count === 1 ? '' : 's'}`;
    this.intro.textContent = global ? GLOBAL_SOUND_EDITOR_INTRO : PART_SOUND_EDITOR_INTRO;
    this.assignmentTitle.textContent = `use a sound for this ${global ? 'global hook' : 'slot'}`;
    this.assignmentHelp.textContent = `only saved sounds can be assigned. save a generated scratch sound first, then choose “use for ${target}”.`;
    this.saveButton.textContent = global ? 'save global sounds' : 'save form';
    this.saveNextButton.hidden = global;
    this.renderSlotTabs();
    this.renderAssignment();
    if (this.live) this.applyLive();
    this.updateLiveButtons();
    this.renderGeneratedSounds();
    this.renderSavedSounds();
    this.updateComposerState();
    this.updateButtons();
  }

  renderSlotTabs() {
    this.slotsElement.replaceChildren();
    for (const slot of this.draft.slots) {
      const tab = button(this.document, `${slot.label}${getAssignmentForSlot(this.draft, slot.id) ? ' // assigned' : ''}`, () => {
        this.activeSlotId = slot.id;
        this.render();
      }, this.activeSlotId === slot.id ? 'is-selected' : '');
      tab.setAttribute('aria-pressed', this.activeSlotId === slot.id ? 'true' : 'false');
      this.slotsElement.appendChild(tab);
    }
  }

  renderAssignment() {
    const slot = this.draft.slots.find((entry) => entry.id === this.activeSlotId) || this.draft.slots[0];
    this.assignmentBody.replaceChildren();
    if (!slot) {
      const empty = this.document.createElement('div');
      empty.className = 'part-sound-empty';
      empty.textContent = 'this form does not make a form-specific sound in the game.';
      this.assignmentBody.appendChild(empty);
      return;
    }
    this.activeSlotId = slot.id;
    const global = this.part.type === 'global';
    const definition = getPartLabSoundSlots(this.part).find((entry) => entry.id === slot.id) || slot;
    const assignment = getAssignmentForSlot(this.draft, slot.id);
    const state = inspectPartSoundSlot(definition, assignment, { audio: this.audio, signalForge: this.signalForge });
    const copy = this.document.createElement('div');
    copy.className = `part-sound-assignment-state is-${state.status}`;
    const step = this.document.createElement('strong');
    step.textContent = global ? '1. choose this global hook' : '1. choose this slot';
    const detail = this.document.createElement('span');
    detail.textContent = `${slot.label}: ${state.label} // ${state.detail}`.toLowerCase();
    copy.append(step, detail);
    const actions = this.document.createElement('div');
    actions.className = 'part-sound-assignment-actions';
    actions.append(
      button(this.document, 'listen to slot', () => this.previewSlot(slot.id), 'is-cyan'),
      button(this.document, 'use built-in default', () => this.assignSlot(slot.id, null), 'is-danger')
    );
    if (this.currentSoundKind === 'saved' && this.currentSound) {
      actions.appendChild(button(this.document, `3. use ${this.currentSound.name} for ${global ? 'hook' : 'slot'}`,
        () => this.assignSlot(slot.id, { source: 'signal-forge', soundId: this.currentSound.id }), 'is-pink'));
    } else if (this.currentSoundKind === 'generated') {
      const scratch = this.document.createElement('div');
      scratch.className = 'part-sound-scratch-warning';
      scratch.textContent = 'this is a generated scratch sound. save to library before assigning it.';
      actions.appendChild(scratch);
    }
    const steps = this.document.createElement('div');
    steps.className = 'part-sound-assignment-steps';
    const choose = this.document.createElement('div');
    choose.textContent = global ? '2. listen or choose/create a saved sound for this shared game hook' : '2. listen or choose/create a sound in the library';
    steps.append(choose, copy);
    this.assignmentBody.append(steps, actions);
  }

  renderGeneratedSounds() {
    if (!this.generatedLibrary) return;
    this.generatedLibrary.replaceChildren();
    const sounds = sortSoundRecordsNewestFirst(this.generatedSounds.values());
    if (sounds.length === 0) {
      const empty = this.document.createElement('div');
      empty.className = 'part-sound-empty';
      empty.textContent = 'no scratch sounds yet. new from preset, mutate, or duplicate + edit creates one here.';
      this.generatedLibrary.appendChild(empty);
      return;
    }
    for (const sound of sounds) {
      const row = this.document.createElement('div');
      row.className = `part-sound-library-row is-generated${sound.id === this.currentSound?.id ? ' is-current' : ''}`;
      const copy = this.document.createElement('div');
      const name = this.document.createElement('strong');
      name.textContent = sound.name || sound.id;
      const detail = this.document.createElement('small');
      detail.textContent = `${Number(sound.duration || 0).toFixed(3)}s // session scratch // not assignable yet`;
      copy.append(name, detail);
      const actions = this.document.createElement('div');
      actions.append(
        button(this.document, 'listen', () => this.previewGenerated(sound.id), 'is-cyan'),
        button(this.document, 'edit / load', () => this.loadGenerated(sound.id), 'is-amber'),
        button(this.document, 'save to library', () => this.saveGeneratedById(sound.id), 'is-pink')
      );
      row.append(copy, actions);
      this.generatedLibrary.appendChild(row);
    }
  }

  renderSavedSounds() {
    if (!this.savedLibrary) return;
    this.savedLibrary.replaceChildren();
    const sounds = sortSoundRecordsNewestFirst(this.signalForge?.sounds?.values?.() || []);
    if (sounds.length === 0) {
      const empty = this.document.createElement('div');
      empty.className = 'part-sound-empty';
      empty.textContent = 'no saved sounds yet.';
      this.savedLibrary.appendChild(empty);
      return;
    }
    const target = this.part.type === 'global' ? 'hook' : 'slot';
    for (const sound of sounds) {
      const row = this.document.createElement('div');
      row.className = `part-sound-library-row${sound.id === this.currentSound?.id ? ' is-current' : ''}`;
      const copy = this.document.createElement('div');
      const name = this.document.createElement('strong');
      name.textContent = sound.name || sound.id;
      const detail = this.document.createElement('small');
      const uses = [...(this.signalForge?.bindings || [])].filter(([, id]) => id === sound.id).length;
      detail.textContent = `${Number(sound.duration || 0).toFixed(3)}s${uses ? ` // bound to ${uses} hook${uses === 1 ? '' : 's'}` : ''}`;
      copy.append(name, detail);
      const actions = this.document.createElement('div');
      const use = button(this.document, `use for ${target}`, () => this.assignSlot(this.activeSlotId, { source: 'signal-forge', soundId: sound.id }), 'is-pink');
      use.disabled = !this.activeSlotId;
      use.title = this.activeSlotId ? `use this sound for the chosen ${target}` : `choose a ${target} first`;
      actions.append(
        button(this.document, 'listen', () => this.previewSaved(sound.id), 'is-cyan'),
        use,
        button(this.document, 'duplicate + edit', () => this.duplicateSaved(sound.id), 'is-amber'),
        button(this.document, 'delete', () => this.deleteSaved(sound.id), 'is-danger')
      );
      row.append(copy, actions);
      this.savedLibrary.appendChild(row);
    }
  }

  async deleteSaved(soundId) {
    const sound = this.signalForge?.sounds?.get?.(soundId);
    if (!sound) return false;
    if (!this.document.defaultView?.confirm?.(`delete saved sound "${sound.name}"? hooks using it return to their defaults.`)) return false;
    try {
      await this.signalForge.deleteSound(soundId);
      if (this.currentSound?.id === soundId) {
        this.currentSound = null;
        this.currentSoundKind = null;
      }
      this.render();
      this.setStatus(`deleted ${sound.name} from the saved library.`);
      return true;
    } catch (error) {
      this.setStatus(`delete failed: ${error.message}`);
      return false;
    }
  }

  async duplicateSaved(soundId) {
    const sound = this.signalForge?.sounds?.get?.(soundId);
    if (!sound) return null;
    try {
      const copy = generatedRecord({ name: this.nextGeneratedName(`${sound.name || sound.id} copy`), recipe: sound.recipe, rendered: recordRendered(sound), sourceId: sound.id });
      this.generatedSounds.set(copy.id, copy);
      await this.loadOwnedSound(copy, 'duplicated into scratch');
      return copy;
    } catch (error) {
      this.setStatus(`duplicate failed: ${error.message}`);
      return null;
    }
  }

  nextGeneratedName(sourceName) {
    const base = String(sourceName || 'sound').trim().toLowerCase();
    const names = new Set([...this.generatedSounds.values(), ...(this.signalForge?.sounds?.values?.() || [])].map((sound) => String(sound.name || '').toLowerCase()));
    if (!names.has(base)) return base;
    let index = 2;
    while (names.has(`${base} ${index}`)) index += 1;
    return `${base} ${index}`;
  }

  async loadGenerated(soundId) {
    const sound = this.generatedSounds.get(soundId);
    if (!sound) return null;
    await this.loadOwnedSound(sound, 'loaded scratch');
    return sound;
  }

  async loadOwnedSound(sound, action = 'loaded') {
    this.generatedSounds.set(sound.id, sound);
    this.currentSound = sound;
    this.currentSoundKind = 'generated';
    this.composerOwnsSound = true;
    this.composerDirty = false;
    this.recipe = cloneRecipe(sound.recipe);
    this.nameInput.value = sound.name;
    await this.refreshRecipe(false);
    this.render();
    this.setStatus(`${action} ${sound.name}. this scratch copy is session-only; save to library to persist it.`);
  }

  assignSlot(slotId, assignment) {
    if (!slotId) return false;
    if (assignment?.source === 'signal-forge' && this.generatedSounds.has(assignment.soundId)) {
      this.setStatus('generated scratch sounds cannot be assigned. save to library first.');
      return false;
    }
    this.draft = withPartSoundAssignment(this.draft, slotId, assignment);
    this.onChange?.(cloneDraft(this.draft), { part: this.part, slotId });
    this.render();
    this.setStatus(`${slotId}: assignment staged. ${this.part.type === 'global' ? 'save global sounds persists it.' : 'save form commits it; save all promotes it.'}`);
    return true;
  }

  previewSlot(slotId) {
    const slot = this.draft?.slots?.find((entry) => entry.id === slotId);
    const definition = getPartLabSoundSlots(this.part).find((entry) => entry.id === slotId);
    if (!slot || !definition) return false;
    const assignment = getAssignmentForSlot(this.draft, slotId);
    const state = inspectPartSoundSlot(definition, assignment, { audio: this.audio, signalForge: this.signalForge });
    if (!state.soundName) {
      this.setStatus(`${slotId}: no playable sound is available.`);
      return false;
    }
    this.audio?.stopPreview?.();
    const voice = state.source === 'signal-forge' ? this.signalForge?.previewSaved?.(assignment.soundId) : this.audio?.previewSound?.(state.soundName);
    if (!voice) {
      this.setStatus(`${slotId}: preview failed.`);
      return false;
    }
    this.setStatus(`previewing ${slotId}: ${state.label}.`);
    return true;
  }

  previewSaved(soundId) {
    const sound = this.signalForge?.sounds?.get?.(soundId);
    if (!sound || !this.signalForge.previewSaved(soundId)) return false;
    this.setStatus(`previewing saved sound: ${sound.name}.`);
    return true;
  }

  async previewGenerated(soundId) {
    const sound = this.generatedSounds.get(soundId);
    if (!sound) return false;
    this.audio?.stopPreview?.();
    let buffer = null;
    if (sound.samples?.length && this.signalForge?.createAudioBuffer) {
      buffer = this.signalForge.createAudioBuffer({ samples: sound.samples, sampleRate: sound.sampleRate });
    } else if (sound.wavBytes && this.audio?.decodeAudioBytes) {
      buffer = await this.audio.decodeAudioBytes(sound.wavBytes);
    }
    if (!buffer || !this.audio?.preview) {
      this.setStatus(`preview failed for scratch sound: ${sound.name}.`);
      return false;
    }
    this.audio.preview(buffer);
    this.setStatus(`previewing generated scratch sound: ${sound.name}.`);
    return true;
  }

  renderParameters(parameters) {
    this.parameterGrid.replaceChildren();
    const usable = parameters.filter((item) => CONTROL_KEYS.has(item.key));
    const makeGroup = (label, help) => {
      const section = this.document.createElement('section');
      section.className = 'part-sound-param-group';
      const heading = this.document.createElement('h4');
      heading.textContent = label;
      const helpElement = this.document.createElement('p');
      helpElement.className = 'part-sound-param-group-help';
      helpElement.textContent = help;
      section.append(heading, helpElement);
      return section;
    };
    for (const group of PARAMETER_GROUPS) {
      const entries = usable.filter((param) => group.keys.has(param.key));
      if (!entries.length) continue;
      const section = makeGroup(group.label, group.help);
      const actions = this.document.createElement('div');
      actions.className = 'part-sound-param-group-actions';
      actions.append(
        button(this.document, 'mutate', () => this.mutateCard(group.id), 'is-amber'),
        button(this.document, 'randomize', () => this.randomizeCard(group.id), 'is-cyan')
      );
      section.appendChild(actions);
      for (const param of entries) section.appendChild(this.makeParameterRow(param));
      this.parameterGrid.appendChild(section);
    }
    const grouped = new Set(PARAMETER_GROUPS.flatMap((group) => [...group.keys]));
    const ungrouped = usable.filter((param) => !grouped.has(param.key));
    if (ungrouped.length) {
      const section = makeGroup('other controls', 'small extra knobs from the sound engine.');
      for (const param of ungrouped) section.appendChild(this.makeParameterRow(param));
      this.parameterGrid.appendChild(section);
    }
  }

  makeParameterRow(param) {
    const row = this.document.createElement('div');
    row.className = 'part-sound-param';
    const label = this.document.createElement('label');
    const name = this.document.createElement('span');
    const value = this.document.createElement('span');
    name.textContent = param.label;
    value.textContent = `${param.value}${param.unit || ''}`;
    label.append(name, value);
    const help = this.document.createElement('small');
    help.className = 'part-sound-param-help';
    help.textContent = PART_SOUND_PARAMETER_HELP[param.key] || 'this changes one small part of the sound. listen to hear what it does.';
    label.appendChild(help);
    let input;
    if (param.type === 'boolean') {
      input = this.document.createElement('input');
      input.type = 'checkbox';
      input.checked = param.value;
    } else if (param.type === 'enum') {
      input = this.document.createElement('select');
      for (const [entryValue, entryLabel] of Object.entries(param.values || {})) input.appendChild(option(this.document, entryValue, String(entryLabel).toLowerCase()));
      input.value = param.value;
    } else {
      input = this.document.createElement('input');
      input.type = 'range';
      input.min = param.min;
      input.max = param.max;
      input.step = param.step === 'any' ? 'any' : param.step;
      input.value = param.value;
    }
    const updateRecipe = () => {
      this.audio?.stopPreview?.();
      this.ensureGeneratedComposer();
      const next = param.type === 'boolean' ? input.checked : (param.type === 'enum' ? input.value : Number(input.value));
      this.recipe = { ...this.recipe, [param.key]: next };
      this.composerDirty = true;
      value.textContent = `${next}${param.unit || ''}`;
      this.updateComposerState(true);
      this.scheduleRender();
    };
    if (param.type === 'enum') input.onchange = updateRecipe;
    else input.oninput = updateRecipe;
    row.append(label, input);
    return row;
  }

  mutateCard(cardId) {
    return this.changeCardFields(cardId, mutateParameterValue, 'mutated');
  }

  randomizeCard(cardId) {
    return this.changeCardFields(cardId, randomParameterValue, 'randomized');
  }

  async changeCardFields(cardId, transform, action) {
    const fields = PART_SOUND_CARD_FIELD_OWNERSHIP[cardId];
    if (!this.recipe || !fields) return false;
    try {
      this.audio?.stopPreview?.();
      this.ensureGeneratedComposer();
      const parameters = await this.adapter.describe(this.recipe);
      const owned = new Set(fields);
      const next = cloneRecipe(this.recipe);
      for (const parameter of parameters) if (owned.has(parameter.key)) next[parameter.key] = transform(parameter);
      this.recipe = next;
      this.composerDirty = true;
      await this.refreshRecipe(true);
      if (this.currentSoundKind !== 'generated') this.captureGenerated(`${action} ${cardId}`);
      else this.render();
      return true;
    } catch (error) {
      this.setStatus(`${action} ${cardId} failed: ${error.message}`);
      return false;
    }
  }

  async refreshRecipe(autoPreview = false) {
    if (!this.recipe) return;
    this.renderParameters(await this.adapter.describe(this.recipe));
    await this.renderSound(autoPreview);
  }

  scheduleRender() {
    this.previewAfterRender = true;
    const generation = ++this.renderGeneration;
    clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(async () => {
      if (generation !== this.renderGeneration || !this.opened) return;
      await this.renderSound(true);
    }, 80);
  }

  async renderSound(autoPreview = false) {
    // Consume the pending request before awaiting so a stale render cannot leak it.
    this.previewAfterRender = false;
    if (!this.recipe) return;
    const generation = ++this.renderGeneration;
    this.setStatus('synthesizing...');
    try {
      const rendered = await this.adapter.render(this.recipe);
      if (generation !== this.renderGeneration || !this.opened) return;
      if (rendered.duration > 5) throw new Error('sound is longer than 5 seconds');
      this.rendered = rendered;
      if (this.currentSoundKind === 'generated' && this.currentSound?.id) {
        const updated = generatedRecord({ id: this.currentSound.id, name: this.nameInput.value, recipe: this.recipe, rendered, sourceId: this.currentSound.sourceId, createdAt: this.currentSound.createdAt });
        this.generatedSounds.set(updated.id, updated);
        this.currentSound = updated;
        this.renderGeneratedSounds();
      }
      if (this.live) this.applyLive();
      this.drawWaveform(rendered.samples);
      const clipping = rendered.peak > 1 ? ' // clipping' : '';
      this.meter.textContent = `${rendered.duration.toFixed(3)}s // ${rendered.sampleRate}hz // peak ${rendered.peak.toFixed(3)}${clipping}`;
      this.meter.classList.toggle('is-clipping', rendered.peak > 1);
      this.setStatus('draft rendered.');
      this.updateComposerState();
      if (autoPreview) this.previewDraft();
    } catch (error) {
      this.previewAfterRender = false;
      this.setStatus(`render failed: ${error.message}`);
    }
  }

  // Live audition: the game plays the current draft for the selected hook until
  // it is switched off. Only the audio manager's binding changes, never the forge.
  activeSlot() {
    return this.draft?.slots?.find((entry) => entry.id === this.activeSlotId) || null;
  }

  toggleLive() {
    if (this.live) {
      this.live = false;
      this.restoreLive();
      this.setStatus('live audition off. the hook is back to its saved or default sound.');
    } else {
      if (!this.rendered || !this.activeSlot()) {
        this.setStatus('render a draft and choose a slot before auditioning it live.');
        return;
      }
      this.live = true;
      this.applyLive();
      this.setStatus(`live audition on: the game now plays this draft for ${this.activeSlot().label}. changes apply as you edit.`);
    }
    this.updateLiveButtons();
  }

  applyLive() {
    const slot = this.activeSlot();
    if (!this.live || !slot || !this.rendered || !this.audio?.bindEvent || !this.signalForge?.createAudioBuffer) return;
    if (this.liveBinding && this.liveBinding.eventKey !== slot.eventKey) this.restoreLive();
    if (!this.liveBinding) {
      this.liveBinding = { eventKey: slot.eventKey, name: `live:${this.part.id}:${slot.id}`, previous: this.audio.getEventBinding?.(slot.eventKey) || null };
    }
    this.audio.replace(this.liveBinding.name, this.signalForge.createAudioBuffer(this.rendered));
    this.audio.bindEvent(slot.eventKey, this.liveBinding.name);
  }

  restoreLive() {
    const binding = this.liveBinding;
    if (!binding || !this.audio) return;
    this.liveBinding = null;
    if (binding.previous && this.audio.hasSound?.(binding.previous)) this.audio.bindEvent(binding.eventKey, binding.previous);
    else this.audio.unbindEvent?.(binding.eventKey);
    this.audio.remove?.(binding.name);
  }

  updateLiveButtons() {
    if (!this.liveButton) return;
    this.liveButton.textContent = this.live ? `live audition: on // ${this.activeSlot()?.label || 'slot'}` : 'live audition: off';
    this.liveButton.classList.toggle('is-selected', this.live);
    this.dockButton.textContent = this.docked ? 'undock // full window' : 'dock beside game';
    this.dockButton.classList.toggle('is-selected', this.docked);
  }

  // Docked, the editor is a side panel and the game keeps mouse + keyboard.
  setDocked(docked) {
    this.docked = docked;
    this.overlay?.classList.toggle('is-docked', docked);
    if (this.app) this.app.ui.partLabOpen = !docked;
    this.updateLiveButtons();
    if (docked) this.setStatus('docked. click the game to play; click here to keep editing. esc closes the editor.');
  }

  drawWaveform(samples) {
    const ctx = this.waveCanvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = this.waveCanvas;
    ctx.fillStyle = '#010405';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#123b40';
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
    ctx.strokeStyle = '#4dffb8';
    ctx.beginPath();
    const stride = Math.max(1, Math.floor(samples.length / width));
    for (let x = 0; x < width; x++) {
      let min = 1, max = -1;
      const start = x * stride;
      for (let index = start; index < Math.min(samples.length, start + stride); index++) {
        min = Math.min(min, samples[index]);
        max = Math.max(max, samples[index]);
      }
      ctx.moveTo(x, (1 - max) * height / 2);
      ctx.lineTo(x, (1 - min) * height / 2);
    }
    ctx.stroke();
  }

  previewDraft() {
    if (!this.rendered || !this.signalForge?.createAudioBuffer || !this.audio?.preview) return false;
    this.audio.stopPreview?.();
    this.audio.preview(this.signalForge.createAudioBuffer(this.rendered));
    this.setStatus(`previewing draft: ${this.nameInput.value || 'untitled'}.`);
    return true;
  }

  ensureGeneratedComposer() {
    if (this.currentSoundKind !== 'saved' || !this.currentSound) return this.currentSound;
    const copy = generatedRecord({ name: this.nextGeneratedName(`${this.currentSound.name} edit`), recipe: this.currentSound.recipe, rendered: recordRendered(this.currentSound), sourceId: this.currentSound.id });
    this.generatedSounds.set(copy.id, copy);
    this.currentSound = copy;
    this.currentSoundKind = 'generated';
    this.composerOwnsSound = true;
    this.composerDirty = true;
    this.nameInput.value = copy.name;
    this.setStatus(`editing created ${copy.name} in scratch. the saved source stays unchanged.`);
    return copy;
  }

  captureGenerated(reason = 'generated sound') {
    if (!this.rendered) return null;
    const sound = generatedRecord({ name: this.nameInput.value, recipe: this.recipe, rendered: this.rendered });
    this.generatedSounds.set(sound.id, sound);
    this.currentSound = sound;
    this.currentSoundKind = 'generated';
    this.composerOwnsSound = true;
    this.composerDirty = false;
    this.render();
    this.setStatus(`${reason}: ${sound.name} is in the session-only generated library. save to library before assigning it.`);
    return sound;
  }

  async saveGenerated({ reason = 'saved to library' } = {}) {
    if (!this.rendered || !this.signalForge) return null;
    const name = this.nameInput.value.trim();
    if (!name) {
      this.setStatus('give the generated sound a name first.');
      this.nameInput.focus();
      return null;
    }
    if (this.currentSoundKind === 'saved' && !this.composerDirty) {
      this.setStatus(`${this.currentSound.name} is already in the saved library. choose duplicate + edit to make a new scratch copy.`);
      return this.currentSound;
    }
    try {
      const generatedId = this.currentSoundKind === 'generated' ? this.currentSound?.id : null;
      const saved = await this.signalForge.saveRendered({ name, recipe: this.recipe, rendered: this.rendered });
      if (generatedId) this.generatedSounds.delete(generatedId);
      this.currentSound = saved;
      this.currentSoundKind = 'saved';
      this.composerOwnsSound = false;
      this.composerDirty = false;
      this.render();
      this.setStatus(`${reason}: ${saved.name} is persistent now. saved sounds can be assigned without changing their source.`);
      return saved;
    } catch (error) {
      this.setStatus(`save generated sound failed: ${error.message}`);
      return null;
    }
  }

  async saveGeneratedById(soundId) {
    const sound = this.generatedSounds.get(soundId);
    if (!sound) return null;
    try {
      await this.loadOwnedSound(sound, 'loaded scratch');
      return await this.saveGenerated();
    } catch (error) {
      this.setStatus(`save generated sound failed: ${error.message}`);
      return null;
    }
  }

  async newFromPreset() {
    try {
      this.recipe = await this.adapter.create(this.presetSelect.value);
      this.nameInput.value = `${this.part.id} ${this.activeSlotId || 'sound'} preset`.toLowerCase();
      this.currentSound = null;
      this.currentSoundKind = null;
      this.composerOwnsSound = false;
      this.composerDirty = true;
      await this.refreshRecipe(true);
      this.captureGenerated('new preset');
    } catch (error) {
      this.setStatus(`preset failed: ${error.message}`);
    }
  }

  async mutate() {
    if (!this.recipe) return;
    try {
      this.recipe = await this.adapter.mutate(this.recipe);
      this.nameInput.value = `${this.currentSound?.name || this.part.id} variant`.toLowerCase();
      this.currentSound = null;
      this.currentSoundKind = null;
      this.composerOwnsSound = false;
      this.composerDirty = true;
      await this.refreshRecipe(true);
      this.captureGenerated('mutated sound');
    } catch (error) {
      this.setStatus(`mutate failed: ${error.message}`);
    }
  }

  updateComposerState(dirty = this.composerDirty) {
    if (!this.editorState || !this.nameInput) return;
    this.editorState.textContent = this.currentSoundKind === 'generated'
      ? `generated scratch: ${this.currentSound.name}${dirty ? ' // changed' : ''} // session-only until save to library`
      : this.currentSoundKind === 'saved'
        ? `saved source: ${this.currentSound.name} // unchanged; duplicate + edit makes scratch`
        : `new draft${dirty ? ' // changed' : ''} // new from preset or mutate creates a generated scratch entry`;
  }

  setStatus(message) {
    if (this.status) this.status.textContent = String(message).toLowerCase();
  }

  updateButtons() {
    const hasSlots = Boolean(this.draft?.slots?.length);
    for (const element of [this.cancelButton, this.saveButton, this.saveNextButton]) {
      if (element) element.disabled = this.busy || (element !== this.cancelButton && !hasSlots);
    }
  }

  async commit(advance) {
    if (this.busy || !this.draft) return;
    this.busy = true;
    this.updateButtons();
    const draft = cloneDraft(this.draft);
    try {
      await this.onSave?.(draft, { action: advance ? 'save-next' : 'save', part: this.part });
      if (advance && this.onNext) {
        const next = await this.onNext(draft, { part: this.part });
        this.close();
        if (next?.part) this.open(next.part, { draft: next.draft });
        return;
      }
      this.close();
    } catch (error) {
      this.setStatus(`save failed: ${error.message}`);
      this.busy = false;
      this.updateButtons();
    }
  }
}
