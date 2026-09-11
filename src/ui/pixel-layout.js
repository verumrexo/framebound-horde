// Layout uses the same logical pixels and six-pixel advance as the bitmap atlas.
export function pixelHudLayout(width, mode = 'game') {
  const leftWidths = [92, 68, 56];
  const rightWidths = [62, 56, 56];
  const groupWidth = (widths) => widths.reduce((sum, value) => sum + value, 0) + (widths.length - 1) * 4;
  const leftWidth = groupWidth(leftWidths), rightWidth = groupWidth(rightWidths);
  const split = leftWidth + rightWidth + 28 > width;
  const place = (widths, x, y) => widths.map((itemWidth) => {
    const item = { x, y, width: itemWidth, height: 17 };
    x += itemWidth + 4;
    return item;
  });
  const scale = width >= 560 ? 2 : 1;
  return {
    topHeight: mode === 'test' ? 23 : scale === 2 ? 32 : 26,
    bottomHeight: mode === 'test' ? 91 : split ? 64 : 43,
    valueScale: scale,
    brandWidth: width >= 560 ? 110 : 72,
    left: place(leftWidths, 8, 3),
    right: place(rightWidths, width - 8 - rightWidth, split ? 24 : 3),
    statusY: split ? 45 : 24,
    statsY: split ? 55 : 34
  };
}

// Each item may reserve a fixed minimum character width per line (item.minChars),
// so a value that gains or loses digits (credits, timers, counts) never shifts its
// own column or any column after it - only the drawn text changes, not the layout.
export function fitPixelTelemetry(items, left, right, gap = 12) {
  let x = left;
  return items.flatMap((item) => {
    const width = Math.max(...item.lines.map((line, index) =>
      Math.max(String(line).length, item.minChars?.[index] || 0) * 6));
    if (x + width > right) return [];
    const placed = { ...item, x, width };
    x += width + gap;
    return [placed];
  });
}

export function pixelActionLayout(actions, availableHeight, requestedPage = 0) {
  const rows = [...new Set(actions.map((action) => action.y))].sort((a, b) => a - b);
  const allHeight = 41 + rows.length * 21 + 3;
  const paginated = allHeight > availableHeight;
  const perPage = paginated ? Math.max(1, Math.floor((availableHeight - 59) / 21)) : Math.max(1, rows.length);
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const page = Math.min(pages - 1, Math.max(0, requestedPage));
  const visible = rows.slice(page * perPage, (page + 1) * perPage);
  return {
    page, pages,
    rows: visible.map((y) => actions.filter((action) => action.y === y)),
    height: 41 + visible.length * 21 + (pages > 1 ? 18 : 3)
  };
}
