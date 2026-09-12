// Construction and evolution reveal: a fixed-size screen frame drawn over a tower that is
// already live in the authoritative snapshot. Simulation ticks drive it, so pausing
// freezes it; nothing here delays placement, targeting, or firing.
export const ASSEMBLY_TICKS = 18;
export const ASSEMBLY_SIZE = 17;
const HALF = Math.floor(ASSEMBLY_SIZE / 2);

export class AssemblyPresentation {
  constructor() { this.items = []; }
  reset() { this.items.length = 0; }

  begin(tower, kind, runTick) {
    if (!tower?.id || !Number.isFinite(runTick)) return;
    const item = { towerId: tower.id, x: tower.x, y: tower.y, kind, startTick: runTick };
    const index = this.items.findIndex((candidate) => candidate.towerId === tower.id);
    if (index >= 0) this.items[index] = item;
    else this.items.push(item);
  }

  // Returns the live frames for this tick and drops finished ones. Items whose start
  // lies in the future belong to a replaced session and are discarded too.
  frames(runTick, reducedMotion = false) {
    let write = 0;
    const frames = [];
    for (const item of this.items) {
      const elapsed = runTick - item.startTick;
      if (elapsed < 0 || elapsed >= ASSEMBLY_TICKS) continue;
      this.items[write++] = item;
      frames.push({ ...item, step: reducedMotion ? null : elapsed });
    }
    this.items.length = write;
    return frames;
  }
}

export function drawAssemblyFrame(shapes, colors, p, frame) {
  const color = frame.kind === 'evolved' ? colors.cyan : colors.mint;
  const left = p.x - HALF, top = p.y - HALF, right = p.x + HALF, bottom = p.y + HALF;
  for (const y of [top, bottom]) {
    shapes.rect(left, y, 3, 1, color);
    shapes.rect(right - 2, y, 3, 1, color);
  }
  for (const x of [left, right]) {
    shapes.rect(x, top + 1, 1, 2, color);
    shapes.rect(x, bottom - 2, 1, 2, color);
  }
  if (frame.step === null) return;
  // One hard scanline steps top to bottom; evolution adds a second line two rows behind.
  const row = top + Math.floor(frame.step / ASSEMBLY_TICKS * ASSEMBLY_SIZE);
  shapes.rect(left + 1, row, ASSEMBLY_SIZE - 2, 1, color);
  if (frame.kind === 'evolved' && row - 2 >= top) shapes.rect(left + 3, row - 2, ASSEMBLY_SIZE - 6, 1, colors.dimMint);
}
