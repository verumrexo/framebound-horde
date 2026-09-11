import { NETWORK_DESCENDANT_IDS } from '../core/network-descendants.js';
// Tower bodies use rectangles exclusively. World-space links and combat geometry live in main.
// Preserve the frame / assault / tether / network vocabulary: square housing,
// inset core, straight rails and blunt mechanical attachments. Never rotate a body.
export function drawTowerSprite(shapes, COLOR, p, tower, override = null, context = {}) {
  const { runTick = 0 } = context;
  const palette = override ? Object.fromEntries(['amber', 'mint', 'cyan', 'green', 'red', 'dimMint'].map(
    (key) => [key, override?.accent || COLOR[key]]
  )) : COLOR;
  const accent = override?.accent || palette.mint;
  const core = override?.core || palette.cyan;
  const box = (x, y, w, h, color) => shapes.rect(p.x + x, p.y + y, w, h, color);
  const housing = (x, y, w, h, color = accent) => {
    box(x - 1, y - 1, w + 2, h + 2, COLOR.black);
    box(x, y, w, h, color);
    box(x + 1, y + 1, w - 2, h - 2, COLOR.black);
  };

  shapes.rect(p.x - 4, p.y - 4, 9, 9, COLOR.black);

  if (tower.definitionId === 'assault') {
    shapes.rect(p.x - 4, p.y - 3, 9, 7, COLOR.black);
    shapes.rect(p.x - 3, p.y - 3, 7, 1, override?.accent || palette.amber);
    shapes.rect(p.x - 3, p.y + 3, 7, 1, override?.accent || palette.amber);
    shapes.rect(p.x - 3, p.y - 2, 1, 5, accent);
    shapes.rect(p.x + 3, p.y - 2, 1, 5, accent);
    shapes.rect(p.x - 3, p.y - 7, 2, 5, override?.core || palette.mint);
    shapes.rect(p.x + 2, p.y - 7, 2, 5, override?.core || palette.mint);
    shapes.rect(p.x - 2, p.y - 1, 1, 3, core);
    shapes.rect(p.x + 2, p.y - 1, 1, 3, core);
    return;
  }

  if (tower.definitionId === 'barrage') {
    shapes.rect(p.x - 6, p.y - 4, 13, 9, COLOR.black);
    shapes.rect(p.x - 5, p.y - 3, 11, 1, palette.amber);
    shapes.rect(p.x - 5, p.y + 3, 11, 1, palette.amber);
    shapes.rect(p.x - 5, p.y - 2, 1, 5, palette.mint);
    shapes.rect(p.x + 5, p.y - 2, 1, 5, palette.mint);
    for (const barrelX of [-5, -2, 1, 4]) shapes.rect(p.x + barrelX, p.y - 8, 1, 5, palette.amber);
    shapes.rect(p.x - 3, p.y - 1, 7, 3, palette.cyan);
    shapes.rect(p.x - 1, p.y, 3, 1, palette.mint);
    return;
  }

  if (tower.definitionId === 'broadside') {
    const familyAccent = override?.accent || palette.amber;
    const familyCore = override?.core || palette.mint;
    shapes.rect(p.x - 9, p.y - 5, 19, 11, COLOR.black);
    shapes.rect(p.x - 8, p.y - 4, 17, 1, familyAccent);
    shapes.rect(p.x - 8, p.y + 4, 17, 1, familyAccent);
    shapes.rect(p.x - 8, p.y - 3, 2, 7, familyCore);
    shapes.rect(p.x + 7, p.y - 3, 2, 7, familyCore);
    for (const barrelX of [-7, -5, -3, -1, 1, 3, 5, 7]) {
      shapes.rect(p.x + barrelX, p.y - 11, 1, 7, familyAccent);
      shapes.rect(p.x + barrelX, p.y - 12, 1, 1, familyCore);
    }
    shapes.rect(p.x - 5, p.y - 2, 11, 5, COLOR.black);
    shapes.rect(p.x - 4, p.y - 1, 9, 3, override?.core || palette.cyan);
    shapes.rect(p.x - 1, p.y, 3, 1, familyCore);
    return;
  }

  if (tower.definitionId === 'flechette') {
    housing(-5, -4, 11, 9, palette.amber);
    for (const x of [-5, -2, 2, 5]) {
      box(x, -12, 1, 9, core);
      box(x, -13, 1, 2, accent);
    }
    box(-2, -1, 5, 3, palette.amber);
    box(-7, 2, 2, 4, core);
    box(6, 2, 2, 4, core);
    return;
  }

  if (tower.definitionId === 'cyclone') {
    housing(-6, -5, 13, 11, palette.amber);
    for (const x of [-4, -1, 2]) box(x, -11, 2, 7, accent);
    // Square cooling jacket and alternating piston indicators.
    box(-8, -2, 2, 6, core);
    box(7, -2, 2, 6, core);
    for (const x of [-3, 0, 3]) box(x, -2, 1, 5, palette.amber);
    box(Math.floor(runTick / 6) % 3 * 3 - 3, 0, 1, 2, accent);
    return;
  }

  if (tower.definitionId === 'rocket') {
    shapes.rect(p.x - 5, p.y - 7, 11, 13, COLOR.black);
    shapes.rect(p.x - 4, p.y - 3, 9, 7, palette.amber);
    shapes.rect(p.x - 3, p.y - 2, 7, 5, COLOR.black);
    shapes.rect(p.x - 1, p.y - 8, 3, 9, palette.amber);
    shapes.rect(p.x, p.y - 10, 1, 2, palette.mint);
    shapes.rect(p.x - 4, p.y + 4, 3, 2, palette.amber);
    shapes.rect(p.x + 2, p.y + 4, 3, 2, palette.amber);
    shapes.rect(p.x, p.y + 1, 1, 3, palette.red);
    return;
  }

  if (tower.definitionId === 'warhead') {
    const familyAccent = override?.accent || palette.amber;
    const familyCore = override?.core || palette.mint;
    shapes.rect(p.x - 7, p.y - 10, 15, 18, COLOR.black);
    shapes.rect(p.x - 3, p.y - 12, 7, 17, familyAccent);
    shapes.rect(p.x - 2, p.y - 14, 5, 3, override?.accent || palette.red);
    shapes.rect(p.x - 1, p.y - 15, 3, 2, familyCore);
    shapes.rect(p.x - 5, p.y - 4, 3, 9, familyAccent);
    shapes.rect(p.x + 3, p.y - 4, 3, 9, familyAccent);
    shapes.rect(p.x - 7, p.y + 3, 3, 5, override?.accent || palette.red);
    shapes.rect(p.x + 5, p.y + 3, 3, 5, override?.accent || palette.red);
    shapes.rect(p.x - 2, p.y - 6, 5, 7, COLOR.black);
    shapes.rect(p.x - 1, p.y - 5, 3, 5, override?.core || palette.red);
    shapes.rect(p.x, p.y - 4, 1, 3, familyCore);
    return;
  }

  if (tower.definitionId === 'cluster') {
    const familyAccent = override?.accent || palette.amber;
    const familyCore = override?.core || palette.mint;
    shapes.rect(p.x - 7, p.y - 7, 15, 15, COLOR.black);
    for (const [nodeX, nodeY] of [[-7, -7], [0, -7], [7, -7], [-7, 7], [0, 7], [7, 7]]) {
      shapes.rect(p.x + nodeX - 2, p.y + nodeY - 2, 5, 5, COLOR.black);
      shapes.rect(p.x + nodeX - 1, p.y + nodeY - 1, 3, 3, familyAccent);
      shapes.rect(p.x + nodeX, p.y + nodeY, 1, 1, familyCore);
    }
    shapes.rect(p.x - 5, p.y - 5, 11, 11, familyAccent);
    shapes.rect(p.x - 4, p.y - 4, 9, 9, COLOR.black);
    shapes.rect(p.x - 2, p.y - 2, 5, 5, override?.core || palette.red);
    shapes.rect(p.x, p.y - 1, 1, 3, familyCore);
    return;
  }

  if (tower.definitionId === 'salvo') {
    const familyAccent = override?.accent || palette.amber;
    const familyCore = override?.core || palette.mint;
    shapes.rect(p.x - 8, p.y - 8, 17, 15, COLOR.black);
    for (const missileX of [-6, 0, 6]) {
      shapes.rect(p.x + missileX - 2, p.y - 9, 5, 13, COLOR.black);
      shapes.rect(p.x + missileX - 1, p.y - 10, 3, 11, familyAccent);
      shapes.rect(p.x + missileX, p.y - 12, 1, 2, familyCore);
      shapes.rect(p.x + missileX - 2, p.y + 1, 2, 4, override?.accent || palette.red);
      shapes.rect(p.x + missileX + 1, p.y + 1, 2, 4, override?.accent || palette.red);
    }
    shapes.rect(p.x - 7, p.y + 5, 15, 2, familyAccent);
    shapes.rect(p.x - 2, p.y + 3, 5, 3, COLOR.black);
    shapes.rect(p.x - 1, p.y + 3, 3, 2, override?.core || palette.cyan);
    return;
  }

  if (tower.definitionId === 'laser') {
    // Narrow optical lance: stacked focusing collars and a needle emitter.
    housing(-4, -3, 9, 10, palette.cyan);
    box(-1, -12, 3, 12, COLOR.black);
    box(0, -12, 1, 12, palette.mint);
    for (const y of [-9, -5, -1]) {
      box(-3, y, 7, 1, palette.cyan);
      box(-1, y, 3, 1, palette.mint);
    }
    box(-2, 2, 5, 3, palette.mint);
    box(0, 3, 1, 1, palette.amber);
    box(-5, 7, 11, 2, palette.cyan);
    return;
  }

  if (tower.definitionId === 'cutter') {
    // Industrial heat jaws with a wide rectangular emitter and cooling fins.
    housing(-8, -3, 17, 11, palette.amber);
    for (const x of [-9, 5]) {
      box(x, -9, 5, 12, COLOR.black);
      box(x+1, -8, 3, 10, palette.red);
      for (const y of [-6, -2, 2]) box(x, y, 5, 1, palette.amber);
    }
    box(-4, -7, 9, 7, COLOR.black);
    box(-4, -7, 9, 2, palette.amber);
    box(-3, -5, 7, 1, palette.mint);
    box(-5, 2, 11, 3, palette.red);
    box(-3, 3, 7, 1, palette.amber);
    box(-8, 8, 17, 2, palette.amber);
    return;
  }

  if (tower.definitionId === 'prism') {
    // Three stepped crystal lenses around an optical splitter.
    housing(-4, -2, 9, 9, palette.cyan);
    for (const [x,y,tint] of [[-8,-3,palette.cyan],[0,-9,palette.mint],[8,-3,palette.amber]]) {
      box(x-1, y-3, 3, 7, COLOR.black);
      box(x-3, y-1, 7, 3, COLOR.black);
      box(x, y-2, 1, 5, tint);
      box(x-2, y, 5, 1, tint);
      box(x, y, 1, 1, palette.mint);
    }
    box(-1, 1, 3, 4, palette.mint);
    box(-5, 7, 11, 2, palette.cyan);
    box(-3, 9, 7, 1, palette.amber);
    return;
  }

  if (tower.definitionId === 'sweeper') {
    // Stepped gimbal cradle. Its moving aperture follows the real sweep phase.
    housing(-5, 1, 11, 7, palette.cyan);
    box(-7, -8, 15, 2, palette.cyan);
    box(-9, -6, 2, 7, palette.cyan);
    box(8, -6, 2, 7, palette.cyan);
    box(-7, 1, 15, 2, palette.mint);
    box(-6, -6, 13, 6, COLOR.black);
    const phase = context.sweepPhase;
    const scan = phase == null ? 0 : Math.round((phase-.5)*12);
    box(scan-1, -7, 3, 8, COLOR.black);
    box(scan, -7, 1, 8, palette.mint);
    box(scan-2, -4, 5, 2, phase == null ? palette.cyan : palette.amber);
    box(-2, 4, 5, 2, palette.mint);
    box(-7, 8, 15, 2, palette.cyan);
    return;
  }

  if (tower.definitionId === 'anchor') {
    shapes.rect(p.x - 5, p.y - 5, 11, 11, COLOR.black);
    shapes.rect(p.x - 4, p.y - 4, 9, 1, palette.cyan);
    shapes.rect(p.x - 4, p.y + 4, 9, 1, palette.cyan);
    shapes.rect(p.x - 4, p.y - 3, 1, 7, palette.cyan);
    shapes.rect(p.x + 4, p.y - 3, 1, 7, palette.cyan);
    shapes.rect(p.x - 1, p.y - 8, 3, 5, palette.mint);
    shapes.rect(p.x - 1, p.y + 4, 3, 4, palette.mint);
    shapes.rect(p.x - 7, p.y - 1, 4, 3, palette.mint);
    shapes.rect(p.x + 4, p.y - 1, 4, 3, palette.mint);
    shapes.rect(p.x - 1, p.y - 1, 3, 3, palette.cyan);
    return;
  }

  if (tower.definitionId === 'knot') {
    housing(-6, -6, 10, 10, palette.green);
    housing(-2, -2, 9, 9, core);
    box(-4, -4, 3, 3, accent);
    box(1, 1, 3, 3, palette.amber);
    return;
  }

  if (tower.definitionId === 'backwash') {
    shapes.rect(p.x - 5, p.y - 5, 11, 11, COLOR.black);
    shapes.rect(p.x - 4, p.y + 3, 9, 2, palette.amber);
    shapes.rect(p.x - 3, p.y, 7, 2, palette.cyan);
    shapes.rect(p.x - 2, p.y - 3, 5, 2, palette.mint);
    shapes.rect(p.x - 1, p.y - 7, 3, 4, palette.amber);
    shapes.rect(p.x - 6, p.y + 1, 2, 5, palette.cyan);
    shapes.rect(p.x + 5, p.y + 1, 2, 5, palette.cyan);
    shapes.rect(p.x, p.y, 1, 1, COLOR.black);
    return;
  }

  if (tower.definitionId === 'stasis') {
    shapes.rect(p.x - 7, p.y - 7, 15, 15, COLOR.black);
    shapes.rect(p.x - 6, p.y - 6, 5, 2, palette.cyan);
    shapes.rect(p.x + 2, p.y - 6, 5, 2, palette.cyan);
    shapes.rect(p.x - 6, p.y + 5, 5, 2, palette.cyan);
    shapes.rect(p.x + 2, p.y + 5, 5, 2, palette.cyan);
    shapes.rect(p.x - 6, p.y - 4, 2, 9, palette.mint);
    shapes.rect(p.x + 5, p.y - 4, 2, 9, palette.mint);
    shapes.rect(p.x - 2, p.y - 4, 2, 9, palette.amber);
    shapes.rect(p.x + 1, p.y - 4, 2, 9, palette.amber);
    shapes.rect(p.x, p.y - 9, 1, 3, palette.mint);
    return;
  }

  if (tower.definitionId === 'recall') {
    housing(-6, -6, 13, 13, core);
    box(-7, -7, 11, 2, palette.amber);
    box(-7, -7, 2, 8, palette.amber);
    box(-9, -1, 6, 2, palette.amber);
    box(5, -1, 2, 8, accent);
    box(-3, 5, 10, 2, accent);
    box(-1, -3, 3, 6, palette.amber);
    box(0, -2, 1, 2, COLOR.black);
    return;
  }

  if (tower.definitionId === 'dragnet') {
    shapes.rect(p.x - 7, p.y - 7, 15, 15, COLOR.black);
    for (const offset of [-5, 0, 5]) {
      box(offset, -6, 1, 13, offset === 0 ? palette.mint : palette.cyan);
      box(-6, offset, 13, 1, offset === 0 ? palette.mint : palette.cyan);
    }
    shapes.rect(p.x - 8, p.y - 8, 4, 3, palette.green);
    shapes.rect(p.x + 5, p.y - 8, 4, 3, palette.green);
    shapes.rect(p.x - 8, p.y + 6, 4, 3, palette.green);
    shapes.rect(p.x + 5, p.y + 6, 4, 3, palette.green);
    shapes.rect(p.x - 1, p.y - 1, 3, 3, palette.amber);
    return;
  }

  if (tower.definitionId === 'singularity') {
    housing(-8, -8, 17, 17, palette.green);
    housing(-5, -5, 11, 11, core);
    housing(-2, -2, 5, 5, accent);
    box(0, 0, 1, 1, palette.amber);
    box(-2, -10, 5, 2, core);
    box(-2, 9, 5, 2, core);
    return;
  }

  if (tower.definitionId === 'bond') {
    const lit = context.controlActive;
    for (const x of [-8, 2]) {
      housing(x, -5, 7, 11, x < 0 ? core : palette.green);
      box(x + 2, -2, 3, 5, lit ? palette.amber : accent);
    }
    box(-2, -1, 5, 3, accent);
    box(-8, 7, 7, 2, core);
    box(2, 7, 7, 2, palette.green);
    return;
  }

  if (tower.definitionId === 'braid') {
    housing(-7, -8, 15, 17, core);
    box(-5, -7, 2, 9, accent);
    box(-5, 0, 10, 2, accent);
    box(3, 0, 2, 8, accent);
    box(3, -7, 2, 5, palette.green);
    box(-5, 4, 2, 4, palette.green);
    box(-5, -4, 10, 2, palette.green);
    box(-7, -9, 4, 2, palette.amber);
    box(4, 8, 4, 2, palette.amber);
    return;
  }

  if (tower.definitionId === 'breaker') {
    housing(-6, -3, 13, 10, core);
    box(-2, -10, 5, 9, accent);
    box(-8, -11, 17, 4, palette.amber);
    box(-8, -7, 3, 3, accent);
    box(6, -7, 3, 3, accent);
    box(-3, 0, 7, 2, palette.amber);
    box(-8, 5, 3, 3, core);
    box(6, 5, 3, 3, core);
    return;
  }

  if (tower.definitionId === 'crosswind') {
    housing(-5, -5, 11, 11, core);
    for (const y of [-3, 0, 3]) {
      box(-9, y, 6, 1, accent);
      box(4, y, 6, 1, palette.green);
    }
    box(-1, -3, 3, 7, palette.amber);
    box(0, -2, 1, 5, COLOR.black);
    return;
  }

  if (tower.definitionId === 'breakwater') {
    housing(-3, -6, 7, 13, accent);
    box(-9, -4, 19, 2, core);
    box(-9, -7, 3, 9, palette.amber);
    box(7, -7, 3, 9, palette.amber);
    box(-1, -1, 3, 6, palette.amber);
    box(-7, 6, 5, 2, accent);
    box(3, 6, 5, 2, accent);
    return;
  }

  if (tower.definitionId === 'tether') {
    shapes.rect(p.x - 3, p.y - 3, 7, 1, override?.accent || palette.cyan);
    shapes.rect(p.x - 3, p.y + 3, 7, 1, override?.accent || palette.cyan);
    shapes.rect(p.x - 3, p.y - 2, 1, 5, accent);
    shapes.rect(p.x + 3, p.y - 2, 1, 5, accent);
    shapes.rect(p.x - 1, p.y - 1, 3, 3, override?.core || palette.mint);
    shapes.rect(p.x, p.y - 7, 1, 4, core);
    shapes.rect(p.x, p.y + 4, 1, 3, core);
    shapes.rect(p.x - 6, p.y, 3, 1, core);
    shapes.rect(p.x + 4, p.y, 3, 1, core);
    return;
  }

  if (NETWORK_DESCENDANT_IDS.includes(tower.definitionId)) {
    const id = tower.definitionId;
    const color = override?.accent || palette.green;
    shapes.rect(p.x - 8, p.y - 8, 17, 17, COLOR.black);
    if (['redline', 'metronome', 'aperture'].includes(id)) {
      housing(-7, -6, 15, 13, color);
      for (const x of [-8, 6]) {
        box(x, -9, 3, 3, id === 'redline' ? palette.red : color);
        box(x, 7, 3, 3, color);
      }
      if (id === 'metronome') {
        box(-5, -3, 11, 1, palette.amber);
        box((Math.floor(runTick / 8) % 5) * 2 - 5, -4, 3, 3, palette.amber);
        box(-1, 1, 3, 4, core);
      } else if (id === 'aperture') {
        housing(-4, -4, 9, 9, core);
        box(-1, -1, 3, 3, accent);
      } else {
        for (const y of [-4, -1, 2]) box(-3, y, 7, 2, palette.amber);
        box(-3, 5, 7, 1, palette.red);
      }
    } else if (['mint', 'reactor', 'arsenal'].includes(id)) {
      shapes.rect(p.x - 7, p.y - 6, 15, 13, palette.amber);
      shapes.rect(p.x - 5, p.y - 4, 11, 9, COLOR.black);
      if (id === 'mint') for (const y of [-3, 0, 3]) shapes.rect(p.x - 3, p.y + y, 7, 1, color);
      if (id === 'reactor') for (const side of [-1, 1]) {
        box(side < 0 ? -10 : 3, -8, 8, 2, core);
        box(side * 10, -8, 2, 10, core);
        shapes.rect(p.x + side * 3 - 1, p.y, 3, 5, color);
      }
      if (id === 'arsenal') {
        shapes.rect(p.x - 6, p.y - 11, 3, 6, color);
        shapes.rect(p.x + 3, p.y - 9, 3, 4, color);
        shapes.rect(p.x - 2, p.y, 5, 5, palette.red);
      }
    } else {
      for (const side of [-1, 1]) {
        box(side * 7 - 1, -7, 3, 12, core);
        box(-7, 3, 15, 2, core);
        shapes.rect(p.x + side * 7 - 1, p.y - 9, 3, 3, color);
      }
      if (id === 'amplifier') {
        shapes.rect(p.x - 3, p.y - 5, 7, 9, palette.amber);
        shapes.rect(p.x - 1, p.y - 3, 3, 5, COLOR.black);
      } else if (id === 'echo') {
        shapes.rect(p.x - 3, p.y - 3, 3, 7, palette.mint);
        shapes.rect(p.x + 2, p.y - 5, 3, 7, palette.amber);
      } else {
        shapes.rect(p.x - 5, p.y + 3, 11, 5, color);

      }
    }
    return;
  }

  if (tower.definitionId === 'overclock') {
    shapes.rect(p.x - 5, p.y - 5, 11, 11, COLOR.black);
    shapes.rect(p.x, p.y - 7, 1, 15, palette.green);
    shapes.rect(p.x - 7, p.y, 15, 1, palette.green);
    shapes.rect(p.x - 4, p.y - 5, 2, 4, palette.amber);
    shapes.rect(p.x + 3, p.y - 5, 2, 4, palette.amber);
    shapes.rect(p.x - 4, p.y + 2, 2, 4, palette.amber);
    shapes.rect(p.x + 3, p.y + 2, 2, 4, palette.amber);
    shapes.rect(p.x - 2, p.y - 2, 5, 5, COLOR.black);
    shapes.rect(p.x - 1, p.y - 1, 3, 3, palette.mint);
    shapes.rect(p.x, p.y - 1, 1, 1, palette.amber);
    return;
  }

  if (tower.definitionId === 'forge') {
    shapes.rect(p.x - 6, p.y - 5, 13, 11, COLOR.black);
    shapes.rect(p.x - 5, p.y - 3, 11, 3, palette.amber);
    shapes.rect(p.x - 3, p.y, 7, 3, palette.amber);
    shapes.rect(p.x - 1, p.y + 3, 3, 4, palette.green);
    shapes.rect(p.x - 4, p.y + 6, 9, 1, palette.green);
    shapes.rect(p.x - 2, p.y - 7, 5, 4, palette.cyan);
    shapes.rect(p.x - 1, p.y - 6, 3, 2, COLOR.black);
    shapes.rect(p.x, p.y - 6, 1, 1, palette.mint);
    return;
  }

  if (tower.definitionId === 'relay') {
    shapes.rect(p.x - 5, p.y - 5, 11, 11, COLOR.black);
    shapes.rect(p.x, p.y - 8, 1, 15, palette.cyan);
    shapes.rect(p.x - 5, p.y + 4, 11, 2, palette.green);
    shapes.rect(p.x - 3, p.y + 2, 7, 2, palette.green);
    shapes.rect(p.x - 1, p.y, 3, 2, palette.mint);
    shapes.rect(p.x - 5, p.y - 6, 2, 2, palette.green);
    shapes.rect(p.x + 4, p.y - 6, 2, 2, palette.green);
    shapes.rect(p.x - 7, p.y - 3, 2, 2, palette.dimMint);
    shapes.rect(p.x + 6, p.y - 3, 2, 2, palette.dimMint);
    shapes.rect(p.x, p.y - 9, 1, 1, palette.amber);
    return;
  }

  if (tower.definitionId === 'network') {
    shapes.rect(p.x - 3, p.y - 3, 7, 7, COLOR.black);
    shapes.rect(p.x, p.y - 5, 1, 11, override?.accent || palette.green);
    shapes.rect(p.x - 5, p.y, 11, 1, override?.accent || palette.green);
    shapes.rect(p.x - 3, p.y - 3, 2, 2, core);
    shapes.rect(p.x + 2, p.y - 3, 2, 2, core);
    shapes.rect(p.x - 3, p.y + 2, 2, 2, core);
    shapes.rect(p.x + 2, p.y + 2, 2, 2, core);
    shapes.rect(p.x - 1, p.y - 1, 3, 3, override?.core || palette.mint);
    return;
  }

  shapes.rect(p.x - 3, p.y - 3, 7, 1, accent);
  shapes.rect(p.x - 3, p.y + 3, 7, 1, accent);
  shapes.rect(p.x - 3, p.y - 2, 1, 5, accent);
  shapes.rect(p.x + 3, p.y - 2, 1, 5, accent);
  shapes.rect(p.x - 1, p.y - 1, 3, 3, core);
  shapes.rect(p.x, p.y - 6, 1, 3, palette.amber);
}

