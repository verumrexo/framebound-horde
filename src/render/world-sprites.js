// Screen-space, rectangle-only landmarks. Movement stays inside a fixed silhouette.
export const RIFT_BOUNDS = Object.freeze({ left: -21, top: -21, right: 22, bottom: 22 });

const dim = (color, amount) => color.map((channel, index) => index === 3 ? channel : channel * amount);

export function drawRiftSprite(shapes, colors, p, appearance) {
  const { state, hot, phase } = appearance;
  const active = state === 'live';
  const accent = state === 'disabled' ? dim(colors.red, 0.24)
    : active ? colors.red : colors.amber;
  const shell = dim(accent, 0.32);
  const recessed = dim(accent, 0.1);
  const box = (x, y, w, h, color) => shapes.rect(p.x + x, p.y + y, w, h, color);

  // The opening is broken into blunt, offset jaws around a black vertical fault.
  box(-14, -18, 29, 37, colors.black);
  box(-10, -15, 21, 31, recessed);
  box(-3, -14, 7, 29, colors.black);
  box(-5, -4, 11, 9, colors.black);
  for (const side of [-1, 1]) {
    const x = side < 0 ? -14 : 10;
    box(x, -16, 5, 12, shell);
    box(x, 2, 5, 15, shell);
    box(side < 0 ? -14 : 13, -16, 2, 10, accent);
    box(side < 0 ? -14 : 13, 6, 2, 11, accent);
    box(side < 0 ? -12 : 5, -18, 8, 2, accent);
    box(side < 0 ? -10 : 6, 17, 5, 2, accent);
    box(side < 0 ? -11 : 8, -2, 3, 4, accent);
    // Four staggered packets step inwards; no expanding body or particle spray.
    for (let row = 0; row < 4; row += 1) {
      const step = (phase + row * 2 + (side > 0 ? 3 : 0)) % 8;
      const inset = active ? Math.floor(step / 2) : 0;
      const px = side < 0 ? -9 + inset : 7 - inset;
      box(px, -11 + row * 7, 2, row % 2 ? 2 : 3, active ? (step < 4 ? accent : shell) : shell);
    }
  }
  // Dormant shutters and surge rails communicate state even with reduced motion.
  if (!active) {
    box(-3, -9, 7, 2, shell);
    box(-3, 0, 7, 2, accent);
    box(-3, 9, 7, 2, shell);
  } else {
    box(-1, -6, 2, 4, shell);
    box(0, 5, 2, 3, accent);
  }
  if (hot) {
    for (const side of [-1, 1]) {
      box(side < 0 ? -21 : 20, -16, 2, 12, colors.amber);
      box(side < 0 ? -21 : 20, 5, 2, 12, colors.amber);
      box(side < 0 ? -21 : 14, -21, 8, 2, colors.amber);
      box(side < 0 ? -21 : 14, 20, 8, 2, colors.amber);
    }
  }
}

export function drawBaseSprite(shapes, colors, p, appearance) {
  const { state, plates, phase, hit } = appearance;
  const dead = state === 'destroyed';
  const accent = dead ? dim(colors.cyan, 0.18)
    : state === 'critical' ? colors.red : state === 'damaged' ? colors.amber : colors.cyan;
  const armour = dim(accent, 0.34);
  const box = (x, y, w, h, color) => shapes.rect(p.x + x, p.y + y, w, h, color);
  box(-21, -13, 43, 27, colors.black);
  box(-13, -15, 27, 31, colors.black);
  // Cross-braced chassis, inset square reactor, and four separated armour plates.
  box(-17, -8, 35, 17, armour);
  box(-11, -12, 23, 25, armour);
  box(-9, -10, 19, 21, colors.black);
  box(-7, -8, 15, 17, accent);
  box(-6, -7, 13, 15, colors.black);
  const corners = [[-19, -12], [12, -12], [12, 6], [-19, 6]];
  for (let index = 0; index < corners.length; index += 1) {
    const [x, y] = corners[index];
    const intact = index < plates;
    box(x, y, 8, 7, armour);
    box(x, y, intact ? 8 : 3, 1, intact ? accent : armour);
    box(x + 1, y + 2, 6, 4, colors.black);
    if (intact) box(x + 2, y + 3, 4, 1, accent);
    else box(x + 5, y + 1, 2, 3, colors.black);
  }
  box(-3, -4, 7, 9, dead ? colors.black : armour);
  if (!dead) {
    box(-1, -3, 3, 7, accent);
    box(-3, -1, 7, 3, accent);
    box(0, 0, 1, 1, colors.ink);
  }
  for (const y of [-14, 13]) {
    box(-7, y, 15, 2, armour);
    if (!dead) box(-6 + phase * 3, y, 3, 1, accent);
  }
  box(-21, -3, 3, 7, armour);
  box(19, -3, 3, 7, armour);
  if (hit) {
    // One contained rim response, refreshed rather than stacked by repeated damage.
    box(-7, -8, 15, 1, colors.red);
    box(-7, 8, 15, 1, colors.red);
    box(-7, -7, 1, 15, colors.red);
    box(7, -7, 1, 15, colors.red);
  }
}

export function drawBodyBrackets(shapes, p, bounds, color) {
  const left = p.x + Math.min(-3, bounds.left - 2);
  const right = p.x + Math.max(3, bounds.right + 2);
  const top = p.y + Math.min(-3, bounds.top - 2);
  const bottom = p.y + Math.max(3, bounds.bottom + 2);
  const corner = Math.min(3, (right - left) / 3, (bottom - top) / 3);
  for (const y of [top, bottom]) {
    shapes.rect(left, y, corner, 1, color);
    shapes.rect(right - corner + 1, y, corner, 1, color);
  }
  for (const x of [left, right]) {
    shapes.rect(x, top, 1, corner, color);
    shapes.rect(x, bottom - corner + 1, 1, corner, color);
  }
}
