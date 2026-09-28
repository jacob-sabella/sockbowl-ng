/** Tiny JSON fixture loader (kept out of `manifest.ts` so scenarios only pull in what they use). */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url));

export function loadFixture<T = unknown>(relativePath: string): T {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, relativePath), 'utf8')) as T;
}
