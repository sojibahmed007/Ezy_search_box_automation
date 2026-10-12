import { test, expect, Page, BrowserContext } from '@playwright/test';
import { SearchModal } from '../pages/SearchModal';
import { getCommunityCredentials } from '../scripts/auth-env';

test.describe('Community Search Box - Aggressive Break & Security Test Suite', () => {
  let context: BrowserContext;
  let page: Page;
  let searchModal: SearchModal;
  let lastTestFailed = false;

  // =========================================================================
  // SETUP: LOG IN EXACTLY ONCE BEFORE RUNNING ANY TESTS
  // =========================================================================
  test.beforeAll(async ({ browser }) => {
    console.log('\n=========================================');
    console.log('🔐 [1-TIME SETUP] Logging in once as Admin...');
    console.log('=========================================');

    const fs = require('fs');
    const hasStorage = fs.existsSync('storageState.json');

    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
      storageState: hasStorage ? 'storageState.json' : undefined,
    });
    page = await context.newPage();
    searchModal = new SearchModal(page);

    await page.goto('https://sojibahmed.communitycdn.net/feeds', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const loginButton = page.locator('header button:has-text("Log in"), button:has-text("Log in")').first();
    let needsLogin = await loginButton.isVisible({ timeout: 3000 }).catch(() => false);

    if (needsLogin) {
      console.log('   Clicking header Log in button...');
      await loginButton.click();

      const { email, password } = getCommunityCredentials();
      const emailInput = page.locator('input[type="email"], input[placeholder*="email" i], input[placeholder*="example.com" i], input[name="email"]').first();
      await emailInput.waitFor({ state: 'visible', timeout: 10000 });
      await emailInput.fill(email);

      const passwordInput = page.locator('input[type="password"]').first();
      await passwordInput.fill(password);

      console.log('   Submitting credentials and waiting for /api/auth/login HTTP 200 response...');
      const submitBtn = page.locator('[role="dialog"] button:has-text("Log in"), button[type="submit"]:has-text("Log in")').last();

      await Promise.all([
        page.waitForResponse(res => res.url().includes('/api/auth/login') && res.status() === 200, { timeout: 20000 }),
        submitBtn.click(),
      ]);

      console.log('   ✅ Backend confirmed login HTTP 200!');
      await page.waitForTimeout(2000);

      // Save updated auth state so future runs are instant
      await context.storageState({ path: 'storageState.json' });
    } else {
      console.log('   Already authenticated via active session!');
    }

    console.log('   Ensuring search trigger is ready...');
    const searchTrigger = page.locator('button:has-text("Search"), button[aria-label*="Search" i]').first();
    await searchTrigger.waitFor({ state: 'visible', timeout: 15000 });

    console.log('   Opening search modal...');
    await searchModal.openViaButton();
    console.log('✅ Logged in successfully and search box is ready!\n');
  });

  test.afterAll(async () => {
    if (context) {
      await context.close();
    }
  });

  // =========================================================================
  // HOOK: CAPTURE SCREENSHOT FOR EACH AND EVERY TEST CASE (PASS OR FAIL)
  // =========================================================================
  test.afterEach(async ({}, testInfo) => {
    lastTestFailed = (testInfo.status !== 'passed' || (testInfo.errors && testInfo.errors.length > 0));

    if (page && !page.isClosed()) {
      const fs = require('fs');
      if (!fs.existsSync('screenshots')) {
        fs.mkdirSync('screenshots', { recursive: true });
      }

      const idMatch = testInfo.title.match(/^[A-Z]+-\d+/);
      const testId = idMatch ? idMatch[0] : 'TEST';
      const isPass = !lastTestFailed;
      const statusLabel = isPass ? 'PASS' : 'FAIL';
      const safeTitle = testInfo.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 35);
      const screenshotPath = `screenshots/${testId}_${statusLabel}_${safeTitle}.png`;

      try {
        await page.screenshot({ path: screenshotPath });
        await testInfo.attach(`screenshot_${testId}_${statusLabel}`, {
          path: screenshotPath,
          contentType: 'image/png',
        });
        console.log(`   📸 [Screenshot Recorded]: ${screenshotPath} [${statusLabel}]`);
      } catch (err: any) {
        console.log(`   ⚠️ Screenshot capture error for ${testId}: ${err.message}`);
      }
    }
  });

  // Helper to ensure search modal is open before each test without reloading page (auto-heals if prior test failed)
  async function ensureSearchModalOpen() {
    if (lastTestFailed) {
      console.log('   🔄 [State Reset] Restoring clean page state after failure...');
      await page.goto('https://sojibahmed.communitycdn.net/feeds', { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(1500);
      lastTestFailed = false;
    }

    try {
      const isVisible = await searchModal.searchInput.isVisible().catch(() => false);
      if (!isVisible) {
        await searchModal.openViaButton();
      }
      await searchModal.searchInput.fill('');
      await page.waitForTimeout(200);
    } catch (err) {
      console.log('   🔄 [Self-Healing] Restoring search modal & page state...');
      await page.goto('https://sojibahmed.communitycdn.net/feeds', { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(1500);
      await searchModal.openViaButton();
      await searchModal.searchInput.fill('');
      await page.waitForTimeout(200);
    }
  }

  // =========================================================================
  // 1. SECURITY & INJECTION VULNERABILITY TESTS
  // =========================================================================
  test.describe('1. Security & Injection Payloads', () => {
    test('SEC-01: Reflected/Stored XSS Script Tag Injection', async () => {
      await ensureSearchModalOpen();
      await searchModal.search('<script>window.__xss_fired=true</script>');
      await page.waitForTimeout(1500);

      const executed = await page.evaluate(() => (window as any).__xss_fired === true);
      expect(executed).toBe(false);

      const rawScripts = await page.locator('script:has-text("window.__xss_fired")').count();
      expect(rawScripts).toBe(0);
    });

    test('SEC-02: XSS IMG Tag with Onerror Payload', async () => {
      await ensureSearchModalOpen();
      await searchModal.search('<img src=x onerror="window.__xss_img=true">');
      await page.waitForTimeout(1500);

      const executed = await page.evaluate(() => (window as any).__xss_img === true);
      expect(executed).toBe(false);
    });

    test('SEC-03: XSS SVG Tag with Onload Payload', async () => {
      await ensureSearchModalOpen();
      await searchModal.search('<svg onload="window.__xss_svg=true">');
      await page.waitForTimeout(1500);

      const executed = await page.evaluate(() => (window as any).__xss_svg === true);
      expect(executed).toBe(false);
    });

    test('SEC-04: SQL Injection - Boolean Bypass Payload', async () => {
      let status: number | undefined;
      const responseListener = (res: any) => {
        if (res.url().includes('/api/search/')) status = res.status();
      };
      page.on('response', responseListener);

      await ensureSearchModalOpen();
      await searchModal.search("' OR '1'='1");
      await page.waitForTimeout(1500);

      page.off('response', responseListener);
      if (status !== undefined) {
        expect(status).not.toBe(500);
      }
    });

    test('SEC-05: SQL Injection - Stacked DROP TABLE Payload', async () => {
      let status: number | undefined;
      const responseListener = (res: any) => {
        if (res.url().includes('/api/search/')) status = res.status();
      };
      page.on('response', responseListener);

      await ensureSearchModalOpen();
      await searchModal.search("'; DROP TABLE members; --");
      await page.waitForTimeout(1500);

      page.off('response', responseListener);
      if (status !== undefined) {
        expect(status).not.toBe(500);
      }
    });

    test('SEC-06: SQL Injection - UNION SELECT Payload', async () => {
      let status: number | undefined;
      const responseListener = (res: any) => {
        if (res.url().includes('/api/search/')) status = res.status();
      };
      page.on('response', responseListener);

      await ensureSearchModalOpen();
      await searchModal.search("' UNION SELECT 1,2,3,4,5,6,7,8,9,10 --");
      await page.waitForTimeout(1500);

      page.off('response', responseListener);
      if (status !== undefined) {
        expect(status).not.toBe(500);
      }
    });

    test('SEC-07: NoSQL Injection Object Syntax', async () => {
      await ensureSearchModalOpen();
      await searchModal.search('{"$gt": ""}');
      await page.waitForTimeout(1500);
      await expect(searchModal.dialog).toBeVisible();
    });

    test('SEC-08: Server-Side Template Injection (SSTI)', async () => {
      await ensureSearchModalOpen();
      await searchModal.search('{{7*7}}');
      await page.waitForTimeout(1500);

      const dialogText = await searchModal.dialog.innerText();
      const evaluated = dialogText.includes('49') && !dialogText.includes('{{7*7}}');
      expect(evaluated).toBe(false);
    });

    test('SEC-09: Directory / Path Traversal Payload', async () => {
      await ensureSearchModalOpen();
      await searchModal.search('../../../../etc/passwd');
      await page.waitForTimeout(1500);
      await expect(searchModal.dialog).toBeVisible();
    });
  });

  // =========================================================================
  // 2. BOUNDARY, EXTREME BUFFER & FUZZING TESTS
  // =========================================================================
  test.describe('2. Boundary, Buffer Overflow & Extreme Inputs', () => {
    test('BND-01: Massive Character Payload (5,000 characters)', async () => {
      await ensureSearchModalOpen();
      const massiveString = 'A'.repeat(5000);
      await searchModal.searchInput.fill(massiveString);
      await page.waitForTimeout(1500);

      await expect(searchModal.dialog).toBeVisible();
      const box = await searchModal.dialog.boundingBox();
      expect(box).not.toBeNull();
    });

    test('BND-02: Single Massive Word Without Spaces (Word-Break Check)', async () => {
      await ensureSearchModalOpen();
      const longWord = 'W'.repeat(800);
      await searchModal.searchInput.fill(longWord);
      await page.waitForTimeout(1500);

      const box = await searchModal.dialog.boundingBox();
      const viewport = page.viewportSize();
      if (box && viewport) {
        expect(box.width).toBeLessThanOrEqual(viewport.width);
      }
    });

    test('BND-03: Zalgo Glitch Characters and Combining Marks', async () => {
      await ensureSearchModalOpen();
      await searchModal.search('T̷h̵i̸s̶ ̷i̶s̵ ̷b̸r̴o̴k̶e̶n̵ ̶z̷a̸l̶g̴o̵');
      await page.waitForTimeout(1200);
      await expect(searchModal.dialog).toBeVisible();
    });

    test('BND-04: BiDi & Right-To-Left Override (RLO) Characters', async () => {
      await ensureSearchModalOpen();
      await searchModal.search('\u202Ereversed_text_payload');
      await page.waitForTimeout(1200);
      await expect(searchModal.dialog).toBeVisible();
    });

    test('BND-05: Multilingual Scripts and Complex Emojis', async () => {
      await ensureSearchModalOpen();
      await searchModal.search('👨‍👩‍👧‍👦 🔥 🚀 বাংলা অনুসন্ধান поиск 検索');
      await page.waitForTimeout(1200);
      await expect(searchModal.dialog).toBeVisible();
    });

    test('BND-06: Raw Percent and Malformed URI Characters', async () => {
      let pageError: string | null = null;
      const errorListener = (err: any) => (pageError = err.message);
      page.on('pageerror', errorListener);

      await ensureSearchModalOpen();
      await searchModal.search('%');
      await page.waitForTimeout(1200);

      page.off('pageerror', errorListener);
      expect(pageError).toBeNull();
    });

    test('BND-07: URL Reserved Control Characters', async () => {
      await ensureSearchModalOpen();
      await searchModal.search('?&=#%+/:;');
      await page.waitForTimeout(1200);
      await expect(searchModal.dialog).toBeVisible();
    });

    test('BND-08: ReDoS Regex Patterns and Unclosed Brackets', async () => {
      let pageError: string | null = null;
      const errorListener = (err: any) => (pageError = err.message);
      page.on('pageerror', errorListener);

      await ensureSearchModalOpen();
      await searchModal.search('(a+)+$ [a-z');
      await page.waitForTimeout(1200);

      page.off('pageerror', errorListener);
      expect(pageError).toBeNull();
      await expect(searchModal.dialog).toBeVisible();
    });
  });

  // =========================================================================
  // 3. WHITESPACE & EMPTY STATES
  // =========================================================================
  test.describe('3. Whitespace & Empty Variations', () => {
    test('WHT-01: Whitespace-Only Queries', async () => {
      await ensureSearchModalOpen();
      await searchModal.search('     ');
      await page.waitForTimeout(1000);
      await expect(searchModal.dialog).toBeVisible();
    });

    test('WHT-02: Tabs and Newline Characters', async () => {
      await ensureSearchModalOpen();
      await searchModal.search('\t\n\t');
      await page.waitForTimeout(1000);
      await expect(searchModal.dialog).toBeVisible();
    });

    test('WHT-03: Zero-Width Characters', async () => {
      await ensureSearchModalOpen();
      await searchModal.search('\u200B\u200C\u200D');
      await page.waitForTimeout(1000);
      await expect(searchModal.dialog).toBeVisible();
    });
  });

  // =========================================================================
  // 4. CONCURRENCY, DEBOUNCE & RACE CONDITIONS
  // =========================================================================
  test.describe('4. Concurrency & Race Conditions', () => {
    test('RACE-01: Rapid Typing Keystroke Flood & Debounce Storm', async () => {
      await ensureSearchModalOpen();
      await searchModal.searchInput.pressSequentially('supercalifragilistic', { delay: 10 });
      for (let i = 0; i < 10; i++) {
        await searchModal.searchInput.press('Backspace');
      }
      await searchModal.searchInput.pressSequentially('member', { delay: 20 });
      await page.waitForTimeout(2000);

      const val = await searchModal.getInputValue();
      expect(val).toContain('member');
    });

    test('RACE-02: Rapid Category Filter Switching Under Query', async () => {
      await ensureSearchModalOpen();
      await searchModal.search('member');
      await page.waitForTimeout(1000);

      const tabs = [searchModal.postsTab, searchModal.commentsTab, searchModal.peopleTab, searchModal.libraryTab, searchModal.allTab];
      for (const tab of tabs) {
        if (await tab.isVisible().catch(() => false)) {
          await tab.click();
          await page.waitForTimeout(50);
        }
      }
      await page.waitForTimeout(1500);
      await expect(searchModal.dialog).toBeVisible();
    });

    test('RACE-03: In-Flight Clear / Empty State Ghost Results Prevention', async () => {
      await ensureSearchModalOpen();
      await searchModal.search('member');
      await searchModal.searchInput.fill('');
      await page.waitForTimeout(2000);

      const dialogText = await searchModal.dialog.innerText();
      const hasGhostResults = dialogText.includes('View all') && !dialogText.includes('Recent searches');
      expect(hasGhostResults).toBe(false);
    });
  });

  // =========================================================================
  // 5. KEYBOARD UX & SHORTCUTS
  // =========================================================================
  test.describe('5. Keyboard UX & Focus Traps', () => {
    test('KEY-01: Escape Key Closes Search Modal', async () => {
      await ensureSearchModalOpen();
      await expect(searchModal.dialog).toBeVisible();
      await searchModal.closeViaEscape();
      await expect(searchModal.dialog).not.toBeVisible();
    });

    test('KEY-02: Keyboard Shortcut (Ctrl+K / Cmd+K) Opens Search Modal', async () => {
      await searchModal.openViaShortcut();
      await expect(searchModal.dialog).toBeVisible();
      await expect(searchModal.searchInput).toBeFocused();
    });
  });

  // =========================================================================
  // 6. FAULT INJECTION & ERROR RESILIENCE
  // =========================================================================
  test.describe('6. Network Fault Injection & Error Resilience', () => {
    test('CHAOS-01: Graceful UI State on Search API HTTP 500 Error', async () => {
      let pageCrash: boolean = false;
      const crashListener = () => (pageCrash = true);
      page.on('pageerror', crashListener);

      await page.route('**/api/search/v1*', route => {
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Internal Server Error' }),
        });
      });

      await ensureSearchModalOpen();
      await searchModal.search('trigger-500');
      await page.waitForTimeout(1500);

      page.off('pageerror', crashListener);
      expect(pageCrash).toBe(false);
      await expect(searchModal.dialog).toBeVisible();

      await page.unroute('**/api/search/v1*');
    });

    test('CHAOS-02: Graceful UI Handling of Empty Records Array from API', async () => {
      await page.route('**/api/search/v1*', route => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 200, data: { records: [], total: 0 } }),
        });
      });

      await ensureSearchModalOpen();
      await searchModal.search('empty-query-test');
      await page.waitForTimeout(1200);

      await page.unroute('**/api/search/v1*');
      await expect(searchModal.dialog).toBeVisible();
    });
  });

  // =========================================================================
  // 7. DELIBERATE FAIL CASES - REAL BUGS & VULNERABILITIES FOUND
  // =========================================================================
  test.describe('7. Vulnerabilities & Broken Features (Deliberate FAIL Cases)', () => {
    test('FAIL-01: Client Crash Vulnerability on Corrupted API Schema (Unhandled TypeError)', async () => {
      let clientCrashDetected = false;
      let crashErrorMsg = '';
      const errorListener = (err: any) => {
        if (err.message.includes('reading \'length\'') || err.message.includes('is not a function') || err.message.includes('Cannot read properties') || err.message.includes('records')) {
          clientCrashDetected = true;
          crashErrorMsg = err.message;
        }
      };
      const consoleListener = (msg: any) => {
        if (msg.type() === 'error' && (msg.text().includes('TypeError') || msg.text().includes('reading \'length\''))) {
          clientCrashDetected = true;
          crashErrorMsg = msg.text();
        }
      };
      page.on('pageerror', errorListener);
      page.on('console', consoleListener);

      try {
        await page.route('**/api/search/v1*', route => {
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ status: 200, data: { records: 'NOT_AN_ARRAY_CORRUPTED' } }),
          });
        });

        await ensureSearchModalOpen();
        await searchModal.search('trigger-schema-bug');
        await page.waitForTimeout(2000);
      } finally {
        page.off('pageerror', errorListener);
        page.off('console', consoleListener);
        await page.unroute('**/api/search/v1*').catch(() => {});
      }

      // EXPECTATION: Client must gracefully handle schema aberrations without throwing unhandled TypeError
      expect(clientCrashDetected, `BUG DETECTED: Frontend crashed with unhandled error: ${crashErrorMsg}`).toBe(false);
    });

    test('FAIL-02: Missing Input MaxLength Security Restriction', async () => {
      await ensureSearchModalOpen();
      // EXPECTATION: Search input MUST have a maxlength attribute to prevent client-side DoS/memory bloat
      await expect(searchModal.searchInput, 'SECURITY ISSUE: Search input is missing a maxlength attribute constraint!').toHaveAttribute('maxlength', /^[0-9]+$/, { timeout: 2000 });
    });

    test('FAIL-03: Cloudflare Hard WAF Block (403 Forbidden) on Injected Query', async () => {
      let apiStatus: number | undefined;
      const responseListener = (res: any) => {
        if (res.url().includes('/api/search/')) apiStatus = res.status();
      };
      page.on('response', responseListener);

      try {
        await ensureSearchModalOpen();
        await searchModal.search('<script>alert("test")</script>');
        await page.waitForTimeout(2000);
      } finally {
        page.off('response', responseListener);
      }

      // EXPECTATION: Application API should gracefully handle special characters with HTTP 200 (0 results) instead of Cloudflare 403 Forbidden
      expect(apiStatus, 'API ERROR: Search API returned HTTP 403 Forbidden instead of handling query with HTTP 200!').toBe(200);
    });

    test('FAIL-04: Massive Buffer Query Rejection (HTTP 403 on 5,000 Characters)', async () => {
      let bufferStatus: number | undefined;
      const responseListener = (res: any) => {
        if (res.url().includes('/api/search/')) bufferStatus = res.status();
      };
      page.on('response', responseListener);

      try {
        await ensureSearchModalOpen();
        await searchModal.searchInput.fill('A'.repeat(5000));
        await page.waitForTimeout(2500);
      } finally {
        page.off('response', responseListener);
      }

      // EXPECTATION: API should accept or truncate long input with HTTP 200 rather than dropping connection with HTTP 403
      expect(bufferStatus, 'BUFFER LIMIT: 5,000 character payload rejected with HTTP 403 instead of 200 OK!').toBe(200);
    });

    test('FAIL-05: Missing Individual Recent Search Delete Action', async () => {
      await ensureSearchModalOpen();
      await searchModal.search('member');
      await page.waitForTimeout(1000);
      await searchModal.searchInput.fill('');
      await page.waitForTimeout(1000);

      // EXPECTATION: User should be able to delete individual recent searches via a remove/trash button
      const removeBtn = page.locator('[role="dialog"] button[aria-label*="delete" i], [role="dialog"] button[aria-label*="remove" i], [role="dialog"] button:has(svg.lucide-trash)');
      await expect(removeBtn.first(), 'FEATURE GAP: Search box does not provide an individual delete button for recent search items!').toBeVisible({ timeout: 2500 });
    });
  });
});
