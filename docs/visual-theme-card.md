# framebound // portable visual theme

this is the handoff source of truth for carrying the framebound visual language into another project. preserve the system, not the game-specific nouns.

## theme signature

hard-pixel survival telemetry suspended over a near-black void. friendly information is surgical cyan and mint. danger is a dense hostile-red mass. the result should feel severe, alive, and slightly improvised—not glossy, nostalgic, or corporate.

three words: `hard // hostile // legible`

## non-negotiables

1. render on an integer logical-pixel grid. snap geometry and type to whole pixels.
2. enlarge only with nearest-neighbor integer scaling. never soften the final image.
3. keep the field near-black and let a few semantic colors do all the talking.
4. build interfaces from lines, brackets, gaps, and attached panels. no rounded cards.
5. show pressure through quantity and movement, not blur, bloom, gradients, or particles smeared into soup.

## palette

### core colors

| token | value | job |
| --- | --- | --- |
| `void` | `#010607` | dominant background, panel fill, negative space |
| `signal-cyan` | `#35f2ff` | towers, shots, targeting, information, slow status |
| `scar-mint` | `#55ffc2` | brand, selected state, rare bright terrain scars, stasis |
| `system-green` | `#74ff6a` | healthy/online state, network/control identity |
| `warning-amber` | `#ffc857` | currency, timers, pending actions, recall status |
| `hostile-red` | `#ff4d5a` | enemies, danger, destructive actions, failure |

### support colors

| token | value | job |
| --- | --- | --- |
| `ink` | `#bde9df` | neutral readable text |
| `dim-mint` | `#0e423b` | inactive borders, dividers, secondary telemetry |
| `nebula-core` | `#030c08` | organic field interior |
| `nebula-scratch` | `#062012` | sparse interior scratches |
| `nebula-edge` | `#0e4125` | subdued continuous terrain edge |
| `nebula-scar` | `#339e5c` | intermittent medium edge scar |
| `dim-star` | `#123d3b` | sparse background points and distant structure |

### color discipline

- `void` owns most of the frame.
- neutral copy uses `ink`; de-emphasized copy uses `dim-mint`.
- cyan and mint never become decorative ambient glow. they mark friendly, selected, or informative things.
- amber means attention without immediate failure.
- red is reserved for hostility, danger, destructive actions, and loss.
- a component gets one main accent at a time. do not rainbow every peer.

## typography and copy

- use a real 5×7 bitmap glyph atlas, not a softened monospace font pretending to be pixel art.
- supported display scale is normally 1×; use 2× only for major headings.
- all interface copy is lowercase.
- use short operational phrases: `build inside nebula`, `next rift 42s`, `kills 000184`.
- use `//` to separate adjacent thoughts or namespaces.
- use hard brackets and numeric prefixes for choices: `[1] deploy`, `2 sell 750`.
- use zero-padded telemetry where rhythm matters: `lives 020`, `credits 00420`, `fps 120`.
- use sentence punctuation rarely. the voice is terse, dry, and mildly hostile.

## geometry language

- base unit: 1 logical pixel.
- structural lines: 1px.
- active bars and major failure lines: 2px.
- compact sprite bodies: odd-numbered boxes such as 5×5, 9×9, 13×13.
- corners stay square. create identity with clipped spans, missing corners, and short accent scars.
- selections use broken brackets or crosshairs; never a soft halo.
- range and field previews use hard one-pixel circles, lines, sectors, or tiled masks.
- negative space is part of the object. advanced forms may be open structures with no backing plate.

## world grammar

### void

start with `void`. add very sparse one-pixel stars in `dim-star`, with rare `signal-cyan` hits. any large-scale grid is barely visible and incomplete.

### organic fields

use one authored silhouette per field, built from torn islands, angled wisps, or shallow bitten hubs. fill it with `nebula-core`. add sparse short horizontal scratches in `nebula-scratch`. keep the full edge subdued with `nebula-edge`; reserve bright mint for broken edge scars. avoid stacked-circle seams and enclosed cutout traps.

### hostiles

hostiles are chunky `hostile-red` squares. a crowd reads as a liquid because many discrete squares share momentum and pressure—not because the rendering is soft. compressed crowds remain visibly plural, with two-to-four separated blocks and a center overload pixel when needed.

### friendly technology

friendly forms are compact constructions of cyan, mint, green, and occasional amber pixels on black negative space. silhouettes must remain readable at their smallest scale. projectiles are visible physical marks; beams are hard bands with no glow.

### status marks

put one tiny contrasting square at the affected unit's center:

- slow: `signal-cyan`
- recall: `warning-amber`
- stasis: `scar-mint`

## interface recipes

### edge hud

- black strip attached to the top or bottom edge.
- one 1px `dim-mint` divider across the field.
- replace a short segment with the current section accent.
- add short 2px vertical bookends near the outer edges.
- keep telemetry inline; do not split every value into a card.

reference game proportions: a 640×360 logical frame uses a 23px top hud and a 31px bottom hud.

### tech panel

- solid `void` fill.
- four interrupted 1px `dim-mint` edge spans; corners are intentionally open.
- a short accent span begins at the top-left.
- a second tiny accent scar lands at the opposite lower corner.
- panel attaches to the world object or decision that summoned it.

### button

- 13–17px logical height.
- black fill with 1px top and bottom rules.
- inactive border: `dim-mint`; active/hover border: semantic accent.
- active state gains a 2–3px hard left rail.
- text stays centered or left-aligned on the pixel grid.
- never use radius, shadow, bevel, gradient, or glow.

### selection and targeting

- cursor: four detached crosshair ticks.
- object selection: broken square brackets or hard corner marks.
- valid action: cyan or mint.
- pending attention: amber.
- invalid or destructive: red.
- show essential state without requiring hover.

## layout

- the world is the dominant surface. ui hugs edges or attaches directly to selected objects.
- use dense horizontal telemetry for persistent facts and compact local panels for decisions.
- preserve large calm areas of black so swarms and signals can become visually loud.
- allow responsive reflow by hiding lower-priority telemetry before shrinking glyphs.
- never stretch a low-resolution frame fractionally. change the logical viewport, then scale it by an integer.

## motion and effects

- movement may interpolate in simulation space, but the rendered position snaps to logical pixels.
- use stepped pulses, hard wipes, moving sectors, discrete projectile trails, and short line discharges.
- communicate impact with occupancy, displacement, color swap, or a hard expanding boundary.
- do not use easing-heavy float, opacity fog, blur, bloom, lens effects, smooth gradients, or looping decorative motion.
- respect reduced-motion settings in non-game interfaces.

## forbidden drift

do not add:

- gradients, glow, blur, bloom, soft shadows, or translucent glass
- rounded cards, pills everywhere, beveled controls, or corporate dashboard chrome
- antialiased vector icons mixed into the pixel framebuffer
- ornamental cyan borders around every object
- soft-edged nebula clouds or painterly particle fog
- retro scanlines, chromatic aberration, crt curvature, or fake film grain unless a future project explicitly makes them part of its own concept
- uppercase interface copy

## portable token block

```css
:root {
  --fb-void: #010607;
  --fb-cyan: #35f2ff;
  --fb-mint: #55ffc2;
  --fb-green: #74ff6a;
  --fb-amber: #ffc857;
  --fb-red: #ff4d5a;
  --fb-ink: #bde9df;
  --fb-dim-mint: #0e423b;
  --fb-nebula-core: #030c08;
  --fb-nebula-scratch: #062012;
  --fb-nebula-edge: #0e4125;
  --fb-nebula-scar: #339e5c;
  --fb-dim-star: #123d3b;
}
```

## ready-to-paste handoff

```text
use the framebound visual system for this project: a dominant #010607 near-black field; hard integer pixels; nearest-neighbor scaling; lowercase 5x7 bitmap type; cyan #35f2ff for friendly information, mint #55ffc2 for selection and rare scars, green #74ff6a for online/system state, amber #ffc857 for attention and economy, red #ff4d5a for hostility and failure, neutral ink #bde9df, and dim structure #0e423b. build ui from interrupted 1px lines, brackets, short accent scars, edge-hugging hud strips, and compact attached panels. keep corners square and silhouettes readable through negative space. show pressure with many discrete moving marks. no gradients, glow, blur, bloom, soft shadows, glass, rounded cards, softened fonts, or generic neon dashboard styling. preserve the new project's own content and hierarchy; transfer the visual grammar, not framebound's game nouns.
```

## acceptance checklist

- [ ] every visible edge lands on a logical pixel
- [ ] final output is nearest-neighbor at an integer scale
- [ ] one semantic accent dominates each component
- [ ] type is truly bitmap and lowercase
- [ ] the world or content remains more prominent than chrome
- [ ] hostile red and friendly cyan/mint cannot be confused
- [ ] panels use interrupted lines and square geometry
- [ ] the design still reads with all decorative stars and scratches removed
- [ ] none of the forbidden soft effects slipped back in

## tower body contract

frame and its three direct replacements (assault, tether, network) are the reference. every existing and future turret is assembled from horizontal and vertical rectangles: square housings, inset cores, blunt barrels, cooling fins, rails, sockets and mechanical blocks. no diagonals, slanted silhouettes, angled components, triangular bodies or rotating body parts. animation moves indicators along straight rails or changes illumination. silhouettes remain stable.

`src/render/tower-sprites.js` owns body art for the world, placement previews and catalog. world-space links and combat geometry are separate. `npm run test:art` exercises every catalog entry with a rectangle-only drawing interface and checks integer geometry, sprite bounds, distinct designs and placement tint. preserve this gate for future forms. the bitmap atlas in `src/main.js` remains the typography source of truth.

## current rendering override

the game now renders at display pixel density with antialiasing. the earlier forced low-resolution enlargement and geometry-snapping requirements are superseded. the blocky tower body contract and authored bitmap lettering remain, but there is no full-scene pixelation filter. enemies use remaining-hp colours instead of a universally red body.


## subtle sleeping-machine network

linked nebulae reveal sparse, static, world-aligned circuit traces inside their silhouettes. traces disappear beyond zoom scale 5; ordinary link lines stay below enemy contrast and render underneath enemies. at most one two-pixel signal moves across the entire network for two seconds every eight seconds. paid research triggers one outward activation on existing traces only, lasting at most four seconds; repeated purchases replace the wave. no full-field flashes, tower-body blinking, glow, particles, or additional labels. reduced-motion preference disables both traveling effects. this is presentation only and does not change buff timing or network rules.
