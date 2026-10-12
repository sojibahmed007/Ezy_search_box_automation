const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ storageState: 'storageState.json' });

  page.on('request', r => {
    if (r.url().includes('search')) {
      console.log('SEARCH REQUEST:', r.method(), r.url());
    }
  });

  page.on('response', async res => {
    if (res.url().includes('search')) {
      console.log('SEARCH RESPONSE:', res.status(), res.url());
      try {
        const text = await res.text();
        console.log('RESPONSE BODY SAMPLE:', text.slice(0, 200));
      } catch (e) {}
    }
  });

  await page.goto('https://sojibahmed.communitycdn.net/feeds');
  await page.waitForTimeout(2000);
  const btn = page.locator('button:has-text("Search"), button[aria-label*="Search" i]').first();
  await btn.click();
  const input = page.getByRole('textbox', { name: 'Search community' });
  await input.fill('member');
  await page.waitForTimeout(3000);

  await browser.close();
})();
