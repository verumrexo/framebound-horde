import { build } from 'vite';

// Kept as a compatible entry point for old local build commands.
await build({ root: new URL('..', import.meta.url).pathname });
