import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  dts: false,
  // `@khata/shared` ships TypeScript source, so it has to be bundled in rather
  // than left as a bare import that Node could not resolve at runtime.
  // Everything else in `dependencies` stays external (tsup's default), so mongoose
  // and friends keep resolving their own optional/native bits at runtime.
  noExternal: ['@khata/shared'],
});
