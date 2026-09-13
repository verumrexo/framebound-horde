import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = ['src', 'scripts'].flatMap((directory) => readdirSync(new URL(`../${directory}/`, import.meta.url), { recursive: true })
  .filter((file) => /\.m?js$/.test(file))
  .map((file) => `${directory}/${file}`));
files.push('vite.config.js');

for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`syntax: ${files.length} javascript modules passed`);
