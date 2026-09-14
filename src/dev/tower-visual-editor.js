import { cancelPointerGesture } from '../app/ui-state.js';
import { RASTER_EMPTY, RASTER_PALETTE, TOWER_RASTER_ORIGIN, emptyRaster, validateTowerRaster } from '../render/tower-raster.js';
import { flipRasterHorizontal, floodFillRaster, rasterBounds, rasterCell, rasterizeTowerSprite, shiftRaster, withRasterCell } from './tower-raster-tools.js';

// Pixel editor for one tower form. It paints a 34x34 raster override; the
// procedural art is only sampled as a starting point and never modified.
const CELL = 16;
const SPRITE_LIMIT = Object.freeze({ left: -16, top: -16, right: 17, bottom: 17 });
const HISTORY_LIMIT = 80;

function button(documentRef, label, action, className = '') {
  const element = documentRef.createElement('button');
  element.type = 'button';
  element.className = `part-lab-button ${className}`.trim();
  element.textContent = label;
  element.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  };
  return element;
}

export class TowerVisualEditorWindow {
  constructor(app, { documentRef = globalThis.document, onDraftChange = () => {}, onSave = () => {}, onDiscard = () => {}, onNext = null, onClose = () => {} } = {}) {
    this.app = app;
    this.document = documentRef;
    this.onDraftChange = onDraftChange;
    this.onSave = onSave;
    this.onDiscard = onDiscard;
    this.onNext = onNext;
    this.onClose = onClose;
    this.overlay = null;
    this.opened = false;
    this.form = null;
    this.raster = null;
    this.original = null;
    this.tool = 'pencil';
    this.color = 'm';
    this.mirror = false;
    this.history = [];
    this.future = [];
    this.painting = false;
    this.strokeChanged = false;
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  open(form, { draft = null, onDraftChange, onSave, onDiscard, onNext, onClose } = {}) {
    if (!form?.id) throw new Error('visual editor needs a tower form');
    for (const [key, value] of Object.entries({ onDraftChange, onSave, onDiscard, onNext, onClose })) if (typeof value === 'function') this[key] = value;
    this.form = form;
    this.original = rasterizeTowerSprite(form.id);
    let initial = null;
    if (draft) {
      try { initial = validateTowerRaster(draft); } catch { initial = null; }
    }
    this.raster = initial || { ...this.original };
    this.history = [];
    this.future = [];
    this.opened = true;
    if (this.app) {
      this.app.ui.partLabOpen = true;
      cancelPointerGesture(this.app);
    }
    if (!this.overlay) this.build();
    this.overlay.classList.add('is-open');
    this.overlay.addEventListener('keydown', this.handleKeyDown);
    this.render();
    this.setStatus(initial ? 'loaded the staged override for this form.' : 'starting from the original art. paint, then save form to apply the override.');
    this.overlay.focus();
    return this;
  }

  close({ cancelled = false } = {}) {
    if (!this.opened) return;
    this.opened = false;
    this.painting = false;
    this.overlay.classList.remove('is-open');
    this.overlay.removeEventListener('keydown', this.handleKeyDown);
    this.onClose?.(this.form, { cancelled });
  }

  handleKeyDown(event) {
    event.stopPropagation();
    if (event.target?.tagName === 'INPUT') return;
    const key = event.key.toLowerCase();
    if (event.key === 'Escape') { event.preventDefault(); this.close({ cancelled: true }); return; }
    if ((event.metaKey || event.ctrlKey) && key === 'z') { event.preventDefault(); if (event.shiftKey) this.redo(); else this.undo(); return; }
    if ((event.metaKey || event.ctrlKey) && key === 'y') { event.preventDefault(); this.redo(); return; }
    if (key === 'p') this.setTool('pencil');
    else if (key === 'f') this.setTool('fill');
    else if (key === 'e') this.setTool('eraser');
    else if (key === 'i') this.setTool('pick');
    else if (key === 'x') this.toggleMirror();
    else if (event.key === 'ArrowLeft') this.apply(shiftRaster(this.raster, -1, 0), 'shifted left');
    else if (event.key === 'ArrowRight') this.apply(shiftRaster(this.raster, 1, 0), 'shifted right');
    else if (event.key === 'ArrowUp') this.apply(shiftRaster(this.raster, 0, -1), 'shifted up');
    else if (event.key === 'ArrowDown') this.apply(shiftRaster(this.raster, 0, 1), 'shifted down');
    else if (/^[1-9]$/.test(event.key) && RASTER_PALETTE[Number(event.key) - 1]) this.setColor(RASTER_PALETTE[Number(event.key) - 1].char);
    else return;
    event.preventDefault();
  }

  build() {
    const overlay = this.document.createElement('div');
    overlay.id = 'tower-visual-editor';
    overlay.tabIndex = -1;
    overlay.innerHTML = `
      <section class="part-lab-panel tower-visual-dialog" role="dialog" aria-modal="true" aria-label="tower visual editor">
        <header class="part-lab-header">
          <div><div class="ui-kicker">part lab // visual</div><h2 class="tower-visual-title">form</h2></div>
          <div class="part-lab-header-copy">paint a pixel override for this form. the original procedural art is untouched and returns when the override is discarded.</div>
          <button class="part-lab-close" type="button" aria-label="close">×</button>
        </header>
        <div class="tower-visual-main">
          <aside class="tower-visual-side">
            <div class="tower-visual-section"><span class="tower-visual-label">palette // 1-9</span><div class="tower-visual-palette"></div></div>
            <div class="tower-visual-section"><span class="tower-visual-label">tools</span><div class="tower-visual-tools"></div></div>
            <div class="tower-visual-section"><span class="tower-visual-label">raster</span><div class="tower-visual-raster-actions"></div></div>
            <div class="tower-visual-section tower-visual-help">
              drag to paint. right drag erases. arrows nudge the whole body. x mirrors strokes across the centre column.
              bodies must stay inside the dashed -16..17 frame so the engine's sprite contract holds.
              overrides are static: animated forms (cyclone, metronome, sweeper, bond) lose their motion while overridden.
            </div>
          </aside>
          <div class="tower-visual-canvas-wrap"><canvas class="tower-visual-canvas"></canvas></div>
          <aside class="tower-visual-side tower-visual-preview-side">
            <div class="tower-visual-section"><span class="tower-visual-label">override // 1x 2x 4x</span><canvas class="tower-visual-preview" width="200" height="120"></canvas></div>
            <div class="tower-visual-section"><span class="tower-visual-label">original art // 1x 2x 4x</span><canvas class="tower-visual-preview tower-visual-original" width="200" height="120"></canvas></div>
            <div class="tower-visual-section"><span class="tower-visual-label">bounds</span><div class="tower-visual-bounds"></div></div>
          </aside>
        </div>
        <footer class="part-lab-footer">
          <span class="part-lab-status" role="status"></span>
          <button class="part-lab-button" data-action="cancel" type="button">cancel</button>
          <button class="part-lab-button is-danger" data-action="discard" type="button">discard override</button>
          <button class="part-lab-button is-accent" data-action="save-next" type="button">save form + next</button>
          <button class="part-lab-button part-lab-save-all" data-action="save" type="button">save form</button>
        </footer>
      </section>
    `;
    this.title = overlay.querySelector('.tower-visual-title');
    this.canvas = overlay.querySelector('.tower-visual-canvas');
    this.preview = overlay.querySelector('.tower-visual-preview:not(.tower-visual-original)');
    this.originalPreview = overlay.querySelector('.tower-visual-original');
    this.boundsElement = overlay.querySelector('.tower-visual-bounds');
    this.status = overlay.querySelector('.part-lab-status');
    this.paletteElement = overlay.querySelector('.tower-visual-palette');
    this.toolsElement = overlay.querySelector('.tower-visual-tools');
    this.rasterActions = overlay.querySelector('.tower-visual-raster-actions');
    overlay.querySelector('.part-lab-close').onclick = () => this.close({ cancelled: true });
    overlay.querySelector('[data-action="cancel"]').onclick = () => this.close({ cancelled: true });
    overlay.querySelector('[data-action="discard"]').onclick = () => this.discard();
    overlay.querySelector('[data-action="save"]').onclick = () => this.commit(false);
    overlay.querySelector('[data-action="save-next"]').onclick = () => this.commit(true);

    for (const entry of RASTER_PALETTE) {
      const swatch = this.document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'tower-visual-swatch';
      swatch.dataset.char = entry.char;
      swatch.style.background = entry.css;
      swatch.title = entry.key;
      swatch.onclick = (event) => { event.preventDefault(); this.setColor(entry.char); };
      this.paletteElement.appendChild(swatch);
    }
    for (const [tool, label] of [['pencil', 'pencil // p'], ['fill', 'fill // f'], ['eraser', 'eraser // e'], ['pick', 'pick colour // i']]) {
      const element = button(this.document, label, () => this.setTool(tool));
      element.dataset.tool = tool;
      this.toolsElement.appendChild(element);
    }
    this.mirrorButton = button(this.document, 'mirror x // x', () => this.toggleMirror());
    this.toolsElement.appendChild(this.mirrorButton);
    this.rasterActions.append(
      button(this.document, 'load original art', () => this.apply(rasterizeTowerSprite(this.form.id), 'original art loaded into the grid')),
      button(this.document, 'flip horizontal', () => this.apply(flipRasterHorizontal(this.raster), 'flipped')),
      button(this.document, 'clear', () => this.apply(emptyRaster(this.form.id), 'cleared')),
      button(this.document, 'undo // ctrl+z', () => this.undo()),
      button(this.document, 'redo // ctrl+shift+z', () => this.redo())
    );

    this.canvas.width = this.canvas.height = CELL * 34;
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    this.canvas.addEventListener('pointerdown', (event) => {
      if (!event.isPrimary) return;
      event.preventDefault();
      this.canvas.setPointerCapture(event.pointerId);
      this.painting = event.button === 2 ? 'erase' : 'paint';
      this.strokeChanged = false;
      this.strokeBefore = this.raster;
      this.lastCell = null;
      this.paintAt(event);
    });
    this.canvas.addEventListener('pointermove', (event) => { if (this.painting) this.paintAt(event); });
    const finish = () => {
      if (!this.painting) return;
      this.painting = false;
      if (this.strokeChanged) {
        this.pushHistory(this.strokeBefore);
        this.emitDraft();
      }
    };
    this.canvas.addEventListener('pointerup', finish);
    this.canvas.addEventListener('pointercancel', finish);
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'contextmenu', 'wheel']) overlay.addEventListener(type, (event) => event.stopPropagation());
    this.document.body.appendChild(overlay);
    this.overlay = overlay;
  }

  cellAt(event) {
    const rect = this.canvas.getBoundingClientRect();
    const scale = this.canvas.width / rect.width;
    return { x: Math.floor((event.clientX - rect.left) * scale / CELL), y: Math.floor((event.clientY - rect.top) * scale / CELL) };
  }

  // Pointer samples skip cells on fast drags, so walk the line between samples.
  paintAt(event) {
    const { x, y } = this.cellAt(event);
    const from = this.lastCell;
    this.lastCell = { x, y };
    if (from && this.tool !== 'fill' && this.tool !== 'pick' && (Math.abs(from.x - x) > 1 || Math.abs(from.y - y) > 1)) {
      const steps = Math.max(Math.abs(x - from.x), Math.abs(y - from.y));
      for (let step = 1; step < steps; step += 1) {
        this.paintCell(Math.round(from.x + (x - from.x) * step / steps), Math.round(from.y + (y - from.y) * step / steps));
      }
    }
    this.paintCell(x, y);
  }

  paintCell(x, y) {
    if (x < 0 || y < 0 || x >= 34 || y >= 34) return;
    if (this.tool === 'pick' && this.painting === 'paint') {
      const char = rasterCell(this.raster, x, y);
      if (char !== RASTER_EMPTY) this.setColor(char);
      return;
    }
    const char = this.painting === 'erase' || this.tool === 'eraser' ? RASTER_EMPTY : this.color;
    let next = this.tool === 'fill' && this.painting === 'paint' ? floodFillRaster(this.raster, x, y, char) : withRasterCell(this.raster, x, y, char);
    if (this.mirror) {
      const mx = 2 * TOWER_RASTER_ORIGIN - x;
      next = this.tool === 'fill' && this.painting === 'paint' ? floodFillRaster(next, mx, y, char) : withRasterCell(next, mx, y, char);
    }
    if (next === this.raster) return;
    this.raster = next;
    this.strokeChanged = true;
    this.render();
  }

  apply(raster, message) {
    if (raster.cells === this.raster.cells) return;
    this.pushHistory(this.raster);
    this.raster = raster;
    this.render();
    this.emitDraft();
    if (message) this.setStatus(message);
  }

  pushHistory(previous) {
    this.history.push(previous);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.future.length = 0;
  }

  undo() {
    const previous = this.history.pop();
    if (!previous) return;
    this.future.push(this.raster);
    this.raster = previous;
    this.render();
    this.emitDraft();
    this.setStatus('undo.');
  }

  redo() {
    const next = this.future.pop();
    if (!next) return;
    this.history.push(this.raster);
    this.raster = next;
    this.render();
    this.emitDraft();
    this.setStatus('redo.');
  }

  emitDraft() {
    this.onDraftChange?.({ ...this.raster }, { form: this.form });
  }

  setTool(tool) {
    this.tool = tool;
    this.render();
  }

  setColor(char) {
    this.color = char;
    if (this.tool === 'eraser' || this.tool === 'pick') this.tool = 'pencil';
    this.render();
  }

  toggleMirror() {
    this.mirror = !this.mirror;
    this.render();
  }

  render() {
    if (!this.overlay || !this.raster) return;
    this.title.textContent = `${this.form.label || this.form.id} // ${this.form.id}`;
    for (const swatch of this.paletteElement.children) swatch.classList.toggle('is-selected', swatch.dataset.char === this.color && this.tool !== 'eraser');
    for (const element of this.toolsElement.querySelectorAll('[data-tool]')) element.classList.toggle('is-selected', element.dataset.tool === this.tool);
    this.mirrorButton.classList.toggle('is-selected', this.mirror);
    this.drawGrid();
    this.drawPreview(this.preview, this.raster);
    this.drawPreview(this.originalPreview, this.original);
    const bounds = rasterBounds(this.raster);
    const outside = bounds && (bounds.left < SPRITE_LIMIT.left || bounds.top < SPRITE_LIMIT.top || bounds.right > SPRITE_LIMIT.right || bounds.bottom > SPRITE_LIMIT.bottom);
    this.boundsElement.textContent = bounds
      ? `${bounds.count} px // x ${bounds.left}..${bounds.right - 1} // y ${bounds.top}..${bounds.bottom - 1}${outside ? ' // outside the sprite frame' : ''}`
      : 'empty // save is disabled';
    this.boundsElement.classList.toggle('is-invalid', Boolean(outside || !bounds));
    for (const action of ['save', 'save-next']) this.overlay.querySelector(`[data-action="${action}"]`).disabled = Boolean(outside || !bounds);
  }

  drawGrid() {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const size = this.canvas.width;
    ctx.fillStyle = '#020b0c';
    ctx.fillRect(0, 0, size, size);
    for (let row = 0; row < 34; row += 1) {
      for (let column = 0; column < 34; column += 1) {
        const char = this.raster.cells[row * 34 + column];
        if (char === RASTER_EMPTY) continue;
        ctx.fillStyle = RASTER_PALETTE.find((entry) => entry.char === char)?.css || '#fff';
        ctx.fillRect(column * CELL, row * CELL, CELL, CELL);
      }
    }
    ctx.strokeStyle = 'rgba(85, 255, 194, 0.08)';
    ctx.lineWidth = 1;
    for (let index = 0; index <= 34; index += 1) {
      ctx.beginPath(); ctx.moveTo(index * CELL + 0.5, 0); ctx.lineTo(index * CELL + 0.5, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, index * CELL + 0.5); ctx.lineTo(size, index * CELL + 0.5); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(53, 242, 255, 0.35)';
    ctx.setLineDash([4, 4]);
    ctx.strokeRect((SPRITE_LIMIT.left + TOWER_RASTER_ORIGIN) * CELL + 0.5, (SPRITE_LIMIT.top + TOWER_RASTER_ORIGIN) * CELL + 0.5,
      (SPRITE_LIMIT.right - SPRITE_LIMIT.left) * CELL, (SPRITE_LIMIT.bottom - SPRITE_LIMIT.top) * CELL);
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255, 200, 87, 0.45)';
    ctx.strokeRect(TOWER_RASTER_ORIGIN * CELL + 0.5, TOWER_RASTER_ORIGIN * CELL + 0.5, CELL - 1, CELL - 1);
  }

  drawPreview(canvas, raster) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#010607';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(85, 255, 194, 0.06)';
    for (let x = 0; x < canvas.width; x += 20) for (let y = (x / 20) % 2 ? 0 : 10; y < canvas.height; y += 20) ctx.fillRect(x, y, 10, 10);
    let originX = 22;
    for (const scale of [1, 2, 4]) {
      const originY = 60;
      for (let row = 0; row < 34; row += 1) {
        for (let column = 0; column < 34; column += 1) {
          const char = raster.cells[row * 34 + column];
          if (char === RASTER_EMPTY) continue;
          ctx.fillStyle = RASTER_PALETTE.find((entry) => entry.char === char)?.css || '#fff';
          ctx.fillRect(originX + (column - TOWER_RASTER_ORIGIN) * scale, originY + (row - TOWER_RASTER_ORIGIN) * scale, scale, scale);
        }
      }
      originX += 20 + 34 * scale / 2 + 12;
    }
  }

  discard() {
    if (!this.document.defaultView?.confirm?.(`discard the ${this.form.id} override and show the original art again?`)) return;
    this.onDiscard?.(this.form);
    this.close();
  }

  async commit(advance) {
    try {
      await this.onSave?.({ ...this.raster }, { form: this.form, action: advance ? 'save-next' : 'save' });
      if (advance && this.onNext) {
        const next = await this.onNext(this.form);
        this.close();
        if (next?.form) this.open(next.form, { draft: next.draft });
        return;
      }
      this.close();
    } catch (error) {
      this.setStatus(`save failed: ${error.message}`);
    }
  }

  setStatus(message) {
    if (this.status) this.status.textContent = String(message || '').toLowerCase();
  }
}
