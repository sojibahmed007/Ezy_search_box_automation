import { chromium } from '@playwright/test';
import * as fs from 'fs';
import { getCommunityCredentials } from './auth-env';

async function generateAuth() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Logging in to save auth state...');
  await page.goto('https://sojibahmed.communitycdn.net/feeds', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const loginBtn = page.locator('button:has-text("Log in")').first();
  await loginBtn.waitFor({ state: 'visible', timeout: 10000 });
  await loginBtn.click();

  const emailInput = page.locator('input[type="email"], input[placeholder*="email" i], input[placeholder*="example.com" i], input[name="email"]').first();
  await emailInput.waitFor({ state: 'visible' });
  const { email, password } = getCommunityCredentials();
  await emailInput.fill(email);

  const passInput = page.locator('input[type="password"]').first();
  await passInput.fill(password);

  const submitBtn = page.locator('[role="dialog"] button:has-text("Log in"), button[type="submit"]:has-text("Log in")').last();
  await submitBtn.click();
  await page.waitForTimeout(3000);

  await context.storageState({ path: 'storageState.json' });
  console.log('✅ Saved storageState.json successfully!');

  await browser.close();
}

generateAuth().catch(err => {
  console.error(err);
  process.exit(1);
});
