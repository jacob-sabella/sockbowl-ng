import { test, expect } from '@playwright/test';

/** The judge-accepted primary answer: the underlined/bold portion of the qbreader HTML. */
function primary(html: string): string {
  const m = (html || '').match(/<u[^>]*>([\s\S]*?)<\/u>/i) || (html || '').match(/<b[^>]*>([\s\S]*?)<\/b>/i);
  let s = m ? m[1] : (html || '');
  s = s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return ((s.split(/[[(]/)[0] || '').trim()).slice(0, 40);
}

async function tossupAnswerFor(id: string): Promise<string> {
  const Q = `query($id: ID!){ getPacketById(id:$id){ tossups{ order tossup{ answer } } bonuses{ order bonus{ bonusParts{ id } } } } }`;
  const gql: any = await fetch('https://questions.sockbowl.com/graphql', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: Q, variables: { id } }),
  }).then(r => r.json());
  const pk = gql.data.getPacketById;
  // The game reads tossups in `order`; tossup 0 pairs with a bonus. Return its answer.
  return primary(pk.tossups.slice().sort((a: any, b: any) => a.order - b.order)[0].tossup.answer);
}

// A correct tossup in auto-judged mode triggers a 3-part bonus for that team. This
// plays the whole bonus to make sure it advances part-by-part and completes rather
// than stalling (there is no human proctor to advance the bonus reads).
test('Auto-judged bonus flow advances through all parts without stalling', async ({ page, browser }) => {
  // Host creates the auto-judged room and takes a team.
  await page.goto('/game-session');
  await page.getByRole('button', { name: /New game/ }).click();
  await page.getByRole('button', { name: /Auto-judged match/ }).click();
  await page.waitForURL('**/game;**', { timeout: 25_000 });
  const code = (await page.locator('.code-value').innerText()).trim();
  await page.locator('.team__actions button').first().click();

  // A second player takes the other team.
  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  await guest.goto('/game-session');
  await guest.getByRole('button', { name: /Join with a code/ }).click();
  await guest.getByLabel('Join Code').fill(code);
  await guest.getByLabel('Name').fill('Robin');
  await guest.getByRole('button', { name: 'Join', exact: true }).click();
  await guest.waitForURL('**/game;**', { timeout: 25_000 });
  await guest.locator('.team__actions button').last().click();

  // Generate a small packet from the UI, capturing its id to look up the tossup answer.
  let packetId = '';
  let tossupAns = '';
  page.on('response', async (r) => {
    if (r.url().includes('/import-random')) {
      try { packetId = (await r.json()).id; } catch { /* ignore */ }
    }
  });
  const dialog = page.locator('.packet-search-dialog');
  for (let attempt = 0; attempt < 4; attempt++) {
    packetId = '';
    await page.getByRole('button', { name: /Find a Packet/ }).click();
    await dialog.getByRole('tab', { name: 'Generate', exact: true }).click();
    await expect(dialog.getByText(/tossups/).first()).toBeVisible({ timeout: 20_000 });
    const nums = dialog.locator('.qb-num-field input');
    await nums.nth(0).fill('2');   // tossups
    await nums.nth(1).fill('2');   // bonuses
    await page.waitForTimeout(600);
    await dialog.getByRole('button', { name: /Generate & use/ }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    expect(packetId).toBeTruthy();
    tossupAns = await tossupAnswerFor(packetId);
    if (tossupAns) break;
  }
  expect(tossupAns).toBeTruthy();

  // Enable bonuses (the toggle shows because the generated packet carries bonuses).
  await page.getByText('Enable Bonuses').click();
  await page.waitForTimeout(500);

  // Start; answer the tossup correctly to earn the bonus.
  await page.getByRole('button', { name: /Start Match/ }).click();
  await page.locator('.game-proctor').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1200);
  await page.locator('.buzz-btn').click();
  await page.locator('.answer-input').fill(tossupAns);
  await page.locator('.answer-form button[type="submit"]').click();

  // The bonus must start (correct tossup) — this is the state that used to stall the game.
  await expect(page.getByText(/Bonus for/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/part 1 of \d/)).toBeVisible({ timeout: 8_000 });

  // Answer each bonus part (correctness is irrelevant to flow) until the round completes.
  // If the bonus stalled, the part would never change and this would time out.
  for (let guard = 0; guard < 10; guard++) {
    if (await page.locator('.verdict-line').isVisible().catch(() => false)) break;
    const inBonus = await page.getByText(/Bonus for/).isVisible().catch(() => false);
    const hasForm = await page.locator('.answer-form').isVisible().catch(() => false);
    if (inBonus && hasForm) {
      await page.locator('.answer-input').fill('x');
      await page.locator('.answer-form button[type="submit"]').click();
      await page.waitForTimeout(1500);
    } else {
      await page.waitForTimeout(800);
    }
  }

  // The round completed and the game moved on (no stall).
  await expect(page.locator('.verdict-line')).toBeVisible({ timeout: 12_000 });

  await guestCtx.close();
});
