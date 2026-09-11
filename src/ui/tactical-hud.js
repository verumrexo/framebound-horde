import { attachedPanelBounds } from './tactical-layout.js';

function node(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function setText(element, text) {
  if (element.textContent !== String(text)) element.textContent = text;
}

export function createTacticalHud({ stage, glyphs, onPointerEnter }) {
  const root = node('div', 'tactical-hud');
  root.id = 'tactical-hud';
  root.hidden = true;
  const top = node('header', 'tactical-top');
  top.setAttribute('aria-label', 'combat telemetry');
  const brand = node('div', 'tactical-brand');
  // Use the game's authored glyph data, at two screen pixels per bitmap pixel.
  const wordmark = node('canvas', 'tactical-wordmark');
  wordmark.width = 120; wordmark.height = 14;
  wordmark.setAttribute('role', 'img');
  wordmark.setAttribute('aria-label', 'framebound');
  const context = wordmark.getContext('2d');
  context.fillStyle = '#55ffc2';
  [...'framebound'].forEach((letter, index) => {
    [...glyphs[letter]].forEach((bit, pixel) => {
      if (bit === '1') context.fillRect(index * 12 + (pixel % 5) * 2, Math.floor(pixel / 5) * 2, 2, 2);
    });
  });
  brand.append(wordmark, node('span', 'tactical-eyebrow', '// horde'));
  const primary = node('div', 'tactical-primary');
  const values = {};
  for (const [id, label] of [['credits', 'credits'], ['lives', 'lives'], ['rift', 'next rift']]) {
    const metric = node('div', `tactical-metric tactical-${id}`);
    const title = node('span', 'tactical-label', label);
    const value = node('strong', 'tactical-value');
    metric.append(title, value); primary.append(metric); values[id] = { title, value };
  }
  const secondary = node('div', 'tactical-secondary');
  const time = node('span', ''); const horde = node('span', ''); const kps = node('span', '');
  secondary.append(time, horde, kps);
  const details = node('details', 'tactical-details');
  const summary = node('summary', '', 'details');
  const detailText = node('div', 'tactical-detail-content');
  details.append(summary, detailText);
  top.append(brand, primary, secondary, details);
  const bottom = node('footer', 'tactical-bottom');
  const commands = node('div', 'tactical-commands');
  const left = node('div', 'tactical-command-group');
  const right = node('div', 'tactical-command-group');
  commands.append(left, right);
  const status = node('div', 'tactical-status');
  bottom.append(commands, status);
  const panel = node('section', 'tactical-panel');
  panel.setAttribute('aria-label', 'selected tower');
  panel.hidden = true;
  const title = node('h2', '');
  const metric = node('p', 'tactical-panel-metric');
  const investment = node('p', 'tactical-label');
  const ownership = node('p', 'tactical-ownership');
  const panelActions = node('div', 'tactical-panel-actions');
  panel.append(title, metric, investment, ownership, panelActions);
  root.append(top, bottom, panel); stage.append(root);

  root.addEventListener('pointerenter', onPointerEnter);
  for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick', 'wheel', 'contextmenu']) {
    root.addEventListener(type, (event) => {
      event.stopPropagation();
      if (type === 'contextmenu') event.preventDefault();
    });
  }
  // Native enter/space activation belongs to the focused control, never the game hotkeys.
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { document.activeElement?.blur(); details.open = false; }
    event.stopPropagation();
  });
  let callbacks = new Map();
  function buttons(container, actions) {
    const existing = new Map([...container.children].map((button) => [button.dataset.action, button]));
    for (const [index, action] of actions.entries()) {
      let button = existing.get(action.id);
      if (!button) {
        button = node('button', ''); button.type = 'button'; button.dataset.action = action.id;
        button.addEventListener('click', () => callbacks.get(action.id)?.());
      }
      existing.delete(action.id);
      callbacks.set(action.id, action.action);
      setText(button, action.label);
      button.className = `tactical-button${action.primary ? ' is-primary' : ''}${action.danger ? ' is-danger' : ''}`;
      if (action.pressed !== undefined) button.setAttribute('aria-pressed', String(action.pressed));
      else button.removeAttribute('aria-pressed');
      // Legacy 'active' means highlighted, not disabled. Preserve callable fallback actions.
      button.disabled = Boolean(action.disabled);
      if (container.children[index] !== button) container.insertBefore(button, container.children[index] || null);
    }
    for (const button of existing.values()) button.remove();
  }
  const measurements = { topHeight: 0, bottomHeight: 0 };
  const observer = new ResizeObserver(() => {
    measurements.topHeight = top.getBoundingClientRect().height;
    measurements.bottomHeight = bottom.getBoundingClientRect().height;
  });
  observer.observe(top); observer.observe(bottom);
  return {
    update(model) {
      root.hidden = !model.visible;
      if (!model.visible) { details.open = false; return null; }
      callbacks = new Map();
      setText(values.credits.value, model.credits);
      setText(values.lives.value, model.lives);
      setText(values.rift.value, model.rift);
      setText(values.rift.title, model.riftLabel);
      setText(time, `time ${model.time}`); setText(horde, `horde ${model.horde}`);
      kps.hidden = model.kps === null; setText(kps, `kps ${model.kps}`);
      setText(detailText, model.details);
      setText(status, model.status);
      buttons(left, model.left.map((action) => ({ ...action, disabled: model.blocked || action.disabled })));
      buttons(right, model.right.map((action) => ({ ...action, disabled: model.blocked || action.disabled })));
      details.hidden = model.blocked;
      if (model.blocked) details.open = false;
      const view = model.tower;
      panel.hidden = !view || model.blocked;
      if (view && !model.blocked) {
        setText(title, view.title); setText(metric, view.metric);
        setText(investment, `invested ${view.investment} cr`);
        ownership.hidden = !view.inspectOnly;
        setText(ownership, `owner ${view.owner} // inspect only`);
        const actions = [...view.actions].sort((a, b) => Number(a.id.includes('sell')) - Number(b.id.includes('sell')));
        buttons(panelActions, actions.map((action, index) => ({ ...action,
          primary: index === 0 && !action.id.includes('sell'), danger: action.id.includes('sell') })));
      }
      // Read after layout so the first frame and reflow use actual screen-space sizes.
      measurements.topHeight = top.getBoundingClientRect().height;
      measurements.bottomHeight = bottom.getBoundingClientRect().height;
      if (view && !model.blocked) {
        const rect = attachedPanelBounds({ anchor: view.anchor, width: 288, height: Infinity,
          viewportWidth: model.width, top: measurements.topHeight, bottom: model.height - measurements.bottomHeight });
        panel.style.width = `${rect.width}px`;
        panel.style.maxHeight = `${rect.height}px`;
        const position = attachedPanelBounds({ anchor: view.anchor, width: rect.width, height: panel.getBoundingClientRect().height,
          viewportWidth: model.width, top: measurements.topHeight, bottom: model.height - measurements.bottomHeight });
        panel.style.left = `${position.x}px`; panel.style.top = `${position.y}px`;
      }
      return measurements;
    }
  };
}
