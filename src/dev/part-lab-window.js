import { enterTestField } from '../app/navigation.js';
import { switchTestTowerForm } from '../app/tower-actions.js';
import { cancelPointerGesture, setStatus } from '../app/ui-state.js';
import { CONTROL_FORMS, TOWER_DEFINITIONS } from '../core/tower-catalog.js';
import { RASTER_EMPTY, RASTER_PALETTE, TOWER_RASTER_ORIGIN, getTowerRasterOverride, setTowerRasterOverride } from '../render/tower-raster.js';
import { rasterizeTowerSprite } from './tower-raster-tools.js';
import { PartSoundEditorWindow } from './part-sound-editor.js';
import { GLOBAL_SOUND_TARGET, createPartSoundDraft, getPartLabSoundSlots, soundEventKeyForTarget } from './part-sound-bindings.js';
import { PartLabDraftStore, getPartLabDraftState } from './part-lab-store.js';
import { applyPartLabSoundDrafts, buildPartLabPack, promotePartLabPack, restoreForgeBindings } from './part-lab-pack.js';
import { TowerVisualEditorWindow } from './tower-visual-editor.js';

// The part lab catalog: every tower form with its visual override and sound
// slots. Editors stage drafts locally; "save all" is the only promotion.
export const PART_LAB_FAMILIES = Object.freeze({
  projectile: 'projectile',
  hitscan: 'beam',
  persistent: 'sweep',
  control: 'control',
  infrastructure: 'infrastructure',
  support: 'network support'
});

export function partLabFamily(definition) {
  if (CONTROL_FORMS.includes(definition.id)) return 'control';
  const delivery = definition.attack?.delivery?.type;
  if (delivery) return delivery;
  return definition.role === 'infrastructure' ? 'infrastructure' : 'support';
}

export function createPartLabTargets(catalog = TOWER_DEFINITIONS) {
  return new Map(Object.values(catalog).map((definition) => [definition.id, {
    id: definition.id,
    name: String(definition.label || definition.id).toLowerCase(),
    type: 'form',
    definition,
    family: partLabFamily(definition),
    role: String(definition.role || '').toLowerCase(),
    description: Array.isArray(definition.description) ? definition.description.join(' // ') : String(definition.description || '')
  }]));
}

export function getPartLabCatalogRows(targets, { query = '', family = 'all', store = null } = {}) {
  const needle = String(query || '').trim().toLowerCase();
  return [...targets.values()]
    .filter((target) => {
      const haystack = `${target.id} ${target.name} ${target.role} ${target.description} ${target.family}`.toLowerCase();
      return (!needle || haystack.includes(needle)) && (family === 'all' || target.family === family);
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((target) => ({ ...target, state: getPartLabDraftState(store?.get?.(target.id)), done: store?.get?.(target.id)?.done === true, draft: store?.get?.(target.id) || null }));
}

function button(documentRef, label, action, className = '') {
  const element = documentRef.createElement('button');
  element.type = 'button';
  element.className = `part-lab-button ${className}`.trim();
  element.textContent = label;
  element.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  });
  return element;
}

export class PartLabWindow {
  constructor(app, { documentRef = globalThis.document, targets = createPartLabTargets(), store = null, promotedVisuals = {} } = {}) {
    this.app = app;
    this.document = documentRef;
    this.targets = targets;
    this.store = store || new PartLabDraftStore({ targets });
    this.promotedVisuals = { ...promotedVisuals };
    this.active = false;
    this.closing = false;
    this.statusMessage = '';
    this.globalSoundTarget = GLOBAL_SOUND_TARGET;
    this.globalSoundDraft = null;
    this.soundEditor = new PartSoundEditorWindow(app, { documentRef });
    this.visualEditor = new TowerVisualEditorWindow(app, { documentRef });
    this.build();
    this.store.subscribe(() => this.renderCatalog());
    this.applyStoredVisualDrafts();
  }

  get forge() { return this.app?.audio?.forge; }
  get audio() { return this.app?.audio?.manager; }

  build() {
    if (!this.document?.body) return;
    this.overlay = this.document.createElement('div');
    this.overlay.id = 'part-lab-window';
    this.overlay.tabIndex = -1;
    this.overlay.innerHTML = `
      <main class="part-lab-panel" role="dialog" aria-modal="true" aria-label="part lab">
        <header class="part-lab-header">
          <div><div class="ui-kicker">development tools</div><h2>part lab</h2></div>
          <div class="part-lab-header-copy">edit one form's look and sounds, test it, then promote everything together with save all.</div>
          <button class="part-lab-close" type="button" aria-label="close">×</button>
        </header>
        <div class="part-lab-toolbar">
          <input class="part-lab-search" type="search" placeholder="search forms" aria-label="search forms">
          <select class="part-lab-type" aria-label="filter by family"></select>
          <button class="part-lab-button" data-action="dirty" type="button">next dirty</button>
          <button class="part-lab-button part-lab-global-sounds" data-action="global-sounds" type="button">global sounds</button>
          <label class="part-lab-volume"><span>master</span><input type="range" min="0" max="1" step="0.05" aria-label="master volume"></label>
          <label class="part-lab-volume part-lab-music-volume"><span>music</span><input type="range" min="0" max="1" step="0.05" aria-label="music volume"></label>
          <span class="part-lab-count" role="status"></span>
        </div>
        <section class="part-lab-list" aria-live="polite"></section>
        <footer class="part-lab-footer">
          <span class="part-lab-status" role="status"></span>
          <button class="part-lab-button part-lab-reset" data-action="reset" type="button">reset drafts</button>
          <button class="part-lab-button part-lab-save-all" data-action="save-all" type="button">save all</button>
        </footer>
      </main>
    `;
    this.search = this.overlay.querySelector('.part-lab-search');
    this.type = this.overlay.querySelector('.part-lab-type');
    this.list = this.overlay.querySelector('.part-lab-list');
    this.count = this.overlay.querySelector('.part-lab-count');
    this.status = this.overlay.querySelector('.part-lab-status');
    this.volume = this.overlay.querySelector('.part-lab-volume:not(.part-lab-music-volume) input');
    this.musicVolume = this.overlay.querySelector('.part-lab-music-volume input');
    this.overlay.querySelector('.part-lab-close').onclick = () => this.close();
    this.search.oninput = () => this.renderCatalog();
    this.type.onchange = () => this.renderCatalog();
    this.volume.oninput = () => this.audio?.setMasterVolume(Number(this.volume.value));
    this.musicVolume.oninput = () => this.audio?.setMusicVolume(Number(this.musicVolume.value));
    this.overlay.querySelector('[data-action="dirty"]').onclick = () => {
      const next = this.nextMatching((id) => Boolean(this.store.get(id)?.visual || this.store.get(id)?.sound));
      if (next) this.openSound(next);
    };
    this.overlay.querySelector('[data-action="global-sounds"]').onclick = () => this.openGlobalSounds();
    this.overlay.querySelector('[data-action="reset"]').onclick = () => this.resetDrafts();
    this.overlay.querySelector('[data-action="save-all"]').onclick = () => this.saveAll();
    this.overlay.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); this.close(); }
    });
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'contextmenu', 'wheel']) this.overlay.addEventListener(type, (event) => event.stopPropagation());
    this.document.body.appendChild(this.overlay);
    const makeOption = (label, value) => {
      const option = this.document.createElement('option');
      option.value = value;
      option.textContent = label;
      return option;
    };
    const families = [...new Set([...this.targets.values()].map((target) => target.family))].sort();
    this.type.replaceChildren(makeOption('all families', 'all'), ...families.map((family) => makeOption(PART_LAB_FAMILIES[family] || family, family)));
  }

  open() {
    if (!this.overlay) return this;
    this.active = true;
    this.app.ui.partLabOpen = true;
    this.app.ui.devToolsOpen = false;
    cancelPointerGesture(this.app);
    this.overlay.classList.add('is-open');
    if (this.audio) {
      this.volume.value = String(this.audio.masterVolume);
      this.musicVolume.value = String(this.audio.musicVolume);
    }
    this.renderCatalog();
    this.overlay.focus();
    return this;
  }

  close() {
    this.closing = true;
    try {
      if (this.soundEditor.opened) this.soundEditor.close({ cancelled: true });
      if (this.visualEditor.opened) this.visualEditor.close({ cancelled: true });
      this.active = false;
      this.overlay?.classList.remove('is-open');
      this.app.ui.partLabOpen = false;
      cancelPointerGesture(this.app);
    } finally {
      this.closing = false;
    }
  }

  toggle() {
    if (this.active) this.close();
    else this.open();
  }

  hideCatalog() {
    this.active = false;
    this.overlay?.classList.remove('is-open');
  }

  renderCatalog() {
    if (!this.list) return;
    const rows = getPartLabCatalogRows(this.targets, { query: this.search?.value, family: this.type?.value || 'all', store: this.store });
    this.count.textContent = `${rows.length}/${this.targets.size} forms`;
    this.list.replaceChildren(...rows.map((row) => this.renderRow(row)));
    this.setStatus(this.statusMessage);
  }

  renderRow(row) {
    const card = this.document.createElement('article');
    card.className = `part-lab-card${row.done ? ' is-done' : ''}`;
    const portrait = this.document.createElement('canvas');
    portrait.className = 'part-lab-portrait';
    portrait.width = portrait.height = 68;
    this.drawPortrait(portrait, row.id);
    const copy = this.document.createElement('div');
    copy.className = 'part-lab-card-copy';
    const title = this.document.createElement('strong');
    title.textContent = row.name;
    const meta = this.document.createElement('small');
    const slots = getPartLabSoundSlots(row).map((slot) => slot.label).join(', ');
    meta.textContent = `${row.id} // ${PART_LAB_FAMILIES[row.family] || row.family}${row.role ? ` // ${row.role}` : ''} // slots: ${slots}`;
    const description = this.document.createElement('p');
    description.textContent = row.description || 'no description';
    copy.append(title, meta, description);
    const badges = this.document.createElement('div');
    badges.className = 'part-lab-badges';
    const badge = this.document.createElement('span');
    badge.className = `part-lab-badge is-${row.state}`;
    badge.textContent = row.state;
    badges.appendChild(badge);
    if (getTowerRasterOverride(row.id)) {
      const visual = this.document.createElement('span');
      visual.className = 'part-lab-badge is-visual';
      visual.textContent = row.draft?.visual ? 'raster draft' : 'raster promoted';
      badges.appendChild(visual);
    }
    const actions = this.document.createElement('div');
    actions.className = 'part-lab-card-actions';
    const doneButton = button(this.document, 'done', () => this.toggleDone(row.id), `part-lab-done${row.done ? ' is-selected' : ''}`);
    doneButton.setAttribute('aria-pressed', String(row.done));
    actions.append(
      doneButton,
      button(this.document, 'visual', () => this.openVisual(row.id)),
      button(this.document, 'sound', () => this.openSound(row.id)),
      button(this.document, 'test field', () => this.openTest(row.id), 'is-accent')
    );
    if (row.draft?.visual || row.draft?.sound) actions.appendChild(button(this.document, 'discard', () => this.discard(row.id), 'is-danger'));
    card.append(portrait, copy, badges, actions);
    return card;
  }

  drawPortrait(canvas, formId) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#010607';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const raster = getTowerRasterOverride(formId) || rasterizeTowerSprite(formId);
    const scale = 2;
    for (let row = 0; row < raster.size; row += 1) {
      for (let column = 0; column < raster.size; column += 1) {
        const char = raster.cells[row * raster.size + column];
        if (char === RASTER_EMPTY) continue;
        ctx.fillStyle = RASTER_PALETTE.find((entry) => entry.char === char)?.css || '#fff';
        ctx.fillRect(canvas.width / 2 + (column - TOWER_RASTER_ORIGIN) * scale, canvas.height / 2 + (row - TOWER_RASTER_ORIGIN) * scale, scale, scale);
      }
    }
  }

  toggleDone(formId) {
    const next = this.store.get(formId)?.done !== true;
    this.store.setDone(formId, next);
    this.setStatus(`${formId}: marked ${next ? 'done' : 'not done'}.`);
    return next;
  }

  openVisual(formId) {
    const target = this.targets.get(formId);
    if (!target) return;
    this.hideCatalog();
    try {
      this.visualEditor.open(target.definition, {
        draft: this.store.get(formId)?.visual || getTowerRasterOverride(formId) || null,
        onDraftChange: (raster) => this.stageVisual(formId, raster, true),
        onSave: (raster) => this.stageVisual(formId, raster),
        onDiscard: () => this.discardVisual(formId),
        onNext: () => {
          const next = this.nextFormId(formId);
          return next ? { form: this.targets.get(next).definition, draft: this.store.get(next)?.visual || getTowerRasterOverride(next) || null } : null;
        },
        onClose: () => { if (!this.closing) this.open(); }
      });
    } catch (error) {
      this.setStatus(`${formId}: visual editor failed: ${error.message || 'unknown error'}`);
      if (!this.closing) this.open();
    }
  }

  openSound(formId) {
    const target = this.targets.get(formId);
    if (!target) return;
    this.hideCatalog();
    try {
      this.soundEditor.open(target, {
        draft: this.store.get(formId)?.sound || undefined,
        onChange: (draft) => this.stageSound(formId, draft),
        onSave: (draft, meta) => {
          this.stageSound(formId, draft);
          if (meta?.action === 'save' && !this.closing) this.open();
        },
        onNext: () => {
          const next = this.nextFormId(formId);
          return next ? { part: this.targets.get(next), draft: this.store.get(next)?.sound || undefined } : null;
        },
        onCancel: () => { if (!this.closing) this.open(); }
      });
    } catch (error) {
      this.setStatus(`${formId}: sound editor failed: ${error.message || 'unknown error'}`);
      if (!this.closing) this.open();
    }
  }

  openGlobalSounds() {
    this.hideCatalog();
    this.globalSoundDraft = createPartSoundDraft(this.globalSoundTarget, this.forge);
    this.soundEditor.open(this.globalSoundTarget, {
      draft: this.globalSoundDraft,
      onChange: (draft) => { this.globalSoundDraft = draft; },
      onSave: async (draft) => {
        await this.saveGlobalSoundDraft(draft);
        if (!this.closing) this.open();
      },
      onCancel: () => { if (!this.closing) this.open(); }
    });
  }

  openTest(formId) {
    this.close();
    enterTestField(this.app);
    if (this.app.game.sessionMode !== 'test') return;
    switchTestTowerForm(this.app, formId);
    setStatus(this.app, `${formId} in the test field // f3 reopens the part lab`, 3000);
  }

  stageVisual(formId, raster, live = false) {
    this.store.saveVisual(formId, raster);
    setTowerRasterOverride(formId, raster);
    if (!live) this.setStatus(`${formId}: visual override staged. save all promotes it.`);
  }

  discardVisual(formId) {
    this.store.clearVisual(formId);
    setTowerRasterOverride(formId, this.promotedVisuals[formId] || null);
    this.setStatus(`${formId}: override discarded${this.promotedVisuals[formId] ? '; the promoted raster is showing' : '; the original art is back'}.`);
  }

  stageSound(formId, draft) {
    this.store.saveSound(formId, draft);
    applyPartLabSoundDrafts(this.store.state, this.audio, this.forge);
    this.setStatus(`${formId}: sound draft autosaved.`);
  }

  async saveGlobalSoundDraft(draft) {
    if (!this.forge) throw new Error('signal forge is unavailable');
    for (const slot of draft?.slots || []) {
      if (slot.assignment?.source === 'signal-forge') {
        if (!this.forge.sounds.has(slot.assignment.soundId)) throw new Error(`saved sound is missing: ${slot.assignment.soundId}`);
        await this.forge.bind(slot.eventKey, slot.assignment.soundId);
      } else {
        if (this.forge.getBinding(slot.eventKey)) await this.forge.unbind(slot.eventKey);
        this.audio?.unbindEvent(slot.eventKey);
        if (slot.assignment?.source === 'runtime') this.audio?.bindEvent(slot.eventKey, slot.assignment.eventId);
      }
    }
    this.globalSoundDraft = draft;
    this.setStatus('global sounds saved to the library. save all promotes them into the pack.');
    return draft;
  }

  applyStoredVisualDrafts() {
    for (const [formId, entry] of Object.entries(this.store.state.parts)) {
      if (entry.visual) {
        try { setTowerRasterOverride(formId, entry.visual); } catch { /* normalize already filtered bad drafts */ }
      }
    }
  }

  applyStoredSoundDrafts() {
    applyPartLabSoundDrafts(this.store.state, this.audio, this.forge);
  }

  formEventKeys(formId) {
    const target = this.targets.get(formId);
    return target ? getPartLabSoundSlots(target).map((slot) => soundEventKeyForTarget(target, slot)) : [];
  }

  nextFormId(current) {
    const ids = [...this.targets.keys()];
    const start = Math.max(0, ids.indexOf(current));
    return ids[(start + 1) % ids.length] || null;
  }

  nextMatching(predicate) {
    return [...this.targets.keys()].find(predicate) || null;
  }

  discard(formId) {
    if (!this.document.defaultView?.confirm?.(`discard ${formId} drafts?`)) return;
    this.store.discard(formId);
    setTowerRasterOverride(formId, this.promotedVisuals[formId] || null);
    if (this.audio) restoreForgeBindings(this.formEventKeys(formId), this.audio, this.forge);
    this.setStatus(`${formId}: drafts discarded.`);
  }

  resetDrafts() {
    if (!this.document.defaultView?.confirm?.('reset every part lab draft?')) return;
    this.store.reset();
    for (const formId of this.targets.keys()) {
      setTowerRasterOverride(formId, this.promotedVisuals[formId] || null);
      if (this.audio) restoreForgeBindings(this.formEventKeys(formId), this.audio, this.forge);
    }
    this.setStatus('all drafts reset.');
  }

  async saveAll() {
    try {
      await this.syncForgeBindings();
      const visuals = { ...this.promotedVisuals };
      for (const [formId, entry] of Object.entries(this.store.state.parts)) {
        if (entry.visual) visuals[formId] = entry.visual;
      }
      const pack = buildPartLabPack({ forge: this.forge, visuals });
      const result = await promotePartLabPack(pack, { documentRef: this.document });
      this.promotedVisuals = visuals;
      this.store.markPromoted(Object.keys(this.store.state.parts), pack.modifiedAt);
      this.setStatus(result.promoted
        ? `saved. ${result.path} updated for the next build.`
        : `pack.json downloaded. copy it to public/${result.path} to promote it.`);
      return result;
    } catch (error) {
      this.setStatus(`save all failed: ${String(error?.message || error).toLowerCase()}`);
      return null;
    }
  }

  async syncForgeBindings() {
    if (!this.forge) return;
    for (const entry of Object.values(this.store.state.parts)) {
      for (const slot of entry.sound?.slots || []) {
        const assignment = slot.assignment;
        if (assignment?.source === 'signal-forge' && this.forge.sounds.has(assignment.soundId)) {
          await this.forge.bind(slot.eventKey, assignment.soundId);
        } else {
          if (this.forge.getBinding(slot.eventKey)) await this.forge.unbind(slot.eventKey);
          this.audio?.unbindEvent(slot.eventKey);
          if (assignment?.source === 'runtime') this.audio?.bindEvent(slot.eventKey, assignment.eventId);
        }
      }
    }
  }

  setStatus(message) {
    this.statusMessage = String(message || '').toLowerCase();
    if (this.status) this.status.textContent = this.statusMessage;
  }
}
