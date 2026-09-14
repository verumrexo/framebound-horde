// Pure panel geometry for the canvas menus. Everything is integer logical pixels so the
// drawing code in main.js only places rectangles and glyphs; tests exercise the layout
// rules (viewport clamps, tier breakpoints, attached-panel flipping) without a canvas.

export function centeredPanel(viewport, maxWidth, maxHeight, marginX = 20, marginY = 12) {
  const width = Math.min(maxWidth, viewport.width - marginX);
  const height = Math.min(maxHeight, viewport.height - marginY);
  return {
    width, height,
    x: Math.round((viewport.width - width) * 0.5),
    y: Math.round((viewport.height - height) * 0.5)
  };
}

// Header rule with one amber scar, run-state rail, then two button tiers split by an
// interrupted divider. Rows are top offsets relative to the panel.
export const MENU_HEADER = Object.freeze({ ruleY: 40, scarWidth: 22, subtitleY: 29, runLabelY: 48, noteY: 59 });

export function mainMenuLayout(viewport) {
  const panel = centeredPanel(viewport, 330, 184);
  return {
    ...panel,
    buttonX: panel.x + 17,
    buttonWidth: panel.width - 34,
    rows: Object.freeze({ primary: 70, secondary: 91, divider: 112, coop: 118, test: 139, footer: 165 })
  };
}

export function escapeMenuLayout(viewport, { page = 'main', networkActive = false } = {}) {
  const full = page === 'help' ? 222 : page === 'options' ? 246 : networkActive ? 212 : 191;
  const panel = centeredPanel(viewport, page === 'help' ? 288 : 264, full, 20, 16);
  const compact = page === 'main' && panel.height < full;
  const tierGap = compact ? 0 : 6;
  const thumbnail = !compact && page === 'main' ? { x: panel.x + panel.width - 17 - 62, y: panel.y + 46, width: 62, height: 38 } : null;
  return {
    ...panel, compact, thumbnail,
    buttonX: panel.x + 17,
    buttonWidth: panel.width - 34,
    runTierWidth: panel.width - 34 - (thumbnail ? 70 : 0),
    rowY: (index) => panel.y + (compact ? 43 : 64) + index * (compact ? 18 : 21) + (index >= 2 ? tierGap : 0),
    dividerY: compact ? null : panel.y + 64 + 2 * 21 + 2
  };
}

export function optionsLayout(viewport) {
  const panel = centeredPanel(viewport, 264, 156, 20, 16);
  return { ...panel, buttonX: panel.x + 17, buttonWidth: panel.width - 34 };
}

export function coopMenuLayout(viewport) {
  const panel = centeredPanel(viewport, 390, 198, 16, 12);
  return { ...panel, buttonX: panel.x + 17, buttonWidth: panel.width - 34 };
}

export function defeatLayout(viewport) {
  const panel = centeredPanel(viewport, 300, 152, 20, 0);
  const wide = panel.width >= 280;
  return {
    ...panel, wide,
    buttonX: panel.x + 16,
    buttonWidth: panel.width - 32,
    rows: Object.freeze({ stats: 34, retry: 86, map: 107, menu: 128 }),
    reactor: { x: panel.x + panel.width - 46, y: panel.y + 30 },
    thumbnail: wide ? { x: panel.x + panel.width - 46 - 8 - 64, y: panel.y + 30, width: 64, height: 44 } : null
  };
}

// The selected field's real contours sit beside the list when the panel is wide and
// tall enough; otherwise the list keeps its full width.
export function mapSelectionLayout(viewport, mapCount) {
  const panel = centeredPanel(viewport, 430, 172 + mapCount * 23, 12, 12);
  const tall = panel.height >= 242;
  const rowHeight = tall ? 23 : 17;
  const rowTop = tall ? 40 : 35;
  const showThumbnail = panel.width >= 380 && tall;
  const listWidth = showThumbnail ? 196 : panel.width - 32;
  const thumbX = panel.x + 16 + listWidth + 10;
  return {
    ...panel, rowHeight, rowTop, listWidth, showThumbnail,
    listX: panel.x + 16,
    thumbnail: showThumbnail ? {
      x: thumbX, y: panel.y + rowTop + 3,
      width: panel.x + panel.width - 20 - thumbX,
      height: Math.min(mapCount * rowHeight - 6, panel.height - 74 - (rowTop + 3))
    } : null,
    descriptionY: rowTop + mapCount * rowHeight + 4,
    paceY: panel.y + panel.height - 66,
    buttonY: panel.y + panel.height - 38
  };
}

export function catalogLayout(viewport, hudTop, hudBottom, rowCount, entryHeight) {
  const rowPitch = entryHeight + 2;
  const width = Math.min(410, viewport.width - 12);
  const height = 22 + rowCount * rowPitch + 16;
  return {
    width, height, rowPitch,
    x: Math.round((viewport.width - width) * 0.5),
    y: Math.max(hudTop + 5, hudBottom - height - 6),
    innerX: 7, innerWidth: width - 14, rowsTop: 22, footerY: height - 12
  };
}

// Attached panels prefer to hang above their anchor and flip below when the hud is in
// the way. The connector always meets the panel within its horizontal span.
export function attachedPanelPosition(anchor, width, height, viewport, hudTop, hudBottom) {
  const edge = 5;
  const minimumY = hudTop + 4;
  const maximumY = Math.max(minimumY, hudBottom - height - 4);
  const x = Math.max(edge, Math.min(viewport.width - width - edge, Math.round(anchor.x - width * 0.5)));
  let y = anchor.y - height - 14;
  let above = true;
  if (y < minimumY) {
    y = anchor.y + 14;
    above = false;
  }
  y = Math.max(minimumY, Math.min(maximumY, Math.round(y)));
  const connectorX = Math.max(x + 7, Math.min(x + width - 8, anchor.x));
  return { x, y, above, connectorX };
}
