import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: { include: ['tests/**/*.test.ts'], coverage: { provider: 'v8', include: ['src/lib/domain/**/*.ts'], reporter: ['text', 'json-summary', 'json', 'html'], thresholds: { branches: 80 } } },
});
