// All input dimensions are CSS pixels. Only the returned world bounds are logical units.
export function playableHudBounds({ width, height, scale, topHeight, bottomHeight }) {
  const top = Math.min(height, Math.max(0, topHeight));
  const bottom = Math.max(top, height - Math.max(0, bottomHeight));
  return { left: 0, right: width / scale, top: top / scale, bottom: bottom / scale };
}

export function attachedPanelBounds({ anchor, width, height, viewportWidth, top, bottom, gap = 16, edge = 8 }) {
  const availableWidth = Math.max(0, viewportWidth - edge * 2);
  const availableHeight = Math.max(0, bottom - top - edge * 2);
  const panelWidth = Math.min(width, availableWidth);
  const panelHeight = Math.min(height, availableHeight);
  const x = Math.max(edge, Math.min(viewportWidth - edge - panelWidth, anchor.x - panelWidth / 2));
  let y = anchor.y - gap - panelHeight;
  if (y < top + edge) y = anchor.y + gap;
  y = Math.max(top + edge, Math.min(bottom - edge - panelHeight, y));
  return { x, y, width: panelWidth, height: panelHeight };
}
