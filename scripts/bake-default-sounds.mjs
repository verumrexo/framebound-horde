// Re-bake src/audio/default-sounds.js from the promoted part lab pack: every
// bound global hook's recipe becomes that hook's built-in default.
import { readFileSync, writeFileSync } from 'node:fs';
import { JfxrAdapter } from '../src/audio/jfxr-adapter.js';

const packPath = new URL('../public/part-lab/pack.json', import.meta.url);
const targetPath = new URL('../src/audio/default-sounds.js', import.meta.url);
const pack = JSON.parse(readFileSync(packPath, 'utf8'));
const byId = new Map(pack.sounds.map((sound) => [sound.id, sound]));
const source = readFileSync(targetPath, 'utf8');
const start = source.indexOf('export const DEFAULT_SOUND_RECIPES');
const current = source.slice(start, source.indexOf('});', start) + 3);
const tail = source.slice(source.indexOf('// Game-specific starting presets'));
const recipes = {};
for (const match of current.matchAll(/^  ([a-z_]+): (\{.*\}),?$/gm)) recipes[match[1]] = JSON.parse(match[2]);

const changed = [];
for (const binding of pack.bindings) {
  if (!binding.eventKey.startsWith('global:')) continue;
  const hook = binding.eventKey.slice('global:'.length);
  const sound = byId.get(binding.soundId);
  if (!sound || !(hook in recipes)) { console.warn(`skip ${binding.eventKey}`); continue; }
  if (JSON.stringify(recipes[hook]) !== JSON.stringify(sound.recipe)) changed.push(`${hook} <- ${sound.name}`);
  recipes[hook] = sound.recipe;
}

let out = `// Baked jfxr recipes for every built-in sound hook. The horde ships no audio files;
// these render at startup so every slot has an audible default until the part lab
// assigns a saved Signal Forge sound. Baked from the promoted part lab pack
// (${pack.modifiedAt.slice(0, 10)}) by scripts/bake-default-sounds.mjs; never edit by hand.
export const DEFAULT_SOUND_RECIPES = Object.freeze({
`;
for (const [key, value] of Object.entries(recipes)) out += `  ${key}: ${JSON.stringify(value)},\n`;
out += `});\n\n${tail}`;
writeFileSync(targetPath, out);

const adapter = new JfxrAdapter();
for (const [id, recipe] of Object.entries(recipes)) {
  const rendered = await adapter.render(recipe);
  console.log(`${id.padEnd(20)}${rendered.duration.toFixed(2)}s peak ${rendered.peak.toFixed(2)}${rendered.peak < 0.01 ? '  <-- silent' : ''}`);
}
console.log(`pack ${pack.modifiedAt} // changed: ${changed.length ? changed.join(', ') : 'none'}`);
