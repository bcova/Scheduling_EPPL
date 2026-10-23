// Browser test of the web app using the fake server.  Run:  node dev/build-preview.js && node dev/ui.test.js
// Needs Playwright + Chromium (set PW_MODULE / CHROME if they live elsewhere).
const assert = require('assert');
const { chromium } = require(process.env.PW_MODULE || 'playwright');
const URL = 'file://' + require('path').join(__dirname, 'preview.html');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const errors = [];
  async function open(query, vp) {
    const page = await browser.newPage({ viewport: vp || { width: 1400, height: 900 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(URL + query);
    await page.waitForSelector('.daycol');
    await page.waitForTimeout(150);
    return page;
  }
  const lane = (page, date) => page.locator(`.daycol[data-date="${date}"] .shiftlane`);
  async function dragIn(page, date, y1, y2) { // y relative to day column top
    const b = await page.locator(`.daycol[data-date="${date}"]`).boundingBox();
    const x = b.x + b.width * 0.8;
    await page.mouse.move(x, b.y + y1); await page.mouse.down();
    await page.mouse.move(x, b.y + (y1 + y2) / 2, { steps: 4 }); await page.mouse.move(x, b.y + y2, { steps: 4 });
    await page.mouse.up();
  }

  // ---------- 1. schedulers can drag-create, save, and see the result ----------
  let page = await open('?role=ys');
  const before = await page.locator('.blk').count();
  await dragIn(page, '2026-05-08', 2, 46 * 3);                    // Fri 9:00 -> 12:00 (46px/hour, column starts at 9am)
  await page.waitForSelector('dialog[open]');
  assert.strictEqual(await page.inputValue('#fStart'), '09:00');
  assert.strictEqual(await page.inputValue('#fEnd'), '12:00');
  assert.strictEqual(await page.inputValue('#fDate'), '2026-05-08');
  await page.selectOption('#fName', 'Halle');
  await page.waitForSelector('#conf .ok');                           // no conflicts -> green tick
  await page.click('#fSave');
  await page.waitForFunction(n => document.querySelectorAll('.blk').length === n, before + 1);
  assert.strictEqual(await page.locator('.daycol[data-date="2026-05-08"] .blk').count(), 1);
  console.log('✓ drag to create + save');

  // ---------- 2. live conflict warning inside the dialog ----------
  await lane(page, '2026-05-05').click({ position: { x: 20, y: 46 * 7 } }); // Tue ~4pm
  await page.waitForSelector('dialog[open]');
  await page.selectOption('#fName', 'Jess');                          // Jess runs Gaming Lounge Tue 3:30-8:30
  await page.waitForSelector('#conf .c');
  assert(/Gaming Lounge/.test(await page.textContent('#conf')));
  await page.click('#fCancel');
  console.log('✓ live conflict text in dialog');

  // ---------- 3. drag to move: shows red hint over a conflict, saves on drop ----------
  const blk = page.locator('.daycol[data-date="2026-05-07"] .blk').first();     // Arantza 9a-3p Thu
  const bb = await blk.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + 30); await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + 60, { steps: 5 });
  assert(await page.locator('#hint').isVisible());
  await page.mouse.up();
  await page.waitForFunction(() => /9:45a/.test(document.querySelector('.daycol[data-date="2026-05-07"] .blk .bt').textContent));
  const t = await page.locator('.daycol[data-date="2026-05-07"] .blk .bt').first().textContent();
  assert.strictEqual(t, '9:45a–3:45p');
  console.log('✓ drag to move saves (' + t + ')');

  // ---------- 4. Monday: dragging Halle onto Jess's program turns red ----------
  const hal = page.locator('.daycol[data-date="2026-05-04"] .blk', { hasText: 'Halle' });
  await hal.waitFor();
  console.log('✓ Halle block present');

  // ---------- 5. delete ----------
  const cnt = await page.locator('.blk').count();
  await page.locator('.daycol[data-date="2026-05-08"] .blk').first().click();
  await page.waitForSelector('#fDel');
  await page.click('#fDel');
  await page.waitForFunction(n => document.querySelectorAll('.blk').length === n, cnt - 1);
  console.log('✓ delete');

  // ---------- 6. sidebar focus + dept toggle ----------
  await page.click('.person[data-who="Katie"]');
  assert(await page.locator('.blk.dim').count() > 0);
  await page.click('#deptSeg button[data-dept="AS"]');
  assert.strictEqual(await page.getAttribute('body', 'data-dept'), 'AS');
  assert(/view only/i.test(await page.textContent('#me')));          // a YS scheduler can only view AS
  await page.locator('.daycol[data-date="2026-05-08"] .shiftlane').click({ position: { x: 20, y: 100 } });  // empty AS spot
  assert.strictEqual(await page.locator('dialog[open]').count(), 0, 'view-only user must not get a create dialog');
  console.log('✓ focus + dept toggle + permission (YS scheduler cannot edit AS)');
  await page.close();

  // ---------- 7. plain staff: read-only everywhere ----------
  page = await open('?role=staff&as=Katie');
  assert(await page.evaluate(() => document.body.classList.contains('ro')));
  assert(await page.locator('#btnPublish').isDisabled());
  await page.locator('.blk').first().click();
  await page.waitForSelector('dialog[open]');
  assert.strictEqual(await page.locator('#fSave').count(), 0);
  assert.strictEqual(await page.locator('#fDel').count(), 0);
  await page.click('#fCancel');
  console.log('✓ staff are read-only');

  // ---------- 8. My Shifts ----------
  await page.click('#viewTabs button[data-view="my"]');
  await page.waitForSelector('.myday');
  const mine = await page.textContent('.my');
  assert(/Katie/.test(mine) && /DESK/.test(mine) && /PROGRAM/.test(mine), 'my shifts lists desk + program');
  console.log('✓ My Shifts');
  await page.close();

  // ---------- 9. phone ----------
  page = await open('?role=staff', { width: 390, height: 800 });
  assert(await page.locator('#daypills button').count() === 7);
  assert.strictEqual(await page.locator('.daycol').count(), 1, 'one day at a time on phones');
  await page.click('#daypills button[data-i="2"]');
  assert.strictEqual(await page.locator('.daycol').getAttribute('data-date'), '2026-05-05');
  console.log('✓ phone layout');
  await page.close();

  await browser.close();
  assert.deepStrictEqual(errors, [], 'browser errors: ' + errors.join(' | '));
  console.log('\nAll UI checks passed.');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
