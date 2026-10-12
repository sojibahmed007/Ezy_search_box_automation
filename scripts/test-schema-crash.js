const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ storageState: 'storageState.json' });

  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('CONSOLE ERROR:', msg.text());
  });

  await page.route('**/api/search/v1*', route => {
    console.log('INTERCEPTED ROUTE:', route.request().url());
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 200, data: { records: 'NOT_AN_ARRAY_CORRUPTED' } }),
    });
  });

  await page.goto('https://sojibahmed.communitycdn.net/feeds');
  await page.waitForTimeout(2000);
  const btn = page.locator('button:has-text("Search"), button[aria-label*="Search" i]').first();
  await btn.click();
  const input = page.getByRole('textbox', { name: 'Search community' });
  await input.fill('trigger-schema-bug');
  await page.waitForTimeout(3000);

  await browser.close();
})();
