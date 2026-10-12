import { chromium } from '@playwright/test';
import { getCommunityCredentials } from './auth-env';

async function testLogin() {
  console.log('1. Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  console.log('2. Navigating to feeds...');
  await page.goto('https://sojibahmed.communitycdn.net/feeds', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  console.log('3. Checking login button...');
  const headerLoginBtn = page.locator('header button:has-text("Log in"), button:has-text("Log in")').first();
  await headerLoginBtn.waitFor({ state: 'visible', timeout: 10000 });
  await headerLoginBtn.click();

  console.log('4. Waiting for email field...');
  const emailInput = page.locator('input[type="email"], input[placeholder*="email" i], input[placeholder*="example.com" i], input[name="email"]').first();
  await emailInput.waitFor({ state: 'visible', timeout: 10000 });
  const { email, password } = getCommunityCredentials();
  await emailInput.fill(email);

  console.log('5. Filling password...');
  const passInput = page.locator('input[type="password"]').first();
  await passInput.fill(password);

  console.log('6. Submitting login and waiting for /api/auth/login response...');
  const submitBtn = page.locator('[role="dialog"] button:has-text("Log in"), button[type="submit"]:has-text("Log in")').last();

  const [response] = await Promise.all([
    page.waitForResponse(res => res.url().includes('/api/auth/login'), { timeout: 15000 }),
    submitBtn.click()
  ]);

  console.log(`7. Login API responded with HTTP: ${response.status()}`);
  await page.waitForTimeout(3000);

  // Check search button
  const searchBtn = page.locator('button:has-text("Search"), button[aria-label*="Search" i]').first();
  await searchBtn.waitFor({ state: 'visible', timeout: 10000 });
  console.log('8. Search button is visible and ready!');

  await context.storageState({ path: 'storageState.json' });
  console.log('9. Updated storageState.json with active session!');

  await browser.close();
  console.log('✅ LOGIN VERIFIED 100% SUCCESSFULLY!');
}

testLogin().catch(err => {
  console.error('❌ Login error:', err);
  process.exit(1);
});
