import { chromium } from '@playwright/test';

async function checkFailCandidates() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'storageState.json' });
  const page = await context.newPage();
  await page.goto('https://sojibahmed.communitycdn.net/feeds', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const searchBtn = page.locator('button:has-text("Search"), button[aria-label*="Search" i]').first();
  await searchBtn.click();
  const input = page.getByRole('textbox', { name: 'Search community' });
  await input.waitFor({ state: 'visible' });

  // 1. Check maxlength attribute
  const maxlength = await input.getAttribute('maxlength');
  console.log('1. maxlength attribute on search input:', maxlength);

  // 2. Check garbage search
  await input.fill('qwertyuiop_not_exist_99999');
  await page.waitForTimeout(2000);
  const text = await page.locator('[role="dialog"]').innerText();
  console.log('2. Search dialog text on non-existent query:', text.replace(/\n+/g, ' | '));

  // 3. Check what happens on 5000 characters search request
  let bufferStatus: number | undefined;
  page.on('response', res => {
    if (res.url().includes('/api/search/')) bufferStatus = res.status();
  });
  await input.fill('A'.repeat(5000));
  await page.waitForTimeout(2000);
  console.log('3. API status for 5,000 char payload:', bufferStatus);

  // 4. Check Focus Trap (accessibility standard)
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
  const isInsideDialog = await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null);
  console.log('4. Focus trapped inside dialog after Tabbing:', isInsideDialog, 'Active element:', focusedTag);

  await browser.close();
}

checkFailCandidates().catch(console.error);
