import { chromium } from '@playwright/test';
import { APP_URL } from '../harness/config.js';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 280, height: 653 } });
await p.goto(APP_URL, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);
const wide = await p.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const out: string[] = [];
  for (const el of Array.from(document.querySelectorAll('*'))) {
    const r = el.getBoundingClientRect();
    if (r.right > vw + 2 || r.left < -2) out.push(`${el.tagName}.${(el.className||'').toString().split(' ')[0]} L=${Math.round(r.left)} R=${Math.round(r.right)} w=${Math.round(r.width)}`);
  }
  return out.slice(0, 14);
});
console.log('overflowing at 280px:\n' + wide.join('\n'));
await b.close();
